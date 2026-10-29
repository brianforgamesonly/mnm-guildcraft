// Order 28, ITEM 1: the wiki snapshot, fetched serially through the relay (scripts/wiki/relay.ts). Only this job
// contacts the wiki (order 28's added rule); everything else reads the snapshot it writes.
//   node scripts/wiki/snapshot.ts --relay <https://…workers.dev> --token-file <file> --out <dir> [--plan-only]
// Writes <dir>/snapshot.json and <dir>/CREDIT.md. Prints counts only.
//
// The polite guest (overrides 1 and 7): one request at a time; at most REQUEST_CAP per run, every attempt counted; maxlag=5
// (the relay adds it); a maxlag answer is waited out for its Retry-After, at most 3 times; a network error gets order 14's
// one retry after 10 s (scripts/probe/wiki.ts politeGet); a 403, a 429 or a challenge stops the run and is reported, never
// retried. A stop writes no snapshot: the import keeps yesterday's zone data (override 9).
//
// What it reads (ITEM 1's allowed actions, scripts/wiki/allowed.ts): siteinfo; the category trees under Category:NPCs,
// Category:Quests and Category:Zones, every subcategory followed (list=categorymembers), and the content of their pages, a
// category at a time (generator=categorymembers, 50 a request), skipping categories whose pages are all fetched already;
// Category:Named Mobs, Raid Encounters and Merchant as trees too, for membership only (titles, no content); the Quests
// and Factions buckets after their schema pages; and ITEM 3's 24-hour count of main-namespace edits (list=recentchanges).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { politeGet, wait, type Got } from '../probe/wiki.ts';
import { BUCKETS, MAXLAG, SCHEMA_PAGES } from './allowed.ts';
import { MEMBERSHIP, TREES, type SnapshotCategory, type SnapshotPage, type WikiSnapshot } from './types.ts';

/** Override 1: at most 150 requests per workflow run (about 60 expected). */
export const REQUEST_CAP = 150;
export const MAXLAG_WAITS = 3;
/** A Retry-After above this is not waited out: the run stops (the job has a time limit). */
const MAX_RETRY_AFTER_S = 60;
// Known limit (review, order 28): after a client-side timeout (20 s), order 14's retry 10 s later can reach the wiki while
// the first relayed request is still being served. Rare, and counted against the cap.

export class SnapshotStop extends Error {}

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type Getter = (url: string, opts: { headers?: Record<string, string>; mayRetry?: () => boolean }) => Promise<Got>;

/** The relay, called one request at a time, every attempt counted against the cap. */
export class Relay {
  count = 0;
  bytes = 0;
  maxlagWaits = 0;
  log: WikiSnapshot['requests']['log'] = [];
  private base: string;
  private token: string;
  private get: Getter;
  private sleep: (ms: number) => Promise<unknown>;
  readonly cap: number;
  constructor(base: string, token: string, get: Getter = politeGet, sleep: (ms: number) => Promise<unknown> = wait, cap = REQUEST_CAP) {
    this.base = base;
    this.token = token;
    this.get = get;
    this.sleep = sleep;
    this.cap = cap;
  }

  /** One allowed request. Returns the parsed answer; a bucket's own error string is returned for the caller to record. */
  async call(shape: string, params: Record<string, string>): Promise<Json> {
    const qs = new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: MAXLAG });
    const target = params.cmtitle ?? params.gcmtitle ?? params.titles ?? (params.query ? params.query.slice(0, 20) : shape);
    for (let lagged = 0; ; ) {
      if (this.count >= this.cap) throw new SnapshotStop(`request cap reached (${this.cap}) before ${shape}`);
      const got = await this.get(`${this.base}/api?${qs}`, { headers: { 'x-relay-token': this.token }, mayRetry: () => this.count + 2 <= this.cap });
      this.count += got.attempts;
      if (!got.res) {
        this.log.push({ shape, target, status: null, bytes: 0, attempts: got.attempts });
        throw new SnapshotStop(`${shape}: no answer after ${got.attempts} attempt(s): ${got.error}`);
      }
      const { res, bytes } = got;
      this.bytes += bytes.byteLength;
      this.log.push({ shape, target, status: res.status, bytes: bytes.byteLength, attempts: got.attempts });
      const body = new TextDecoder().decode(bytes);
      // A block is an answer (override 7): stop, report, never retry.
      if (res.status === 403 || res.status === 429 || res.headers.has('cf-mitigated'))
        throw new SnapshotStop(
          `${shape}: refused, HTTP ${res.status}${res.headers.get('x-relay-refused') ? ' by the relay' : ''}${res.headers.has('cf-mitigated') ? ` (cf-mitigated: ${res.headers.get('cf-mitigated')})` : ''}: ${body.slice(0, 200)}`,
        );
      if (res.status !== 200) throw new SnapshotStop(`${shape}: HTTP ${res.status}: ${body.slice(0, 200)}`);
      let json: Json;
      try {
        json = JSON.parse(body) as Json;
      } catch {
        throw new SnapshotStop(`${shape}: 200 but not JSON: ${body.slice(0, 200)}`);
      }
      if (json.error?.code === 'maxlag') {
        const after = Number(res.headers.get('retry-after') ?? '5');
        if (lagged >= MAXLAG_WAITS) throw new SnapshotStop(`${shape}: still lagged after ${MAXLAG_WAITS} waits`);
        if (!(after >= 0 && after <= MAX_RETRY_AFTER_S)) throw new SnapshotStop(`${shape}: maxlag with Retry-After ${after} s`);
        lagged++;
        this.maxlagWaits++;
        await this.sleep(after * 1000);
        continue;
      }
      if (json.error && typeof json.error === 'object') throw new SnapshotStop(`${shape}: API error ${json.error.code ?? '?'}: ${String(json.error.info ?? '').slice(0, 200)}`);
      return json;
    }
  }

  /** A request and every continuation of it (the API's continue object is sent back as it came). */
  async *pages(shape: string, params: Record<string, string>): AsyncGenerator<Json> {
    let cont: Record<string, string> = {};
    for (;;) {
      const json = await this.call(shape, { ...params, ...cont });
      yield json;
      if (!json.continue) return;
      cont = json.continue as Record<string, string>;
    }
  }
}

/** A category's members (titles), main namespace and subcategories. */
async function listCategory(relay: Relay, title: string): Promise<{ pages: string[]; subcats: string[] }> {
  const pages: string[] = [];
  const subcats: string[] = [];
  for await (const json of relay.pages('list', { action: 'query', list: 'categorymembers', cmtitle: title, cmtype: 'page|subcat', cmnamespace: '0|14', cmprop: 'title', cmlimit: '500' }))
    for (const m of (json.query?.categorymembers ?? []) as { ns: number; title: string }[]) (m.ns === 14 ? subcats : pages).push(m.title);
  return { pages, subcats };
}

/** The content of a category's main-namespace pages, 50 a request. */
async function categoryContent(relay: Relay, title: string, into: Record<string, SnapshotPage>): Promise<void> {
  const params = { action: 'query', generator: 'categorymembers', gcmtitle: title, gcmnamespace: '0', gcmlimit: '50', prop: 'revisions', rvprop: 'ids|timestamp|content', rvslots: 'main' };
  for await (const json of relay.pages('content', params)) addPages(json, into);
}

function addPages(json: Json, into: Record<string, SnapshotPage>): void {
  for (const p of (json.query?.pages ?? []) as Json[]) {
    const rev = p.revisions?.[0];
    const content = rev?.slots?.main?.content;
    if (!rev || typeof content !== 'string') continue; // its content comes in a continuation
    into[p.title] = { pageid: p.pageid, title: p.title, ns: p.ns, revid: rev.revid, timestamp: rev.timestamp, content };
  }
}

/**
 * Every category under a root, breadth first, each listed once. A category already listed from another root is not
 * listed again: it, and what is below it, gain this root too (a category reached twice keeps its first depth).
 */
async function walk(relay: Relay, root: string, into: Record<string, SnapshotCategory>): Promise<void> {
  const queue: [string, number][] = [[root, 0]];
  const seen = new Set<string>();
  while (queue.length) {
    const [title, depth] = queue.shift()!;
    if (seen.has(title)) continue;
    seen.add(title);
    if (!into[title]) into[title] = { ...(await listCategory(relay, title)), depth, roots: [] };
    if (!into[title].roots.includes(root)) into[title].roots.push(root);
    for (const s of into[title].subcats) if (!seen.has(s)) queue.push([s, depth + 1]);
  }
}

/** The schema page's field names: a bucket's schema page holds a JSON object keyed by field. */
export function schemaFields(schema: string | null): string[] {
  if (!schema) return [];
  try {
    const parsed = JSON.parse(schema) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).filter((k) => /^[a-z0-9_]+$/.test(k)) : [];
  } catch {
    return [];
  }
}

/** One planned content fetch: a whole category, 50 pages a request (continuation for oversized content may add a few). */
export interface PlannedFetch {
  root: string;
  category: string;
  /** The category's pages, and how many of them no earlier fetch in the plan brings. */
  pages: number;
  newPages: number;
  requests: number;
}
/** The requests after the content: the schema pages (1), one per bucket, and the recent changes (1). */
export const TAIL_REQUESTS = 1 + BUCKETS.length + 1;
/**
 * Kept free under the cap for what a plan cannot see: maxlag waits and the network retry (each a counted attempt),
 * content continuations, a category grown since its listing, more than one page of bucket rows or recent changes.
 */
export const PLAN_MARGIN = 15;

/**
 * Order 28 (the owner, 2026-10-29: plan first): the content fetches, decided from the title listings before any content
 * is read. Each tree's root first, then, repeatedly, the category holding the most pages no earlier fetch brings. A
 * category whose pages all come with earlier fetches is never fetched.
 */
export function planContent(categories: Record<string, SnapshotCategory>): PlannedFetch[] {
  const have = new Set<string>();
  const plan: PlannedFetch[] = [];
  const take = (root: string, c: string) => {
    const pages = categories[c].pages;
    const newPages = pages.filter((t) => !have.has(t)).length;
    plan.push({ root, category: c, pages: pages.length, newPages, requests: Math.max(1, Math.ceil(pages.length / 50)) });
    for (const t of pages) have.add(t);
  };
  for (const root of TREES) {
    if (!categories[root]) continue;
    if (categories[root].pages.some((t) => !have.has(t))) take(root, root);
    const inTree = Object.keys(categories).filter((c) => categories[c].roots.includes(root) && c !== root);
    const missing = (c: string) => categories[c].pages.filter((t) => !have.has(t)).length;
    for (;;) {
      const next = inTree.filter((c) => missing(c) > 0).sort((a, b) => missing(b) - missing(a) || a.localeCompare(b))[0];
      if (!next) break;
      take(root, next);
    }
  }
  return plan;
}

/** The run stopped before any content: the plan does not fit the cap (or only the plan was asked for). */
export class PlanStop extends SnapshotStop {
  plan: PlannedFetch[];
  listed: number;
  constructor(message: string, plan: PlannedFetch[], listed: number) {
    super(message);
    this.plan = plan;
    this.listed = listed;
  }
}

export async function takeSnapshot(relay: Relay, now: Date, opts: { planOnly?: boolean } = {}): Promise<WikiSnapshot> {
  const site = await relay.call('siteinfo', { action: 'query', meta: 'siteinfo' });
  const general = site.query?.general ?? {};

  const categories: Record<string, SnapshotCategory> = {};
  for (const root of [...TREES, ...MEMBERSHIP]) await walk(relay, root, categories);

  // The plan, before any content: a run that cannot finish within the cap stops here, having read titles only.
  const plan = planContent(categories);
  const planned = plan.reduce((n, p) => n + p.requests, 0) + TAIL_REQUESTS;
  if (opts.planOnly) throw new PlanStop(`plan only: ${relay.count} listing requests made, ${planned} more planned`, plan, relay.count);
  if (relay.count + planned + PLAN_MARGIN > relay.cap)
    throw new PlanStop(`the plan does not fit the cap: ${relay.count} listing requests made, ${planned} more planned, ${PLAN_MARGIN} kept free, cap ${relay.cap}`, plan, relay.count);

  // Content, a category at a time, for the trees only (the membership categories are read as titles), in the plan's
  // order. A page listed but not returned (moved or deleted between the two requests) stays out: counted here, and by
  // the parser (a tree page without content).
  const pages: Record<string, SnapshotPage> = {};
  for (const p of plan) await categoryContent(relay, p.category, pages);
  const listed = new Set(plan.flatMap((p) => categories[p.category].pages));
  const uncovered = [...listed].filter((t) => !pages[t]);
  if (uncovered.length) console.log(`::warning::${uncovered.length} listed page(s) came back without content: ${uncovered.slice(0, 20).join(', ')}`);

  // The buckets, after their schema pages (select('*') is refused, so the fields come from the schema).
  const schemas: Record<string, SnapshotPage> = {};
  addPages(await relay.call('schema', { action: 'query', prop: 'revisions', titles: SCHEMA_PAGES.join('|'), rvprop: 'ids|timestamp|content', rvslots: 'main' }), schemas);
  const buckets: WikiSnapshot['buckets'] = {};
  for (const [i, name] of BUCKETS.entries()) {
    const schema = schemas[SCHEMA_PAGES[i]]?.content ?? null;
    const fields = schemaFields(schema);
    if (!fields.length) {
      buckets[name] = { schema, fields, rows: null, error: 'no field names in the schema page' };
      continue;
    }
    const rows: Record<string, unknown>[] = [];
    let error: string | undefined;
    for (let offset = 0; ; offset += 5000) {
      const json = await relay.call('bucket', { action: 'bucket', query: `bucket('${name}').select(${fields.map((f) => `'${f}'`).join(',')}).limit(5000).offset(${offset}).run()` });
      if (typeof json.error === 'string') {
        error = json.error.slice(0, 300);
        break;
      }
      const got = Array.isArray(json.bucket) ? (json.bucket as Record<string, unknown>[]) : [];
      rows.push(...got);
      if (got.length < 5000) break;
    }
    buckets[name] = { schema, fields, rows: error ? null : rows, ...(error ? { error } : {}) };
  }

  // ITEM 3: the last 24 hours' main-namespace edits and creations, for the quiet-night estimate.
  const since = new Date(now.getTime() - 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const changes: { title: string; timestamp: string }[] = [];
  for await (const json of relay.pages('recentchanges', {
    action: 'query',
    list: 'recentchanges',
    rcend: since,
    rcnamespace: '0',
    rctype: 'edit|new',
    rcprop: 'title|timestamp',
    rclimit: '500',
  }))
    changes.push(...((json.query?.recentchanges ?? []) as { title: string; timestamp: string }[]).map((c) => ({ title: c.title, timestamp: c.timestamp })));

  const newest = Object.values(pages).reduce<SnapshotPage | null>((a, p) => (!a || p.revid > a.revid ? p : a), null);
  if (!newest) throw new SnapshotStop('no page content fetched');
  return {
    site: `${general.sitename ?? '?'} · ${general.generator ?? '?'}`,
    fetchedAt: now.toISOString(),
    version: { revid: newest.revid, timestamp: newest.timestamp },
    categories,
    pages,
    buckets,
    recentChanges: { since, changes },
    requests: { count: relay.count, bytes: relay.bytes, maxlagWaits: relay.maxlagWaits, log: relay.log },
  };
}

/** The CC BY-SA credit that travels with every copy of the snapshot (the artifact, and data/wiki-snapshot/ in PR B). */
export const CREDIT = `# Monsters and Memories Wiki snapshot

This data is taken from the Monsters and Memories Wiki (https://monstersandmemories.miraheze.org), written by its
contributors and licensed under the Creative Commons Attribution-ShareAlike 4.0 International licence (CC BY-SA 4.0,
https://creativecommons.org/licenses/by-sa/4.0/). Each page's history on the wiki lists its authors. GuildCraft keeps
the page text as fetched; its own parsing of it is shared under the same licence.
`;

if (import.meta.main) {
  const { values: args } = parseArgs({
    options: { relay: { type: 'string' }, 'token-file': { type: 'string' }, out: { type: 'string' }, 'plan-only': { type: 'boolean', default: false } },
  });
  if (!args.relay || !args['token-file'] || !args.out) throw new Error('--relay, --token-file and --out are required');
  const relay = new Relay(args.relay, readFileSync(args['token-file'], 'utf8').trim());
  /** Requests per shape and subject, most first: printed on every stop, so a stop says where the requests went. */
  const spent = () => {
    const by = new Map<string, { n: number; bytes: number }>();
    for (const l of relay.log) {
      const k = `${l.shape} ${l.target}`;
      const v = by.get(k) ?? { n: 0, bytes: 0 };
      by.set(k, { n: v.n + l.attempts, bytes: v.bytes + l.bytes });
    }
    return [...by].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => `${v.n}\t${v.bytes}\t${k}`).join('\n');
  };
  const planTable = (s: PlanStop) =>
    ['| Tree | Category | Pages | New pages | Requests |', '|---|---|---|---|---|', ...s.plan.map((p) => `| ${p.root} | ${p.category} | ${p.pages} | ${p.newPages} | ${p.requests} |`)].join('\n') +
    `\n\nListing requests: ${s.listed}. Content requests planned: ${s.plan.reduce((n, p) => n + p.requests, 0)}, then ${TAIL_REQUESTS} for the schema pages, buckets and recent changes, with ${PLAN_MARGIN} kept free. Cap: ${REQUEST_CAP}.`;
  try {
    const snap = await takeSnapshot(relay, new Date(), { planOnly: args['plan-only'] });
    mkdirSync(args.out, { recursive: true });
    writeFileSync(join(args.out, 'snapshot.json'), JSON.stringify(snap));
    writeFileSync(join(args.out, 'CREDIT.md'), CREDIT);
    const tree = (root: string) => Object.values(snap.categories).filter((c) => c.roots.includes(root));
    for (const root of [...TREES, ...MEMBERSHIP])
      console.log(`${root}: ${tree(root).length} categories, ${Math.max(...tree(root).map((c) => c.depth ?? 0))} levels of subcategories below it, ${new Set(tree(root).flatMap((c) => c.pages)).size} pages`);
    console.log(`pages with content: ${Object.keys(snap.pages).length}`);
    for (const [k, b] of Object.entries(snap.buckets)) console.log(`bucket ${k}: ${b.fields.length} fields, ${b.rows === null ? `no rows (${b.error})` : `${b.rows.length} rows`}`);
    console.log(`version: revid ${snap.version.revid} at ${snap.version.timestamp}`);
    console.log(`recent changes (24 h, main namespace): ${snap.recentChanges.changes.length}`);
    console.log(`requests: ${snap.requests.count} of ${REQUEST_CAP} (maxlag waits ${snap.requests.maxlagWaits}), ${snap.requests.bytes} bytes`);
  } catch (e) {
    if (e instanceof PlanStop) {
      // The plan (titles only were read): plan.md for the job summary.
      mkdirSync(args.out, { recursive: true });
      writeFileSync(join(args.out, 'plan.md'), `### Wiki snapshot plan\n\n${e.message}\n\n${planTable(e)}\n`);
      console.log(planTable(e));
    }
    const planOnly = args['plan-only'] && e instanceof PlanStop;
    console.log(`${planOnly ? '' : '::error::wiki snapshot stopped: '}${e instanceof Error ? e.message : String(e)}`);
    console.log(`requests: ${relay.count} of ${REQUEST_CAP}, ${relay.bytes} bytes. By request (attempts, bytes, what):\n${spent()}`);
    if (!planOnly) process.exitCode = 1;
  }
}

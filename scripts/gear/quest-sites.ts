// Order 37, PR B (ITEM 4; the owner, 2026-11-06: Way A): the quest lines' monstersandmemories.wiki links, checked monthly
// by .github/workflows/quest-sites.yml (and by dispatch), kept in the quest_site table (migrations/0032), which the Worker
// reads (src/gear/upgrades.ts QUEST_LINKS_SQL). Replaces the order 36 follow-up's run by hand and src/gear/quest-sites.json.
//   node scripts/gear/quest-sites.ts --copies dev[,production] --event schedule|workflow_dispatch [--dry-run]
//   Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (the import's secrets: D1 read and write).
//
// - Which quests: production's, by the import's quest key (origin_json.quests[].name, scripts/import/core.ts questsByItem),
//   for gear items. Each result is written to every copy named; a quest only dev holds is never checked.
// - How (a polite guest, order 14, through scripts/zone/sites.ts get): the named User-Agent, one request per quest, half a
//   second apart, one retry after 10 s on a network error only. First robots.txt: a 404 means allowed; a Disallow covering
//   /quests/ stops the run; any other answer, a 5xx or no answer stops it. Then a control request for a quest that cannot
//   exist: anything but a 404 means the site has changed, and the run stops. A 403 or a 429 on a quest stops it too (a block
//   is an answer). A stopped run writes nothing and fails the job.
// - The rules (decide): a link is never dropped on one bad answer. Only a counted check counts: a scheduled run at least
//   COUNT_GAP_DAYS after the quest's last counted check (a dispatch never counts). A 404 adds to the quest's counter only on
//   a counted check; the second counted 404 in a row removes the link; other 404s are reported and change nothing. A 200 at
//   the quest's own address adds the link (or adds it back) and clears the counter. A 5xx, a timeout, a network error or any
//   other answer changes nothing. A quest that leaves the data keeps its row and is no longer checked. Only changed rows
//   are written, plus one quest_site_run row per copy (the health check's record, scripts/health/judge.ts judgeQuestSites).
import { parseArgs } from 'node:util';
import { USER_AGENT } from '../probe/wiki.ts';
import { get as politeGet, MNM_WIKI, wikiSlug } from '../zone/sites.ts';
import { copies } from '../copies.ts';
import { remoteDb, remoteReadD1 } from '../import/db.ts';

export const COUNT_GAP_DAYS = 25;
export const REMOVE_AFTER = 2;
export const PAUSE_MS = 500;
const DAY_MS = 86_400_000;

/** Production's quests that reward gear: the import's quest key, distinct. */
export const QUESTS_SQL =
  "SELECT DISTINCT json_extract(q.value, '$.name') AS name FROM item, json_each(item.origin_json, '$.quests') q WHERE item.slot_mask <> 0 ORDER BY 1";
export const ROWS_SQL = 'SELECT quest, url, linked, last_result, counted_at, fails FROM quest_site';

export interface Row {
  quest: string;
  url: string;
  linked: number;
  last_result: string | null;
  counted_at: string | null;
  fails: number;
}
export interface Answer {
  status: number | null;
  finalUrl: string | null;
  text?: string;
  error?: string;
}
export type Kind = 'ok' | '404' | 'blocked' | 'error' | 'other';

export const questUrl = (quest: string) => `${MNM_WIKI}/quests/${wikiSlug(quest)}`;
const pathOf = (u: string | null) => (u ? new URL(u).pathname.replace(/\/+$/, '') : '');

/** ok: 200 at its own address. blocked: 403 or 429 (stops the run). error: no answer or a 5xx. other: anything else. */
export function classify(a: Answer, url: string): { kind: Kind; detail: string } {
  if (a.status === null) return { kind: 'error', detail: a.error ?? 'no answer' };
  if (a.status === 200) return pathOf(a.finalUrl) === pathOf(url) ? { kind: 'ok', detail: '200' } : { kind: 'other', detail: `200 at ${pathOf(a.finalUrl)}` };
  if (a.status === 404) return { kind: '404', detail: '404' };
  if (a.status === 403 || a.status === 429) return { kind: 'blocked', detail: String(a.status) };
  if (a.status >= 500) return { kind: 'error', detail: String(a.status) };
  return { kind: 'other', detail: String(a.status) };
}

/**
 * robots.txt (RFC 9309): the group naming our product token (GuildCraft), else the "*" group; the longest matching rule
 * wins, Allow on a tie; "*" matches any run and a final "$" anchors. True when `path` may be fetched.
 */
export function robotsAllows(text: string, path: string, token = USER_AGENT.split('/')[0]): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let open = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!open) groups.push({ agents: [], rules: [] });
      groups[groups.length - 1].agents.push(value.toLowerCase());
      open = true;
    } else if (key === 'allow' || key === 'disallow') {
      open = false;
      if (groups.length && value) groups[groups.length - 1].rules.push({ allow: key === 'allow', pattern: value });
    }
  }
  const mine = groups.filter((g) => g.agents.includes(token.toLowerCase()));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes('*'))).flatMap((g) => g.rules);
  let best: { allow: boolean; length: number } | null = null;
  for (const r of rules) {
    const anchored = r.pattern.endsWith('$');
    const body = anchored ? r.pattern.slice(0, -1) : r.pattern;
    const re = new RegExp(`^${body.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}${anchored ? '$' : ''}`);
    if (!re.test(path)) continue;
    if (!best || r.pattern.length > best.length || (r.pattern.length === best.length && r.allow)) best = { allow: r.allow, length: r.pattern.length };
  }
  return best ? best.allow : true;
}

/** One quest's row after one answer: the new row, or null when nothing changes. */
export function decide(row: Row | undefined, quest: string, kind: Kind, now: string, scheduled: boolean): { next: Row | null; change: 'added' | 'removed' | null; counted: boolean } {
  const url = questUrl(quest);
  const counting = scheduled && (!row?.counted_at || Date.parse(now) - Date.parse(row.counted_at) >= COUNT_GAP_DAYS * DAY_MS);
  let next: Row | null = null;
  let change: 'added' | 'removed' | null = null;
  if (kind === 'ok') {
    next = { quest, url, linked: 1, last_result: '200', counted_at: counting ? now : (row?.counted_at ?? null), fails: 0 };
    if (!row?.linked) change = 'added';
  } else if (kind === '404' && counting) {
    const fails = (row?.fails ?? 0) + 1;
    const linked = row?.linked && fails < REMOVE_AFTER ? 1 : 0;
    next = { quest, url, linked, last_result: '404', counted_at: now, fails };
    if (row?.linked && !linked) change = 'removed';
  }
  const same = (a: Row, b: Row) => a.url === b.url && Number(a.linked) === b.linked && a.last_result === b.last_result && a.counted_at === b.counted_at && Number(a.fails) === b.fails;
  if (next && row && same(row, next)) next = null;
  return { next, change, counted: counting && (kind === 'ok' || kind === '404') };
}

export interface CopyRows {
  name: string;
  rows: Map<string, Row>;
}
export interface Outcome {
  /** Set when the run stopped: nothing is written and the job fails. */
  stop?: string;
  requests: number;
  checked: number;
  copies: { name: string; writes: Row[]; added: string[]; removed: string[]; counted: number }[];
  /** 5xx, timeouts and network failures, with their quest. */
  errors: string[];
  /** 404s that did not count (reported only). */
  uncounted404: string[];
  /** Any other answer (reported only). */
  other: string[];
}

/** The whole check: robots.txt, the control, each quest, then each copy's changes. No writes here. */
export async function check(io: { get: (url: string, body?: boolean) => Promise<Answer>; sleep: (ms: number) => Promise<void> }, quests: string[], targets: CopyRows[], now: string, scheduled: boolean): Promise<Outcome> {
  const out: Outcome = { requests: 0, checked: 0, copies: targets.map((t) => ({ name: t.name, writes: [], added: [], removed: [], counted: 0 })), errors: [], uncounted404: [], other: [] };
  const ask = async (url: string, body = false) => {
    out.requests++;
    return io.get(url, body);
  };
  const robots = await ask(`${MNM_WIKI}/robots.txt`, true);
  if (robots.status === null) return { ...out, stop: `robots.txt: no answer (${robots.error ?? 'network'}); nothing changed` };
  if (robots.status === 200) {
    // Review fix: every quest's own address, not a sample (a rule can cover some quest pages and not others).
    const barred = quests.filter((q) => !robotsAllows(robots.text ?? '', new URL(questUrl(q)).pathname));
    if (barred.length) return { ...out, stop: `robots.txt disallows ${barred.length} quest page(s) (${barred.slice(0, 3).join('; ')}): stopped, nothing changed; report to the owner` };
  } else if (robots.status !== 404) return { ...out, stop: `robots.txt answered ${robots.status}: stopped, nothing changed` };
  await io.sleep(PAUSE_MS);
  const control = `${MNM_WIKI}/quests/guildcraft-no-such-quest-${Date.parse(now)}`;
  const c = await ask(control);
  if (c.status !== 404) return { ...out, stop: `the control (a quest that cannot exist) answered ${c.status ?? c.error ?? 'nothing'}, not 404: the site has changed; nothing changed` };
  const kinds = new Map<string, Kind>();
  for (const q of quests) {
    await io.sleep(PAUSE_MS);
    const url = questUrl(q);
    const k = classify(await ask(url), url);
    if (k.kind === 'blocked') return { ...out, stop: `${q}: ${k.detail} (a block is an answer, order 14): stopped, nothing changed` };
    kinds.set(q, k.kind);
    out.checked++;
    if (k.kind === 'error') out.errors.push(`${q}: ${k.detail}`);
    else if (k.kind === 'other') out.other.push(`${q}: ${k.detail}`);
  }
  // Review fix: a run in which no quest page answered is no check at all: it stops, so it is never recorded as a success.
  if (quests.length && out.errors.length === quests.length) return { ...out, stop: `every quest page failed (${out.errors[0]}, …): nothing changed` };
  for (const [i, t] of targets.entries()) {
    const o = out.copies[i];
    for (const q of quests) {
      const kind = kinds.get(q)!;
      const d = decide(t.rows.get(q), q, kind, now, scheduled);
      if (d.counted) o.counted++;
      if (d.next) o.writes.push(d.next);
      if (d.change === 'added') o.added.push(q);
      if (d.change === 'removed') o.removed.push(q);
      if (kind === '404' && !d.counted && t.rows.get(q)?.linked && i === 0) out.uncounted404.push(q);
    }
  }
  return out;
}

const lit = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
export const upsertSql = (r: Row) =>
  `INSERT INTO quest_site (quest, url, linked, last_result, counted_at, fails) VALUES (${[r.quest, r.url, r.linked, r.last_result, r.counted_at, r.fails].map(lit).join(', ')}) ` +
  'ON CONFLICT(quest) DO UPDATE SET url = excluded.url, linked = excluded.linked, last_result = excluded.last_result, counted_at = excluded.counted_at, fails = excluded.fails';

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { copies: { type: 'string', default: 'dev,production' }, event: { type: 'string', default: 'workflow_dispatch' }, 'dry-run': { type: 'boolean', default: false } } });
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
  const all = copies();
  const db = (name: string) => {
    const c = all.find((x) => x.name === name);
    if (!c) throw new Error(`no copy named ${name} in wrangler.jsonc`);
    return c.databaseId();
  };
  const started = new Date().toISOString();
  const scheduled = args.event === 'schedule';
  const out: string[] = [];
  const say = (s: string) => {
    console.log(s);
    out.push(s);
  };
  const summary = async () => {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (file) (await import('node:fs')).appendFileSync(file, `${out.join('\n')}\n`);
  };

  let rowsRead = 0;
  const prod = remoteReadD1({ accountId, apiToken, databaseId: db('production') });
  const q = (await prod.prepare(QUESTS_SQL).all()) as unknown as { results: { name: string | null }[]; meta: { rows_read: number } };
  rowsRead += q.meta.rows_read;
  const quests = q.results.map((r) => r.name).filter((n): n is string => !!n && !!n.trim());
  const names = args.copies.split(',').map((s) => s.trim()).filter(Boolean);
  const targets: CopyRows[] = [];
  for (const name of names) {
    const r = (await remoteReadD1({ accountId, apiToken, databaseId: db(name) }).prepare(ROWS_SQL).all()) as unknown as { results: Row[]; meta: { rows_read: number } };
    rowsRead += r.meta.rows_read;
    targets.push({ name, rows: new Map(r.results.map((x) => [x.quest, x])) });
  }
  say(`### quest-sites (${scheduled ? 'scheduled: checks can count' : 'dispatch: no check counts'}), ${started}`);
  say(`Quests from production: ${quests.length}. Copies written: ${names.join(', ')}${args['dry-run'] ? ' (dry run: nothing written)' : ''}.`);

  const o = await check({ get: politeGet, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) }, quests, targets, started, scheduled);
  say(`Requests to monstersandmemories.wiki: ${o.requests} (robots.txt, the control, ${o.checked} quests).`);
  if (o.stop) {
    say(`**Stopped:** ${o.stop}`);
    console.log(`::error::quest-sites stopped: ${o.stop}`);
    await summary();
    process.exit(1);
  }
  let rowsWritten = 0;
  for (const c of o.copies) {
    say(`- ${c.name}: checked ${o.checked}, links added ${c.added.length}${c.added.length ? ` (${c.added.join('; ')})` : ''}, links removed ${c.removed.length}${c.removed.length ? ` (${c.removed.join('; ')})` : ''}, counted checks ${c.counted}, rows written ${c.writes.length}`);
    if (args['dry-run']) continue;
    const finished = new Date().toISOString();
    const stmts = [
      ...c.writes.map(upsertSql),
      `INSERT INTO quest_site_run (started_at, finished_at, event, checked, added, removed, errors) VALUES (${[started, finished, scheduled ? 'schedule' : 'workflow_dispatch', o.checked, c.added.length, c.removed.length, o.errors.length].map(lit).join(', ')})`,
    ];
    const metas = await remoteDb({ accountId, apiToken, databaseId: db(c.name) }).run(stmts);
    rowsWritten += metas.reduce((n, m) => n + m.rows_written, 0);
  }
  say(`Errors (5xx, timeout, network): ${o.errors.length}${o.errors.length ? `: ${o.errors.join('; ')}` : ''}`);
  if (o.uncounted404.length) say(`404s that did not count (a link is kept): ${o.uncounted404.join('; ')}`);
  if (o.other.length) say(`Other answers (nothing changed): ${o.other.join('; ')}`);
  say(`D1: ${rowsRead} rows read, ${rowsWritten} rows written (index writes included).`);
  await summary();
}

// Order 17b, ITEM 3: the zone card's links to the other sites, one derived file (src/zone/sites.json). Run by hand when
// zones change, never on a schedule, after a real-data import into the local D1:
//   node scripts/import/zone-files.ts --out <dir>
//   node scripts/bench/import-writes.ts --file <dir>/mnm-tools__wiki.json --sha <sha> --runs 1 --zones-dir <dir>
//   node scripts/zone/sites.ts [--dry-run]
// The zones are the local D1's active zones, the rows the same import code writes to the live copies. For each zone:
//   monstersandmemories.wiki: one request to /zones/z-<slug> (the slug: the name, lower-case, apostrophes dropped,
//     hyphenated). Accepted only when it answers 200 at /zones/<slug> after redirects; anything else means no link (never
//     the /zones index, which is the card's Zone connections button).
//   storiesofmnm.com: one read of its /zones/ index; a zone whose name matches a listed zone exactly (case and apostrophes
//     aside) gets that page, accepted only when one request to it answers 200 at the same page after redirects.
// The Monsters and Memories Wiki on Miraheze is never contacted (order 14); the card builds its link from the import.
// A polite guest (order 14): one request per zone per site, order 14's named User-Agent, one retry after 10 s on a network
// error only, never on a 403 or 429. A link the file held before that no longer verifies stops the run and keeps the old
// file: the owner decides (CI checks the same, scripts/ci/zone-sites.test.ts). Writes nothing remote; reads no credential.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { USER_AGENT } from '../probe/wiki.ts';
import { zoneKey } from '../../src/zone/names.ts';

export const SITES_FILE = new URL('../../src/zone/sites.json', import.meta.url);
export const MNM_WIKI = 'https://monstersandmemories.wiki';
export const STORIES = 'https://storiesofmnm.com';
export const SITE_KEYS = ['mnmWiki', 'stories'] as const;
export type SiteKey = (typeof SITE_KEYS)[number];
export interface SitesFile {
  about: string;
  checkedAt: string;
  zones: Record<string, { name: string } & Record<SiteKey, string | null>>;
}

/** The monstersandmemories.wiki slug: lower-case, apostrophes dropped, every other run of non-alphanumerics a hyphen. */
export const wikiSlug = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
/** Stories of MnM's names are matched exactly, case and apostrophes aside (the owner's order 17b rule). */
export const storiesName = (name: string) => zoneKey(name.replace(/[‘’]/g, "'")).trim();
const decode = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Stories of MnM's index: each zone page it links ("/zone/<slug>/") with the link's text. */
export function storiesIndex(html: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of html.matchAll(/<a\b[^>]*href="((?:https:\/\/(?:www\.)?storiesofmnm\.com)?\/zone\/([a-z0-9-]+)\/?)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = decode(m[3]);
    if (text && !out.has(storiesName(text))) out.set(storiesName(text), `${STORIES}/zone/${m[2]}/`);
  }
  return out;
}

/** Links `before` held that `after` lacks, for every zone `after` still holds (a zone gone from the database is not a loss). */
export const lostLinks = (before: SitesFile, after: SitesFile): string[] =>
  Object.entries(before.zones).flatMap(([k, z]) => SITE_KEYS.filter((s) => z[s] && after.zones[k] && !after.zones[k][s]).map((s) => `${z.name}: ${s} ${z[s]}`));

const RETRY_AFTER_MS = 10_000;
const TIMEOUT_MS = 20_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One GET, redirects followed: the status and final address only (the body is discarded unread unless `body`). */
async function get(url: string, body = false): Promise<{ status: number | null; finalUrl: string | null; text?: string; error?: string }> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = body ? await res.text() : undefined;
      if (!body) await res.body?.cancel();
      return { status: res.status, finalUrl: res.url, text };
    } catch (e) {
      if (attempt >= 2) return { status: null, finalUrl: null, error: (e as Error).message };
      await sleep(RETRY_AFTER_MS);
    }
  }
}
const path = (u: string | null) => (u ? new URL(u).pathname.replace(/\/+$/, '') : '');

export interface Check {
  zone: string;
  site: SiteKey;
  tried: string | null;
  status: number | null;
  finalUrl: string | null;
  accepted: string | null;
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
  let zones: { key: string; name: string }[];
  try {
    zones = (await proxy.env.DB.prepare('SELECT key, name FROM zone WHERE active = 1 ORDER BY key').all<{ key: string; name: string }>()).results;
  } finally {
    await proxy.dispose();
  }
  if (!zones.length) throw new Error('the local D1 holds no active zones: run the real-data import first (see the header)');

  const index = await get(`${STORIES}/zones/`, true);
  console.log(`stories index: ${index.status} ${index.finalUrl ?? index.error}`);
  if (index.status !== 200 || !index.text) throw new Error('Stories of MnM\'s /zones/ index did not answer 200; nothing written');
  const stories = storiesIndex(index.text);
  console.log(`stories index lists ${stories.size} zone pages`);

  const checks: Check[] = [];
  const out: SitesFile = { about: 'Derived by scripts/zone/sites.ts (order 17b); never edited by hand.', checkedAt: new Date().toISOString(), zones: {} };
  for (const z of zones) {
    const slug = wikiSlug(z.name);
    const tried = `${MNM_WIKI}/zones/z-${slug}`;
    const w = await get(tried);
    const wikiOk = w.status === 200 && path(w.finalUrl) === `/zones/${slug}`;
    checks.push({ zone: z.name, site: 'mnmWiki', tried, status: w.status, finalUrl: w.finalUrl ?? w.error ?? null, accepted: wikiOk ? `${MNM_WIKI}/zones/${slug}` : null });

    const page = stories.get(storiesName(z.name)) ?? null;
    let storiesOk: string | null = null;
    if (page) {
      const s = await get(page);
      storiesOk = s.status === 200 && path(s.finalUrl) === path(page) ? page : null;
      checks.push({ zone: z.name, site: 'stories', tried: page, status: s.status, finalUrl: s.finalUrl ?? s.error ?? null, accepted: storiesOk });
    } else checks.push({ zone: z.name, site: 'stories', tried: null, status: null, finalUrl: null, accepted: null });
    out.zones[z.key] = { name: z.name, mnmWiki: checks.at(-2)!.accepted, stories: storiesOk };
    await sleep(500);
  }
  for (const c of checks) console.log(`${c.zone}\t${c.site}\t${c.tried ?? '(no page in the index)'}\t${c.status ?? '-'}\t${c.finalUrl ?? '-'}\t${c.accepted ? 'LINK' : 'none'}`);
  for (const s of SITE_KEYS) console.log(`${s}: ${Object.values(out.zones).filter((z) => z[s]).length} of ${zones.length} zones have a link`);

  // A link held before that no longer verifies: stop, keep the old file.
  let before: SitesFile | null = null;
  try {
    before = JSON.parse(readFileSync(SITES_FILE, 'utf8')) as SitesFile;
  } catch {}
  const lost = before ? lostLinks(before, out) : [];
  if (lost.length) {
    console.error(`links held before that no longer verify, nothing written:\n  ${lost.join('\n  ')}`);
    process.exit(1);
  }
  if (args['dry-run']) console.log('dry run: nothing written');
  else {
    writeFileSync(SITES_FILE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`written: ${SITES_FILE.pathname}`);
  }
}

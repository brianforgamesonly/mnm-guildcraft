// Order 36 follow-up (the owner, 2026-11-06: "Ok to check quest links"): the quest lines' links to monstersandmemories.wiki,
// one derived file (src/gear/quest-sites.json). Run by hand when quests change, never on a schedule, after a real-data import
// into the local D1 (npm run import:local), which keeps each gear item's quests (origin_json.quests):
//   node scripts/gear/quest-sites.ts [--dry-run]
// For each quest name: one request to /quests/<slug> (the zone links' slug rule, scripts/zone/sites.ts wikiSlug), accepted
// only when it answers 200 at that same path after redirects; anything else means no link. First, one control request to a
// slug no quest can have: if that answers 200 at its own path, a "page" is not proof of one, so the run stops and writes
// nothing. A polite guest (order 14): one request per quest, order 14's named User-Agent, one retry after 10 s on a network
// error only, never on a 403 or 429, half a second apart. A link the file held before that no longer verifies stops the run
// and keeps the old file (as the zone links). Writes nothing remote; reads no credential.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { get, MNM_WIKI, wikiSlug } from '../zone/sites.ts';

export const QUEST_SITES_FILE = new URL('../../src/gear/quest-sites.json', import.meta.url);
export interface QuestSitesFile {
  about: string;
  checkedAt: string | null;
  quests: Record<string, string>;
}
const path = (u: string | null) => (u ? new URL(u).pathname.replace(/\/+$/, '') : '');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Links `before` held that `after` lacks, for quests `after` was asked about. */
export const lostQuestLinks = (before: QuestSitesFile, after: QuestSitesFile, asked: Set<string>) =>
  Object.entries(before.quests).filter(([name]) => asked.has(name) && !after.quests[name]).map(([name, url]) => `${name}: ${url}`);

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
  let names: string[];
  try {
    const { results } = await proxy.env.DB.prepare(
      "SELECT DISTINCT json_extract(q.value, '$.name') AS name FROM item, json_each(item.origin_json, '$.quests') q WHERE item.slot_mask <> 0 ORDER BY 1",
    ).all<{ name: string }>();
    names = results.map((r) => r.name).filter(Boolean);
  } finally {
    await proxy.dispose();
  }
  if (!names.length) throw new Error('the local D1 holds no gear quests: run npm run import:local first');
  console.log(`${names.length} quests reward gear`);

  const control = `${MNM_WIKI}/quests/guildcraft-no-such-quest-${Date.now()}`;
  const c = await get(control);
  console.log(`control ${control}: ${c.status ?? c.error} ${c.finalUrl ?? ''}`);
  if (c.status === 200 && path(c.finalUrl) === path(control)) throw new Error('a quest that cannot exist answered 200 at its own path: a page is no proof; nothing written');

  const out: QuestSitesFile = { about: 'Derived by scripts/gear/quest-sites.ts (order 36 follow-up); never edited by hand.', checkedAt: new Date().toISOString(), quests: {} };
  let requests = 1;
  for (const name of names) {
    const slug = wikiSlug(name);
    const url = `${MNM_WIKI}/quests/${slug}`;
    const r = await get(url);
    requests++;
    const ok = r.status === 200 && path(r.finalUrl) === `/quests/${slug}`;
    if (ok) out.quests[name] = url;
    console.log(`${name}\t${url}\t${r.status ?? r.error}\t${ok ? 'LINK' : 'none'}`);
    await sleep(500);
  }
  console.log(`${Object.keys(out.quests).length} of ${names.length} quests have a link; ${requests} requests`);

  let before: QuestSitesFile | null = null;
  try {
    before = JSON.parse(readFileSync(QUEST_SITES_FILE, 'utf8')) as QuestSitesFile;
  } catch {}
  const lost = before ? lostQuestLinks(before, out, new Set(names)) : [];
  if (lost.length) {
    console.error(`links held before that no longer verify, nothing written:\n  ${lost.join('\n  ')}`);
    process.exit(1);
  }
  if (args['dry-run']) console.log('dry run: nothing written');
  else {
    writeFileSync(QUEST_SITES_FILE, `${JSON.stringify(out, null, 2)}\n`);
    console.log(`written: ${QUEST_SITES_FILE.pathname}`);
  }
}

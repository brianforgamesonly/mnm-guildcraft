// Order 23, ITEM 1: how many zone names map to an active zone (per source), and how many zone buttons the real pages and
// cards get. Read-only: the dev copy through remoteReadD1 (SELECTs only; CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN
// from the environment), or the local D1 after a real-data import.
//   node scripts/bench/zone-buttons.ts [--remote]
// /gear: the Worker's own resultsPage (src/commands/gear.ts) for every class with slot CHEST, one weapon search (Any,
// PRIMARY), up to PAGES pages each, and page 1 of every zone's results (class Any). /item: the card's own fields
// (cardFields) and layout (layoutZoneButtons) over every item that names a zone, from three bulk reads (a card per item
// over HTTP would take too long). A bench guild id, so no guild data is read. The output names zones and items only.
/// <reference types="@cloudflare/workers-types" />
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { cardFields, parseQuery, resultsPage } from '../../src/commands/gear.ts';
import { statFields } from '../../src/commands/find.ts';
import { layoutZoneButtons, CUSTOM_ID_MAX, matchZones, OPEN_PREFIX, type ZoneMatch, type ZoneRef } from '../../src/zone/buttons.ts';
import { loadZone } from '../../src/zone/card.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE } from '../../src/zone/names.ts';
import { GEAR_COLS, type GearRow } from '../../src/gear/search.ts';
import type { Option } from '../../src/discord.ts';
import { copyDatabaseId, remoteReadD1 } from '../import/db.ts';

const PAGES = 3;
/** The rows a private /item card uses (Post to channel with the links; the action row): test/worker/zone-buttons.test.ts. */
const ITEM_CARD_ROWS = 2;

const { values: args } = parseArgs({ options: { remote: { type: 'boolean', default: false } } });
const need = (name: string) => process.env[name] || (() => { throw new Error(`${name} is not set`); })();
let db: D1Database;
let dispose = async () => {};
if (args.remote) {
  db = remoteReadD1({ accountId: need('CLOUDFLARE_ACCOUNT_ID'), apiToken: need('CLOUDFLARE_API_TOKEN'), databaseId: copyDatabaseId() });
  console.log(`copy: ${process.env.GUILDCRAFT_COPY || 'dev'} (remote, read-only)`);
} else {
  const { getPlatformProxy } = await import('wrangler');
  // This checkout's config and local state, whatever the shell's directory.
  const root = new URL('../../', import.meta.url);
  const proxy = await getPlatformProxy<{ DB: D1Database }>({
    environment: 'dev',
    configPath: fileURLToPath(new URL('wrangler.jsonc', root)),
    persist: { path: fileURLToPath(new URL('.wrangler/state/v3', root)) },
  });
  db = proxy.env.DB;
  dispose = () => proxy.dispose();
}
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
const dist = (xs: number[]) => `median ${median(xs)}, max ${xs.length ? Math.max(...xs) : 0} (n=${xs.length})`;
let rowsRead = 0;
const all = async <T>(sql: string, ...binds: unknown[]) => {
  const r = await db.prepare(sql).bind(...binds).all<T>();
  rowsRead += r.meta?.rows_read ?? 0;
  return r.results;
};

try {
  // ---------------------------------------------------------------- 1. the names, per source
  const MATCH = `LEFT JOIN zone_name zn ON zn.source = ?1 AND zn.name = j.value AND zn.active = 1 LEFT JOIN zone z ON z.key = zn.zone_key AND z.active = 1`;
  const sources = [
    { source: WIKI_ZONES_SOURCE, label: "items' wikiZones", per: 'items', sql: `SELECT j.value AS name, COUNT(DISTINCT item.id) AS n, MAX(z.key IS NOT NULL) AS matched FROM item, json_each(item.origin_json, '$.wikiZones') j ${MATCH} WHERE item.origin_json IS NOT NULL GROUP BY j.value ORDER BY n DESC, name` },
    { source: MOB_ZONES_SOURCE, label: "mobs' zones_json", per: 'mobs', sql: `SELECT j.value AS name, COUNT(DISTINCT mob.key) AS n, MAX(z.key IS NOT NULL) AS matched FROM mob, json_each(mob.zones_json) j ${MATCH} WHERE mob.active = 1 GROUP BY j.value ORDER BY n DESC, name` },
  ];
  for (const s of sources) {
    const names = await all<{ name: string; n: number; matched: number }>(s.sql, s.source);
    const unmatched = names.filter((x) => !x.matched);
    console.log(`${s.label}: ${names.filter((x) => x.matched).length} of ${names.length} distinct names map to an active zone; ${s.per} naming an unmatched name: ${unmatched.reduce((a, x) => a + x.n, 0)}`);
    console.log(`  top by ${s.per}: ${names.slice(0, 10).map((x) => `${x.name} ${x.n}${x.matched ? '' : ' (unmatched)'}`).join(' · ')}`);
    console.log(`  unmatched, top 10 by ${s.per}: ${unmatched.slice(0, 10).map((x) => `${x.name} (${x.n})`).join(' · ') || 'none'}`);
  }
  const zones = await all<{ key: string; name: string }>('SELECT key, name FROM zone WHERE active = 1 ORDER BY key');
  const long = zones.filter((z) => OPEN_PREFIX.length + z.key.length > CUSTOM_ID_MAX);
  console.log(`active zones: ${zones.length}; keys too long for "${OPEN_PREFIX}<key>" (over ${CUSTOM_ID_MAX - OPEN_PREFIX.length}): ${long.length}; longest key ${Math.max(...zones.map((z) => z.key.length))}`);

  // ---------------------------------------------------------------- 2. /gear pages
  const c = { db, guild: { id: 'bench-guild', learning_window: 25 } } as never;
  const classes = (await all<{ code: string }>('SELECT code FROM game_class WHERE item_count > 0 AND bit IS NOT NULL ORDER BY code')).map((x) => x.code);
  const opt = (o: Record<string, string>): Option[] => Object.entries(o).map(([name, value]) => ({ name, type: 3, value }) as Option);
  const searches = [
    ...classes.map((cls) => ({ label: `${cls} CHEST`, opts: { class: cls, slot: 'CHEST' }, pages: PAGES })),
    { label: 'Any PRIMARY', opts: { class: 'Any', slot: 'PRIMARY' }, pages: PAGES },
    ...zones.map((z) => ({ label: `zone ${z.name}`, opts: { class: 'Any', zone: z.name }, pages: 1 })),
  ];
  const per = { normal: [] as number[], zone: [] as number[] };
  const lookup: number[] = [];
  const over: string[] = [];
  const examples: string[] = [];
  let pages = 0;
  for (const s of searches) {
    const q = parseQuery(opt(s.opts));
    if (typeof q === 'string') throw new Error(`${s.label}: ${q}`);
    for (let n = 0; n < s.pages; n++) {
      const p = await resultsPage(c, q, n);
      if (!p) break;
      pages++;
      (q.zone === undefined ? per.normal : per.zone).push(p.zones.zones);
      if (p.zones.zones) lookup.push(p.zones.rowsRead);
      if (p.zones.zones > p.zones.shown) over.push(`${s.label} p${n + 1}: ${p.zones.zones} zones, ${p.zones.shown} shown`);
      const buttons = (p.data.components as { components: { custom_id?: string; label: string }[] }[]).flatMap((r) => r.components).filter((b) => b.custom_id?.startsWith(OPEN_PREFIX));
      if (n === 0 && examples.length < 6 && buttons.length) examples.push(`${s.label}: ${buttons.map((b) => b.label).join(' | ')} (${p.data.components!.length} rows)`);
    }
  }
  console.log(`/gear pages sampled: ${pages} (${searches.length} searches); distinct matched zones per page: normal ${dist(per.normal)}; zone mode (own zone left out) ${dist(per.zone)}`);
  console.log(`/gear pages with more zones than fit: ${over.length} of ${pages}${over.length ? ` (${over.slice(0, 10).join('; ')})` : ''}`);
  console.log(`/gear pages naming no matched zone: normal ${per.normal.filter((x) => x === 0).length} of ${per.normal.length}, zone mode ${per.zone.filter((x) => x === 0).length} of ${per.zone.length}`);
  console.log(`examples:\n  ${examples.join('\n  ')}`);

  // ---------------------------------------------------------------- 3. /item cards
  const items = await all<GearRow>(`SELECT ${GEAR_COLS}, NULL AS sort_value, total_stats FROM item WHERE origin_json IS NOT NULL ORDER BY id`);
  const mobs = await all<{ key: string; title: string; level: string | null; zones_json: string | null }>('SELECT key, title, level, zones_json FROM mob WHERE active = 1');
  const matches = await all<ZoneMatch>(
    `SELECT zn.source, zn.name, z.key, z.name AS zone FROM zone_name zn JOIN zone z ON z.key = zn.zone_key AND z.active = 1 WHERE zn.active = 1 AND zn.source IN ('${WIKI_ZONES_SOURCE}', '${MOB_ZONES_SOURCE}')`,
  );
  const byName = new Map<string, typeof mobs>();
  for (const m of mobs) for (const k of new Set([m.key.toLowerCase(), m.title.toLowerCase()])) byName.set(k, [...(byName.get(k) ?? []), m]);
  const perItem: { name: string; zones: number; shown: number; refs: ZoneRef[] }[] = [];
  for (const r of items) {
    const from = (JSON.parse(r.origin_json ?? '{}') as { from?: string[] }).from ?? [];
    const d = { classes: [], mobs: [...new Set(from.flatMap((f) => byName.get(f.toLowerCase()) ?? []))], recipes: [], crafters: [], version: null };
    const item = { id: r.id, name: r.name, icon_url: r.icon_url, slot: r.slot, stats_json: r.stats_json, wiki_url: r.wiki_url, source: r.source };
    const { zones: refs } = cardFields(statFields(item), r, d);
    const z = layoutZoneButtons(refs, matches, ITEM_CARD_ROWS);
    if (z.zones) perItem.push({ name: r.name, zones: z.zones, shown: z.shown, refs });
  }
  const sorted = [...perItem].sort((a, b) => b.zones - a.zones);
  const one = perItem.find((x) => x.zones === 1);
  console.log(`/item cards with a zone button: ${perItem.length} of ${items.length} items with a source record; distinct matched zones per card ${dist(perItem.map((x) => x.zones))}`);
  console.log(`/item cards with more zones than fit: ${perItem.filter((x) => x.zones > x.shown).length}; most: ${sorted.slice(0, 5).map((x) => `${x.name} (${x.zones})`).join(' · ')}; one zone e.g. ${one?.name ?? '-'}`);

  // ---------------------------------------------------------------- 4. the cost
  const press: number[] = [];
  for (const z of zones) press.push((await loadZone(db, z.key))!.rowsRead);
  // The card's lookup, measured on the 10 cards with the most zones (the worst case) and every 50th card.
  const card: number[] = [];
  for (const x of [...sorted.slice(0, 10), ...perItem.filter((_, i) => i % 50 === 0)]) card.push((await matchZones(db, x.refs)).rowsRead);
  console.log(`rows read: the zone lookup per /gear page that names a zone ${dist(lookup)}; per /item card ${dist(card)}; a zone button press (loadZone) ${dist(press)}`);
  console.log(`rows read by this bench, outside resultsPage and loadZone: ${rowsRead}`);
} finally {
  await dispose();
}

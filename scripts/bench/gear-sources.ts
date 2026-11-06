// Order 37 (ITEMs 1 and 2) on the local D1 after a real-data import (npm run import:local): reads only, writes nothing.
//   node scripts/bench/gear-sources.ts [--item "<name>" ...]
// - The source rows' cold cost (src/gear/sources.ts sourceCache): D1's own rows_read per statement.
// - ITEM 1's mismatch scan: gear items whose level_kind is mob and whose drop line's creature (dropPick, through the page
//   path the Worker uses, pageSources) does not have level_low as its low. The target is 0; each mismatch is listed. Each
//   item's page lookup's rows_read is reported (median and worst).
// - ITEM 2's counts: vendor gear items whose line names a merchant, names zones only, or shows the record as recorded.
// - --item: that item's how-to-get lines, as /gear upgrades shows them (howToGet, with its real page data).
import { getPlatformProxy } from 'wrangler';
import { clearSourceIndex, dropPick, pageSources, SOURCE_SQL, sourceCache, vendorParts } from '../../src/gear/sources.ts';
import { VERSION_SQL, GEAR_INDEX_SQL, toItem } from '../../src/gear/index.ts';
import { extrasFor, howToGet } from '../../src/gear/upgrades.ts';

const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
const db = proxy.env.DB;
try {
  const r = await db.batch([db.prepare(SOURCE_SQL.mobs), db.prepare(SOURCE_SQL.lootNpcs), db.prepare(SOURCE_SQL.zoneNames), db.prepare(SOURCE_SQL.zones)]);
  r.forEach((x, i) => console.log(`source rows ${['mobs', 'lootNpcs', 'zoneNames', 'zones'][i]}: ${x.results.length} rows, rows_read ${x.meta?.rows_read}`));
  // CPU as order 36's bench measures it: a PROXY in Node, median and worst of 20 cold builds.
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    clearSourceIndex();
    const t = performance.now();
    await sourceCache(db, null);
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  console.log(`source rows read and built, 20 runs (D1 wait included): median ${times[10].toFixed(2)} ms, worst ${times[19].toFixed(2)} ms`);
  const cache = await sourceCache(db, null);
  console.log(`source rows, cold: rows_read ${cache.rowsRead}`);

  const { results: items } = await db
    .prepare('SELECT id, name, name_key, level_low, level_kind, level_kinds, origin_json FROM item WHERE slot_mask <> 0')
    .all<{ id: number; name: string; name_key: string; level_low: number | null; level_kind: string | null; level_kinds: string | null; origin_json: string | null }>();
  const origin = (s: string | null) => (s ? JSON.parse(s) : {}) as { from?: string[]; wikiZones?: string[]; soldBy?: { vendors?: string[] } };
  const page = async (it: (typeof items)[number]) => {
    const o = origin(it.origin_json);
    return { o, ...(await pageSources(db, cache, [{ key: it.name_key, from: o.from ?? [], vendors: o.soldBy?.vendors ?? [] }])) };
  };

  // ITEM 1.
  const mob = items.filter((it) => it.level_kind === 'mob');
  const bad: string[] = [];
  const lookups: number[] = [];
  const heavy: { name: string; rows: number; names: number }[] = [];
  for (const it of items) {
    const { o, rowsRead } = await page(it);
    heavy.push({ name: it.name, rows: rowsRead, names: new Set([...(o.from ?? []), ...cache.base.creaturesOf(it.name_key, [])]).size });
  }
  heavy.sort((a, b) => b.rows - a.rows);
  console.log(`heaviest lookups (every gear item): ${heavy.slice(0, 5).map((h) => `${h.name} ${h.rows} rows (${h.names} creature names)`).join(' · ')}`);
  for (const it of mob) {
    const { o, src, rowsRead } = await page(it);
    lookups.push(rowsRead);
    const p = dropPick(src, it.name_key, o.from ?? [], o.wikiZones ?? []);
    if (p?.range?.low !== it.level_low) bad.push(`${it.name}: level_low ${it.level_low}, shown ${p ? `${p.name} ${p.range?.low ?? 'no level'}` : 'no creature'}`);
  }
  lookups.sort((a, b) => a - b);
  console.log(`\nITEM 1 mismatch scan: ${bad.length} of ${mob.length} gear items with level_kind mob; one item's lookup by name: rows_read median ${lookups[lookups.length >> 1]}, worst ${lookups.at(-1)}`);
  for (const b of bad) console.log(`  ${b}`);

  // ITEM 2.
  const sold = items.filter((it) => (it.level_kinds ?? '').split(',').includes('vendor'));
  const tally = { merchant: 0, zoneOnly: 0, asRecorded: 0, empty: 0 };
  const zoneNames = new Set(cache.zones.zoneName.values());
  for (const it of sold) {
    const { o, src } = await page(it);
    const v = o.soldBy?.vendors ?? [];
    if (!v.length) {
      tally.empty++;
      continue;
    }
    const p = vendorParts(src, v);
    tally[p.merchants.length ? 'merchant' : p.zoneKeys.length && p.rest.every((x) => zoneNames.has(x)) ? 'zoneOnly' : 'asRecorded']++;
  }
  console.log(`\nITEM 2: ${sold.length} vendor gear items: named merchant ${tally.merchant}, zones only ${tally.zoneOnly}, as recorded ${tally.asRecorded}, no vendor recorded ${tally.empty}`);

  // --item.
  const ver = (await db.prepare(VERSION_SQL).all<{ v: string }>()).results[0]?.v ?? null;
  for (let i = process.argv.indexOf('--item'); i !== -1; i = process.argv.indexOf('--item', i + 1)) {
    const name = process.argv[i + 1];
    const row = await db.prepare(`${GEAR_INDEX_SQL} AND name = ?`).bind(name).first();
    if (!row) {
      console.log(`\n${name}: not a gear item`);
      continue;
    }
    const it = toItem(row as never);
    const x = await extrasFor({ db, guild: { id: 'bench-o37' } } as never, [it], ver);
    console.log(`\n${name}:\n  ${howToGet(it, x, 'bench-user', 25).lines.join('\n  ')}`);
  }
} finally {
  await proxy.dispose();
}

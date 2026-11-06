// Order 37 (ITEMs 1 and 2) on the local D1 after a real-data import (npm run import:local): reads only, writes nothing.
//   node scripts/bench/gear-sources.ts [--item "<name>" ...]
// - The source index's cold cost: D1's own rows_read per statement (src/gear/sources.ts SOURCE_SQL).
// - ITEM 1's mismatch scan: gear items whose level_kind is mob and whose drop line's creature (dropPick) does not have
//   level_low as its low. The target is 0; each mismatch is listed.
// - ITEM 2's counts: vendor gear items whose line names a merchant, names zones only, or shows the record as recorded.
// - --item: that item's how-to-get lines, as /gear upgrades shows them (howToGet, with its real page data).
import { getPlatformProxy } from 'wrangler';
import { buildSourceIndex, dropPick, SOURCE_SQL, vendorParts } from '../../src/gear/sources.ts';
import { VERSION_SQL, GEAR_INDEX_SQL, toItem } from '../../src/gear/index.ts';
import { extrasFor, howToGet } from '../../src/gear/upgrades.ts';

const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
const db = proxy.env.DB;
try {
  const r = await db.batch([db.prepare(SOURCE_SQL.mobs), db.prepare(SOURCE_SQL.npcs), db.prepare(SOURCE_SQL.zoneNames), db.prepare(SOURCE_SQL.zones)]);
  const names = Object.keys(SOURCE_SQL);
  r.forEach((x, i) => console.log(`source index ${names[i]}: ${x.results.length} rows, rows_read ${x.meta?.rows_read}`));
  const rowsRead = r.reduce((n, x) => n + (x.meta?.rows_read ?? 0), 0);
  console.log(`source index, cold: rows_read ${rowsRead} (4 statements)`);
  // CPU as order 36's bench measures it (scripts/bench/gear-upgrades.mjs): a PROXY in Node, median and worst of 20 builds.
  const build = () => buildSourceIndex('bench', { mobs: r[0].results as never, npcs: r[1].results as never, zoneNames: r[2].results as never, zones: r[3].results as never }, rowsRead);
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t = performance.now();
    build();
    times.push(performance.now() - t);
  }
  const first = times[0];
  times.sort((a, b) => a - b);
  console.log(`CPU (Node, building it, 20 runs): first ${first.toFixed(2)} ms, median ${times[10].toFixed(2)} ms, worst ${times[19].toFixed(2)} ms`);
  const idx = build();

  const { results: items } = await db
    .prepare('SELECT id, name, name_key, level_low, level_kind, level_kinds, origin_json FROM item WHERE slot_mask <> 0')
    .all<{ id: number; name: string; name_key: string; level_low: number | null; level_kind: string | null; level_kinds: string | null; origin_json: string | null }>();
  const origin = (s: string | null) => (s ? JSON.parse(s) : {}) as { from?: string[]; wikiZones?: string[]; soldBy?: { vendors?: string[] } };

  // ITEM 1.
  const mob = items.filter((it) => it.level_kind === 'mob');
  const bad: string[] = [];
  let pickMs = 0;
  for (const it of mob) {
    const o = origin(it.origin_json);
    const t = performance.now();
    const p = dropPick(idx, it.name_key, o.from ?? [], o.wikiZones ?? []);
    pickMs = Math.max(pickMs, performance.now() - t);
    if (p?.range?.low !== it.level_low) bad.push(`${it.name}: level_low ${it.level_low}, shown ${p ? `${p.name} ${p.range?.low ?? 'no level'}` : 'no creature'}`);
  }
  console.log(`\nITEM 1 mismatch scan: ${bad.length} of ${mob.length} gear items with level_kind mob (worst dropPick ${pickMs.toFixed(3)} ms)`);
  for (const b of bad) console.log(`  ${b}`);

  // ITEM 2.
  const sold = items.filter((it) => (it.level_kinds ?? '').split(',').includes('vendor'));
  const tally = { merchant: 0, zoneOnly: 0, asRecorded: 0, empty: 0 };
  const samples: Record<string, string[]> = { merchant: [], zoneOnly: [], asRecorded: [] };
  for (const it of sold) {
    const v = origin(it.origin_json).soldBy?.vendors ?? [];
    if (!v.length) {
      tally.empty++;
      continue;
    }
    const p = vendorParts(idx, v);
    const kind = p.merchants.length ? 'merchant' : p.zoneKeys.length && p.rest.every((x) => [...idx.zoneName.values()].includes(x)) ? 'zoneOnly' : 'asRecorded';
    tally[kind]++;
    if (samples[kind].length < 3) samples[kind].push(`${it.name}: [${v.join(' | ')}] → ${[...p.merchants, ...p.rest].join(' / ')}`);
  }
  console.log(`\nITEM 2: ${sold.length} vendor gear items: named merchant ${tally.merchant}, zones only ${tally.zoneOnly}, as recorded ${tally.asRecorded}, no vendor recorded ${tally.empty}`);
  for (const [k, s] of Object.entries(samples)) for (const x of s) console.log(`  ${k}: ${x}`);

  // --item.
  const ver = ((await db.prepare(VERSION_SQL).all<{ v: string }>()).results[0]?.v) ?? null;
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

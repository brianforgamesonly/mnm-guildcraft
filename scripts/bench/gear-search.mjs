// /gear find's cost on the local D1 (order 13, ITEM 3): rows read per statement (D1's own meta), the query plan, and the
// CPU of rendering a page, for a set of searches. Start from a local database holding an import of the real source.
//   npm run bench:gear-search
// The CPU figure is a PROXY measured in Node (as scripts/bench/board-cpu.mjs): workerd's accounting is not reproduced,
// and waits on D1 cost no CPU in either. It prints item names from the public wiki data only.
import { getPlatformProxy } from 'wrangler';
import { pageData, pageEmbed, parseQuery, resultEntry } from '../../src/commands/gear.ts';
import { filters, relaxStatement, searchStatement } from '../../src/gear/search.ts';

const proxy = await getPlatformProxy({ environment: 'dev' });
const db = proxy.env.DB;
const guild = { id: '0', learning_window: 25 };

const SEARCHES = {
  'Any, CHEST (control)': { class: 'Any', slot: 'CHEST' },
  'CLR, CHEST': { class: 'CLR', slot: 'CHEST' },
  'CLR, CHEST, STA': { class: 'CLR', slot: 'CHEST', stat1: 'STA' },
  'CLR, CHEST, STA+WIS, Total stats': { class: 'CLR', slot: 'CHEST', stat1: 'STA', stat2: 'WIS', sort: 'TOTAL' },
  'Any, SLA, min_ratio 0.3': { class: 'Any', weapon_type: 'SLA', min_ratio: 0.3 },
  'Any, source Unknown': { class: 'Any', source: 'Unknown' },
  'Any, no other filter (all gear)': { class: 'Any' },
  'Any, sort STR': { class: 'Any', sort: 'STR' },
  'Any, CHEST, min_ac 999 (zero results)': { class: 'Any', slot: 'CHEST', min_ac: 999 },
};
const opts = (o) => Object.entries(o).map(([name, value]) => ({ type: typeof value === 'number' ? 10 : 3, name, value }));

const quoted = {};
for (const [label, o] of Object.entries(SEARCHES)) {
  const q = parseQuery(opts(o));
  if (typeof q === 'string') throw new Error(q);
  const s = await searchStatement(db, q, 0).all();
  const fs = filters(q);
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN SELECT id FROM item WHERE slot_mask <> 0 AND (source_mask & 32) = 0${fs.map((f) => ` AND ${f.sql}`).join('')}`)
    .bind(...fs.flatMap((f) => f.binds))
    .all();
  if (s.results.length) {
    const rows = s.results.slice(0, 10);
    const t0 = Date.now();
    const d = await pageData({ db, guild }, rows);
    const ioMs = Date.now() - t0;
    for (let i = 0; i < 20; i++) pageEmbed(rows, q, d, 0, 25); // warm-up
    const N = 200;
    const c0 = process.cpuUsage();
    for (let i = 0; i < N; i++) pageEmbed(rows, q, d, 0, 25);
    const c = process.cpuUsage(c0);
    for (const r of rows) {
      const e = resultEntry(r, q, d, 25);
      if (!quoted.weapon && r.ratio !== null) quoted.weapon = e;
      if (!quoted.armor && r.ratio === null && r.ac !== null && e.includes('Drop:')) quoted.armor = e;
      if (!quoted.unknown && e.includes('Unknown: ')) quoted.unknown = e;
    }
    const shown = s.results.length > 10 ? 'a full page and more' : `${s.results.length} matches`;
    console.log(`${label}: ${shown} · search rows_read ${s.meta.rows_read} · page data ${ioMs} ms · render CPU ${((c.user + c.system) / 1000 / N).toFixed(2)} ms/page (Node proxy)`);
  } else {
    const r = await relaxStatement(db, q).stmt.all();
    console.log(`${label}: 0 matches · search rows_read ${s.meta.rows_read} · relax rows_read ${r.meta.rows_read}`);
  }
  console.log(`  plan: ${plan.results.map((p) => p.detail).join(' | ')}`);
}
// The page-data batch's statements, one by one, for the control search's page.
{
  const q = parseQuery(opts(SEARCHES['Any, CHEST (control)']));
  const s = await searchStatement(db, q, 0).all();
  const names = [...new Set(s.results.slice(0, 10).flatMap((r) => ((r.origin_json ? JSON.parse(r.origin_json).from : []) ?? []).slice(0, 3)))];
  const m = await db.prepare('SELECT key FROM mob WHERE active = 1 AND (key IN (SELECT value FROM json_each(?1)) OR title IN (SELECT value FROM json_each(?1)))').bind(JSON.stringify(names)).all();
  const g = await db.prepare('SELECT code, bit FROM game_class WHERE item_count > 0 AND bit IS NOT NULL').all();
  console.log(`page data (control page): mobs rows_read ${m.meta.rows_read} for ${names.length} names · classes rows_read ${g.meta.rows_read}`);
}
console.log('\nquoted results (real data):');
for (const [k, v] of Object.entries(quoted)) console.log(`--- ${k}\n${v}`);
await proxy.dispose();

// /gear upgrades' cost on the local D1 (order 36, ITEM 5): D1's own rows_read per interaction (the summary, one slot's list,
// a page turn, Pick a result), for a Fighter at level 24 with 15 slots filled and for a character with nothing saved; cold
// (the gear index read from D1: a new isolate, or a new import) and warm (from memory). Start from a local database holding
// an import of the real source (npm run import:local).
//   npm run bench:gear-upgrades
// The CPU figure is a PROXY measured in Node: the pure work, timed apart from D1 (median and worst of 20 runs; as
// scripts/bench/gear-search.mjs): workerd's accounting is not reproduced, and waits on D1 cost no CPU in either. The bench
// writes only its own guild's rows (BENCH_GUILD) to the local database, and prints item names from the public wiki data only.
import { getPlatformProxy } from 'wrangler';
import { gearUpgrades, load, summaryView, upgradesComponent, PAGE_PREFIX, RESULT_PREFIX } from '../../src/gear/upgrades.ts';
import { clearGearIndex, GEAR_INDEX_SQL, toItem } from '../../src/gear/index.ts';
import { gearWeights } from '../../src/gear/weights.ts';
import { compareGroup, groupByKey, grouped, levelGroup } from '../../src/gear/score.ts';
import { WEAR_SLOTS } from '../../src/gear/slots.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';

const proxy = await getPlatformProxy({ environment: 'dev' });
const raw = proxy.env.DB;
const BENCH_GUILD = 'bench-o36';
const USER = 'bench-user';
const SHOW = process.argv.includes('--show');

// D1 with every statement's rows_read added up (first() is answered from all(), which carries meta).
let rows = 0;
/** Order 36, PR B: D1's rows_written (index writes included), for --weights. */
let written = 0;
let statements = 0;
const count = (r) => {
  statements++;
  rows += r?.meta?.rows_read ?? 0;
  written += r?.meta?.rows_written ?? 0;
  return r;
};
const wrapStmt = (s) => ({
  __raw: s,
  bind: (...a) => wrapStmt(s.bind(...a)),
  all: async () => count(await s.all()),
  run: async () => count(await s.run()),
  raw: async (o) => s.raw(o),
  first: async (col) => {
    const r = count(await s.all());
    const row = r.results[0] ?? null;
    return col === undefined ? row : (row?.[col] ?? null);
  },
});
const db = {
  prepare: (sql) => wrapStmt(raw.prepare(sql)),
  batch: async (list) => (await raw.batch(list.map((x) => x.__raw ?? x))).map(count),
  exec: (sql) => raw.exec(sql),
};

// ---------------------------------------------------------------- the bench's own rows (local only)
const at = new Date().toISOString();
await raw.batch([
  // Order 36 review fix: a run that died before its own cleanup leaves weight, setting and audit rows naming the guild.
  raw.prepare('DELETE FROM gear_weight WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM gear_setting WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM audit_log WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM character_gear WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM character WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM member WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM guild WHERE id = ?').bind(BENCH_GUILD),
  raw.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(BENCH_GUILD, 'Bench', at),
  raw.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES (?, ?, 'Bench', ?)").bind(BENCH_GUILD, USER, at),
  raw.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, 'Benchfighter', 'benchfighter', 'FTR', 24, 1, ?, ?)").bind(BENCH_GUILD, USER, at, at),
  raw.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, 'Benchbare', 'benchbare', 'FTR', 24, 0, ?, ?)").bind(BENCH_GUILD, USER, at, at),
]);
const fighter = await raw.prepare("SELECT id FROM character WHERE guild_id = ? AND name = 'Benchfighter'").bind(BENCH_GUILD).first('id');
const bare = await raw.prepare("SELECT id FROM character WHERE guild_id = ? AND name = 'Benchbare'").bind(BENCH_GUILD).first('id');
const ftrBit = await raw.prepare("SELECT bit FROM game_class WHERE code = 'FTR'").first('bit');
// 15 of the 20 slots filled, each with the Fighter-usable item lowest in name order (Ear 2, Wrist 2, Finger 2, Shirt, Range empty).
const SKIP = new Set(['ear2', 'wrist2', 'finger2', 'shirt', 'range']);
const filled = [];
for (const w of WEAR_SLOTS.filter((x) => !SKIP.has(x.key))) {
  const key = await raw
    .prepare("SELECT name_key FROM item WHERE source = 'wiki' AND gone_at IS NULL AND (slot_mask & ?1) <> 0 AND (class_mask IN (-1, 0) OR ((class_mask >> ?2) & 1) = 1) AND (handed IS NULL OR handed NOT LIKE '%two%') ORDER BY name_key LIMIT 1")
    .bind(bitOf(SLOTS, w.token), ftrBit)
    .first('name_key');
  if (key) filled.push(raw.prepare("INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)").bind(fighter, BENCH_GUILD, w.key, key, at, USER));
}
await raw.batch(filled);
console.log(`Benchfighter (FTR 24): ${filled.length} slots filled · Benchbare (FTR 24): nothing saved`);

const ctx = () => ({
  db,
  guild: { id: BENCH_GUILD, name: 'Bench', learning_window: 25, request_channel_id: null, review_channel_id: null },
  member: { user: { id: USER, username: 'bench', global_name: 'Bench' }, nick: null, roles: [], permissions: '0' },
  userId: USER,
  officer: false,
  effects: {},
});
const opt = (name, value) => ({ type: typeof value === 'number' ? 4 : 3, name, value });
const comps = (r) => (r.data.components ?? []).flatMap((x) => x.components);

/** One interaction: D1 rows read and statements, and the reply. */
async function measure(run) {
  rows = 0;
  statements = 0;
  const reply = await run();
  return { rows, statements, reply };
}
/**
 * The Worker's own work, without D1 or the proxy: each of 20 runs times `reps` repetitions with performance.now() and keeps
 * the mean (process.cpuUsage ticks at about 15.6 ms on Windows, too coarse for this). Median and worst of the 20.
 */
function cpu(work, reps = 50) {
  for (let i = 0; i < 20; i++) work(); // warm-up
  const t = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    for (let j = 0; j < reps; j++) work();
    t.push((performance.now() - t0) / reps);
  }
  t.sort((a, b) => a - b);
  return { median: (t[9] + t[10]) / 2, worst: t[19] };
}
const fmt = (c) => `median ${c.median.toFixed(3)} ms, worst ${c.worst.toFixed(3)} ms`;
/** cpu() for async work whose D1 is a stub answering at once (order 39: the summary reads its stat lines' rows). */
async function cpuAsync(work, reps = 50) {
  for (let i = 0; i < 20; i++) await work();
  const t = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    for (let j = 0; j < reps; j++) await work();
    t.push((performance.now() - t0) / reps);
  }
  t.sort((a, b) => a - b);
  return { median: (t[9] + t[10]) / 2, worst: t[19] };
}
/** A D1 stand-in that answers every statement with the rows read once from the real one (the pure work, no wait). */
const stubDb = (rows) => ({
  prepare: () => ({
    bind: (ids) => {
      const want = new Set(JSON.parse(ids));
      return { all: async () => ({ results: rows.filter((r) => want.has(r.id)) }) };
    },
  }),
});

for (const [label, name, charId] of [['Fighter 24, 15 slots filled', 'Benchfighter', fighter], ['Fighter 24, nothing saved', 'Benchbare', bare]]) {
  const summary = () => gearUpgrades(ctx(), [opt('character', name)]);
  const list = () => gearUpgrades(ctx(), [opt('character', name), opt('slot', 'chest')]);
  clearGearIndex();
  const cold = await measure(summary);
  const s = await measure(summary);
  const l = await measure(list);
  const pageId = comps(l.reply).find((c) => c.custom_id?.startsWith(PAGE_PREFIX) && !c.disabled)?.custom_id ?? `${PAGE_PREFIX}${charId}:chest:10:1`;
  const pickId = comps(l.reply).find((c) => c.custom_id?.startsWith(RESULT_PREFIX));
  const page = () => upgradesComponent(ctx(), pageId, []);
  const pick = () => upgradesComponent(ctx(), pickId.custom_id, [pickId.options[0].value]);
  const p = await measure(page);
  const k = await measure(pick);
  console.log(`\n${label}:`);
  console.log(`  summary, cold index: rows_read ${cold.rows} (${cold.statements} statements)`);
  for (const [what, m] of [['summary', s], ['chest list', l], ['page turn', p], ['Pick a result', k]]) console.log(`  ${what}: rows_read ${m.rows} (${m.statements} statements)`);
  // CPU: the pure work each interaction does on the warm index (the summary: 17 slot comparisons; a list, a page turn and
  // Pick a result: one slot's), and, once per isolate or import, building the index from its rows.
  const L = await load(ctx(), (await raw.prepare('SELECT * FROM character WHERE id = ?').bind(charId).first()));
  const statRows = (await raw.prepare("SELECT id, stats_json FROM item WHERE source = 'wiki' AND slot_mask <> 0").all()).results;
  console.log(`  CPU (Node, pure work) summary: ${fmt(await cpuAsync(() => summaryView({ db: stubDb(statRows) }, L, null)))}`);
  console.log(`  CPU (Node, pure work) one slot (list, page turn, Pick a result): ${fmt(cpu(() => grouped(compareGroup(groupByKey('chest'), L.ctx, L.wearer, L.idx.items).upgrades, null)))}`);
  if (charId === fighter) {
    const { results } = await raw.prepare(GEAR_INDEX_SQL).all();
    console.log(`  CPU (Node, pure work) building the index from ${results.length} rows (cold only): ${fmt(cpu(() => results.map(toItem), 5))}`);
  }
  if (SHOW) {
    console.log('--- summary\n' + s.reply.data.embeds[0].description + '\n' + s.reply.data.embeds[0].footer.text);
    console.log('--- chest list\n' + l.reply.data.embeds[0].description + '\n' + l.reply.data.embeds[0].footer.text);
  }
}
// --testchar: Brian's check on this data. Testchar (Inquisitor 15, Human), Primary: Copper Greatsword, Chest empty: the
// Enchanted Copper Plate Breastplate's level and group at windows 10 and 0, its gain on an empty Chest; then step 3 (the
// first Around result worn) and the Chest counts per group at windows 10 and 0.
if (process.argv.includes('--testchar')) {
  await raw.batch([
    raw.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, race, is_main, created_at, updated_at) VALUES (?, ?, 'Testchar', 'testchar', 'INQ', 15, 'HUM', 0, ?, ?)").bind(BENCH_GUILD, USER, at, at),
  ]);
  const tc = await raw.prepare("SELECT * FROM character WHERE guild_id = ? AND name = 'Testchar'").bind(BENCH_GUILD).first();
  await raw.prepare("INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, 'primary', 'copper greatsword', ?, ?)").bind(tc.id, BENCH_GUILD, at, USER).run();
  const bp = await raw.prepare("SELECT level_kind, level_low, level_high FROM item WHERE name = 'Enchanted Copper Plate Breastplate'").first();
  const chest = async () => {
    const L = await load(ctx(), tc);
    return compareGroup(groupByKey('chest'), L.ctx, L.wearer, L.idx.items);
  };
  // Order 36 follow-up: no cap by default; max_level: 15 hides what is above Lv 15 (counted as "above").
  const counts = (r, cap) => Object.fromEntries(Object.entries(grouped(r.upgrades, cap)).map(([g, l]) => [g, l.length]));
  const r0 = await chest();
  const u = r0.upgrades.find((x) => x.item.name === 'Enchanted Copper Plate Breastplate');
  console.log(`\nTestchar: breastplate level_kind ${bp.level_kind}, level_low ${bp.level_low}, level_high ${bp.level_high}; group with no cap: ${u ? levelGroup(u.item, null) : 'not a candidate'}, at max_level 15: ${u ? levelGroup(u.item, 15) : '-'}; gain on an empty Chest ${u ? u.gain / 100 : '-'}`);
  console.log(`  Chest before step 3: no cap ${JSON.stringify(counts(r0, null))}, max_level 15 ${JSON.stringify(counts(r0, 15))}`);
  const first = grouped(r0.upgrades, null).listed[0];
  console.log(`  step 3 wears the first listed result: ${first.item.name} (+${first.gain / 100}, ${first.item.levelKind} ${first.item.levelLow})`);
  await raw.prepare("INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, 'chest', ?, ?, ?)").bind(tc.id, BENCH_GUILD, first.item.key, at, USER).run();
  const r1 = await chest();
  console.log(`  Chest after step 3: no cap ${JSON.stringify(counts(r1, null))}, max_level 15 ${JSON.stringify(counts(r1, 15))}`);
  const ac0 = { ...(await load(ctx(), tc)) };
  ac0.ctx = { ...ac0.ctx, weights: { ...ac0.ctx.weights, AC: 0 } };
  const r2 = compareGroup(groupByKey('chest'), ac0.ctx, ac0.wearer, ac0.idx.items);
  console.log(`  step 6 (AC weight 0), Chest after step 3: no cap ${JSON.stringify(counts(r2, null))}`);
}
// --testchar37 (order 37, Brian's check): Testchar (Inquisitor 15, Human, default weights), Primary: Copper Greatsword,
// Chest: Fine Blue Cloth Robe. At max_level: 15: the Chest counts; Corroded Bronze Plate Breastplate's gain over the robe,
// its page and its drop line; then, over every slot, the first listed item with a named merchant and the first with a
// named quest (slot, page, line). Pages count from 1, PER_PAGE a page, in the list's own order.
if (process.argv.includes('--testchar37')) {
  const { GROUPS, SLOT_GROUPS } = await import('../../src/gear/score.ts');
  const { extrasFor, howToGet, PER_PAGE } = await import('../../src/gear/upgrades.ts');
  await raw.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, race, is_main, created_at, updated_at) VALUES (?, ?, 'Testchar', 'testchar', 'INQ', 15, 'HUM', 0, ?, ?)").bind(BENCH_GUILD, USER, at, at).run();
  const tc = await raw.prepare("SELECT * FROM character WHERE guild_id = ? AND name = 'Testchar'").bind(BENCH_GUILD).first();
  for (const [slot, key] of [['primary', 'copper greatsword'], ['chest', 'fine blue cloth robe']])
    await raw.prepare('INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(tc.id, BENCH_GUILD, slot, key, at, USER).run();
  const CAP = 15;
  const L = await load(ctx(), tc);
  const list = (g) => {
    const by = grouped(compareGroup(g, L.ctx, L.wearer, L.idx.items).upgrades, CAP);
    return { all: GROUPS.flatMap((k) => by[k].map((u) => ({ k, u }))), by };
  };
  const { vendorParts } = await import('../../src/gear/sources.ts');
  const merchants = async (u) => {
    const x = await extrasFor(ctx(), [u.item], L.idx.version);
    const v = JSON.parse(x.rows.get(u.item.id)?.origin_json ?? '{}').soldBy?.vendors ?? [];
    return v.length ? vendorParts(x.src, v).merchants.length : 0;
  };
  const line = async (u) => howToGet(u.item, await extrasFor(ctx(), [u.item], L.idx.version), USER, 25).lines;
  const chest = list(groupByKey('chest'));
  console.log(`\nTestchar (order 37), Chest at max_level ${CAP}: listed ${chest.by.listed.length}, level unknown ${chest.by.unknown.length} (shown under the cap: ${GROUPS.includes('unknown')}), hidden above Lv ${CAP}: ${chest.by.above.length}; ${chest.all.length} shown, ${Math.ceil(chest.all.length / PER_PAGE)} pages`);
  const at37 = chest.all.findIndex((s) => s.u.item.name === 'Corroded Bronze Plate Breastplate');
  if (at37 < 0) console.log('  Corroded Bronze Plate Breastplate: not listed');
  else {
    const u = chest.all[at37].u;
    console.log(`  Corroded Bronze Plate Breastplate: +${(u.gain / 100).toFixed(2)} over the robe, page ${Math.floor(at37 / PER_PAGE) + 1} (place ${at37 + 1}); ${(await line(u)).join(' / ')}`);
  }
  let vendor = null;
  let quest = null;
  for (const g of SLOT_GROUPS) {
    const { all } = list(g);
    for (const [i, s] of all.entries()) {
      if (s.k !== 'listed' || (vendor && quest)) continue;
      const kinds = (s.u.item.levelKinds ?? '').split(',');
      if (!vendor && kinds.includes('vendor') && (await merchants(s.u)) > 0) {
        const l = (await line(s.u)).find((x) => x.startsWith('Vendor:'));
        vendor = `${g.label}, page ${Math.floor(i / PER_PAGE) + 1}: ${s.u.item.name} +${(s.u.gain / 100).toFixed(2)} · ${l}`;
      }
      if (!quest && kinds.includes('quest')) {
        const l = (await line(s.u)).find((x) => x.startsWith('Quest:') && !x.includes("isn't recorded"));
        if (l) quest = `${g.label}, page ${Math.floor(i / PER_PAGE) + 1}: ${s.u.item.name} +${(s.u.gain / 100).toFixed(2)} · ${l}`;
      }
    }
  }
  console.log(`  vendor item with a named merchant: ${vendor ?? 'none listed'}`);
  console.log(`  quest item: ${quest ?? 'none listed'}`);
}
// --weights (order 36, PR B): D1's rows written and read by each kind of weight change, with its audit row (no review
// channel is set here, so nothing is posted).
if (process.argv.includes('--weights')) {
  console.log('\nWeight changes (Inquisitor; rows_written includes index writes and the audit row):');
  const steps = [
    ['view', [opt('class', 'INQ')]],
    ['one stat (AC 0)', [opt('class', 'INQ'), opt('stat', 'AC'), opt('value', 0)]],
    ['a second stat (STA 0.5)', [opt('class', 'INQ'), opt('stat', 'STA'), opt('value', 0.5)]],
    ['preset Caster', [opt('class', 'INQ'), opt('preset', 'Caster')]],
    ['reset', [opt('class', 'INQ'), { type: 5, name: 'reset', value: true }]],
  ];
  for (const [label, o] of steps) {
    rows = 0;
    written = 0;
    statements = 0;
    await gearWeights(ctx(), o);
    console.log(`  ${label}: rows_written ${written}, rows_read ${rows} (${statements} statements)`);
  }
  await raw.batch([raw.prepare('DELETE FROM gear_weight WHERE guild_id = ?').bind(BENCH_GUILD), raw.prepare('DELETE FROM gear_setting WHERE guild_id = ?').bind(BENCH_GUILD), raw.prepare('DELETE FROM audit_log WHERE guild_id = ?').bind(BENCH_GUILD)]);
}
await raw.batch([
  raw.prepare('DELETE FROM character_gear WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM character WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM member WHERE guild_id = ?').bind(BENCH_GUILD),
  raw.prepare('DELETE FROM guild WHERE id = ?').bind(BENCH_GUILD),
]);
await proxy.dispose();

// Order 37, PR B (the owner, 2026-11-06): a new isolate's first slot list, measured on the local D1 after a real-data
// import (npm run import:local). Each run is a fresh Node process, so the gear index and the source rows are read and built
// cold (their caches are module state) and the JIT is cold, as in a new isolate. One run: Testchar (Inquisitor 15, Human,
// Fine Blue Cloth Robe in Chest, Copper Greatsword in Primary) asks /gear upgrades slot:chest, through the real handler.
//   node scripts/bench/cold-slot-list.mjs            (10 runs: median and worst)
// Rows: D1's own rows_read, every statement added up. CPU: a PROXY measured in Node: the handler's wall time less the time
// spent waiting on D1 (overlapping waits counted once). workerd's own accounting is not reproduced (as order 36's bench).
// Writes only the bench guild's own rows to the local database, and removes them.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RUNS = 10;
const self = fileURLToPath(import.meta.url);

if (!process.argv.includes('--once')) {
  const out = [];
  for (let i = 0; i < RUNS; i++) {
    const r = spawnSync(process.execPath, [self, '--once', ...(process.argv.includes('--split') ? ['--split'] : [])], { encoding: 'utf8' });
    const line = r.stdout.split('\n').find((l) => l.startsWith('{"rows"'));
    if (!line) throw new Error(`run ${i + 1} printed no result:\n${r.stdout}\n${r.stderr}`);
    out.push(JSON.parse(line));
  }
  const stat = (k) => {
    const v = out.map((x) => x[k]).sort((a, b) => a - b);
    return { median: (v[(RUNS - 1) >> 1] + v[RUNS >> 1]) / 2, worst: v[RUNS - 1] };
  };
  const f = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2));
  const keys = [['rows', 'rows_read'], ['cpuMs', 'CPU ms (proxy)'], ['statements', 'statements'], ...(out[0].loadMs !== null ? [['loadMs', 'of which, apart: the gear index load, CPU ms']] : [])];
  for (const [k, label] of keys) {
    const s = stat(k);
    console.log(`first slot list on a fresh isolate, ${RUNS} runs: ${label} median ${f(s.median)}, worst ${f(s.worst)}`);
  }
  console.log(`per run: ${out.map((x) => `${x.rows} rows / ${x.cpuMs.toFixed(2)} ms`).join(' · ')}`);
} else {
  const { getPlatformProxy } = await import('wrangler');
  const { gearUpgrades } = await import('../../src/gear/upgrades.ts');
  const proxy = await getPlatformProxy({ environment: 'dev' });
  const raw = proxy.env.DB;
  const GUILD = 'bench-o37-cold';
  const USER = 'bench-user';
  const at = new Date().toISOString();
  const clean = () =>
    raw.batch(['character_gear', 'character', 'member', 'audit_log'].map((t) => raw.prepare(`DELETE FROM ${t} WHERE guild_id = ?`).bind(GUILD)).concat(raw.prepare('DELETE FROM guild WHERE id = ?').bind(GUILD)));
  await clean();
  await raw.batch([
    raw.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(GUILD, 'Bench', at),
    raw.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES (?, ?, 'Bench', ?)").bind(GUILD, USER, at),
    raw.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, race, is_main, created_at, updated_at) VALUES (?, ?, 'Testchar', 'testchar', 'INQ', 15, 'HUM', 1, ?, ?)").bind(GUILD, USER, at, at),
  ]);
  const id = await raw.prepare("SELECT id FROM character WHERE guild_id = ? AND name = 'Testchar'").bind(GUILD).first('id');
  await raw.batch(
    [['primary', 'copper greatsword'], ['chest', 'fine blue cloth robe']].map(([slot, key]) =>
      raw.prepare('INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, GUILD, slot, key, at, USER),
    ),
  );
  // D1 with rows_read added up and each wait's interval kept.
  let rows = 0;
  let statements = 0;
  const waits = [];
  const timed = async (p) => {
    const t0 = performance.now();
    try {
      return await p;
    } finally {
      waits.push([t0, performance.now()]);
    }
  };
  const count = (r) => {
    statements++;
    rows += r?.meta?.rows_read ?? 0;
    return r;
  };
  const wrap = (s) => ({
    __raw: s,
    bind: (...a) => wrap(s.bind(...a)),
    all: async () => count(await timed(s.all())),
    run: async () => count(await timed(s.run())),
    first: async (col) => {
      const r = count(await timed(s.all()));
      const row = r.results[0] ?? null;
      return col === undefined ? row : (row?.[col] ?? null);
    },
  });
  const db = { prepare: (sql) => wrap(raw.prepare(sql)), batch: async (l) => (await timed(raw.batch(l.map((x) => x.__raw ?? x)))).map(count) };
  const ctx = {
    db,
    guild: { id: GUILD, name: 'Bench', learning_window: 25, request_channel_id: null, review_channel_id: null },
    member: { user: { id: USER, username: 'bench', global_name: 'Bench' }, nick: null, roles: [], permissions: '0' },
    userId: USER,
    officer: false,
    effects: {},
  };
  // The union of the D1 waits since `from`.
  const waitedSince = (from) => {
    const w = waits.filter(([s]) => s >= from).sort((a, b) => a[0] - b[0]);
    let waited = 0;
    let end = -Infinity;
    for (const [s, e] of w) {
      if (e <= end) continue;
      waited += e - Math.max(s, end);
      end = e;
    }
    return waited;
  };
  // --split: the gear index's cold load (src/gear/upgrades.ts load, order 36) first, timed apart; then the handler with that
  // index warm, so its time is the rest (the source rows, the scoring, the page).
  let loadMs = null;
  if (process.argv.includes('--split')) {
    const { load } = await import('../../src/gear/upgrades.ts');
    const ch = await raw.prepare('SELECT * FROM character WHERE id = ?').bind(id).first();
    const s = performance.now();
    await load(ctx, ch);
    loadMs = performance.now() - s - waitedSince(s);
  }
  const t0 = performance.now();
  const reply = await gearUpgrades(ctx, [{ type: 3, name: 'character', value: 'Testchar' }, { type: 3, name: 'slot', value: 'chest' }]);
  const total = performance.now() - t0;
  const waited = waitedSince(t0);
  if (!reply.data.embeds?.[0]?.description?.includes('Chest')) throw new Error('the reply is not a Chest list');
  await clean();
  await proxy.dispose();
  console.log(JSON.stringify({ rows, statements, cpuMs: total - waited, totalMs: total, loadMs }));
}

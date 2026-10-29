// Order 27 (ITEM 2): rows read by the one DKP reader (src/dkp/ledger.ts dkpRead), for standings of every pool and for
// one member's /me (balances and 30-day attendance), at two sizes, on a local D1 of its own (never a credential, never
// remote). The data is written by the real payout statement (payStatement), so balance_after is the code's own.
//   now:      40 members, 4 pools (3 raid zones + the guild pool), 800 rows
//   one year: 3 raids a week, 12 kills each, 20 members present (each kill pays the raid pool and the guild pool)
// First: npx wrangler d1 migrations apply mnm-guildcraft-dev --local --env dev --persist-to <dir>
//   node scripts/bench/dkp-reads.ts --persist <dir>
/// <reference types="@cloudflare/workers-types" />
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dkpRead, payStatement, POOL_GUILD } from '../../src/dkp/ledger.ts';

const { values: args } = parseArgs({ options: { persist: { type: 'string' } } });
if (!args.persist) throw new Error('--persist <dir> (a local D1 with the migrations applied) is required');
const { getPlatformProxy } = await import('wrangler');
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  environment: 'dev',
  configPath: fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)),
  persist: { path: args.persist },
});
const db = proxy.env.DB;
const ZONES = ['bench zone a', 'bench zone b', 'bench zone c'];
const DAY = 86_400_000;

async function fill(guild: string, members: number, raids: { pool: string; at: number; kills: number; present: number }[], adjustRows: number) {
  const ids = Array.from({ length: members }, (_, i) => `${guild}-m${i}`);
  const t0 = new Date(Date.now() - 365 * DAY).toISOString();
  await db.batch([
    db.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(guild, 'bench', t0),
    ...ids.map((id, i) => db.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?)").bind(guild, id, `Member ${i}`, t0)),
  ]);
  let stmts: D1PreparedStatement[] = [];
  const flush = async () => {
    if (stmts.length) await db.batch(stmts);
    stmts = [];
  };
  for (const r of raids) {
    const at = new Date(r.at).toISOString();
    const raid = await db.prepare("INSERT INTO dkp_raid (guild_id, pool, mode, opened_by, opened_at, closes_at, closed_at) VALUES (?, ?, 'named', 'x', ?, ?, ?) RETURNING id").bind(guild, r.pool, at, at, at).first<{ id: number }>();
    for (let k = 0; k < r.kills; k++) {
      const kat = new Date(r.at + k * 600_000).toISOString();
      const kill = await db.prepare("INSERT INTO dkp_kill (raid_id, name, points, guild_points, at, by) VALUES (?, 'Named', 10, 2, ?, 'x') RETURNING id").bind(raid!.id, kat).first<{ id: number }>();
      const present = ids.slice(0, r.present);
      stmts.push(payStatement(db, { guildId: guild, pool: r.pool, members: present, asked: 10, cap: 100000, kind: 'kill', raidId: raid!.id, killId: kill!.id, actor: 'bot', at: kat }));
      stmts.push(payStatement(db, { guildId: guild, pool: POOL_GUILD, members: present, asked: 2, cap: 100000, kind: 'kill', raidId: raid!.id, killId: kill!.id, actor: 'bot', at: kat }));
      if (stmts.length >= 50) await flush();
    }
  }
  for (let i = 0; i < adjustRows; i++) {
    stmts.push(payStatement(db, { guildId: guild, pool: [...ZONES, POOL_GUILD][i % 4], members: [ids[i % members]], asked: 3, cap: 100, kind: 'adjust', actor: 'x', at: new Date().toISOString() }));
    if (stmts.length >= 50) await flush();
  }
  await flush();
  return ids;
}

async function measure(label: string, guild: string, member: string) {
  const [{ n: rows }] = (await db.prepare('SELECT count(*) AS n FROM dkp_ledger WHERE guild_id = ?').bind(guild).all<{ n: number }>()).results;
  const pools = [POOL_GUILD, ...ZONES];
  const standings = await dkpRead(db, guild, { pools });
  const me = await dkpRead(db, guild, { pools, member, attendance: true });
  const att = me.attendance.map((a) => `${a.pool} ${a.earned}/${a.held}`).join(', ');
  console.log(`${label}: ${rows} ledger rows · standings, all ${pools.length} pools: ${standings.rowsRead} rows read · /me (balances + 30-day attendance): ${me.rowsRead} rows read · attendance ${att}`);
  return { rows, standings: standings.rowsRead, me: me.rowsRead };
}

try {
  // Now: 40 members, 4 pools, 800 rows (8 raids of 5 kills, 10 present: 800 rows across the pools).
  const nowRaids = Array.from({ length: 8 }, (_, i) => ({ pool: ZONES[i % 3], at: Date.now() - (8 - i) * 2 * DAY, kills: 5, present: 10 }));
  const a = await fill('bench-dkp-now', 40, nowRaids, 0);
  const now = await measure('now', 'bench-dkp-now', a[0]);
  // One year: 156 raids (3 a week), 12 kills, 20 present.
  const yearRaids = Array.from({ length: 156 }, (_, i) => ({ pool: ZONES[i % 3], at: Date.now() - (156 - i) * (7 / 3) * DAY, kills: 12, present: 20 }));
  const b = await fill('bench-dkp-year', 20, yearRaids, 0);
  const year = await measure('one year', 'bench-dkp-year', b[0]);
  const plan = await db.prepare("EXPLAIN QUERY PLAN SELECT balance_after FROM dkp_ledger WHERE guild_id = ?1 AND pool = ?2 AND member_id = ?3 ORDER BY id DESC LIMIT 1").bind('x', 'y', 'z').all<{ detail: string }>();
  for (const p of plan.results) console.log(`  balance plan: ${p.detail}`);
  console.log(JSON.stringify({ now, year, target: 2000, pass: year.standings < 2000 && year.me < 2000 }));
} finally {
  await proxy.dispose();
}

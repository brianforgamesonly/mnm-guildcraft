// Work order 29, ITEM 3 (override 1 of order 27's append-only rule): migrations/0023 rebuilds dkp_ledger. Every row is
// copied unchanged, ids included (row count and a SHA-256 of every column, before and after: scripts/backup/ledger-proof.ts,
// the same proof the backup job's migration check runs on a copy of the live data); the triggers and indexes come back; and
// the kill rosters are backfilled from the kill rows net of correction rows, counted by rows (a named's value can be 0).
import { env } from 'cloudflare:test';
import { beforeEach, expect, it } from 'vitest';
import up23 from '../../migrations/0023_dkp_auctions.sql?raw';
import { AFTER_SQL, LEDGER_PROOF_SQL, proofText } from '../../scripts/backup/ledger-proof.ts';
import down23 from '../../scripts/rollback/0023_dkp_auctions.down.sql?raw';
import { all, one, reset } from '../db.ts';

/** Statements with a trigger's BEGIN … END body kept whole (as test/worker/rollback.test.ts runs them). */
const statements = (sql: string) => sql.replace(/--.*$/gm, '').match(/\s*CREATE TRIGGER[\s\S]*?END;|[^;]+;?/g)!.map((s) => s.trim().replace(/;$/, '')).filter(Boolean);
const runWhole = async (sql: string) => {
  for (const s of statements(sql)) await env.DB.prepare(s).run();
};
const sha256 = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const proof = async () => {
  const rows = await all<Record<string, unknown>>(LEDGER_PROOF_SQL);
  return { count: rows.length, sha256: await sha256(proofText(rows)) };
};

const G = '900000000000000001';
const [X, Y, Z] = ['900000000000000011', '900000000000000012', '900000000000000013'];
const at = '2026-10-28T20:00:00.000Z';

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  // The ledger as order 27 left it: 0023 comes off, the old rows go in, then 0023 goes on again.
  await runWhole(down23);
  const ins = (sql: string, ...b: unknown[]) => env.DB.prepare(sql).bind(...b);
  const ledger = (id: number, m: string, pool: string, amount: number, cut: number, bal: number, kind: string, kill: number | null, corrects: number | null, reason: string | null) =>
    ins('INSERT INTO dkp_ledger (id, guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, G, m, pool, amount, cut, bal, kind, kill === null ? null : 1, kill, corrects, reason, kill === null ? '100000000000000002' : 'bot', at);
  await env.DB.batch([
    ins("INSERT INTO guild (id, name, created_at) VALUES (?, 'Rebuild guild', ?)", G, at),
    ...[X, Y, Z].map((m, i) => ins("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?)", G, m, `Member ${i}`, at)),
    ins("INSERT INTO dkp_raid (id, guild_id, pool, mode, opened_by, opened_at, closes_at, closed_at, closed_by, close_reason) VALUES (1, ?, 'the ruins', 'named', 'o', ?, ?, ?, 'o', 'officer')", G, at, at, at),
    ins("INSERT INTO dkp_kill (id, raid_id, name, points, guild_points, at, by) VALUES (1, 1, 'Goblin King', 10, 2, ?, 'o'), (2, 1, 'Zero Named', 0, 2, ?, 'o'), (3, 1, 'Capped Named', 10, 2, ?, 'o')", at, at, at),
    // Kill 1: X and Y earn it; X is removed (a reversal); Y is removed and added again (a re-add).
    ledger(1, X, 'the ruins', 10, 0, 10, 'kill', 1, null, null),
    ledger(2, X, 'guild', 2, 0, 2, 'kill', 1, null, null),
    ledger(3, Y, 'the ruins', 10, 0, 10, 'kill', 1, null, null),
    ledger(4, Y, 'guild', 2, 0, 2, 'kill', 1, null, null),
    ledger(5, X, 'the ruins', -10, 0, 0, 'correction', 1, 1, 'was afk'),
    ledger(6, X, 'guild', -2, 0, 0, 'correction', 1, 2, 'was afk'),
    ledger(7, Y, 'the ruins', -10, 0, 0, 'correction', 1, 3, 'wrong member'),
    ledger(8, Y, 'the ruins', 10, 0, 10, 'correction', 1, 7, 'was there'),
    // Kill 2 pays 0: Z earns it all the same (counted by rows, never by sum > 0).
    ledger(9, Z, 'the ruins', 0, 0, 0, 'kill', 2, null, null),
    ledger(10, Z, 'guild', 2, 0, 2, 'kill', 2, null, null),
    // Kill 3: Z at the cap (asked 10, paid 0, cut 10), still there; an adjustment that names no kill.
    ledger(11, Z, 'the ruins', 0, 10, 0, 'kill', 3, null, null),
    ledger(12, Z, 'guild', 1, 1, 3, 'kill', 3, null, null),
    ledger(13, X, 'guild', 5, 0, 5, 'adjust', null, null, 'event prize'),
  ]);
});

it('0023 copies every ledger row unchanged (count and SHA-256 of every column match), keeps the triggers, and backfills the rosters', async () => {
  const before = await proof();
  expect(before.count).toBe(13);
  await runWhole(up23);
  expect(await proof()).toEqual(before);
  // The columns 0023 adds are empty on every copied row; no row of a new kind.
  expect(await one(AFTER_SQL)).toEqual({ new_rows: 0, roster_rows: 3, roster_kills: 3, kills: 3, roster_with_state: 0, triggers: 2 });
  // Kill 1: Y only (X's kill row is reversed; Y's reversal is re-added). Kill 2: Z, though it paid 0. Kill 3: Z (capped).
  expect(await all('SELECT kill_id, member_id, state FROM dkp_kill_member ORDER BY kill_id, member_id')).toEqual([
    { kill_id: 1, member_id: Y, state: null },
    { kill_id: 2, member_id: Z, state: null },
    { kill_id: 3, member_id: Z, state: null },
  ]);
  // Still append-only.
  await expect(env.DB.prepare('UPDATE dkp_ledger SET amount = 0 WHERE id = 1').run()).rejects.toThrow(/append-only/);
  await expect(env.DB.prepare('DELETE FROM dkp_ledger WHERE id = 1').run()).rejects.toThrow(/append-only/);
  // The new kinds are accepted; an old-shaped kind outside the list still is not.
  await env.DB.prepare("INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, actor, at) VALUES (?, ?, 'guild', -1, 0, 4, 'decay', 'bot', ?)").bind(G, X, at).run();
  await expect(env.DB.prepare("INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, actor, at) VALUES (?, ?, 'guild', 1, 0, 5, 'gift', 'bot', ?)").bind(G, X, at).run()).rejects.toThrow();
});

it('the rollback refuses (and changes nothing) while a row of a new kind exists', async () => {
  await runWhole(up23);
  await env.DB.prepare("INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, actor, at) VALUES (?, ?, 'the ruins', 30, 0, 40, 'standby', 1, 'bot', ?)").bind(G, Z, at).run();
  const rows = await proof();
  // As one batch (one transaction): the copy fails on the old CHECK, and the whole down path rolls back.
  await expect(env.DB.batch(statements(down23).map((s) => env.DB.prepare(s)))).rejects.toThrow();
  expect(await proof()).toEqual(rows);
  expect((await all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'dkp_%' ORDER BY name")).map((r) => r.name)).toContain('dkp_auction');
  expect(await one("SELECT count(*) AS n FROM dkp_ledger WHERE kind = 'standby'")).toEqual({ n: 1 });
});

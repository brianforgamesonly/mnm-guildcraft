// Order 29 (override 1 of order 27's append-only rule): the proof that migrations/0023's ledger rebuild copied every row
// unchanged. One SELECT of every column 0021 made, in id order; its row count and a SHA-256 of its rows (as JSON) are taken
// before and after. Shared by test/worker/dkp-ledger-rebuild.test.ts and the backup job's migration check
// (scripts/backup/run.ts --migration-check), so both prove the same thing. Pure: no Node or Workers imports.

/** Every column of dkp_ledger as migrations/0021 created it, in its order. */
export const LEDGER_0021_COLUMNS = ['id', 'guild_id', 'member_id', 'pool', 'amount', 'cut', 'balance_after', 'kind', 'raid_id', 'kill_id', 'corrects', 'reason', 'actor', 'at'] as const;

/** The rows the checksum covers. */
export const LEDGER_PROOF_SQL = `SELECT ${LEDGER_0021_COLUMNS.join(', ')} FROM dkp_ledger ORDER BY id`;

/** The text hashed: one JSON array per row, columns in LEDGER_0021_COLUMNS order, one row per line. */
export const proofText = (rows: Record<string, unknown>[]) => rows.map((r) => JSON.stringify(LEDGER_0021_COLUMNS.map((c) => r[c] ?? null))).join('\n');

/**
 * After 0023: the rows of a kind 0021 did not allow (0 right after the rebuild), the kill rosters it backfilled, and the
 * members the backfill's own rule puts on a kill who have no roster row (missing_rosters; review of PR A: a kill recorded
 * by the old code between the migration and the Worker's deploy; read again after the deploy, it must be 0).
 */
export const AFTER_SQL = `SELECT (SELECT count(*) FROM dkp_ledger WHERE kind NOT IN ('kill', 'flat', 'adjust', 'correction') OR auction_id IS NOT NULL OR purchase_id IS NOT NULL) AS new_rows,
  (SELECT count(*) FROM dkp_kill_member) AS roster_rows, (SELECT count(DISTINCT kill_id) FROM dkp_kill_member) AS roster_kills, (SELECT count(*) FROM dkp_kill) AS kills,
  (SELECT count(*) FROM dkp_kill_member WHERE state IS NOT NULL) AS roster_with_state,
  (SELECT count(*) FROM dkp_ledger WHERE kill_id IS NOT NULL) AS kill_ledger_rows,
  (SELECT count(*) FROM (SELECT l.kill_id, l.member_id FROM dkp_ledger l JOIN dkp_kill k ON k.id = l.kill_id JOIN dkp_raid r ON r.id = k.raid_id WHERE l.pool = r.pool
     GROUP BY l.kill_id, l.member_id
     HAVING sum(CASE WHEN l.kind IN ('kill', 'flat') THEN 1 WHEN l.kind = 'correction' AND l.amount + l.cut < 0 THEN -1 WHEN l.kind = 'correction' THEN 1 ELSE 0 END) > 0) n
     WHERE NOT EXISTS (SELECT 1 FROM dkp_kill_member km WHERE km.kill_id = n.kill_id AND km.member_id = n.member_id)) AS missing_rosters,
  (SELECT count(*) FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'dkp_ledger') AS triggers`;

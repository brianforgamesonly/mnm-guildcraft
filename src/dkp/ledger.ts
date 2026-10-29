// Order 27: the DKP ledger (migrations/0021 dkp_ledger). Append-only: every change is a new row, and its balance_after is
// computed in the same statement from the member's previous row in that pool (order 27, override 8). A positive amount is
// capped against the pool's cap at that moment; the part the cap cut is kept in `cut` (asked = amount + cut). A negative
// adjustment is never cut. A reversal returns the amount actually paid, with the mirrored cut, so a kill's asked amounts
// for a member sum to zero once reversed.
//
// One reader (dkpRead) answers every balance and attendance question: standings, /me, history, Who earned.
export const POOL_GUILD = 'guild';

export type LedgerKind = 'kill' | 'flat' | 'adjust' | 'correction';

/** The member's previous balance in the pool: one indexed row (dkp_ledger_balance), 0 before the first row. */
const PREV = (member: string) =>
  `coalesce((SELECT l.balance_after FROM dkp_ledger l WHERE l.guild_id = ?1 AND l.pool = ?2 AND l.member_id = ${member} ORDER BY l.id DESC LIMIT 1), 0)`;

/** The pool's registry row, in the same batch as its first ledger row (its standings message is posted after). */
export const registerPool = (db: D1Database, guildId: string, pool: string, at: string) =>
  db.prepare('INSERT INTO dkp_pool (guild_id, pool, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').bind(guildId, pool, at);

export interface Payment {
  guildId: string;
  pool: string;
  members: string[];
  /** Asked per member; positive amounts are capped. */
  asked: number;
  cap: number;
  kind: LedgerKind;
  raidId?: number | null;
  killId?: number | null;
  reason?: string | null;
  actor: string;
  at: string;
}

/** One statement: a row per member (members must be distinct), each with its own balance_after. */
export function payStatement(db: D1Database, p: Payment): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (SELECT j.value AS member_id, ${PREV('j.value')} AS prev FROM json_each(?9) j),
            a AS (SELECT member_id, prev, CASE WHEN ?3 > 0 THEN min(?3, max(0, ?4 - prev)) ELSE ?3 END AS applied FROM t)
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, applied, ?3 - applied, prev + applied, ?5, ?6, ?7, NULL, ?8, ?10, ?11 FROM a`,
    )
    .bind(p.guildId, p.pool, p.asked, p.cap, p.kind, p.raidId ?? null, p.killId ?? null, p.reason ?? null, JSON.stringify([...new Set(p.members)]), p.actor, p.at);
}

/**
 * Removes members from one kill in one pool: for each member whose asked amounts on that kill sum above zero, a correction
 * row returning what was actually paid (corrects: their latest row for the kill). Members not credited get no row.
 */
export function reverseStatement(db: D1Database, r: { guildId: string; pool: string; killId: number; members: string[]; reason: string; actor: string; at: string }): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (SELECT j.value AS member_id, ${PREV('j.value')} AS prev,
                    (SELECT coalesce(sum(k.amount), 0) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS paid,
                    (SELECT coalesce(sum(k.amount + k.cut), 0) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS asked,
                    (SELECT max(k.id) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS last
                  FROM json_each(?4) j)
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, -paid, paid - asked, prev - paid, 'correction', (SELECT raid_id FROM dkp_kill WHERE id = ?3), ?3, last, ?5, ?6, ?7
       FROM t WHERE asked > 0`,
    )
    .bind(r.guildId, r.pool, r.killId, JSON.stringify([...new Set(r.members)]), r.reason, r.actor, r.at);
}

/**
 * Adds members to one kill in one pool (an officer's correction): for each member whose asked amounts on that kill are not
 * above zero, a correction row asking `asked`, capped against the cap now (corrects: their latest row for the kill, if any).
 */
export function readdStatement(db: D1Database, r: { guildId: string; pool: string; killId: number; asked: number; cap: number; members: string[]; reason: string; actor: string; at: string }): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (SELECT j.value AS member_id, ${PREV('j.value')} AS prev,
                    (SELECT coalesce(sum(k.amount + k.cut), 0) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS asked,
                    (SELECT max(k.id) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS last
                  FROM json_each(?6) j),
            a AS (SELECT member_id, prev, last, min(?4, max(0, ?5 - prev)) AS applied FROM t WHERE asked <= 0)
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, applied, ?4 - applied, prev + applied, 'correction', (SELECT raid_id FROM dkp_kill WHERE id = ?3), ?3, last, ?7, ?8, ?9 FROM a`,
    )
    .bind(r.guildId, r.pool, r.killId, r.asked, r.cap, JSON.stringify([...new Set(r.members)]), r.reason, r.actor, r.at);
}

// ---------------------------------------------------------------- the one reader

export interface Standing {
  member_id: string;
  name: string;
  status: 'active' | 'left';
  balance: number;
}
export interface Attendance {
  pool: string;
  earned: number;
  held: number;
}

export const ATTENDANCE_DAYS = 30;
const windowStart = (now: number) => new Date(now - ATTENDANCE_DAYS * 86_400_000).toISOString();

/**
 * Balances and attendance, the one place they are read (order 27). `pools`: which pools; `member`: one member (/me,
 * history) or every member with a row (standings). Attendance (30 days) only when asked: kills and flat payouts the member
 * earned in the pool (asked amounts on the kill sum above zero) ÷ those the pool held.
 */
export async function dkpRead(
  db: D1Database,
  guildId: string,
  q: { pools: string[]; member?: string; attendance?: boolean; now?: number },
): Promise<{ standings: Map<string, Standing[]>; attendance: Attendance[]; rowsRead: number }> {
  const pools = JSON.stringify(q.pools);
  const stmts = [
    // Members with a row in the pool: the member table (the pool's members are a subset), then one indexed row each.
    db
      .prepare(
        `SELECT p.value AS pool, m.discord_user_id AS member_id, m.display_name AS name, m.status,
                (SELECT l.balance_after FROM dkp_ledger l WHERE l.guild_id = ?1 AND l.pool = p.value AND l.member_id = m.discord_user_id ORDER BY l.id DESC LIMIT 1) AS balance
         FROM json_each(?2) p, member m WHERE m.guild_id = ?1 AND (?3 IS NULL OR m.discord_user_id = ?3)`,
      )
      .bind(guildId, pools, q.member ?? null),
  ];
  if (q.attendance && q.member) {
    const since = windowStart(q.now ?? Date.now());
    // Kills each pool held in the window (raids opened within the window plus the longest auto-close), and of those the
    // ones the member earned, through dkp_ledger_kill.
    stmts.push(
      db
        .prepare(
          `WITH k AS (SELECT k.id, r.pool FROM dkp_raid r JOIN dkp_kill k ON k.raid_id = r.id WHERE r.guild_id = ?1 AND r.opened_at >= ?4 AND k.at >= ?3)
           SELECT p.value AS pool,
                  (SELECT count(*) FROM k WHERE p.value = '${POOL_GUILD}' OR k.pool = p.value) AS held,
                  (SELECT count(*) FROM k WHERE (p.value = '${POOL_GUILD}' OR k.pool = p.value)
                     AND (SELECT coalesce(sum(l.amount + l.cut), 0) FROM dkp_ledger l WHERE l.kill_id = k.id AND l.member_id = ?2 AND l.pool = p.value) > 0) AS earned
           FROM json_each(?5) p`,
        )
        .bind(guildId, q.member, since, new Date(Date.parse(since) - 24 * 3_600_000).toISOString(), pools),
    );
  }
  const res = await db.batch<Record<string, unknown>>(stmts);
  const standings = new Map<string, Standing[]>(q.pools.map((p) => [p, []]));
  for (const r of res[0].results as unknown as (Standing & { pool: string; balance: number | null })[])
    if (r.balance !== null) standings.get(r.pool)!.push({ member_id: r.member_id, name: r.name, status: r.status, balance: r.balance });
  for (const list of standings.values()) list.sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const attendance = (res[1]?.results ?? []) as unknown as Attendance[];
  return { standings, attendance, rowsRead: res.reduce((n, r) => n + (r.meta.rows_read ?? 0), 0) };
}

export interface LedgerRow {
  id: number;
  pool: string;
  amount: number;
  cut: number;
  balance_after: number;
  kind: LedgerKind;
  kill_id: number | null;
  corrects: number | null;
  reason: string | null;
  actor: string;
  at: string;
}
/** /dkp history: one member's rows in one pool, newest first (dkp_ledger_balance, read backwards). */
export const historySql = 'SELECT id, pool, amount, cut, balance_after, kind, kill_id, corrects, reason, actor, at FROM dkp_ledger WHERE guild_id = ?1 AND pool = ?2 AND member_id = ?3 ORDER BY id DESC LIMIT ?4 OFFSET ?5';

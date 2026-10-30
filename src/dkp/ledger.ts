// Order 27: the DKP ledger (migrations/0021 dkp_ledger). Append-only: every change is a new row, and its balance_after is
// computed in the same statement from the member's previous row in that pool (order 27, override 8). A positive amount is
// capped against the pool's cap at that moment; the part the cap cut is kept in `cut` (asked = amount + cut). A negative
// adjustment is never cut. A reversal returns the amount actually paid, with the mirrored cut, so a kill's asked amounts
// for a member sum to zero once reversed.
//
// One reader (dkpRead) answers every balance and attendance question: standings, /me, history.
//
// Order 29: who was at a kill is read only from dkp_kill_member (the kill's roster, written in the same batch as its
// ledger rows), never from the ledger. Standby earns the standby value once per raid, at close (standbyStatement), in raids
// opened from order 29 on (dkp_raid.standby_once); a correction after close reverses it (standbyReverseStatement).
export const POOL_GUILD = 'guild';

export type LedgerKind = 'kill' | 'flat' | 'adjust' | 'correction' | 'standby' | 'spend' | 'refund' | 'decay';

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
  /** Pays only while this approval stands as this press decided it (an approval's status change and payment, in one batch). */
  approvedPending?: number;
}

/** One statement: a row per member (members must be distinct), each with its own balance_after. */
export function payStatement(db: D1Database, p: Payment): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (SELECT j.value AS member_id, ${PREV('j.value')} AS prev FROM json_each(?9) j),
            a AS (SELECT member_id, prev, CASE WHEN ?3 > 0 THEN min(?3, max(0, ?4 - prev)) ELSE ?3 END AS applied FROM t)
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, applied, ?3 - applied, prev + applied, ?5, ?6, ?7, NULL, ?8, ?10, ?11 FROM a
       WHERE ?12 IS NULL OR (EXISTS (SELECT 1 FROM dkp_pending q WHERE q.id = ?12 AND q.status = 'approved' AND q.decided_by = ?10 AND q.decided_at = ?11)
         AND NOT EXISTS (SELECT 1 FROM dkp_ledger x WHERE x.guild_id = ?1 AND x.pool = ?2 AND x.member_id = a.member_id AND x.actor = ?10 AND x.at = ?11))`,
    )
    .bind(p.guildId, p.pool, p.asked, p.cap, p.kind, p.raidId ?? null, p.killId ?? null, p.reason ?? null, JSON.stringify([...new Set(p.members)]), p.actor, p.at, p.approvedPending ?? null);
}

/**
 * Removes members from one kill in one pool: for each member whose asked amounts on that kill sum above zero, a correction
 * row returning what was actually paid (corrects: their latest row for the kill). Members not credited get no row.
 */
/** An approval's gate (review of PR B): writes only while pending row ?id stands approved by this actor at this time. */
const APPROVED_GATE = (id: string, actor: string, at: string) =>
  `(${id} IS NULL OR EXISTS (SELECT 1 FROM dkp_pending q WHERE q.id = ${id} AND q.status = 'approved' AND q.decided_by = ${actor} AND q.decided_at = ${at}))`;

export function reverseStatement(db: D1Database, r: { guildId: string; pool: string; killId: number; members: string[]; reason: string; actor: string; at: string; approvedPending?: number }): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (SELECT j.value AS member_id, ${PREV('j.value')} AS prev,
                    (SELECT coalesce(sum(k.amount), 0) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS paid,
                    (SELECT coalesce(sum(k.amount + k.cut), 0) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS asked,
                    (SELECT max(k.id) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS last
                  FROM json_each(?4) j)
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, -paid, paid - asked, prev - paid, 'correction', (SELECT raid_id FROM dkp_kill WHERE id = ?3), ?3, last, ?5, ?6, ?7
       FROM t WHERE asked > 0 AND ${APPROVED_GATE('?8', '?6', '?7')}`,
    )
    .bind(r.guildId, r.pool, r.killId, JSON.stringify([...new Set(r.members)]), r.reason, r.actor, r.at, r.approvedPending ?? null);
}

/**
 * Adds members to one kill in one pool (an officer's correction): for each member whose asked amounts on that kill are not
 * above zero, a correction row asking `asked`, capped against the cap now (corrects: their latest row for the kill, if any).
 */
export function readdStatement(db: D1Database, r: { guildId: string; pool: string; killId: number; asked: number; cap: number; members: string[]; reason: string; actor: string; at: string; approvedPending?: number }): D1PreparedStatement {
  return db
    .prepare(
      `WITH t AS (SELECT j.value AS member_id, ${PREV('j.value')} AS prev,
                    (SELECT coalesce(sum(k.amount + k.cut), 0) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS asked,
                    (SELECT max(k.id) FROM dkp_ledger k WHERE k.kill_id = ?3 AND k.member_id = j.value AND k.pool = ?2) AS last
                  FROM json_each(?6) j),
            a AS (SELECT member_id, prev, last, min(?4, max(0, ?5 - prev)) AS applied FROM t WHERE asked <= 0 AND ${APPROVED_GATE('?10', '?8', '?9')})
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, applied, ?4 - applied, prev + applied, 'correction', (SELECT raid_id FROM dkp_kill WHERE id = ?3), ?3, last, ?7, ?8, ?9 FROM a`,
    )
    .bind(r.guildId, r.pool, r.killId, r.asked, r.cap, JSON.stringify([...new Set(r.members)]), r.reason, r.actor, r.at, r.approvedPending ?? null);
}

// ---------------------------------------------------------------- kill rosters and standby (order 29)

/** One roster row per member at a kill (Present or Standby, as they stood); a member already on it is kept as recorded. */
export const rosterAddStatement = (db: D1Database, killId: number, members: { member_id: string; state: 'present' | 'standby' }[], approvedPending?: { id: number; actor: string; at: string }) =>
  db
    .prepare(
      `INSERT INTO dkp_kill_member (kill_id, member_id, state) SELECT ?1, json_extract(j.value, '$.m'), json_extract(j.value, '$.s') FROM json_each(?2) j
       WHERE ${APPROVED_GATE('?3', '?4', '?5')} ON CONFLICT DO NOTHING`,
    )
    .bind(killId, JSON.stringify(members.map((m) => ({ m: m.member_id, s: m.state }))), approvedPending?.id ?? null, approvedPending?.actor ?? null, approvedPending?.at ?? null);

/** Members off one kill's roster (Check again, a correction). */
export const rosterRemoveStatement = (db: D1Database, killId: number, members: string[], approvedPending?: { id: number; actor: string; at: string }) =>
  db
    .prepare(`DELETE FROM dkp_kill_member WHERE kill_id = ?1 AND member_id IN (SELECT value FROM json_each(?2)) AND ${APPROVED_GATE('?3', '?4', '?5')}`)
    .bind(killId, JSON.stringify([...new Set(members)]), approvedPending?.id ?? null, approvedPending?.actor ?? null, approvedPending?.at ?? null);

/**
 * The standby value, once per raid (order 29, override 2): every member Standby at one or more of the raid's kills (its
 * roster), active now (frozen members earn nothing), in a closed raid opened from order 29 on. Capped as a kill is. Once
 * per member and pool: a payout already made (or made and reversed) is never made again (and dkp_ledger_standby_once
 * refuses a second).
 */
export const standbyStatement = (db: D1Database, p: { guildId: string; pool: string; raidId: number; asked: number; cap: number; at: string }) =>
  db
    .prepare(
      `WITH s AS (SELECT DISTINCT km.member_id FROM dkp_kill_member km JOIN dkp_kill k ON k.id = km.kill_id
                  JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = km.member_id
                  WHERE k.raid_id = ?3 AND km.state = 'standby' AND m.status = 'active'),
            t AS (SELECT member_id, ${PREV('s.member_id')} AS prev FROM s),
            a AS (SELECT member_id, prev, CASE WHEN ?4 > 0 THEN min(?4, max(0, ?5 - prev)) ELSE ?4 END AS applied FROM t)
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, member_id, ?2, applied, ?4 - applied, prev + applied, 'standby', ?3, NULL, NULL, NULL, 'bot', ?6 FROM a
       WHERE EXISTS (SELECT 1 FROM dkp_raid r WHERE r.id = ?3 AND r.standby_once = 1 AND r.closed_at IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM dkp_ledger x WHERE x.kind = 'standby' AND x.raid_id = ?3 AND x.pool = ?2 AND x.member_id = a.member_id)`,
    )
    .bind(p.guildId, p.pool, p.raidId, p.asked, p.cap, p.at);

/**
 * After close, a member who no longer has a Standby kill in the raid (Check again or a correction removed their last) loses
 * the standby payout: a correction row returning what it paid (corrects: the standby row). Runs after the roster change in
 * the same batch; once only (a reversed payout is not reversed again).
 */
export const standbyReverseStatement = (db: D1Database, r: { guildId: string; pool: string; raidId: number; members: string[]; reason: string; actor: string; at: string; approvedPending?: number }) =>
  db
    .prepare(
      `WITH s AS (SELECT x.id, x.member_id, x.amount, x.cut FROM dkp_ledger x WHERE x.kind = 'standby' AND x.raid_id = ?3 AND x.pool = ?2
                    AND x.member_id IN (SELECT value FROM json_each(?4))
                    AND NOT EXISTS (SELECT 1 FROM dkp_ledger c WHERE c.corrects = x.id)
                    AND NOT EXISTS (SELECT 1 FROM dkp_kill_member km JOIN dkp_kill k ON k.id = km.kill_id WHERE k.raid_id = ?3 AND km.member_id = x.member_id AND km.state = 'standby'))
       INSERT INTO dkp_ledger (guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
       SELECT ?1, s.member_id, ?2, -s.amount, -s.cut, ${PREV('s.member_id')} - s.amount, 'correction', ?3, NULL, s.id, ?5, ?6, ?7 FROM s
       WHERE ${APPROVED_GATE('?8', '?6', '?7')}`,
    )
    .bind(r.guildId, r.pool, r.raidId, JSON.stringify([...new Set(r.members)]), r.reason, r.actor, r.at, r.approvedPending ?? null);

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
 * was at in the pool (Present or Standby: on the kill's roster, order 29) ÷ those the pool held.
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
    // ones the member was at, through the roster's primary key.
    stmts.push(
      db
        .prepare(
          `WITH k AS (SELECT k.id, r.pool FROM dkp_raid r JOIN dkp_kill k ON k.raid_id = r.id WHERE r.guild_id = ?1 AND r.opened_at >= ?4 AND k.at >= ?3)
           SELECT p.value AS pool,
                  (SELECT count(*) FROM k WHERE p.value = '${POOL_GUILD}' OR k.pool = p.value) AS held,
                  (SELECT count(*) FROM k WHERE (p.value = '${POOL_GUILD}' OR k.pool = p.value)
                     AND EXISTS (SELECT 1 FROM dkp_kill_member km WHERE km.kill_id = k.id AND km.member_id = ?2)) AS earned
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
export const historySql = `SELECT l.id, l.pool, l.amount, l.cut, l.balance_after, l.kind, l.kill_id, l.corrects, l.reason, l.actor, l.at, k.name AS kill_name
  FROM dkp_ledger l LEFT JOIN dkp_kill k ON k.id = l.kill_id WHERE l.guild_id = ?1 AND l.pool = ?2 AND l.member_id = ?3 ORDER BY l.id DESC LIMIT ?4 OFFSET ?5`;

// Order 32: the one writer of event_signup. Every change goes through here with its history row, in one batch, and room is
// judged inside the statement, so two presses at once can't both take the last place. The card and every count are derived
// from the current rows.
import { LIMIT_COLUMN, ON_ROSTER, ROLES, type Role, type Status } from './types.ts';

/** Room for the signed-up row of `role` (a SQL expression), not counting member `self` (a SQL expression). */
export const roomSql = (role: string, self: string) => `(
  (e.capacity IS NULL OR (SELECT count(*) FROM event_signup x WHERE x.event_id = e.id AND x.status = 'signed_up' AND x.member_id <> ${self}) < e.capacity)
  AND (CASE ${role} ${ROLES.map((r) => `WHEN '${r}' THEN e.${LIMIT_COLUMN[r]}`).join(' ')} END IS NULL
    OR (SELECT count(*) FROM event_signup x WHERE x.event_id = e.id AND x.status = 'signed_up' AND x.role = ${role} AND x.member_id <> ${self})
       < CASE ${role} ${ROLES.map((r) => `WHEN '${r}' THEN e.${LIMIT_COLUMN[r]}`).join(' ')} END))`;

/** The history row of everything this batch changed on this event at this moment, for one reason or one member. */
export const historyStatement = (db: D1Database, eventId: number, at: string, who: { member: string } | { reason: string }) =>
  db
    .prepare(
      `INSERT INTO event_signup_history (event_id, guild_id, member_id, status, role, char_name, actor, reason, at)
       SELECT s.event_id, s.guild_id, s.member_id, s.status, s.role, s.char_name, s.changed_by, s.change_reason, s.updated_at FROM event_signup s
       WHERE s.event_id = ?1 AND s.updated_at = ?2 AND ${'member' in who ? 's.member_id = ?3' : 's.change_reason = ?3'}
         AND NOT EXISTS (SELECT 1 FROM event_signup_history h WHERE h.event_id = s.event_id AND h.member_id = s.member_id AND h.at = s.updated_at AND h.status = s.status AND h.role IS s.role AND h.char_name IS s.char_name)`,
    )
    .bind(eventId, at, 'member' in who ? who.member : who.reason);

export interface Change {
  eventId: number;
  member: string;
  /** What is asked; a full role or event sends signed_up to the event's when_full, unless `force`. */
  status: Status;
  role: Role | null;
  character: Snapshot | null;
  actor: string;
  reason: string | null;
  at: string;
  /** Officers may exceed a limit. */
  force?: boolean;
}
export interface Snapshot {
  id: number | null;
  name: string | null;
  class: string | null;
  level: number | null;
}

/**
 * One member's change, with its history row. Room is judged inside the statement. The waitlist keeps a member's place while
 * they stay on it (Change character, Change role); any other status gives it up. Returns the status they ended on.
 */
export function changeStatements(db: D1Database, c: Change): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO event_signup (event_id, guild_id, member_id, status, role, character_id, char_name, char_class, char_level, queued_at, updated_at, changed_by, change_reason)
         SELECT f.id, f.guild_id, ?2, f.final, ?4, ?5, ?6, ?7, ?8, CASE WHEN f.final = 'waitlist' THEN ?9 END, ?9, ?10, ?11
         FROM (SELECT e.id, e.guild_id, CASE WHEN ?3 = 'signed_up' AND ?12 = 0 AND NOT ${roomSql('?4', '?2')} THEN e.when_full ELSE ?3 END AS final FROM event e WHERE e.id = ?1 AND e.status = 'open') f WHERE 1
         ON CONFLICT (event_id, member_id) DO UPDATE SET status = excluded.status, role = excluded.role, character_id = excluded.character_id, char_name = excluded.char_name, char_class = excluded.char_class, char_level = excluded.char_level,
           queued_at = CASE WHEN excluded.status <> 'waitlist' THEN NULL WHEN event_signup.status = 'waitlist' THEN event_signup.queued_at ELSE excluded.updated_at END,
           updated_at = excluded.updated_at, changed_by = excluded.changed_by, change_reason = excluded.change_reason
         RETURNING status`,
      )
      .bind(c.eventId, c.member, c.status, c.role, c.character?.id ?? null, c.character?.name ?? null, c.character?.class ?? null, c.character?.level ?? null, c.at, c.actor, c.reason, c.force ? 1 : 0),
    historyStatement(db, c.eventId, c.at, { member: c.member }),
  ];
}

/** A member's role, only into room while they hold a place; a waitlisted member keeps their place. Returns no row when it's full. */
export function roleStatements(db: D1Database, c: { eventId: number; member: string; role: Role; actor: string; at: string }): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE event_signup SET role = ?3, updated_at = ?4, changed_by = ?5, change_reason = NULL
         WHERE event_id = ?1 AND member_id = ?2 AND (status <> 'signed_up' OR EXISTS (SELECT 1 FROM event e WHERE e.id = ?1 AND ${roomSql('?3', '?2')}))
         RETURNING status`,
      )
      .bind(c.eventId, c.member, c.role, c.at, c.actor),
    historyStatement(db, c.eventId, c.at, { member: c.member }),
  ];
}

/** Change character: the snapshot only; place and role stay. */
export function characterStatements(db: D1Database, c: { eventId: number; member: string; character: Snapshot; actor: string; at: string }): D1PreparedStatement[] {
  return [
    db
      .prepare('UPDATE event_signup SET character_id = ?3, char_name = ?4, char_class = ?5, char_level = ?6, updated_at = ?7, changed_by = ?8, change_reason = NULL WHERE event_id = ?1 AND member_id = ?2')
      .bind(c.eventId, c.member, c.character.id, c.character.name, c.character.class, c.character.level, c.at, c.actor),
    historyStatement(db, c.eventId, c.at, { member: c.member }),
  ];
}

/** The lock's Left check: these members leave the roster. Returns each. */
export function leftStatements(db: D1Database, eventId: number, members: string[], at: string): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `UPDATE event_signup SET status = 'left', queued_at = NULL, updated_at = ?2, changed_by = 'bot', change_reason = '${LEFT}'
         WHERE event_id = ?1 AND status IN (${ON_ROSTER.map((s) => `'${s}'`).join(', ')}) AND member_id IN (SELECT value FROM json_each(?3)) RETURNING member_id`,
      )
      .bind(eventId, at, JSON.stringify(members)),
    historyStatement(db, eventId, at, { reason: LEFT }),
  ];
}

export const LEFT = 'left the server';
export const PROMOTED = 'promoted';
/** Most members one batch promotes; the rest move with the next change that frees a place. */
export const MAX_PROMOTIONS = 50;

/**
 * Up to `slots` promotions, in order: each statement moves the earliest waitlisted member whose role now has room, up to
 * the start, and then one history statement records them. Each returns the member it moved. `except`: an officer who has
 * just moved this member to the waitlist means it, so their own place doesn't bring them straight back.
 */
export function promotionStatements(db: D1Database, eventId: number, at: string, slots: number, except = ''): D1PreparedStatement[] {
  const one = db
    .prepare(
      `UPDATE event_signup SET status = 'signed_up', queued_at = NULL, updated_at = ?2, changed_by = 'bot', change_reason = '${PROMOTED}'
       WHERE event_id = ?1 AND member_id = (SELECT s.member_id FROM event_signup s JOIN event e ON e.id = s.event_id
         WHERE s.event_id = ?1 AND s.status = 'waitlist' AND s.member_id <> ?3 AND e.status = 'open' AND e.start_at > ?2 AND ${roomSql('s.role', 's.member_id')}
         ORDER BY s.queued_at, s.rowid LIMIT 1)
       RETURNING member_id`,
    )
    .bind(eventId, at, except);
  return [...Array.from({ length: slots }, () => one), historyStatement(db, eventId, at, { reason: PROMOTED })];
}

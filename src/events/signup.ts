// Order 32: the one writer of event_signup. Every change goes through here with its history row, in one batch, and room is
// judged inside the statement, so two presses at once can't both take the last place. The card and every count are derived
// from the current rows.
import { LIMIT_COLUMN, ROLES } from './types.ts';

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

export const PROMOTED = 'promoted';
/** Most members one batch promotes; the rest move with the next change that frees a place. */
export const MAX_PROMOTIONS = 50;

/**
 * Up to `slots` promotions, in order: each statement moves the earliest waitlisted member whose role now has room, up to
 * the start, and then one history statement records them. Each returns the member it moved.
 */
export function promotionStatements(db: D1Database, eventId: number, at: string, slots: number): D1PreparedStatement[] {
  const one = db
    .prepare(
      `UPDATE event_signup SET status = 'signed_up', queued_at = NULL, updated_at = ?2, changed_by = 'bot', change_reason = '${PROMOTED}'
       WHERE event_id = ?1 AND member_id = (SELECT s.member_id FROM event_signup s JOIN event e ON e.id = s.event_id
         WHERE s.event_id = ?1 AND s.status = 'waitlist' AND e.status = 'open' AND e.start_at > ?2 AND ${roomSql('s.role', 's.member_id')}
         ORDER BY s.queued_at, s.rowid LIMIT 1)
       RETURNING member_id`,
    )
    .bind(eventId, at);
  return [...Array.from({ length: slots }, () => one), historyStatement(db, eventId, at, { reason: PROMOTED })];
}

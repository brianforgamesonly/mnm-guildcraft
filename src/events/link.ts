// Order 34 (ITEM 1): the link between a raid and an event (dkp_raid.event_id, docs/PRD.md "Events module"). A raid links when
// it opens and never again, so an event created later can't be linked to it. A cancelled event counts as no link, and so does
// a server whose Events module is off: the raid then behaves as an unlinked one. Marks are worked out each time a card is
// drawn, never stored. Events never pays or removes points: this file only reads, and closes the event with its raid.
import { rosterMark } from './eligible.ts';
import { PRESENT_CHECK, presentCheckOf, type PresentCheck } from './settings.ts';
import { ON_ROSTER, type Status } from './types.ts';

/** A raid links to an event starting at most this long before or after now, compared in UTC. */
export const LINK_WINDOW_MS = 3_600_000;

const LINK_COLS = `e.id, e.title, e.status, e.start_at, e.message_id, g.channel_id, coalesce(g.enabled, 0) AS enabled,
  (SELECT s.value FROM event_setting s WHERE s.guild_id = e.guild_id AND s.key = '${PRESENT_CHECK}') AS present_check`;
const LINK_FROM = 'FROM event e LEFT JOIN event_guild g ON g.guild_id = e.guild_id WHERE e.id = ?1 AND e.guild_id = ?2';

interface LinkRow {
  id: number;
  title: string;
  status: string;
  start_at: string;
  message_id: string | null;
  channel_id: string | null;
  enabled: number;
  present_check: string | null;
}
export interface EventLink extends Omit<LinkRow, 'enabled' | 'present_check'> {
  check: PresentCheck;
  /** Cancelling the event ended the link; the raid carries on, and its card says so. */
  cancelled: boolean;
}

/** The link as the raid card and a tap see it: null while the Events module is off, or the row is gone. */
function linkOf(r: LinkRow | null | undefined): EventLink | null {
  if (!r || r.enabled !== 1) return null;
  const { enabled: _on, present_check, ...rest } = r;
  return { ...rest, check: presentCheckOf(present_check), cancelled: r.status === 'cancelled' };
}

export interface LinkedRoster {
  link: EventLink;
  /** Each member on the roster, by status. */
  roster: Map<string, Status>;
  bench: { member_id: string; name: string }[];
}

const ROSTER_SQL = `SELECT s.member_id, s.status, coalesce(m.display_name, s.member_id) AS name FROM event_signup s
  LEFT JOIN member m ON m.guild_id = s.guild_id AND m.discord_user_id = s.member_id
  WHERE s.event_id = ? AND s.status IN (${ON_ROSTER.map((x) => `'${x}'`).join(', ')}) ORDER BY lower(name)`;

/** What the raid card draws from: one batch of 2 statements, only for a linked raid. */
export async function linkedRoster(db: D1Database, guildId: string, eventId: number): Promise<LinkedRoster | null> {
  const [link, rows] = await db.batch<Record<string, unknown>>([db.prepare(`SELECT ${LINK_COLS} ${LINK_FROM}`).bind(eventId, guildId), db.prepare(ROSTER_SQL).bind(eventId)]);
  const l = linkOf(link.results[0] as unknown as LinkRow | undefined);
  if (!l) return null;
  const list = rows.results as { member_id: string; status: Status; name: string }[];
  return { link: l, roster: new Map(list.map((r) => [r.member_id, r.status])), bench: list.filter((r) => r.status === 'bench') };
}

/** Whether the card marks this member "(not signed up)". Null: nothing to mark against. */
export const marked = (r: LinkedRoster | null, member: string) => !!r && !r.link.cancelled && rosterMark(r.link.check, r.roster.get(member));

/** One statement per tap: the link and the member's own status, read fresh, so a late sign-up counts at once. */
export async function tapLink(db: D1Database, guildId: string, eventId: number, member: string): Promise<(EventLink & { signup: Status | null }) | null> {
  const r = await db
    .prepare(`SELECT ${LINK_COLS}, (SELECT x.status FROM event_signup x WHERE x.event_id = e.id AND x.member_id = ?3) AS signup ${LINK_FROM}`)
    .bind(eventId, guildId, member)
    .first<LinkRow & { signup: Status | null }>();
  const l = linkOf(r);
  return l && !l.cancelled ? { ...l, signup: r!.signup } : null;
}

export interface Linkable {
  id: number;
  title: string;
  start_at: string;
}
/** A card that hasn't posted has no message_id: Post can still put that row back to a preview, which must stay unlinked. */
const OPEN_RAID_EVENT = "e.guild_id = ?1 AND e.status = 'open' AND e.type = 'raid' AND e.message_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM dkp_raid r WHERE r.event_id = e.id)";
/** The SQL each list of linkable events shares (src/commands/autocomplete.ts). */
export const SQL_LINKABLE = OPEN_RAID_EVENT;

/** The automatic match: open Raid events in this zone, or with no zone, within the window (stored times are UTC). One statement. */
export async function matchEvents(db: D1Database, guildId: string, zone: string, nowMs: number): Promise<Linkable[]> {
  const { results } = await db
    .prepare(`SELECT e.id, e.title, e.start_at FROM event e WHERE ${OPEN_RAID_EVENT} AND (e.zone_key = ?2 OR e.zone_key IS NULL) AND e.start_at BETWEEN ?3 AND ?4 ORDER BY e.start_at LIMIT 10`)
    .bind(guildId, zone, new Date(nowMs - LINK_WINDOW_MS).toISOString(), new Date(nowMs + LINK_WINDOW_MS).toISOString())
    .all<Linkable>();
  return results;
}

/** The event: option: any open Raid event not already linked. It overrides the match. One statement. */
export const pickableEvent = (db: D1Database, guildId: string, id: number) => db.prepare(`SELECT e.id, e.title, e.start_at FROM event e WHERE ${OPEN_RAID_EVENT} AND e.id = ?2`).bind(guildId, id).first<Linkable>();

/**
 * For the batch that closes a linked raid, however it closes: the event closes too, only once the raid really has (override
 * 3 of order 32's "The event closes 8 hours after start"). A closed event's card is flagged out of date in the same batch,
 * so the sweep draws it whatever follows, Events module off included: order 33's flag waits for the module to come back. A
 * cancelled event's card isn't touched: nothing about it changed, and order 33's repost is only for a change.
 */
export const closeWithRaid = (db: D1Database, guildId: string, raidId: number, eventId: number, at: string): D1PreparedStatement[] => [
  db.prepare("UPDATE event SET status = 'closed', closed_at = ?1 WHERE id = ?2 AND guild_id = ?3 AND status = 'open' AND EXISTS (SELECT 1 FROM dkp_raid r WHERE r.id = ?4 AND r.closed_at IS NOT NULL)").bind(at, eventId, guildId, raidId),
  db.prepare("INSERT INTO card_stale (guild_id, item, since, status, code) SELECT ?1, ?2, ?3, 0, NULL FROM event e WHERE e.id = ?4 AND e.status = 'closed' ON CONFLICT (guild_id, item) DO NOTHING").bind(guildId, `evcard:${eventId}`, at, eventId),
];

/** Whether the linked event's card needs drawing after its raid closed. One statement, only for a linked raid. */
export const closedEvent = async (db: D1Database, eventId: number) => !!(await db.prepare("SELECT 1 FROM event WHERE id = ? AND status = 'closed'").bind(eventId).first());

// Order 32 (ITEM 2): the event card, one message in GC-Events, derived from the current sign-up rows. The roster fills the
// description (at most 4,096 characters), then fields (at most 1,024 each); the whole embed stays within 6,000, and on
// overflow it ends "+N more: /event list" (docs.discord.com/developers/resources/message, embed limits). Mentions show
// who a member is and ping nobody (order 32's override 6). Every button on the card is one any member can press.
import type { Env } from '../env.ts';
import { UNKNOWN_MESSAGE, type BotApi } from '../board/api.ts';
import { button, EMBED_LIMITS, md, memberTag, NO_PINGS, row, STYLE_PRIMARY, STYLE_SECONDARY, type Embed } from '../discord.ts';
import { dkpRead, type EventRaid } from '../dkp/ledger.ts';
import { cardRefused } from '../dkp/stale.ts';
import { EVENT_COPY } from './copy.ts';
import type { EventSettings } from './settings.ts';
import type { EventState } from './state.ts';
import { stamp } from './times.ts';
import { LIMIT_COLUMN, PREVIEW, ROLE_DEFAULTS, ROLES, TYPE_RULES, type Choice, type EventType, type Role, type Status } from './types.ts';

export const STATUS_PREFIX = 'evs:';
export const CHANGE_CHARACTER_PREFIX = 'evcc:';
export const CHANGE_ROLE_PREFIX = 'evcr:';
export const CALENDAR_PREFIX = 'evcal:';

export interface EventRow {
  id: number;
  guild_id: string;
  type: EventType;
  title: string;
  start_at: string;
  duration_minutes: number;
  zone_key: string | null;
  zone_name?: string | null;
  description: string | null;
  capacity: number | null;
  limit_tank: number | null;
  limit_healer: number | null;
  limit_dps: number | null;
  limit_support: number | null;
  when_full: 'waitlist' | 'bench';
  signup_role: string | null;
  lock_at: string | null;
  closes_at: string;
  status: typeof PREVIEW | 'open' | 'cancelled' | 'closed';
  message_id: string | null;
  posted_by: string;
  poster_name?: string | null;
  canceller_name?: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  lock_done_at: string | null;
  left_cursor: string | null;
  reminded_start: string | null;
}

export interface SignupRow {
  member_id: string;
  status: Status;
  role: Role | null;
  char_name: string | null;
  char_class: string | null;
  char_level: number | null;
  queued_at: string | null;
  name: string;
}

const EVENT_SQL = `SELECT e.*, z.name AS zone_name, m.display_name AS poster_name, x.display_name AS canceller_name FROM event e LEFT JOIN zone z ON z.key = e.zone_key
  LEFT JOIN member m ON m.guild_id = e.guild_id AND m.discord_user_id = e.posted_by
  LEFT JOIN member x ON x.guild_id = e.guild_id AND x.discord_user_id = e.cancelled_by WHERE e.id = ?1 AND e.guild_id = ?2`;
export const loadEvent = (db: D1Database, guildId: string, id: number) => db.prepare(EVENT_SQL).bind(id, guildId).first<EventRow>();

const SIGNUPS_SQL = `SELECT s.member_id, s.status, s.role, s.char_name, s.char_class, s.char_level, s.queued_at, coalesce(m.display_name, s.member_id) AS name
  FROM event_signup s LEFT JOIN member m ON m.guild_id = s.guild_id AND m.discord_user_id = s.member_id WHERE s.event_id = ?`;
export const loadSignups = async (db: D1Database, id: number) => (await db.prepare(SIGNUPS_SQL).bind(id).all<SignupRow>()).results;

/** The heading a role's group takes. A label an admin renamed is shown as typed; GuildCraft doesn't guess its plural. */
const ROLE_PLURAL: Record<Role, string> = { tank: 'Tanks', healer: 'Healers', dps: 'DPS', support: 'Support' };
export const roleHeading = (r: Role, s: EventSettings) => (s.role_labels[r] === ROLE_DEFAULTS[r] ? ROLE_PLURAL[r] : md(s.role_labels[r]));

/** The label of a member's choice on this type: Going and Maybe are stored as signed_up and tentative. */
export function statusLabel(status: Choice | 'waitlist', type: EventType): string {
  const casual = TYPE_RULES[type].casual;
  return status === 'signed_up' ? (casual ? EVENT_COPY.going : EVENT_COPY.signedUp) : status === 'tentative' ? (casual ? EVENT_COPY.maybe : EVENT_COPY.tentative) : status === 'bench' ? EVENT_COPY.bench : status === 'waitlist' ? EVENT_COPY.waitlist : EVENT_COPY.cantMakeIt;
}

/** Order 33: buttons name actions. Only Signed up changes; every other label is the status's own. */
export const actionLabel = (status: Choice, type: EventType) => (status === 'signed_up' && !TYPE_RULES[type].casual ? EVENT_COPY.signUp : statusLabel(status, type));

/** Name · Cls 32 · @member, each part only where it is known. A sign-up without a character is the mention alone. */
export function rosterLine(s: SignupRow): string {
  const cls = [s.char_class ? md(s.char_class) : null, s.char_level ?? null].filter((x) => x !== null).join(' ');
  return [s.char_name ? md(s.char_name) : null, cls || null, memberTag(s.member_id, s.name)].filter(Boolean).join(' · ');
}

const byClass = (a: SignupRow, b: SignupRow) => (a.char_class ?? '').localeCompare(b.char_class ?? '') || (a.char_name ?? a.name).localeCompare(b.char_name ?? b.name);
const countOf = (n: number, limit: number | null) => {
  const count = limit === null ? `${n}` : `${n} / ${limit}`;
  return limit !== null && n > limit ? `${count} ${EVENT_COPY.overLimit}` : count;
};

export interface Section {
  head: string;
  lines: string[];
}

/** The roster's groups: by role with each count against its limit, then by class; then Tentative, Bench and Waitlist. */
export function rosterSections(e: EventRow, signups: SignupRow[], s: EventSettings): Section[] {
  const rule = TYPE_RULES[e.type];
  const going = signups.filter((x) => x.status === 'signed_up');
  const out: Section[] = [];
  if (rule.character === 'none') out.push({ head: `${statusLabel('signed_up', e.type)} ${countOf(going.length, null)}`, lines: [...going].sort(byClass).map(rosterLine) });
  else {
    for (const r of ROLES) {
      const limit = e[LIMIT_COLUMN[r]];
      const here = going.filter((x) => x.role === r);
      if (limit === null && !here.length) continue;
      out.push({ head: `${roleHeading(r, s)} ${countOf(here.length, limit)}`, lines: [...here].sort(byClass).map(rosterLine) });
    }
    const none = going.filter((x) => !x.role);
    if (none.length) out.push({ head: `${EVENT_COPY.noRole} ${none.length}`, lines: [...none].sort(byClass).map(rosterLine) });
  }
  for (const status of ['tentative', 'bench', 'waitlist'] as const) {
    const here = signups.filter((x) => x.status === status);
    if (!here.length) continue;
    const sorted = status === 'waitlist' ? [...here].sort((a, b) => (a.queued_at ?? '').localeCompare(b.queued_at ?? '')) : [...here].sort(byClass);
    out.push({ head: `${statusLabel(status, e.type)} ${here.length}`, lines: sorted.map(rosterLine) });
  }
  return out;
}

/** "+N more: /event list", the longest form at a 4-digit N. */
const MORE_RESERVE = EVENT_COPY.more(9999).length + 2;

/**
 * The header, then each section's lines, into the description and then fields, within Discord's limits. Stops at the
 * whole embed's 6,000 characters (less the title and footer) or 25 fields, and says how many lines it left out.
 */
export function layoutRoster(header: string, sections: Section[], reserved: number, moreText: (n: number) => string = EVENT_COPY.more): Pick<Embed, 'description' | 'fields'> {
  const total = EMBED_LIMITS.total - reserved - MORE_RESERVE;
  const lines = sections.flatMap((x) => [{ text: `**${x.head}**`, head: x.head, first: true }, ...x.lines.map((text) => ({ text, head: x.head, first: false }))]);
  let description = header;
  const fields: { name: string; value: string }[] = [];
  let used = header.length;
  let i = 0;
  // The description, keeping room for the overflow line.
  for (; i < lines.length; i++) {
    const add = `\n${lines[i].text}`;
    if (description.length + add.length > EMBED_LIMITS.description - MORE_RESERVE || used + add.length > total) break;
    description += add;
    used += add.length;
  }
  // Then fields: a group that starts in a field names it; one carried over says so.
  while (i < lines.length && fields.length < EMBED_LIMITS.fields) {
    const name = lines[i].first ? lines[i].head : EVENT_COPY.continued(lines[i].head);
    if (lines[i].first) i++;
    if (used + name.length + 1 > total) break;
    let value = '';
    for (; i < lines.length && !lines[i].first; i++) {
      const add = `${value ? '\n' : ''}${lines[i].text}`;
      if (value.length + add.length > EMBED_LIMITS.fieldValue - MORE_RESERVE || used + name.length + value.length + add.length > total) break;
      value += add;
    }
    if (!value) {
      // A field that took nothing means the next line can't fit at all; an empty group still says so, when that fits.
      if (i < lines.length && !lines[i].first) break;
      value = EVENT_COPY.nobodyYet;
      if (used + name.length + value.length > total) break;
    }
    fields.push({ name, value });
    used += name.length + value.length;
  }
  const left = lines.slice(i).filter((l) => !l.first).length;
  if (left) {
    const more = moreText(left);
    if (fields.length) fields[fields.length - 1].value += `\n${more}`;
    else description += `\n${more}`;
  }
  return { description, ...(fields.length ? { fields } : {}) };
}

/** Order 34: no-shows take at most this much of the card, whole names only, so the roster keeps its room. */
const NO_SHOWS_MAX = 1500;

/** Order 34: as many whole names as fit in `max` characters, a cut mention being no use, and how many didn't. */
export function wholeNames(tags: string[], max: number): string {
  let used = 0;
  let shown = 0;
  while (shown < tags.length && used + tags[shown].length + 2 <= max) used += tags[shown++].length + 2;
  const left = tags.length - shown;
  return `${tags.slice(0, shown).join(', ')}${left ? ` ${EVENT_COPY.andMore(left)}` : ''}`;
}

/**
 * Order 34: the card's no-shows line, worked out from the rows each time the card is drawn: Signed up, and on no kill's roster
 * (a flat payout is one) of the linked raid. Null until that raid closes. Names show; nobody is pinged (NO_PINGS).
 */
export function noShowsLine(signups: SignupRow[], raid: EventRaid | null): string | null {
  if (!raid?.closed) return null;
  if (!raid.kills) return EVENT_COPY.noShowsNotRecorded;
  const was = new Set(raid.attended);
  const tags = signups.filter((s) => s.status === 'signed_up' && !was.has(s.member_id)).sort((a, b) => a.name.localeCompare(b.name)).map((s) => memberTag(s.member_id, s.name));
  return tags.length ? EVENT_COPY.noShows(wholeNames(tags, NO_SHOWS_MAX)) : EVENT_COPY.noShowsNone;
}

function header(e: EventRow, now: number, noShows: string | null): string {
  const start = Date.parse(e.start_at);
  const hours = Math.round((e.duration_minutes / 60) * 100) / 100;
  const lock = e.lock_at ? Date.parse(e.lock_at) : null;
  const zone = e.zone_key ? md(e.zone_name ?? e.zone_key) : null;
  return [
    e.status === 'cancelled' ? EVENT_COPY.cancelledLine(memberTag(e.cancelled_by ?? '', e.canceller_name ?? e.cancelled_by ?? ''), e.cancel_reason ?? '') : e.status === 'closed' ? EVENT_COPY.closedLine : null,
    noShows,
    `${stamp(start, 'F')} (${stamp(start, 'R')})`,
    [EVENT_COPY.duration(hours), zone, EVENT_COPY.posted(memberTag(e.posted_by, e.poster_name ?? e.posted_by))].filter(Boolean).join(' · '),
    e.status === 'open' || e.status === PREVIEW ? (lock === null ? EVENT_COPY.noLock : lock <= now ? EVENT_COPY.locked(stamp(lock, 'f')) : EVENT_COPY.locks(stamp(lock, 'f'), stamp(lock, 'R'))) : null,
    e.signup_role ? EVENT_COPY.signupRole(e.signup_role) : null,
    e.description ? md(e.description) : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The card's buttons: the type's statuses, then Change character and Change role where the type asks for them, and Add to calendar. */
export function cardButtons(e: Pick<EventRow, 'id' | 'type'>): unknown[] {
  const rule = TYPE_RULES[e.type];
  const statuses = rule.statuses.map((st) => button(`${STATUS_PREFIX}${e.id}:${st}`, actionLabel(st, e.type), st === 'signed_up' ? STYLE_PRIMARY : STYLE_SECONDARY));
  const changes = rule.character === 'required' ? [button(`${CHANGE_CHARACTER_PREFIX}${e.id}`, EVENT_COPY.changeCharacter), button(`${CHANGE_ROLE_PREFIX}${e.id}`, EVENT_COPY.changeRole)] : [];
  return [row(statuses), row([...changes, button(`${CALENDAR_PREFIX}${e.id}`, EVENT_COPY.addToCalendar)])];
}

/** The card's embed and buttons. Only an open event has buttons (a preview carries its own). */
export function cardMessage(e: EventRow, signups: SignupRow[], s: EventSettings, now: number, noShows: string | null = null): { embeds: Embed[]; components: unknown[] } {
  const title = `${e.status === 'cancelled' ? EVENT_COPY.cancelledTag : ''}${md(s.type_labels[e.type])} · ${md(e.title)}`.slice(0, EMBED_LIMITS.title);
  const declined = signups.filter((x) => x.status === 'declined').length;
  const left = signups.filter((x) => x.status === 'left').length;
  const going = signups.filter((x) => x.status === 'signed_up').length;
  const footer = [EVENT_COPY.countLine(statusLabel('signed_up', e.type), countOf(going, e.capacity)), declined ? EVENT_COPY.declinedCount(declined) : null, left ? EVENT_COPY.leftCount(left) : null].filter(Boolean).join(' · ');
  const sections = rosterSections(e, signups, s);
  const body = layoutRoster(header(e, now, noShows), sections, title.length + footer.length);
  const embed: Embed = { title, ...body, footer: { text: footer } };
  return { embeds: [embed], components: e.status === 'open' ? cardButtons(e) : [] };
}

export const messageLink = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/**
 * evcard:<id>: the card, edited in place. Returns the edit's rate-limit headers, for the pace of the next one
 * (src/dkp/pace.ts). A change to the event posts the card again if Discord no longer has it (`repost`); the sweep's redraw
 * never posts: 10008 stops there and is recorded (order 33), since a card someone deleted shouldn't return unasked.
 */
export async function renderEvent(env: Pick<Env, 'DB'>, api: BotApi, guildId: string, state: EventState, id: number, now: number, repost = true) {
  const e = await loadEvent(env.DB, guildId, id);
  if (!e || e.status === PREVIEW || !state.channel_id) return null;
  const signups = await loadSignups(env.DB, id);
  // Order 34: only a closed event can have a closed linked raid, so every other draw reads nothing more.
  const raid = e.status === 'closed' ? (await dkpRead(env.DB, guildId, { pools: [], eventRaid: id })).eventRaid : null;
  const m = cardMessage(e, signups, state.settings, now, noShowsLine(signups, raid));
  const body = { ...m, allowed_mentions: NO_PINGS };
  // Post is still saving the card's id: posting here would make a second card.
  if (!e.message_id) return null;
  const r = await api.call('PATCH', `/channels/${state.channel_id}/messages/${e.message_id}`, body);
  if (r.ok) {
    const last = api.log.at(-1);
    return last ? { remaining: last.remaining ?? null, resetAfter: last.reset_after ?? null, retryAfter: last.retry_after ?? null } : null;
  }
  // A throw leaves the item for the object's retries, then the sweep: this edit may be the only one a cancelled card gets.
  if (r.code !== UNKNOWN_MESSAGE || !repost) {
    await cardRefused(env.DB, guildId, `evcard:${id}`, r);
    return null;
  }
  const posted = await api.call<{ id: string }>('POST', `/channels/${state.channel_id}/messages`, body);
  if (!posted.ok) {
    await cardRefused(env.DB, guildId, `evcard:${id}`, posted);
    return null;
  }
  await env.DB.prepare('UPDATE event SET message_id = ? WHERE id = ?').bind(posted.body.id, id).run();
  return null;
}

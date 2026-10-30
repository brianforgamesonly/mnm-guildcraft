// Order 32 (ITEM 2): the event card, one message in GC-Events, derived from the current sign-up rows. The roster fills the
// description (at most 4,096 characters), then fields (at most 1,024 each); the whole embed stays within 6,000, and on
// overflow it ends "+N more: /event list" (docs.discord.com/developers/resources/message, embed limits). Mentions show
// who a member is and ping nobody (order 32's override 6). Every button on the card is one any member can press.
import type { Env } from '../env.ts';
import { UNKNOWN_MESSAGE, type BotApi } from '../board/api.ts';
import { button, EMBED_LIMITS, md, memberTag, NO_PINGS, row, STYLE_PRIMARY, STYLE_SECONDARY, type Embed } from '../discord.ts';
import { EVENT_COPY } from './copy.ts';
import type { EventSettings } from './settings.ts';
import type { EventState } from './state.ts';
import { stamp } from './times.ts';
import { LIMIT_COLUMN, ROLE_DEFAULTS, ROLES, TYPE_RULES, type Choice, type EventType, type Role, type Status } from './types.ts';

export const STATUS_PREFIX = 'evs:';
export const CHANGE_CHARACTER_PREFIX = 'evcc:';
export const CHANGE_ROLE_PREFIX = 'evcr:';

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
  status: 'draft' | 'open' | 'cancelled' | 'closed';
  message_id: string | null;
  posted_by: string;
  poster_name?: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  lock_done_at: string | null;
  left_cursor: string | null;
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

const EVENT_SQL = `SELECT e.*, z.name AS zone_name, m.display_name AS poster_name FROM event e LEFT JOIN zone z ON z.key = e.zone_key
  LEFT JOIN member m ON m.guild_id = e.guild_id AND m.discord_user_id = e.posted_by WHERE e.id = ?1 AND e.guild_id = ?2`;
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
export function layoutRoster(header: string, sections: Section[], reserved: number): Pick<Embed, 'description' | 'fields'> {
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
    fields.push({ name, value: value || EVENT_COPY.nobodyYet });
    used += name.length + value.length;
    // A field that took nothing means the next line can't fit at all.
    if (!value && i < lines.length && !lines[i].first) break;
  }
  const left = lines.slice(i).filter((l) => !l.first).length;
  if (left) {
    const more = EVENT_COPY.more(left);
    if (fields.length) fields[fields.length - 1].value += `\n${more}`;
    else description += `\n${more}`;
  }
  return { description, ...(fields.length ? { fields } : {}) };
}

function header(e: EventRow, now: number): string {
  const start = Date.parse(e.start_at);
  const hours = e.duration_minutes / 60;
  const lock = e.lock_at ? Date.parse(e.lock_at) : null;
  const zone = e.zone_key ? md(e.zone_name ?? e.zone_key) : null;
  return [
    e.status === 'cancelled' ? EVENT_COPY.cancelledLine(md(e.cancel_reason ?? '')) : e.status === 'closed' ? EVENT_COPY.closedLine : null,
    `${stamp(start, 'F')} (${stamp(start, 'R')})`,
    [EVENT_COPY.duration(hours), zone, EVENT_COPY.posted(memberTag(e.posted_by, e.poster_name ?? e.posted_by))].filter(Boolean).join(' · '),
    e.status === 'open' || e.status === 'draft' ? (lock === null ? EVENT_COPY.noLock : lock <= now ? EVENT_COPY.locked(stamp(lock, 'f')) : EVENT_COPY.locks(stamp(lock, 'f'), stamp(lock, 'R'))) : null,
    e.signup_role ? EVENT_COPY.signupRole(e.signup_role) : null,
    e.description ? md(e.description) : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/** The card's buttons: the type's statuses, then Change character and Change role where the type asks for them. */
export function cardButtons(e: Pick<EventRow, 'id' | 'type'>): unknown[] {
  const rule = TYPE_RULES[e.type];
  const statuses = rule.statuses.map((st) => button(`${STATUS_PREFIX}${e.id}:${st}`, statusLabel(st, e.type), st === 'signed_up' ? STYLE_PRIMARY : STYLE_SECONDARY));
  const changes = rule.character === 'required' ? [button(`${CHANGE_CHARACTER_PREFIX}${e.id}`, EVENT_COPY.changeCharacter), button(`${CHANGE_ROLE_PREFIX}${e.id}`, EVENT_COPY.changeRole)] : [];
  return [row(statuses), ...(changes.length ? [row(changes)] : [])];
}

/** The card's embed and buttons. Only an open event has buttons (a draft's are the preview's own). */
export function cardMessage(e: EventRow, signups: SignupRow[], s: EventSettings, now: number): { embeds: Embed[]; components: unknown[] } {
  const title = `${e.status === 'cancelled' ? EVENT_COPY.cancelledTag : ''}${md(s.type_labels[e.type])} · ${md(e.title)}`.slice(0, EMBED_LIMITS.title);
  const declined = signups.filter((x) => x.status === 'declined').length;
  const left = signups.filter((x) => x.status === 'left').length;
  const going = signups.filter((x) => x.status === 'signed_up').length;
  const footer = [EVENT_COPY.countLine(statusLabel('signed_up', e.type), countOf(going, e.capacity)), declined ? EVENT_COPY.declinedCount(declined) : null, left ? EVENT_COPY.leftCount(left) : null].filter(Boolean).join(' · ');
  const sections = rosterSections(e, signups, s);
  const body = layoutRoster(header(e, now), sections, title.length + footer.length);
  const embed: Embed = { title, ...body, footer: { text: footer } };
  return { embeds: [embed], components: e.status === 'open' ? cardButtons(e) : [] };
}

export const messageLink = (guildId: string, channelId: string, messageId: string) => `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

/**
 * evcard:<id>: the card, edited in place; posted again if Discord no longer has it. Returns the edit's rate-limit headers,
 * for the pace of the next one (src/dkp/pace.ts).
 */
export async function renderEvent(env: Pick<Env, 'DB'>, api: BotApi, guildId: string, state: EventState, id: number, now: number) {
  const e = await loadEvent(env.DB, guildId, id);
  if (!e || e.status === 'draft' || !state.channel_id) return null;
  const m = cardMessage(e, await loadSignups(env.DB, id), state.settings, now);
  const body = { ...m, allowed_mentions: NO_PINGS };
  if (e.message_id) {
    const r = await api.call('PATCH', `/channels/${state.channel_id}/messages/${e.message_id}`, body);
    const last = api.log.at(-1);
    if (r.ok || r.code !== UNKNOWN_MESSAGE) return last ? { remaining: last.remaining ?? null, resetAfter: last.reset_after ?? null, retryAfter: last.retry_after ?? null } : null;
  }
  const posted = await api.call<{ id: string }>('POST', `/channels/${state.channel_id}/messages`, body);
  if (posted.ok) await env.DB.prepare('UPDATE event SET message_id = ? WHERE id = ?').bind(posted.body.id, id).run();
  return null;
}

// Order 32 (ITEM 3): what a member's press does, and /event roster. Every route asks src/events/eligible.ts, and every write
// goes through src/events/signup.ts. The presser's answer is always a new private message (or an edit of their own private
// message); the card is redrawn by an evcard item, at the pace Discord allows. After the lock, each change is posted in
// GC-Events with who made it and why. A promoted member gets a direct message (src/events/dm.ts; order 33's override 3), and
// the private reply is enough when it happened on their own press.
import { MessageComponentTypes } from 'discord-interactions';
import { audit, now } from '../access.ts';
import { ADD_PREFIX as ME_ADD_PREFIX } from '../commands/me.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, linkButton, md, memberTag, NO_PINGS, optString, row, STYLE_PRIMARY, truncate, updateMessage, type GuildMember, type MessageReply, type Option } from '../discord.ts';
import { actionLabel, CALENDAR_PREFIX, CHANGE_CHARACTER_PREFIX, CHANGE_ROLE_PREFIX, loadEvent, messageLink, STATUS_PREFIX, statusLabel, type EventRow } from './card.ts';
import { googleLink, icsText, type CalendarEvent } from './calendar.ts';
import { byName, eventApi, spentEvent, type EventRun } from './commands.ts';
import { EVENT_COPY } from './copy.ts';
import { promoItems } from './dm.ts';
import { signupRefusal, SPAM_WINDOW_MS, type SignupRefusal } from './eligible.ts';
import { characterStatements, changeStatements, promotionStatements, roleStatements, type Snapshot } from './signup.ts';
import type { EventState } from './state.ts';
import { ON_ROSTER, PREVIEW, ROLES, TYPE_RULES, type Choice, type Role, type Status } from './types.ts';

export const PICK_CHARACTER_PREFIX = 'evpc:';
export const PICK_ROLE_PREFIX = 'evpr:';
export const CONFIRM_PREFIX = 'evpo:';
export const CHANGE_CHARACTER_PICK = 'evcs:';
export const CHANGE_ROLE_PICK = 'evrs:';
export const NO_REMINDERS_PREFIX = 'evnr:';
const SELECT_MAX = 25;
const NONE = '-';

interface Current {
  status: Status;
  role: Role | null;
  character_id: number | null;
  char_name: string | null;
  char_class: string | null;
  char_level: number | null;
}
interface Own {
  id: number;
  name: string;
  class: string | null;
  level: number | null;
  is_main: number;
  /** That class's default role here, or null: GuildCraft never guesses. */
  suggested: Role | null;
}
const snapshotOf = (ch: Own): Snapshot => ({ id: ch.id, name: ch.name, class: ch.class, level: ch.level });
const keptSnapshot = (cur: Current | null): Snapshot | null => (cur?.char_name ? { id: cur.character_id, name: cur.char_name, class: cur.char_class, level: cur.char_level } : null);

/** Everything a press decides on, in one batch: the event, their row, their member status and their last minute. */
async function loadPress(c: Ctx, eventId: number, member: string) {
  const since = new Date(Date.now() - SPAM_WINDOW_MS).toISOString();
  const [cur, m, recent] = await c.db.batch<Record<string, unknown>>([
    c.db.prepare('SELECT status, role, character_id, char_name, char_class, char_level FROM event_signup WHERE event_id = ? AND member_id = ?').bind(eventId, member),
    c.db.prepare('SELECT status FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, member),
    c.db.prepare('SELECT count(*) AS n FROM event_signup_history WHERE event_id = ? AND member_id = ? AND actor = ? AND at > ?').bind(eventId, member, member, since),
  ]);
  return { current: (cur.results[0] as unknown as Current | undefined) ?? null, memberStatus: (m.results[0]?.status as string | undefined) ?? null, recent: (recent.results[0]?.n as number | undefined) ?? 0 };
}

const OWN_SQL = `SELECT c.id, c.name, c.class, c.level, c.is_main, r.role AS suggested FROM character c
  LEFT JOIN event_class_role r ON r.guild_id = c.guild_id AND r.class_code = c.class
  WHERE c.guild_id = ? AND c.owner_user_id = ? AND c.deleted_at IS NULL ORDER BY c.is_main DESC, c.created_at, c.id`;
const ownCharacters = async (c: Ctx, member: string) => (await c.db.prepare(OWN_SQL).bind(c.guild.id, member).all<Own>()).results;

function refusalText(r: SignupRefusal, officer = false): string {
  switch (r.code) {
    case 'cancelled': return EVENT_COPY.isCancelled;
    case 'closed': return EVENT_COPY.isClosed;
    case 'spam': return EVENT_COPY.tooFast;
    case 'frozen': return officer ? EVENT_COPY.memberFrozen : EVENT_COPY.frozen;
    case 'left': return EVENT_COPY.leftServer;
    case 'locked': return EVENT_COPY.isLocked;
    default: return officer ? EVENT_COPY.memberNeedsServerRole(r.role) : EVENT_COPY.needsRole(r.role);
  }
}

const askRefusal = (c: Ctx, e: EventRow, p: Awaited<ReturnType<typeof loadPress>>, leaving: boolean) =>
  signupRefusal({ event: e, memberRole: c.guild.member_role_id, roles: c.member.roles, memberStatus: p.memberStatus, current: p.current?.status ?? null, leaving, route: 'member', inServer: true, recent: p.recent, now: Date.now() });

const redraw = (c: Ctx, eventId: number) => {
  c.effects.dkpTimers = { guildId: c.guild.id, items: [...(c.effects.dkpTimers?.items ?? []), { key: `evcard:${eventId}`, due: Date.now() }] };
};
/** Order 33: a direct message to each member moved up. `told`: a member's own press, whose private reply already says so. */
const tellPromoted = (c: Ctx, eventId: number, members: (string | null | undefined)[], told?: string) => {
  const others = members.filter((m): m is string => !!m && m !== told);
  if (others.length) c.effects.dkpTimers = { guildId: c.guild.id, items: [...(c.effects.dkpTimers?.items ?? []), ...promoItems(eventId, others, Date.now())] };
};
const isLocked = (e: EventRow) => !!e.lock_at && Date.parse(e.lock_at) <= Date.now();

/** A member's row, so the card has a name for someone who has never run a command. */
const memberRow = (c: Ctx, m: GuildMember) =>
  c.db.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?) ON CONFLICT DO NOTHING").bind(c.guild.id, m.user.id, m.nick || m.user.global_name || m.user.username, now());

/** Names for a notice. */
export async function tags(c: Ctx, ids: string[]): Promise<string> {
  const { results } = await c.db.prepare('SELECT discord_user_id AS id, display_name AS name FROM member WHERE guild_id = ? AND discord_user_id IN (SELECT value FROM json_each(?))').bind(c.guild.id, JSON.stringify(ids)).all<{ id: string; name: string }>();
  const names = new Map(results.map((r) => [r.id, r.name]));
  return ids.map((id) => memberTag(id, names.get(id) ?? id)).join(', ');
}

/** A line in GC-Events: every change after the lock, and every /event roster change. It pings nobody. */
export async function notice(c: Ctx, d: EventState, line: string): Promise<boolean> {
  const api = eventApi(c, 2);
  try {
    if (!api || !d.channel_id) return false;
    const r = await api.call('POST', `/channels/${d.channel_id}/messages`, { content: truncate(line, 2000), allowed_mentions: NO_PINGS });
    if (!r.ok) console.error('event notice failed', r.status);
    return r.ok;
  } finally {
    spentEvent(c, api);
  }
}

const statusWord = (status: Status, e: EventRow) => (status === 'left' ? EVENT_COPY.left : status === 'removed' ? EVENT_COPY.removed_ : statusLabel(status, e.type));

function resultText(e: EventRow, d: EventState, asked: Status, final: Status, role: Role | null): string {
  if (asked === 'signed_up' && final !== 'signed_up') return final === 'bench' ? EVENT_COPY.fullBench : EVENT_COPY.fullWaitlist;
  const label = statusWord(final, e);
  return role ? EVENT_COPY.youAreRole(label, md(d.settings.role_labels[role])) : EVENT_COPY.youAre(label);
}

interface Applied {
  content: string;
  components: unknown[];
}

/**
 * Order 33: the one-time note, with a member's first sign-up in the server. The write is its own proof: only a row not yet
 * told comes back, and only if this press really left a sign-up row.
 */
const firstSignup = (c: Ctx, eventId: number, at: string) =>
  c.db
    .prepare(
      `INSERT INTO event_member (guild_id, member_id, told_at) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM event_signup s WHERE s.event_id = ?4 AND s.member_id = ?2 AND s.updated_at = ?3)
       ON CONFLICT (guild_id, member_id) DO UPDATE SET told_at = excluded.told_at WHERE told_at IS NULL RETURNING reminders_off`,
    )
    .bind(c.guild.id, c.userId, at, eventId);

/** Applies a member's own choice: their row, its history, a promotion if it freed a place, then the card and any notice. */
async function apply(c: Ctx, d: EventState, e: EventRow, cur: Current | null, status: Status, role: Role | null, character: Snapshot | null): Promise<Applied> {
  const at = now();
  const freed = cur?.status === 'signed_up' && (status !== 'signed_up' || role !== cur.role);
  const asks = status !== 'declined' && d.settings.reminder_minutes > 0;
  const results = await c.db.batch<{ status?: Status; member_id?: string; reminders_off?: number }>([
    memberRow(c, c.member),
    ...changeStatements(c.db, { eventId: e.id, member: c.userId, status, role, character, actor: c.userId, reason: null, at }),
    ...(freed ? promotionStatements(c.db, e.id, at, 1) : []),
    ...(asks ? [firstSignup(c, e.id, at)] : []),
  ]);
  if (results[0].meta.changes === 1) c.effects.welcome = true;
  const final = results[1].results[0]?.status;
  if (!final) return { content: EVENT_COPY.notOpen, components: [] };
  const promoted = freed ? (results[3].results[0]?.member_id ?? null) : null;
  redraw(c, e.id);
  tellPromoted(c, e.id, [promoted], c.userId);
  if (isLocked(e)) await notice(c, d, [EVENT_COPY.changeLine(md(e.title), byName(c), statusWord(final, e)), ...(promoted ? [EVENT_COPY.promotedLine(await tags(c, [promoted]))] : [])].join('\n'));
  const text = resultText(e, d, status, final, role);
  if (asks && results.at(-1)!.results[0]?.reminders_off === 0) return { content: `${text}\n${EVENT_COPY.reminderNote}`, components: [row([button(NO_REMINDERS_PREFIX, EVENT_COPY.noReminders)])] };
  return { content: text, components: [] };
}
const privately = (a: Applied) => ephemeral(a.content, a.components.length ? { components: a.components } : {});

/** evnr:: the first sign-up's No reminders. It stops reminders only, on this server. */
export async function noReminders(c: Ctx): Promise<MessageReply> {
  await c.db.prepare('INSERT INTO event_member (guild_id, member_id, reminders_off) VALUES (?1, ?2, 1) ON CONFLICT (guild_id, member_id) DO UPDATE SET reminders_off = 1').bind(c.guild.id, c.userId).run();
  return updateMessage({ content: EVENT_COPY.remindersOff, components: [] });
}

/**
 * evcal:<event>: Add to calendar, for any member, privately: the Google link and the .ics file. The file goes with the
 * reply; if Discord refuses it, the reply goes without it (src/respond.ts).
 */
export async function calendarPress(c: Ctx, id: string, d: EventState): Promise<MessageReply> {
  const e = await loaded(c, Number(id.slice(CALENDAR_PREFIX.length)));
  if (!e) return ephemeral(EVENT_COPY.notOpen);
  if (e.status !== 'open') return ephemeral(e.status === 'cancelled' ? EVENT_COPY.isCancelled : EVENT_COPY.isClosed);
  const event: CalendarEvent = {
    id: e.id, guildId: e.guild_id, title: e.title, startMs: Date.parse(e.start_at), durationMinutes: e.duration_minutes, location: e.zone_key ? (e.zone_name ?? e.zone_key) : null, description: e.description,
    cardUrl: e.message_id && d.channel_id ? messageLink(e.guild_id, d.channel_id, e.message_id) : null,
  };
  const title = md(e.title);
  return ephemeral([EVENT_COPY.calendarHead(title), EVENT_COPY.calendarStays].join('\n'), {
    components: [row([linkButton(EVENT_COPY.googleCalendar, googleLink(event))])],
    files: [{ name: `event-${e.id}.ics`, type: 'text/calendar', text: icsText(event, Date.now()) }],
    noFiles: [EVENT_COPY.calendarNoFile(title), EVENT_COPY.calendarStays].join('\n'),
  });
}

const parseEvent = (id: string, prefix: string) => id.slice(prefix.length).split(':');
const loaded = async (c: Ctx, id: number) => {
  const e = await loadEvent(c.db, c.guild.id, id);
  return e && e.status !== PREVIEW ? e : null;
};

/** The private sign-up form: the character and the role, the suggested role preselected, and a button to confirm. */
function picker(e: EventRow, d: EventState, status: Choice, chars: Own[], charId: number, role: Role | null, cur: Current | null): MessageReply {
  const rule = TYPE_RULES[e.type];
  const required = rule.character === 'required';
  const roles = ROLES.filter((r) => d.settings.support_on || r !== 'support' || cur?.role === 'support');
  // A class default that isn't on offer (Support turned off) is no suggestion.
  if (role && !roles.includes(role)) role = null;
  const shown = chars.slice(0, SELECT_MAX - 1);
  const charSelect = {
    type: MessageComponentTypes.STRING_SELECT,
    custom_id: `${PICK_CHARACTER_PREFIX}${e.id}:${status}:${role ?? NONE}`,
    placeholder: EVENT_COPY.pickCharacter,
    options: [
      ...(required ? [] : [{ label: EVENT_COPY.noCharacter, value: '0', ...(charId === 0 ? { default: true } : {}) }]),
      ...shown.map((ch) => ({ label: truncate([ch.name, ch.class, ch.level].filter((x) => x !== null).join(' · '), 100), value: String(ch.id), ...(ch.id === charId ? { default: true } : {}) })),
    ],
  };
  const roleSelect = {
    type: MessageComponentTypes.STRING_SELECT,
    custom_id: `${PICK_ROLE_PREFIX}${e.id}:${status}:${charId}`,
    placeholder: EVENT_COPY.pickRole,
    options: [
      ...(required ? [] : [{ label: EVENT_COPY.noRole, value: NONE, ...(role === null ? { default: true } : {}) }]),
      ...roles.map((r) => ({ label: truncate(d.settings.role_labels[r], 100), value: r, ...(r === role ? { default: true } : {}) })),
    ],
  };
  const ready = !required || (charId !== 0 && role !== null);
  return ephemeral(EVENT_COPY.pickHead(md(e.title)), {
    components: [row([charSelect]), row([roleSelect]), row([button(`${CONFIRM_PREFIX}${e.id}:${status}:${charId}:${role ?? NONE}`, actionLabel(status, e.type), STYLE_PRIMARY, !ready)])],
  });
}

/** Already there: nothing changes, and a member on the waitlist or holding a place keeps it (a form left open can't cost it). */
const alreadyThere = (cur: Current | null, status: Status) => cur?.status === status || (status === 'signed_up' && cur?.status === 'waitlist');

/** evs:<event>:<status>: one of the card's status buttons. */
export async function statusPress(c: Ctx, id: string, d: EventState): Promise<MessageReply> {
  const [eventText, statusText] = parseEvent(id, STATUS_PREFIX);
  const e = await loaded(c, Number(eventText));
  if (!e) return ephemeral(EVENT_COPY.notOpen);
  const status = statusText as Choice;
  const rule = TYPE_RULES[e.type];
  if (!rule.statuses.includes(status)) return ephemeral(EVENT_COPY.notOpen);
  const p = await loadPress(c, e.id, c.userId);
  const leaving = status === 'declined';
  const refusal = askRefusal(c, e, p, leaving);
  if (refusal) return ephemeral(refusalText(refusal));
  const cur = p.current;
  if (alreadyThere(cur, status)) return ephemeral(EVENT_COPY.already(statusWord(cur!.status, e)));
  if (leaving) return privately(await apply(c, d, e, cur, status, cur?.role ?? null, keptSnapshot(cur)));
  if (rule.character === 'none') return privately(await apply(c, d, e, cur, status, null, null));
  if (keptSnapshot(cur) && (cur?.role || rule.character !== 'required')) return privately(await apply(c, d, e, cur, status, cur!.role, keptSnapshot(cur)));
  const chars = await ownCharacters(c, c.userId);
  if (!chars.length) {
    if (rule.character === 'optional') return privately(await apply(c, d, e, cur, status, null, null));
    return ephemeral(EVENT_COPY.needsCharacter, { components: [row([button(`${ME_ADD_PREFIX}${c.userId}`, EVENT_COPY.addCharacter, STYLE_PRIMARY)])] });
  }
  const first = chars[0];
  return picker(e, d, status, chars, rule.character === 'required' ? first.id : 0, rule.character === 'required' ? first.suggested : null, cur);
}

/** evpc: and evpr:: a pick on the form, which edits it. The role follows the character until the member picks one. */
export async function pickPress(c: Ctx, id: string, values: string[], d: EventState): Promise<MessageReply> {
  const byCharacter = id.startsWith(PICK_CHARACTER_PREFIX);
  const [eventText, status, other] = parseEvent(id, byCharacter ? PICK_CHARACTER_PREFIX : PICK_ROLE_PREFIX);
  const e = await loaded(c, Number(eventText));
  if (!e) return updateMessage({ content: EVENT_COPY.notOpen, components: [] });
  const chars = await ownCharacters(c, c.userId);
  const p = await loadPress(c, e.id, c.userId);
  if (byCharacter) {
    const charId = Number(values[0]);
    const picked = chars.find((ch) => ch.id === charId);
    const role = other === NONE ? (picked?.suggested ?? null) : (other as Role);
    const m = picker(e, d, status as Choice, chars, charId, role, p.current);
    return updateMessage({ content: m.data.content, components: m.data.components });
  }
  const m = picker(e, d, status as Choice, chars, Number(other), values[0] === NONE ? null : (values[0] as Role), p.current);
  return updateMessage({ content: m.data.content, components: m.data.components });
}

/** evpo:<event>:<status>:<character>:<role>: the form's confirm. Everything is checked again, on this press. */
export async function confirmPress(c: Ctx, id: string, d: EventState): Promise<MessageReply> {
  const [eventText, status, charText, roleText] = parseEvent(id, CONFIRM_PREFIX);
  const e = await loaded(c, Number(eventText));
  if (!e) return updateMessage({ content: EVENT_COPY.notOpen, components: [] });
  const p = await loadPress(c, e.id, c.userId);
  const refusal = askRefusal(c, e, p, false);
  if (refusal) return updateMessage({ content: refusalText(refusal), components: [] });
  if (!TYPE_RULES[e.type].statuses.includes(status as Choice)) return updateMessage({ content: EVENT_COPY.notOpen, components: [] });
  if (alreadyThere(p.current, status as Status)) return updateMessage({ content: EVENT_COPY.already(statusWord(p.current!.status, e)), components: [] });
  const role = roleText === NONE ? null : (roleText as Role);
  if (role && !ROLES.includes(role)) return updateMessage({ content: EVENT_COPY.notOpen, components: [] });
  if (role === 'support' && !d.settings.support_on && p.current?.role !== 'support') return updateMessage({ content: EVENT_COPY.supportOff(md(d.settings.role_labels.support)), components: [] });
  const charId = Number(charText);
  const chars = await ownCharacters(c, c.userId);
  const ch = chars.find((x) => x.id === charId);
  const required = TYPE_RULES[e.type].character === 'required';
  if ((required && (!ch || !role)) || (charId !== 0 && !ch)) return updateMessage({ content: EVENT_COPY.characterGone, components: [] });
  return updateMessage(await apply(c, d, e, p.current, status as Status, role, ch ? snapshotOf(ch) : null));
}

/** What Change character and Change role need: an open event, the member on its roster, and the one function's yes. */
async function changing(c: Ctx, eventId: number) {
  const e = await loaded(c, eventId);
  if (!e) return { refusal: EVENT_COPY.notOpen };
  const p = await loadPress(c, e.id, c.userId);
  const refusal = askRefusal(c, e, p, false);
  if (refusal) return { refusal: refusalText(refusal) };
  if (!p.current || !(ON_ROSTER as readonly string[]).includes(p.current.status)) return { refusal: EVENT_COPY.signUpFirst };
  return { e, current: p.current };
}

/** evcc:<event>: a private select of the member's characters. */
export async function changeCharacterPress(c: Ctx, id: string): Promise<MessageReply> {
  const r = await changing(c, Number(id.slice(CHANGE_CHARACTER_PREFIX.length)));
  if ('refusal' in r) return ephemeral(r.refusal!);
  const chars = await ownCharacters(c, c.userId);
  if (!chars.length) return ephemeral(EVENT_COPY.needsCharacter, { components: [row([button(`${ME_ADD_PREFIX}${c.userId}`, EVENT_COPY.addCharacter, STYLE_PRIMARY)])] });
  return ephemeral(EVENT_COPY.pickCharacter, {
    components: [row([{ type: MessageComponentTypes.STRING_SELECT, custom_id: `${CHANGE_CHARACTER_PICK}${r.e!.id}`, options: chars.slice(0, SELECT_MAX).map((ch) => ({ label: truncate([ch.name, ch.class, ch.level].filter((x) => x !== null).join(' · '), 100), value: String(ch.id), ...(ch.id === r.current!.character_id ? { default: true } : {}) })) }])],
  });
}

/** evcs:<event>: the character picked. The place and the role stay. */
export async function changeCharacterPicked(c: Ctx, id: string, values: string[], d: EventState): Promise<MessageReply> {
  const r = await changing(c, Number(id.slice(CHANGE_CHARACTER_PICK.length)));
  if ('refusal' in r) return updateMessage({ content: r.refusal!, components: [] });
  const ch = (await ownCharacters(c, c.userId)).find((x) => x.id === Number(values[0]));
  if (!ch) return updateMessage({ content: EVENT_COPY.characterGone, components: [] });
  await c.db.batch(characterStatements(c.db, { eventId: r.e!.id, member: c.userId, character: snapshotOf(ch), actor: c.userId, at: now() }));
  redraw(c, r.e!.id);
  return updateMessage({ content: EVENT_COPY.characterChanged(md(ch.name)), components: [] });
}

/** evcr:<event>: a private select of the roles. */
export async function changeRolePress(c: Ctx, id: string, d: EventState): Promise<MessageReply> {
  const r = await changing(c, Number(id.slice(CHANGE_ROLE_PREFIX.length)));
  if ('refusal' in r) return ephemeral(r.refusal!);
  const roles = ROLES.filter((x) => d.settings.support_on || x !== 'support' || r.current!.role === 'support');
  return ephemeral(EVENT_COPY.pickRole, {
    components: [row([{ type: MessageComponentTypes.STRING_SELECT, custom_id: `${CHANGE_ROLE_PICK}${r.e!.id}`, options: roles.map((x) => ({ label: truncate(d.settings.role_labels[x], 100), value: x, ...(x === r.current!.role ? { default: true } : {}) })) }])],
  });
}

/** evrs:<event>: the role picked. A member may switch to a role with room until the lock; a waitlisted member keeps their place. */
export async function changeRolePicked(c: Ctx, id: string, values: string[], d: EventState): Promise<MessageReply> {
  const r = await changing(c, Number(id.slice(CHANGE_ROLE_PICK.length)));
  if ('refusal' in r) return updateMessage({ content: r.refusal!, components: [] });
  const role = values[0] as Role;
  if (!ROLES.includes(role)) return updateMessage({ content: EVENT_COPY.notOpen, components: [] });
  if (role === 'support' && !d.settings.support_on && r.current!.role !== 'support') return updateMessage({ content: EVENT_COPY.supportOff(md(d.settings.role_labels.support)), components: [] });
  if (role === r.current!.role) return updateMessage({ content: EVENT_COPY.already(md(d.settings.role_labels[role])), components: [] });
  const at = now();
  const results = await c.db.batch<{ status?: string; member_id?: string }>([...roleStatements(c.db, { eventId: r.e!.id, member: c.userId, role, actor: c.userId, at }), ...promotionStatements(c.db, r.e!.id, at, 1)]);
  const promoted = results[2].results[0]?.member_id;
  if (results[0].results.length || promoted) redraw(c, r.e!.id);
  tellPromoted(c, r.e!.id, [promoted], c.userId);
  if (!results[0].results.length) return updateMessage({ content: EVENT_COPY.roleFull(md(d.settings.role_labels[role])), components: [] });
  return updateMessage({ content: promoted === c.userId ? EVENT_COPY.promotedYou(md(d.settings.role_labels[role])) : EVENT_COPY.roleChanged(md(d.settings.role_labels[role])), components: [] });
}

/** /event roster: officers add, move or remove a member, with a public reason. They may exceed a limit. */
export const rosterCommand: EventRun = async (c, opts: Option[], d) => {
  const id = Number(optString(opts, 'event'));
  const e = Number.isInteger(id) && id > 0 ? await loaded(c, id) : null;
  if (!e) return ephemeral(EVENT_COPY.notOpen);
  const reason = (optString(opts, 'reason') ?? '').trim().slice(0, 200);
  if (!reason) return ephemeral(EVENT_COPY.noReason);
  const action = optString(opts, 'action') as 'add' | 'move' | 'remove';
  const member = optString(opts, 'member') ?? '';
  const p = await loadPress(c, e.id, member);
  const cur = p.current;
  const leaving = action === 'remove' || optString(opts, 'status') === 'declined';
  const resolved = c.resolved?.members?.[member] as { nick?: string | null; roles?: string[] } | undefined;
  const refusal = signupRefusal({ event: e, memberRole: c.guild.member_role_id, roles: resolved?.roles ?? [], memberStatus: p.memberStatus, current: cur?.status ?? null, leaving, route: 'officer', inServer: !!resolved, recent: 0, now: Date.now() });
  if (refusal) return ephemeral(refusalText(refusal, true));
  const rule = TYPE_RULES[e.type];
  const onRoster = cur && (ON_ROSTER as readonly string[]).includes(cur.status);
  if (action !== 'add' && !onRoster) return ephemeral(EVENT_COPY.notOnRoster);
  if (action === 'add' && onRoster) return ephemeral(EVENT_COPY.alreadyOn);
  const status: Status = action === 'remove' ? 'removed' : ((optString(opts, 'status') as Status | undefined) ?? (action === 'add' ? 'signed_up' : cur!.status));
  if (status === 'bench' && !rule.statuses.includes('bench') && e.when_full !== 'bench') return ephemeral(EVENT_COPY.noBench);
  const role = rule.character === 'none' ? null : ((optString(opts, 'role') as Role | undefined) ?? cur?.role ?? null);
  let character = keptSnapshot(cur);
  const typed = optString(opts, 'character');
  if (rule.character !== 'none' && action !== 'remove' && (typed !== undefined || !character)) {
    const own = await ownCharacters(c, member);
    const ch = typed !== undefined ? own.find((x) => x.name.toLowerCase() === typed.trim().toLowerCase()) : own[0];
    if (ch) character = snapshotOf(ch);
    else if (typed !== undefined || rule.character === 'required') return ephemeral(EVENT_COPY.memberNeedsCharacter);
  }
  if (rule.character === 'required' && action !== 'remove' && !leaving && !role) return ephemeral(EVENT_COPY.memberNeedsRole);
  const at = now();
  const name = resolved?.nick || c.resolved?.users?.[member]?.global_name || c.resolved?.users?.[member]?.username || member;
  const freed = cur?.status === 'signed_up' && (status !== 'signed_up' || role !== cur.role);
  const results = await c.db.batch<{ status?: Status; member_id?: string }>([
    c.db.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?) ON CONFLICT DO NOTHING").bind(c.guild.id, member, name, at),
    ...changeStatements(c.db, { eventId: e.id, member, status, role, character, actor: c.userId, reason, at, force: true }),
    ...(freed ? promotionStatements(c.db, e.id, at, 1, member) : []),
    audit(c.db, c.guild.id, c.userId, 'event.roster', `event:${e.id}`, { member, status: cur?.status ?? null }, { status, role }),
  ]);
  redraw(c, e.id);
  const promoted = freed ? results[3].results[0]?.member_id : undefined;
  tellPromoted(c, e.id, [promoted]);
  const shown = role ? `${statusWord(status, e)} (${md(d.settings.role_labels[role])})` : statusWord(status, e);
  const posted = await notice(c, d, [EVENT_COPY.rosterLine(md(e.title), memberTag(member, name), shown, byName(c), md(reason)), ...(promoted ? [EVENT_COPY.promotedLine(await tags(c, [promoted]))] : [])].join('\n'));
  return ephemeral(posted ? EVENT_COPY.rosterDone : EVENT_COPY.rosterQuiet);
};

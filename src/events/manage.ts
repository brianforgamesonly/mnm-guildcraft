// Order 32 (ITEM 2): /event create (with its private preview), edit, cancel and list. Create takes its fields as options:
// 13 fit Discord's 25 per subcommand, and options bring the zone's autocomplete and Discord's role picker, which a modal
// doesn't, so no modal is used. A preview is a row with status PREVIEW; Post opens it.
import { audit, isEventRunner, now } from '../access.ts';
import type { Ctx } from '../context.ts';
import { button, EMBED_LIMITS, ephemeral, md, memberTag, NO_PINGS, optInt, optBool, optString, row, STYLE_PRIMARY, STYLE_SECONDARY, truncate, updateMessage, type Embed, type MessageReply, type Option } from '../discord.ts';
import { auditIfChanged } from '../requests.ts';
import { zoneKey } from '../zone/names.ts';
import { cardMessage, loadEvent, loadSignups, messageLink, rosterLine, rosterSections, statusLabel, type EventRow } from './card.ts';
import { EVENT_COPY } from './copy.ts';
import { eventApi, spentEvent, type EventRun } from './commands.ts';
import type { EventState } from './state.ts';
import { fullDate, lockAndClose, MAX_DAYS_AHEAD, parseStart, stamp } from './times.ts';
import { LIMIT_COLUMN, PREVIEW, ROLES, TYPE_RULES, type EventType, type Role } from './types.ts';
import { notice, tags } from './press.ts';
import { promoItems } from './dm.ts';
import { reminderItem } from './setup.ts';
import { MAX_PROMOTIONS, promotionStatements } from './signup.ts';

export const POST_PREFIX = 'evpost:';
export const DROP_PREFIX = 'evdrop:';
export const ROSTER_PAGE_PREFIX = 'evlp:';
const ROSTER_PAGE = 40;
const UPCOMING_MAX = 25;
/** What /event edit may change, by column (the start and its lock and close are worked out apart). */
const EDITABLE = ['type', 'title', 'duration_minutes', 'zone_key', 'description', 'capacity', 'limit_tank', 'limit_healer', 'limit_dps', 'limit_support', 'when_full', 'signup_role'] as const;
/** A preview nobody posted or cancelled goes after this long, with the next /event create. */
const DRAFT_MS = 86_400_000;
export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 1000;

type Fields = Pick<EventRow, 'type' | 'title' | 'duration_minutes' | 'zone_key' | 'description' | 'capacity' | 'limit_tank' | 'limit_healer' | 'limit_dps' | 'limit_support' | 'when_full' | 'signup_role'>;

const startRefusal = (error: 'format' | 'skipped' | 'past' | 'far') =>
  error === 'format' ? EVENT_COPY.badStart : error === 'skipped' ? EVENT_COPY.skippedStart : error === 'past' ? EVENT_COPY.pastStart : EVENT_COPY.farStart(MAX_DAYS_AHEAD);

/** The zone a typed name means, or a refusal. */
async function resolveZone(c: Ctx, typed: string): Promise<{ key: string } | { refusal: string }> {
  const z = await c.db.prepare('SELECT key FROM zone WHERE key = ? AND active = 1').bind(zoneKey(typed.trim())).first<{ key: string }>();
  return z ?? { refusal: EVENT_COPY.unknownZone(md(truncate(typed, 100))) };
}

/** What a type requires of an event's fields, for create and edit alike. Returns the refusal, or null. */
function typeRefusal(f: Fields, d: EventState): string | null {
  const rule = TYPE_RULES[f.type];
  const label = md(d.settings.type_labels[f.type]);
  if (rule.zone === 'required' && !f.zone_key) return EVENT_COPY.needsZone(label);
  if (rule.zone === 'none' && f.zone_key) return EVENT_COPY.noZone(label);
  if (!rule.limits && ROLES.some((r) => f[LIMIT_COLUMN[r]] !== null)) return EVENT_COPY.noLimits(label);
  return null;
}

const INSERT_SQL = `INSERT INTO event (guild_id, type, title, start_at, duration_minutes, zone_key, description, capacity, limit_tank, limit_healer, limit_dps, limit_support, when_full, signup_role, lock_at, closes_at, posted_by, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`;

export const createCommand: EventRun = async (c, opts, d) => {
  const type = (optString(opts, 'type') ?? 'raid') as EventType;
  const parsed = parseStart(optString(opts, 'start') ?? '', d.settings.time_zone, Date.now());
  if ('error' in parsed) return ephemeral(startRefusal(parsed.error));
  const typedZone = optString(opts, 'zone');
  let zoneKeyValue: string | null = null;
  if (typedZone) {
    const z = await resolveZone(c, typedZone);
    if ('refusal' in z) return ephemeral(z.refusal);
    zoneKeyValue = z.key;
  }
  const f: Fields = {
    type,
    title: (optString(opts, 'title') ?? '').trim().slice(0, TITLE_MAX),
    duration_minutes: Math.round((optInt(opts, 'hours') ?? TYPE_RULES[type].hours) * 60),
    zone_key: zoneKeyValue,
    description: optString(opts, 'description')?.trim().slice(0, DESCRIPTION_MAX) || null,
    capacity: optInt(opts, 'capacity') ?? null,
    limit_tank: optInt(opts, 'tank') ?? null,
    limit_healer: optInt(opts, 'healer') ?? null,
    limit_dps: optInt(opts, 'dps') ?? null,
    limit_support: optInt(opts, 'support') ?? null,
    when_full: optString(opts, 'when_full') === 'bench' ? 'bench' : 'waitlist',
    signup_role: optString(opts, 'signup_role') ?? d.settings.signup_role,
  };
  const refusal = typeRefusal(f, d);
  if (refusal) return ephemeral(refusal);
  if (!f.title) return ephemeral(EVENT_COPY.needsTitle);
  const at = now();
  const times = lockAndClose(parsed.at, d.settings);
  const [, inserted] = await c.db.batch<{ id: number }>([
    c.db.prepare('DELETE FROM event WHERE guild_id = ? AND status = ? AND created_at < ?').bind(c.guild.id, PREVIEW, new Date(Date.now() - DRAFT_MS).toISOString()),
    c.db
      .prepare(INSERT_SQL)
      .bind(c.guild.id, f.type, f.title, new Date(parsed.at).toISOString(), f.duration_minutes, f.zone_key, f.description, f.capacity, f.limit_tank, f.limit_healer, f.limit_dps, f.limit_support, f.when_full, f.signup_role, times.lock_at, times.closes_at, c.userId, at),
  ]);
  const id = inserted.results[0].id;
  const e = (await loadEvent(c.db, c.guild.id, id))!;
  return ephemeral(EVENT_COPY.preview(fullDate(parsed.at, d.settings.time_zone)), {
    embeds: cardMessage(e, [], d.settings, Date.now()).embeds,
    components: [row([button(`${POST_PREFIX}${id}`, EVENT_COPY.post, STYLE_PRIMARY), button(`${DROP_PREFIX}${id}`, EVENT_COPY.cancel, STYLE_SECONDARY)])],
  });
};

/** evpost:<id>: the preview's Post. Rights come from this press; the start is checked again. */
export async function postDraft(c: Ctx, id: string, d: EventState): Promise<MessageReply> {
  if (!isEventRunner(c.guild, d.settings.events_role, c.member)) return ephemeral(EVENT_COPY.notRunner);
  const eventId = Number(id.slice(POST_PREFIX.length));
  const e = await loadEvent(c.db, c.guild.id, eventId);
  // A new private message, never an edit: this press may have lost to one whose answer is on the way.
  if (!e || e.status !== PREVIEW || e.posted_by !== c.userId) return ephemeral(EVENT_COPY.draftGone);
  if (Date.parse(e.start_at) <= Date.now()) return ephemeral(EVENT_COPY.pastStart);
  if (!d.channel_id) return ephemeral(EVENT_COPY.noChannel);
  const api = eventApi(c, 1);
  if (!api) return ephemeral(EVENT_COPY.noChannel);
  try {
    // One press wins: the row opens first, so a second press finds it open and posts nothing.
    const took = await c.db.prepare("UPDATE event SET status = 'open' WHERE id = ? AND guild_id = ? AND status = ?").bind(eventId, c.guild.id, PREVIEW).run();
    if (took.meta.changes !== 1) return ephemeral(EVENT_COPY.draftGone);
    const open: EventRow = { ...e, status: 'open' };
    const posted = await api.call<{ id: string }>('POST', `/channels/${d.channel_id}/messages`, { ...cardMessage(open, [], d.settings, Date.now()), allowed_mentions: NO_PINGS });
    if (!posted.ok) {
      await c.db.prepare("UPDATE event SET status = ? WHERE id = ? AND status = 'open'").bind(PREVIEW, eventId).run();
      return ephemeral(EVENT_COPY.postFailed(posted.status));
    }
    // Asked for first: the card is live, so the event closes on time even if the save below fails.
    c.effects.dkpTimers = { guildId: c.guild.id, items: [...(e.lock_at ? [{ key: `evlock:${eventId}`, due: Date.parse(e.lock_at) }] : []), { key: `evclose:${eventId}`, due: Date.parse(e.closes_at) }, ...(reminderItem(e, d.settings.reminder_minutes, Date.now()) ?? [])] };
    await c.db.batch([c.db.prepare('UPDATE event SET message_id = ? WHERE id = ?').bind(posted.body.id, eventId), audit(c.db, c.guild.id, c.userId, 'event.create', `event:${eventId}`, null, { type: e.type, start: e.start_at })]);
    return updateMessage({ content: EVENT_COPY.posted_(messageLink(c.guild.id, d.channel_id, posted.body.id)), embeds: [], components: [] });
  } finally {
    spentEvent(c, api);
  }
}

/** evdrop:<id>: the preview's Cancel. It removes the poster's own unposted row. */
export async function dropDraft(c: Ctx, id: string): Promise<MessageReply> {
  const gone = await c.db.prepare('DELETE FROM event WHERE id = ? AND guild_id = ? AND status = ? AND posted_by = ?').bind(Number(id.slice(DROP_PREFIX.length)), c.guild.id, PREVIEW, c.userId).run();
  return gone.meta.changes ? updateMessage({ content: EVENT_COPY.dropped, embeds: [], components: [] }) : ephemeral(EVENT_COPY.draftGone);
}

/** An event option's value: an id from the list. */
const pickedId = (opts: Option[]) => {
  const n = Number(optString(opts, 'event'));
  return Number.isInteger(n) && n > 0 ? n : null;
};

export const editCommand: EventRun = async (c, opts, d) => {
  const id = pickedId(opts);
  if (id === null) return ephemeral(EVENT_COPY.pickEvent);
  const e = await loadEvent(c.db, c.guild.id, id);
  if (!e || e.status !== 'open') return ephemeral(EVENT_COPY.notOpen);
  const typedType = optString(opts, 'type') as EventType | undefined;
  const clear = optString(opts, 'clear');
  const has = (name: string) => opts.some((o) => o.name === name);
  const f: Fields = { ...e };
  const retype = !!typedType && typedType !== e.type;
  if (retype) {
    f.type = typedType;
    // What the new type doesn't take goes with the old one.
    if (TYPE_RULES[typedType].zone === 'none') f.zone_key = null;
    if (!TYPE_RULES[typedType].limits) for (const r of ROLES) f[LIMIT_COLUMN[r]] = null;
  }
  if (has('title')) f.title = (optString(opts, 'title') ?? '').trim().slice(0, TITLE_MAX) || f.title;
  if (has('hours')) f.duration_minutes = Math.round((optInt(opts, 'hours') ?? 0) * 60) || f.duration_minutes;
  if (has('description')) f.description = optString(opts, 'description')?.trim().slice(0, DESCRIPTION_MAX) || null;
  if (has('capacity')) f.capacity = optInt(opts, 'capacity') ?? null;
  for (const r of ROLES) if (has(r)) f[LIMIT_COLUMN[r]] = optInt(opts, r) ?? null;
  if (has('when_full')) f.when_full = optString(opts, 'when_full') === 'bench' ? 'bench' : 'waitlist';
  if (has('signup_role')) f.signup_role = optString(opts, 'signup_role') ?? null;
  if (has('zone')) {
    const z = await resolveZone(c, optString(opts, 'zone') ?? '');
    if ('refusal' in z) return ephemeral(z.refusal);
    f.zone_key = z.key;
  }
  if (clear === 'capacity') f.capacity = null;
  if (clear === 'zone') f.zone_key = null;
  if (clear === 'description') f.description = null;
  if (clear === 'signup_role') f.signup_role = null;
  if ((ROLES as readonly string[]).includes(clear ?? '')) f[LIMIT_COLUMN[clear as Role]] = null;
  const refusal = typeRefusal(f, d);
  if (refusal) return ephemeral(refusal);

  let start = e.start_at;
  let lock = e.lock_at;
  let closes = e.closes_at;
  const typedStart = optString(opts, 'start');
  const moved = typedStart !== undefined;
  if (moved) {
    const parsed = parseStart(typedStart, d.settings.time_zone, Date.now());
    if ('error' in parsed) return ephemeral(startRefusal(parsed.error));
    start = new Date(parsed.at).toISOString();
    ({ lock_at: lock, closes_at: closes } = lockAndClose(parsed.at, d.settings));
  }
  if (opts.filter((o) => o.name !== 'event').length === 0) return ephemeral(EVENT_COPY.nothingToEdit);
  const at = now();
  const waiting = await c.db.prepare("SELECT count(*) AS n FROM event_signup WHERE event_id = ? AND status = 'waitlist'").bind(id).first<{ n: number }>();
  // Only what this edit changes, so two officers editing at once keep each other's fields. The type lock is inside the
  // statement: a sign-up that lands first refuses it.
  const changed = EDITABLE.filter((k) => f[k] !== e[k]);
  const sets = [...changed.map((k) => `${k} = ?`), ...(moved ? ['start_at = ?', 'lock_at = ?', 'closes_at = ?', 'lock_done_at = NULL', 'left_cursor = NULL'] : [])];
  const stmts = [
    c.db
      .prepare(`UPDATE event SET ${sets.join(', ') || 'id = id'} WHERE id = ? AND guild_id = ? AND status = 'open'${retype ? ' AND NOT EXISTS (SELECT 1 FROM event_signup s WHERE s.event_id = event.id)' : ''}`)
      .bind(...changed.map((k) => f[k]), ...(moved ? [start, lock, closes] : []), id, c.guild.id),
    auditIfChanged(c.db, c.guild.id, c.userId, 'event.edit', `event:${id}`, null, { fields: opts.filter((o) => o.name !== 'event').map((o) => o.name) }),
    // Raising a limit promotes from the waitlist; lowering one moves nobody (the statement finds no room).
    ...(waiting?.n ? promotionStatements(c.db, id, at, Math.min(waiting.n, MAX_PROMOTIONS)) : []),
  ];
  const results = await c.db.batch<{ member_id?: string }>(stmts);
  if (results[0].meta.changes !== 1) return ephemeral(retype ? EVENT_COPY.typeLocked : EVENT_COPY.notOpen);
  // Each change after the lock is posted, a promotion by this edit too.
  const promoted = results.slice(2, -1).flatMap((r) => r.results.map((x) => x.member_id!)).filter(Boolean);
  if (promoted.length && lock && Date.parse(lock) <= Date.now()) await notice(c, d, `**${md(f.title)}:** ${EVENT_COPY.promotedLine(await tags(c, promoted))}`);
  const items: { key: string; due: number; later?: boolean }[] = [{ key: `evcard:${id}`, due: Date.now() }, ...promoItems(id, promoted.filter((m) => m !== c.userId), Date.now())];
  // A new start moves the lock and the close: `later` replaces the old items even with a later time.
  if (moved) items.push(...(lock ? [{ key: `evlock:${id}`, due: Date.parse(lock), later: true }] : []), { key: `evclose:${id}`, due: Date.parse(closes), later: true });
  // Order 33: a start that really moved tells the roster, and re-arms the reminder; a reminder whose time has passed goes.
  if (moved && start !== e.start_at) {
    const reminder = reminderItem({ id, start_at: start, reminded_start: e.reminded_start }, d.settings.reminder_minutes, Date.now());
    if (reminder) items.push(...reminder);
    else c.effects.timersDrop = { guildId: c.guild.id, keys: [`evremind:${id}`] };
    items.push({ key: `evmoved:${id}`, due: Date.now(), later: true });
  }
  c.effects.dkpTimers = { guildId: c.guild.id, items };
  return ephemeral(EVENT_COPY.edited);
};

export const cancelCommand: EventRun = async (c, opts) => {
  const id = pickedId(opts);
  if (id === null) return ephemeral(EVENT_COPY.pickEvent);
  const reason = (optString(opts, 'reason') ?? '').trim().slice(0, 200);
  if (!reason) return ephemeral(EVENT_COPY.noReason);
  const [took] = await c.db.batch([
    c.db.prepare("UPDATE event SET status = 'cancelled', cancelled_by = ?, cancel_reason = ? WHERE id = ? AND guild_id = ? AND status = 'open'").bind(c.userId, reason, id, c.guild.id),
    auditIfChanged(c.db, c.guild.id, c.userId, 'event.cancel', `event:${id}`, null, { reason }),
  ]);
  if (took.meta.changes !== 1) return ephemeral(EVENT_COPY.notOpen);
  // Order 33: the reminder goes with it, and the roster is told.
  c.effects.timersDrop = { guildId: c.guild.id, keys: [`evremind:${id}`, `evmoved:${id}`] };
  c.effects.dkpTimers = { guildId: c.guild.id, items: [{ key: `evcard:${id}`, due: Date.now() }, { key: `evgone:${id}`, due: Date.now() }] };
  return ephemeral(EVENT_COPY.cancelled);
};

const typeOf = (d: EventState, e: { type: EventType }) => md(d.settings.type_labels[e.type]);

async function upcoming(c: Ctx, d: EventState, type: EventType | undefined): Promise<MessageReply> {
  const { results } = await c.db
    .prepare(`SELECT id, type, title, start_at, message_id FROM event WHERE guild_id = ?1 AND status = 'open' AND (?2 IS NULL OR type = ?2) ORDER BY start_at LIMIT 26`)
    .bind(c.guild.id, type ?? null)
    .all<{ id: number; type: EventType; title: string; start_at: string; message_id: string | null }>();
  if (!results.length) return ephemeral(EVENT_COPY.noUpcoming);
  const lines = results.slice(0, UPCOMING_MAX).map((e) => EVENT_COPY.listLine(md(e.title), typeOf(d, e), stamp(Date.parse(e.start_at), 'f'), e.message_id && d.channel_id ? messageLink(c.guild.id, d.channel_id, e.message_id) : null));
  return ephemeral('', { embeds: [{ title: EVENT_COPY.upcomingTitle, description: wholeLines(lines, results.length > UPCOMING_MAX) }] });
}

/** As many whole lines as an embed's description holds (a cut line could break a link), saying how many were left out. */
function wholeLines(lines: string[], moreAfter = false): string {
  const room = EMBED_LIMITS.description - EVENT_COPY.andMore(9999).length - 1;
  let used = 0;
  let n = 0;
  for (const l of lines) {
    if (used + l.length + 1 > room) break;
    used += l.length + 1;
    n++;
  }
  const left = lines.length - n;
  return [...lines.slice(0, n), ...(left || moreAfter ? [left ? EVENT_COPY.andMore(left) : EVENT_COPY.andMoreSome] : [])].join('\n');
}

/** Pages of at most ROSTER_PAGE lines, each fitting an embed's description, so a "full" roster never loses a line. */
function pagesOf(lines: string[]): string[][] {
  const pages: string[][] = [[]];
  let used = 0;
  for (const l of lines) {
    if (pages.at(-1)!.length >= ROSTER_PAGE || used + l.length + 1 > EMBED_LIMITS.description) {
      pages.push([]);
      used = 0;
    }
    pages.at(-1)!.push(l);
    used += l.length + 1;
  }
  return pages;
}

/** One event's full roster, paged, in the presser's private message. */
async function rosterPage(c: Ctx, d: EventState, id: number, page: number, inPlace: boolean): Promise<MessageReply> {
  const e = await loadEvent(c.db, c.guild.id, id);
  if (!e || e.status === PREVIEW) return ephemeral(EVENT_COPY.notOpen);
  const sections = rosterSections(e, await loadSignups(c.db, id), d.settings);
  const lines = sections.flatMap((s) => [`**${s.head}**`, ...s.lines]);
  const paged = pagesOf(lines);
  const pages = paged.length;
  const p = Math.min(Math.max(0, page), pages - 1);
  const shown = paged[p];
  const data = {
    embeds: [{ title: truncate(EVENT_COPY.rosterTitle(md(e.title)), EMBED_LIMITS.title), description: shown.length ? shown.join('\n') : EVENT_COPY.rosterEmpty, footer: { text: EVENT_COPY.page(p + 1, pages) } }] as Embed[],
    components: pages > 1 ? [row([button(`${ROSTER_PAGE_PREFIX}${id}:${p - 1}`, EVENT_COPY.previous, undefined, p === 0), button(`${ROSTER_PAGE_PREFIX}${id}:${p + 1}`, EVENT_COPY.next, undefined, p === pages - 1)])] : [],
  };
  return inPlace ? updateMessage(data) : ephemeral('', data);
}

/** evlp:<id>:<page>. */
export function rosterPageButton(c: Ctx, id: string, d: EventState): Promise<MessageReply> {
  const [event, page] = id.slice(ROSTER_PAGE_PREFIX.length).split(':').map(Number);
  return rosterPage(c, d, event, page, true);
}

/** Sign-up history, newest first: officers only (order 32's override 5). */
async function history(c: Ctx, d: EventState, id: number): Promise<MessageReply> {
  if (!isEventRunner(c.guild, d.settings.events_role, c.member)) return ephemeral(EVENT_COPY.historyOfficers);
  const e = await loadEvent(c.db, c.guild.id, id);
  if (!e || e.status === PREVIEW) return ephemeral(EVENT_COPY.notOpen);
  const { results } = await c.db
    .prepare(
      `SELECT h.member_id, h.status, h.actor, h.reason, h.at, coalesce(m.display_name, h.member_id) AS name FROM event_signup_history h
       LEFT JOIN member m ON m.guild_id = h.guild_id AND m.discord_user_id = h.member_id WHERE h.event_id = ? AND h.guild_id = ? ORDER BY h.id DESC LIMIT 40`,
    )
    .bind(id, c.guild.id)
    .all<{ member_id: string; status: 'signed_up' | 'tentative' | 'bench' | 'waitlist' | 'declined' | 'left' | 'removed'; actor: string; reason: string | null; at: string; name: string }>();
  const shownStatus = (s: (typeof results)[number]['status']) => (s === 'left' ? EVENT_COPY.left : s === 'removed' ? EVENT_COPY.removed_ : statusLabel(s, e.type));
  const lines = results.map((h) => EVENT_COPY.historyLine(stamp(Date.parse(h.at), 'f'), memberTag(h.member_id, h.name), shownStatus(h.status), h.actor === 'bot' ? EVENT_COPY.theBot : `<@${h.actor}>`, h.reason ? md(h.reason) : null));
  return ephemeral('', { embeds: [{ title: truncate(EVENT_COPY.historyTitle(md(e.title)), EMBED_LIMITS.title), description: lines.length ? wholeLines(lines) : EVENT_COPY.rosterEmpty }] });
}

export const listCommand: EventRun = async (c, opts, d) => {
  const typed = optString(opts, 'event');
  if (typed === undefined) {
    if (optBool(opts, 'history')) return ephemeral(EVENT_COPY.pickEvent);
    return upcoming(c, d, optString(opts, 'type') as EventType | undefined);
  }
  const id = pickedId(opts);
  if (id === null) return ephemeral(EVENT_COPY.pickEvent);
  return optBool(opts, 'history') ? history(c, d, id) : rosterPage(c, d, id, 0, false);
};

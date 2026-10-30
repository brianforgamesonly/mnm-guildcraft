// Order 33 (ITEM 2): direct messages to an event's roster, sent in chunks by Events timer items, as wishlist nudges are
// (src/dkp/auction.ts). Order 33's override 1: a message carries only that event's card data and the recipient's own sign-up,
// never a button, and pings nobody. Discord (docs.discord.com/developers/resources/user, Create DM): "DMs should generally be
// initiated by a user action"; signing up is that action.
//
//   evremind:<event>   the reminder, to Signed up, Tentative and Bench, at most once per start time (event.reminded_start)
//   evmoved:<event>    the time changed, to everyone on the roster
//   evgone:<event>     the event was cancelled, to everyone on the roster
//   evpromo:<event>.<member>   that member moved up from the Waitlist
//
// Chunks walk recipients in user-id order. The cursor names the start it belongs to, and is stored after each message, so a
// run that dies part-way never messages anyone twice, and a start that moves mid-walk begins a fresh walk.
import type { Env } from '../env.ts';
import { audit } from '../access.ts';
import { budgetLeft, type BotApi } from '../board/api.ts';
import { md, memberTag, NO_PINGS, truncate } from '../discord.ts';
import { CANNOT_DM, transient } from '../dkp/auction.ts';
import { TIMER_CALL_CAP, type DueHandler, type DueResult } from '../dkp/due-types.ts';
import { loadEvent, loadSignups, messageLink, type EventRow } from './card.ts';
import { EVENT_COPY } from './copy.ts';
import { leftStatements, MAX_PROMOTIONS, promotionStatements } from './signup.ts';
import { loadEvents, type EventState } from './state.ts';
import { reminderAt, stamp } from './times.ts';
import { ON_ROSTER, TYPE_RULES, type Role } from './types.ts';

/** Discord's "Unknown member" (docs.discord.com/developers/topics/opcodes-and-status-codes). */
export const UNKNOWN_MEMBER = 10007;
/** Opening the DM, then sending. */
export const CALLS_PER_DM = 2;
/** The Left lookup, per recipient at reminder time. */
export const LOOKUP_CALLS = 1;
/**
 * A chunk's other calls, the worst case: the state, the event, the reminder's claim, the recipients, the Left batch, their
 * names, the notice, the recipients moved up, and the count. D1 and Discord share the alarm's 40 calls.
 */
export const CHUNK_OVERHEAD = 9;
/** Order 34 (ITEM 4): the event's status and start, read again just before each reminder. */
export const RECHECK_CALLS = 1;
/** Recipients a chunk holds: derived from the alarm's cap. */
export const chunkSize = (lookups: boolean, recheck = false) => Math.floor((TIMER_CALL_CAP - CHUNK_OVERHEAD) / (CALLS_PER_DM + (lookups ? LOOKUP_CALLS : 0) + (recheck ? RECHECK_CALLS : 0)));
/** A lock this recent already looked everyone up: the reminder reuses its Left result. */
const LEFT_FRESH_MS = 300_000;
/** A chunk's calls after its recipients are chosen: the Left batch, their names, the notice, those moved up, the count. */
const CHUNK_TAIL = 5;
/** A failed send is tried again this much later; an unfinished lock is waited for, up to a limit: a stuck lock costs no one a reminder. */
const RETRY_MS = 30_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_WAIT_MAX_MS = 120_000;

type Sent = 'sent' | 'refused' | 'failed' | 'retry';

/** One direct message: 2 calls. A refusal (50007) is final, and counted; anything transient is tried again. */
async function sendDm(api: BotApi, member: string, content: string): Promise<Sent> {
  const dm = await api.call<{ id: string }>('POST', '/users/@me/channels', { recipient_id: member });
  const sent = dm.ok ? await api.call('POST', `/channels/${dm.body.id}/messages`, { content: truncate(content, 2000), allowed_mentions: NO_PINGS }) : dm;
  if (transient(sent)) return 'retry';
  return sent.ok ? 'sent' : sent.code === CANNOT_DM ? 'refused' : 'failed';
}

const cardLink = (e: EventRow, state: EventState) => (e.message_id && state.channel_id ? messageLink(e.guild_id, state.channel_id, e.message_id) : null);
const whenOf = (e: EventRow) => {
  const start = Date.parse(e.start_at);
  return EVENT_COPY.dmStart(stamp(start, 'F'), stamp(start, 'R'));
};

interface Recipient {
  member_id: string;
  role: Role | null;
  char_name: string | null;
}

const IN_REMINDER = "('signed_up', 'tentative', 'bench')";
const RECIPIENT_COLS = 's.member_id, s.role, s.char_name';
const OPTED_IN = `LEFT JOIN event_member p ON p.guild_id = s.guild_id AND p.member_id = s.member_id`;

/** What the reminder says of the member's own sign-up. A Social, or a sign-up with no character, has nothing to add. */
function reminderText(e: EventRow, state: EventState, r: Recipient, link: string | null): string {
  const asked = TYPE_RULES[e.type].character !== 'none';
  const as = asked ? EVENT_COPY.dmAs(r.char_name ? md(r.char_name) : null, r.role ? md(state.settings.role_labels[r.role]) : null) : null;
  return EVENT_COPY.dmReminder(md(e.title), whenOf(e), as, link);
}

/** The chunk's count, kept in the audit log: a refused message is skipped silently and counted. */
const counted = (env: Pick<Env, 'DB'>, guildId: string, kind: string, id: number | string, tally: Record<Sent, number>) =>
  audit(env.DB, guildId, 'bot', 'event.dm', `event:${id}`, null, { kind, sent: tally.sent, refused: tally.refused, failed: tally.failed }).run();
const tallyOf = (): Record<Sent, number> => ({ sent: 0, refused: 0, failed: 0, retry: 0 });

/** The cursor's text before the member: what it belongs to. */
const walkOf = (mark: string, cursor: string | undefined) => (cursor?.startsWith(`${mark}|`) ? cursor.slice(mark.length + 1) : null);

/**
 * Order 34 (ITEM 4): a reminder's cursor is <start>|<last member>|<owed>. Owed: members who moved up where the walk has
 * already passed. They stay in the cursor until each has had their message, so a transient failure can't drop them.
 */
const reminderCursor = (start: string, after: string, owed: string[]) => `${start}|${after}${owed.length ? `|${owed.join(',')}` : ''}`;
const reminderWalk = (text: string | null) => {
  if (text === null) return null;
  const [after, owed] = text.split('|');
  return { after, owed: owed ? owed.split(',') : [] };
};

type Stopped = 'budget' | 'retry' | 'changed' | null;

/**
 * One chunk of a walk: each member, a message, and `done` after it. `still`, before each message: false stops the walk.
 * Returns why it stopped short, or null when every row was handled.
 */
async function walk<T extends { member_id: string }>(env: Pick<Env, 'DB'>, api: BotApi, guildId: string, kind: string, id: number, rows: T[], text: (r: T) => string, done: (member: string) => Promise<void>, still?: () => Promise<boolean>): Promise<Stopped> {
  const tally = tallyOf();
  let stopped: Stopped = null;
  for (const r of rows) {
    // This message, its re-check, and the count after it.
    if (budgetLeft(api.budget) < CALLS_PER_DM + 1 + (still ? RECHECK_CALLS : 0)) {
      stopped = 'budget';
      break;
    }
    if (still && !(await still())) {
      stopped = 'changed';
      break;
    }
    const sent = await sendDm(api, r.member_id, text(r));
    if (sent === 'retry') {
      stopped = 'retry';
      break;
    }
    tally[sent]++;
    await done(r.member_id);
  }
  if (tally.sent || tally.refused || tally.failed) await counted(env, guildId, kind, id, tally);
  return stopped;
}
/** The item's next run after a chunk. A change ends this walk: an edit has re-armed the item, and a cancel has removed it. */
const nextRun = (stopped: Stopped, more: boolean, now: number): DueResult | null => (stopped === 'changed' ? null : stopped === 'retry' ? { again: now + RETRY_MS } : stopped || more ? { again: now + 1_000 } : null);

export const promoItems = (eventId: number, members: string[], now: number) => members.map((m) => ({ key: `evpromo:${eventId}.${m}`, due: now }));

/** Left at the reminder or the lock: the rows' batch, then the notice in GC-Events. Returns who moved up. */
export async function leftAndPromoted(env: Pick<Env, 'DB'>, api: BotApi, e: EventRow, state: EventState, left: string[], at: string, line: (title: string, who: string) => string, also: D1PreparedStatement[] = []): Promise<string[]> {
  if (!left.length && !also.length) return [];
  // Names first: once the batch below has run, a failure here could lose the notice.
  const names = left.length ? new Map((await loadSignups(env.DB, e.id)).map((s) => [s.member_id, s.name])) : new Map<string, string>();
  const moved = await env.DB.batch<{ member_id: string }>([
    ...(left.length ? [...leftStatements(env.DB, e.id, left, at), ...promotionStatements(env.DB, e.id, at, Math.min(left.length, MAX_PROMOTIONS))] : []),
    ...also,
  ]);
  if (!left.length) return [];
  const promoted = moved.slice(2, -(1 + also.length)).flatMap((r) => r.results.map((x) => x.member_id));
  if (state.channel_id) {
    const tags = (ids: string[]) => ids.map((m) => memberTag(m, names.get(m) ?? m)).join(', ');
    const posted = await api.call('POST', `/channels/${state.channel_id}/messages`, { content: truncate([line(md(e.title), tags(left)), ...(promoted.length ? [EVENT_COPY.promotedLine(tags(promoted))] : [])].join('\n'), 2000), allowed_mentions: NO_PINGS });
    if (!posted.ok) console.error('event notice failed', posted.status);
  }
  return promoted;
}

/**
 * evremind:<event>. Due at the reminder time; a start that moved runs it again at the new one. Each chunk looks its recipients
 * up (a 404 marks them Left, and the waitlist promotes) unless the lock just did. The lock goes first: lock and reminder share
 * the default of 30 minutes, and alarms run same-time items A→Z, but a long lock takes several alarms.
 */
export const evremind: DueHandler = async (env, guildId, id, _due, now, api, run) => {
  const state = await loadEvents(env.DB, guildId);
  if (!state.enabled || !api || !run?.save) return null;
  const eventId = Number(id);
  const e = await loadEvent(env.DB, guildId, eventId);
  if (!e || e.status !== 'open') return null;
  const at = reminderAt(e.start_at, state.settings.reminder_minutes);
  if (at === null || Date.parse(e.start_at) <= now) return null;
  if (at > now) return { again: at };
  const lockDue = !!e.lock_at && Date.parse(e.lock_at) <= now;
  if (lockDue && !e.lock_done_at && now - Date.parse(e.lock_at!) < LOCK_WAIT_MAX_MS) return { again: now + LOCK_WAIT_MS };
  const lookups = !(lockDue && e.lock_done_at && now - Date.parse(e.lock_done_at) < LEFT_FRESH_MS);
  const walked = reminderWalk(walkOf(e.start_at, run.cursor));
  if (!walked?.after) {
    // The cursor first: a stored cursor means this walk is ours, so a run that died before the claim claims now; with none,
    // a claim already held means this start has had its reminder.
    if (walked === null) await run.save(`${e.start_at}|`);
    const took = await env.DB.prepare('UPDATE event SET reminded_start = ?1 WHERE id = ?2 AND reminded_start IS NOT ?1').bind(e.start_at, eventId).run();
    if (walked === null && took.meta.changes !== 1) return null;
  }
  const after = walked?.after ?? '';
  const size = chunkSize(lookups, true);
  const { results: chosen } = await env.DB
    .prepare(`SELECT ${RECIPIENT_COLS} FROM event_signup s ${OPTED_IN} WHERE s.event_id = ? AND s.status IN ${IN_REMINDER} AND s.member_id > ? AND coalesce(p.reminders_off, 0) = 0 ORDER BY s.member_id LIMIT ${size}`)
    .bind(eventId, after)
    .all<Recipient>();
  // Other items may have shared this alarm: a smaller chunk now, rather than a notice or a count refused at the cap.
  const room = Math.floor((budgetLeft(api.budget) - CHUNK_TAIL) / (CALLS_PER_DM + RECHECK_CALLS + (lookups ? LOOKUP_CALLS : 0)));
  if (chosen.length && room < 1) return { again: now + 1_000 };
  const results = chosen.slice(0, room);
  const link = cardLink(e, state);
  const left: string[] = [];
  let recipients = results;
  if (lookups) {
    // Only a 404 marks anyone Left. Any other answer tells nothing about this member, and costs them no reminder.
    for (const r of results) {
      const m = await api.call('GET', `/guilds/${guildId}/members/${r.member_id}`);
      if (!m.ok && m.status === 404 && m.code === UNKNOWN_MEMBER) left.push(r.member_id);
    }
    recipients = results.filter((r) => !left.includes(r.member_id));
  }
  const promoted = await leftAndPromoted(env, api, e, state, left, new Date(now).toISOString(), EVENT_COPY.leftLineReminder);
  const last = results.at(-1)?.member_id ?? after;
  const more = chosen.length === size || results.length < chosen.length;
  // A member who moved up where the walk won't reach them gets both messages. Behind the cursor, they go in it before anything
  // else can fail. Ahead of it, they join this chunk in their place: the cursor passes them, or the next chunk finds them.
  const missed = promoted.filter((m) => !more || m <= last);
  const behind = missed.filter((m) => m <= after);
  const owing = [...new Set([...(walked?.owed ?? []), ...behind])];
  if (behind.length) await run.save(reminderCursor(e.start_at, after, owing));
  // At once: these rows are committed, and whatever happens below, the card and the message are owed.
  const follow = [...(left.length ? [{ key: `evcard:${id}`, due: now }] : []), ...promoItems(eventId, promoted, now)];
  if (follow.length) await run.schedule?.(follow);
  // Those owed go first, while they still qualify. One message goes out only if the event is still as this run read it.
  const wanted = [...owing, ...missed.filter((m) => m > after)];
  const found = wanted.length
    ? (await env.DB.prepare(`SELECT ${RECIPIENT_COLS} FROM event_signup s ${OPTED_IN} WHERE s.event_id = ? AND s.status IN ${IN_REMINDER} AND s.member_id IN (SELECT value FROM json_each(?)) AND coalesce(p.reminders_off, 0) = 0`).bind(eventId, JSON.stringify(wanted)).all<Recipient>()).results
    : [];
  const first = found.filter((r) => r.member_id <= after);
  const owed = new Set(first.map((r) => r.member_id));
  recipients = [...recipients, ...found.filter((r) => r.member_id > after)].sort((a, b) => (a.member_id < b.member_id ? -1 : 1));
  let cursor = after;
  const save = run.save;
  const done = async (m: string) => {
    if (!owed.delete(m)) cursor = m > cursor ? m : cursor;
    await save(reminderCursor(e.start_at, cursor, [...owed]));
  };
  const same = async () => {
    const live = await env.DB.prepare('SELECT status, start_at FROM event WHERE id = ?').bind(eventId).first<{ status: string; start_at: string }>();
    return live?.status === 'open' && live.start_at === e.start_at;
  };
  const stopped = await walk(env, api, guildId, 'reminder', eventId, [...first, ...recipients], (x) => reminderText(e, state, x, link), done, same);
  // Those who left move the cursor too: the next chunk starts after the last one looked up.
  if (!stopped && last > cursor) await run.save(reminderCursor(e.start_at, last, [...owed]));
  return nextRun(stopped, more, now);
};

/** evmoved: and evgone:: everyone on the roster, Waitlist included. No reminders doesn't stop these. */
const toRoster = (kind: 'moved' | 'cancelled', mark: (e: EventRow) => string, ready: (e: EventRow) => boolean, text: (e: EventRow, link: string | null) => string): DueHandler => async (env, guildId, id, _due, now, api, run) => {
  const state = await loadEvents(env.DB, guildId);
  if (!state.enabled || !api || !run?.save) return null;
  const eventId = Number(id);
  const e = await loadEvent(env.DB, guildId, eventId);
  if (!e || !ready(e)) return null;
  const after = walkOf(mark(e), run.cursor) ?? '';
  const size = chunkSize(false);
  const { results } = await env.DB
    .prepare(`SELECT member_id FROM event_signup WHERE event_id = ? AND status IN (${ON_ROSTER.map((s) => `'${s}'`).join(', ')}) AND member_id > ? ORDER BY member_id LIMIT ${size}`)
    .bind(eventId, after)
    .all<{ member_id: string }>();
  const message = text(e, cardLink(e, state));
  const save = run.save;
  return nextRun(await walk(env, api, guildId, kind, eventId, results, () => message, (m) => save(`${mark(e)}|${m}`)), results.length === size, now);
};

export const evmoved = toRoster('moved', (e) => e.start_at, (e) => e.status === 'open', (e, link) => EVENT_COPY.dmMoved(md(e.title), whenOf(e), link));
export const evgone = toRoster('cancelled', () => 'cancelled', (e) => e.status === 'cancelled', (e, link) => EVENT_COPY.dmCancelled(md(e.title), whenOf(e), md(e.cancel_reason ?? ''), link));

/** evpromo:<event>.<member>: while they still hold that place. */
export const evpromo: DueHandler = async (env, guildId, id, _due, now, api) => {
  const state = await loadEvents(env.DB, guildId);
  if (!state.enabled || !api) return null;
  const [eventText, member] = id.split('.');
  const eventId = Number(eventText);
  const e = await loadEvent(env.DB, guildId, eventId);
  if (!e || e.status !== 'open') return null;
  const held = await env.DB.prepare("SELECT 1 FROM event_signup WHERE event_id = ? AND member_id = ? AND status = 'signed_up'").bind(eventId, member).first();
  if (!held) return null;
  const sent = await sendDm(api, member, EVENT_COPY.dmPromoted(md(e.title), whenOf(e), cardLink(e, state)));
  if (sent === 'retry') return { again: now + RETRY_MS };
  await counted(env, guildId, 'promoted', eventId, { ...tallyOf(), [sent]: 1 });
  return null;
};

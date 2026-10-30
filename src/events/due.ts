// Order 32: what each Events timer item does when the guild's timer object runs it (src/dkp/timers.ts; routed by kind in
// src/dkp/due.ts). Every kind starts "ev", which is how each module removes only its own items (order 32's override 2).
// Each handler is idempotent (alarms run at least once): it acts only on a row D1 still shows as due, in a statement that
// checks that state itself, and does nothing while the module is off (Add Events module re-arms it).
import type { DueHandler } from '../dkp/due-types.ts';
import { budgetLeft } from '../board/api.ts';
import { loadEvent, renderEvent } from './card.ts';
import { EVENT_COPY } from './copy.ts';
import { evgone, evmoved, evpromo, evremind, leftAndPromoted, promoItems, UNKNOWN_MEMBER } from './dm.ts';
import { loadEvents } from './state.ts';
import { ON_ROSTER } from './types.ts';

/** evclose:<event id>: the event closes at closes_at. */
const evclose: DueHandler = async (env, guildId, id, _due, now) => {
  try {
    const state = await loadEvents(env.DB, guildId);
    if (!state.enabled) return null;
    const at = new Date(now).toISOString();
    await env.DB.prepare("UPDATE event SET status = 'closed', closed_at = ?1 WHERE id = ?2 AND guild_id = ?3 AND status = 'open' AND closes_at <= ?1").bind(at, Number(id), guildId).run();
    const e = await env.DB.prepare('SELECT status, closes_at FROM event WHERE id = ? AND guild_id = ?').bind(Number(id), guildId).first<{ status: string; closes_at: string }>();
    // Closed, by this run or by one that died before it could ask for the card (alarms run at least once).
    if (e?.status === 'closed') return { schedule: [{ key: `evcard:${id}`, due: now }] };
    // Its start moved after this item was set: run again at the new time.
    return e?.status === 'open' ? { again: Date.parse(e.closes_at) } : null;
  } catch (err) {
    // As decay: a failed run tries again within the hour. The object drops an item after 5 throws, and nothing would re-arm it.
    console.error('event close failed', err instanceof Error ? err.message : String(err));
    return { again: now + 3_600_000 };
  }
};

/** evcard:<event id>: the card, edited in place, paced by Discord's last answer (src/dkp/timers.ts). */
const evcard: DueHandler = async (env, guildId, id, _due, now, api, run) => {
  const state = await loadEvents(env.DB, guildId);
  if (!api || !state.enabled) return { skip: true };
  return { headers: await renderEvent(env, api, guildId, state, Number(id), now, !run?.stale) };
};

/** Member lookups one alarm may make, and what it keeps back for D1 and the notice (the alarm's budget is 40 calls in all). */
export const LEFT_BATCH = 40;
const LEFT_RESERVE = 6;
export { UNKNOWN_MEMBER };

/**
 * evlock:<event id>: the lock. Each member on the roster is looked up (Get Guild Member needs no privileged intent); only a
 * 404 with Unknown Member marks them Left, and the waitlist promotes. It resumes from left_cursor, and stops at the start,
 * when promotion stops. Anything else Discord answers is tried again; it never marks anyone.
 */
const evlock: DueHandler = async (env, guildId, id, _due, now, api) => {
  const state = await loadEvents(env.DB, guildId);
  if (!state.enabled) return null;
  const eventId = Number(id);
  const e = await loadEvent(env.DB, guildId, eventId);
  if (!e || e.status !== 'open' || !e.lock_at) return null;
  const card = [{ key: `evcard:${id}`, due: now }];
  // Done, by this run or by one that died before it could ask for the card (alarms run at least once).
  if (e.lock_done_at) return { schedule: card };
  if (Date.parse(e.lock_at) > now) return { again: Date.parse(e.lock_at) };
  const at = new Date(now).toISOString();
  // Each write names the lock it worked for, so a start moved during this run keeps its fresh lock.
  const finish = (cursor: string | null) => env.DB.prepare('UPDATE event SET lock_done_at = ?, left_cursor = ? WHERE id = ? AND lock_at = ?').bind(at, cursor, eventId, e.lock_at);
  if (!api || Date.parse(e.start_at) <= now) {
    await finish(e.left_cursor).run();
    return { schedule: card };
  }
  const { results } = await env.DB.prepare(`SELECT member_id FROM event_signup WHERE event_id = ? AND status IN (${ON_ROSTER.map((s) => `'${s}'`).join(', ')}) AND member_id > ? ORDER BY member_id LIMIT ${LEFT_BATCH}`)
    .bind(eventId, e.left_cursor ?? '')
    .all<{ member_id: string }>();
  const left: string[] = [];
  let cursor = e.left_cursor;
  let looked = 0;
  let stopped = false;
  for (const { member_id: m } of results) {
    if (budgetLeft(api.budget) < LEFT_RESERVE) break;
    const r = await api.call('GET', `/guilds/${guildId}/members/${m}`);
    if (!r.ok && !(r.status === 404 && r.code === UNKNOWN_MEMBER)) {
      stopped = true;
      break;
    }
    if (!r.ok) left.push(m);
    cursor = m;
    looked++;
  }
  const done = !stopped && looked === results.length && results.length < LEFT_BATCH;
  const saved = done ? finish(cursor) : env.DB.prepare('UPDATE event SET left_cursor = ? WHERE id = ? AND lock_at = ?').bind(cursor, eventId, e.lock_at);
  const promoted = await leftAndPromoted(env, api, e, state, left, at, EVENT_COPY.leftLine, [saved]);
  const promos = promoItems(eventId, promoted, now);
  if (done) return { schedule: [...card, ...promos] };
  // Discord said something else, or the budget ran out: the next batch, a moment later (each alarm is its own invocation).
  return { again: now + (stopped ? 30_000 : 1_000), ...(left.length ? { schedule: [...card, ...promos] } : {}) };
};

/** The Events handlers by item kind. test/worker/events-switch.test.ts holds every kind to the "ev" prefix. */
export const EVENT_HANDLERS: Record<string, DueHandler> = { evclose, evcard, evlock, evremind, evmoved, evgone, evpromo };

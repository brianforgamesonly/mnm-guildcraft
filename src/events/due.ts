// Order 32: what each Events timer item does when the guild's timer object runs it (src/dkp/timers.ts; routed by kind in
// src/dkp/due.ts). Every kind starts "ev", which is how each module removes only its own items (order 32's override 2).
// Each handler is idempotent (alarms run at least once): it acts only on a row D1 still shows as due, in a statement that
// checks that state itself, and does nothing while the module is off (Add Events module re-arms it).
import type { DueHandler } from '../dkp/due-types.ts';
import { renderEvent } from './card.ts';
import { loadEvents } from './state.ts';

/** evclose:<event id>: the event closes at closes_at. */
const evclose: DueHandler = async (env, guildId, id, _due, now) => {
  const state = await loadEvents(env.DB, guildId);
  if (!state.enabled) return null;
  const at = new Date(now).toISOString();
  const r = await env.DB.prepare("UPDATE event SET status = 'closed', closed_at = ?1 WHERE id = ?2 AND guild_id = ?3 AND status = 'open' AND closes_at <= ?1").bind(at, Number(id), guildId).run();
  if (r.meta.changes) return { schedule: [{ key: `evcard:${id}`, due: now }] };
  // Its start moved after this item was set: run again at the new time.
  const e = await env.DB.prepare("SELECT closes_at FROM event WHERE id = ? AND guild_id = ? AND status = 'open'").bind(Number(id), guildId).first<{ closes_at: string }>();
  return e ? { again: Date.parse(e.closes_at) } : null;
};

/** evcard:<event id>: the card, edited in place, paced by Discord's last answer (src/dkp/timers.ts). */
const evcard: DueHandler = async (env, guildId, id, _due, now, api) => {
  const state = await loadEvents(env.DB, guildId);
  if (!api || !state.enabled) return null;
  return { headers: await renderEvent(env, api, guildId, state, Number(id), now) };
};

/** evlock:<event id>: the lock. The card shows it. */
const evlock: DueHandler = async (env, guildId, id, _due, now) => {
  const state = await loadEvents(env.DB, guildId);
  return state.enabled ? { schedule: [{ key: `evcard:${id}`, due: now }] } : null;
};

/** The Events handlers by item kind. test/worker/events-switch.test.ts holds every kind to the "ev" prefix. */
export const EVENT_HANDLERS: Record<string, DueHandler> = { evclose, evcard, evlock };

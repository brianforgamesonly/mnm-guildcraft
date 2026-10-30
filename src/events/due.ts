// Order 32: what each Events timer item does when the guild's timer object runs it (src/dkp/timers.ts; routed by kind in
// src/dkp/due.ts). Every kind starts "ev", which is how each module removes only its own items (order 32's override 2).
// Each handler is idempotent (alarms run at least once): it acts only on a row D1 still shows as due, in a statement that
// checks that state itself, and does nothing while the module is off (Add Events module re-arms it).
import type { DueHandler } from '../dkp/due-types.ts';
import { loadEvents } from './state.ts';

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

/** The Events handlers by item kind. test/worker/events-switch.test.ts holds every kind to the "ev" prefix. */
export const EVENT_HANDLERS: Record<string, DueHandler> = { evclose };

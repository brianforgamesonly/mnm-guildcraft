// Order 27 (ITEM 3): what each timer item does when its alarm runs. Each handler is idempotent (alarms run at least once):
// it acts only on a row that D1 still shows as due and open, in a statement that checks that state itself.
import { botApi, type BotApi } from '../board/api.ts';
import type { Env } from '../env.ts';
import { SHOP_COPY } from './copy.ts';
import { decayStatement } from './ledger.ts';
import { renderPending, showDecision } from './messages.ts';
import { closeCheck, closeRaid, renderCard } from './raid.ts';
import { announceResult, closeAuction, nudge, openNext, renderAuction, reopen } from './auction.ts';
import { renderListing } from './shop.ts';
import { loadGuild } from '../access.ts';
import { loadDkp } from './state.ts';
import { TIMER_CALL_CAP, type DueHandler, type DueResult, type ItemRun } from './due-types.ts';
import { EVENT_HANDLERS } from '../events/due.ts';

export { TIMER_CALL_CAP } from './due-types.ts';
export type { DueResult } from './due-types.ts';
export type Handler = DueHandler;

/** lapse:<pending id>: an approval nobody gave in time. */
const lapse: Handler = async (env, guildId, id, _due, now, api) => {
  const p = await env.DB.prepare(
    "UPDATE dkp_pending SET status = 'lapsed', decided_at = ?1 WHERE id = ?2 AND guild_id = ?3 AND status = 'open' AND due_at <= ?1 RETURNING message_id",
  )
    .bind(new Date(now).toISOString(), Number(id), guildId)
    .first<{ message_id: string | null }>();
  if (!p?.message_id || !api) return null;
  const state = await loadDkp(env.DB, guildId);
  if (!state.channel_id) return null;
  // The status line is the content, and the Approve button goes. Order 34: a refused edit is flagged for the sweep.
  await showDecision(env.DB, api, guildId, state.channel_id, Number(id), p.message_id, 'lapsed', null, null);
  return null;
};

/** Order 34 (ITEM 4): pcard:<pending id>, an approval card the sweep redraws. */
const pcard: Handler = async (env, guildId, id, _due, _now, api) => {
  const state = await loadDkp(env.DB, guildId);
  if (!api || !state.channel_id) return null;
  return { headers: await renderPending(env.DB, api, guildId, state.channel_id, Number(id)) };
};

/** check:<kill id>: the Kill roll call window closes; then the card shows it. */
const check: Handler = async (env, guildId, id, _due, now) => {
  const r = await closeCheck(env.DB, guildId, Number(id), now);
  if (r === null) return null;
  if ('again' in r) return { again: r.again };
  return { schedule: [{ key: `render:${r.raidId}`, due: now }] };
};

/** close:<raid id>: the raid closes itself at its closes_at. */
const close: Handler = async (env, guildId, id, _due, now, api) => {
  const state = await loadDkp(env.DB, guildId);
  if (!state.enabled) return null;
  const closed = await closeRaid(env.DB, api, guildId, state.channel_id, Number(id), 'bot', 'auto', now, state.settings);
  return closed?.eventId ? { schedule: [{ key: `evcard:${closed.eventId}`, due: now }] } : null;
};

/** render:<raid id>: the raid card, edited in place. */
const render: Handler = async (env, guildId, id, _due, _now, api) => {
  const state = await loadDkp(env.DB, guildId);
  if (!api || !state.channel_id) return null;
  return { headers: await renderCard(env.DB, api, guildId, state.channel_id, Number(id)) };
};

/** Order 29: auction:<id>, an auction closes at closes_at (the timer only; never extended). */
const auction: Handler = async (env, guildId, id, _due, now, api) => {
  const [state, guild] = await Promise.all([loadDkp(env.DB, guildId), loadGuild(env.DB, guildId)]);
  if (!state.enabled || !guild) return null;
  const r = await closeAuction(env.DB, api, guild, Number(id), now, state.settings);
  if (r === null) return null;
  if ('again' in r) return { again: r.again };
  // The result is its own item (review of PR B: it retries on its own); a raid auction's shows on its raid card (Won
  // tonight), and the raid's next queued drop opens (order 29, PR C: the item queue), each its own item too.
  const raid = r.closed.raid_id;
  // next: a moment later, so the result line posts before the next drop's card (review of PR C: same-time items run A→Z).
  return { schedule: [{ key: `result:${id}`, due: now }, ...(raid ? [{ key: `render:${raid}`, due: now }, { key: `next:${raid}`, due: now + 1 }] : [])] };
};

/** Order 29: result:<id>, a closed auction's card, line and standings. */
const result: Handler = async (env, guildId, id, _due, now, api) => {
  const [state, guild] = await Promise.all([loadDkp(env.DB, guildId), loadGuild(env.DB, guildId)]);
  if (!state.enabled || !guild) return null;
  return announceResult(env.DB, api, guild, state.channel_id, Number(id), now);
};

/** Order 29, PR C: next:<raid id>, the raid's next queued drop opens (its card, its timer, its nudges). */
const next: Handler = async (env, guildId, id, _due, now, api) => {
  const [state, guild] = await Promise.all([loadDkp(env.DB, guildId), loadGuild(env.DB, guildId)]);
  if (!state.enabled || !guild) return null;
  const items = await openNext(env.DB, api, guild, state.channel_id, Number(id), now, state.settings);
  return items.length ? { schedule: [...items, { key: `render:${id}`, due: now }] } : null;
};

/** Order 29, PR C (review): reopen:<auction id>, an opening whose card could not post yet tries again. */
const reopenItem: Handler = async (env, guildId, id, _due, now, api) => {
  const [state, guild] = await Promise.all([loadDkp(env.DB, guildId), loadGuild(env.DB, guildId)]);
  if (!state.enabled || !guild) return null;
  const items = await reopen(env.DB, api, guild, state.channel_id, Number(id), now, state.settings);
  return items.length ? { schedule: items } : null;
};

/** Order 29, PR C: nudge:<auction id>, wishlist direct messages in chunks, rescheduled until done. */
const nudgeItem: Handler = async (env, guildId, id, _due, now, api) => {
  const [state, guild] = await Promise.all([loadDkp(env.DB, guildId), loadGuild(env.DB, guildId)]);
  if (!state.enabled || !guild) return null;
  return nudge(env.DB, api, guild, state.channel_id, Number(id), now, state.settings);
};

/** Order 29: acard:<id>, an auction card edited in place (its bidder count), paced as the raid card is. */
const acard: Handler = async (env, guildId, id, _due, _now, api) => {
  const state = await loadDkp(env.DB, guildId);
  if (!api || !state.channel_id) return null;
  return { headers: await renderAuction(env.DB, api, guildId, state.channel_id, Number(id), state.settings) };
};

/** Order 33: scard:<listing id>, a shop listing's card. Only the sweep asks for it: a press edits the card itself. */
const scard: Handler = async (env, guildId, id, _due, _now, api) => {
  const [state, guild] = await Promise.all([loadDkp(env.DB, guildId), loadGuild(env.DB, guildId)]);
  if (!api || !state.channel_id || !guild) return null;
  return { headers: await renderListing(env.DB, api, guild, state.channel_id, Number(id)) };
};

/** Order 29, PR D: the decay item's fixed key (order 30: DkpTimers.ensureDecay alone seeds it), and its week. */
export const DECAY_KEY = 'decay:week';
export const WEEK_MS = 7 * 86_400_000;

/** Order 29, PR D: decay:week, once a week: idle balances lose the decay percent (src/dkp/ledger.ts decayStatement). */
const decay: Handler = async (env, guildId, _id, _due, now) => {
  const state = await loadDkp(env.DB, guildId);
  // DKP off: the item ends (Remove DKP clears every item anyway; ensureDecay seeds it again).
  if (!state.enabled) return null;
  const s = state.settings;
  const at = new Date(now).toISOString();
  try {
    await env.DB.batch([decayStatement(env.DB, { guildId, idleSince: new Date(now - s.decay_days * 86_400_000).toISOString(), percent: s.decay_percent, reason: SHOP_COPY.decayReason(s.decay_days, s.decay_percent), at })]);
  } catch (e) {
    // Review of PR D: a failed run tries again within the hour, never ends decay (the object drops an item after 5 throws).
    console.error('dkp decay failed', e instanceof Error ? e.message : String(e));
    return { again: now + 3_600_000 };
  }
  return { again: now + WEEK_MS };
};

/** DKP's handlers by item kind. */
export const DKP_HANDLERS: Record<string, Handler> = { lapse, pcard, check, close, render, auction, result, next, reopen: reopenItem, nudge: nudgeItem, acard, scard, decay };
/** The handlers by item kind ("kind:id"). Order 32: the Events module's items share the guild's due-list. */
export const HANDLERS: Record<string, Handler> = { ...DKP_HANDLERS, ...EVENT_HANDLERS };

/** The calls one alarm's items share (the alarm is one invocation). */
export const timerApi = (env: Env, now: number, d1: () => number): BotApi | null =>
  env.DISCORD_BOT_TOKEN ? botApi(env.DISCORD_BOT_TOKEN, { d1, discord: 0, cap: TIMER_CALL_CAP, deadline: now + 20_000 }) : null;

export async function runDue(env: Env, guildId: string, key: string, due: number, now: number, api: BotApi | null, run: ItemRun = {}): Promise<DueResult | null> {
  const [kind, id] = key.split(':');
  const h = HANDLERS[kind];
  if (!h) {
    console.error('dkp timer: unknown item', key);
    return null;
  }
  return h(env, guildId, id, due, now, api, run);
}

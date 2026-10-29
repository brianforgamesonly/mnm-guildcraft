// Order 27 (ITEM 3): what each timer item does when its alarm runs. Each handler is idempotent (alarms run at least once):
// it acts only on a row that D1 still shows as due and open, in a statement that checks that state itself.
import { botApi, type BotApi } from '../board/api.ts';
import type { Env } from '../env.ts';
import { DKP_COPY } from './copy.ts';
import { editIn } from './messages.ts';
import { closeCheck, closeRaid, renderCard } from './raid.ts';
import { loadDkp } from './state.ts';

/** About 40 external calls an invocation (order 5), D1 and Discord together; shared by every item one alarm runs. */
export const TIMER_CALL_CAP = 40;

export interface DueResult {
  /** Run this item again at this time (it was not due yet). */
  again?: number;
  /** Other items to set (a card edit after a window closes). */
  schedule?: { key: string; due: number }[];
  /** Discord's rate-limit headers on the card edit, for the pace of the next one (src/dkp/pace.ts). */
  headers?: { remaining?: string | null; resetAfter?: string | null; retryAfter?: number | null } | null;
}
export type Handler = (env: Env, guildId: string, id: string, due: number, now: number, api: BotApi | null) => Promise<DueResult | null>;

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
  // The card's text is its embed, which the edit keeps (order 22: an edit keeps every field it does not send); the
  // status line is the content, and the Approve button goes.
  await editIn(api, state.channel_id, p.message_id, { content: DKP_COPY.lapsed, components: [] });
  return null;
};

/** check:<kill id>: the Check again window closes; then the card shows it. */
const check: Handler = async (env, guildId, id, _due, now) => {
  const r = await closeCheck(env.DB, guildId, Number(id), now);
  if (r === null) return null;
  if (r > now + 1000) return { again: r };
  return { schedule: [{ key: `render:${r}`, due: now }] };
};

/** close:<raid id>: the raid closes itself at its closes_at. */
const close: Handler = async (env, guildId, id, _due, now, api) => {
  const state = await loadDkp(env.DB, guildId);
  if (!state.enabled) return null;
  await closeRaid(env.DB, api, guildId, state.channel_id, Number(id), 'bot', 'auto', now);
  return null;
};

/** render:<raid id>: the raid card, edited in place. */
const render: Handler = async (env, guildId, id, _due, _now, api) => {
  const state = await loadDkp(env.DB, guildId);
  if (!api || !state.channel_id) return null;
  return { headers: await renderCard(env.DB, api, guildId, state.channel_id, Number(id)) };
};

/** The handlers by item kind ("kind:id"). */
export const HANDLERS: Record<string, Handler> = { lapse, check, close, render };

/** The calls one alarm's items share (the alarm is one invocation). */
export const timerApi = (env: Env, now: number, d1: () => number): BotApi | null =>
  env.DISCORD_BOT_TOKEN ? botApi(env.DISCORD_BOT_TOKEN, { d1, discord: 0, cap: TIMER_CALL_CAP, deadline: now + 20_000 }) : null;

export async function runDue(env: Env, guildId: string, key: string, due: number, now: number, api: BotApi | null): Promise<DueResult | null> {
  const [kind, id] = key.split(':');
  const h = HANDLERS[kind];
  if (!h) {
    console.error('dkp timer: unknown item', key);
    return null;
  }
  return h(env, guildId, id, due, now, api);
}

// Order 27 (ITEM 3): what each timer item does when its alarm runs. Each handler is idempotent (alarms run at least once):
// it acts only on a row that D1 still shows as due and open, in a statement that checks that state itself.
import { botApi } from '../board/api.ts';
import type { Env } from '../env.ts';
import { DKP_COPY } from './copy.ts';
import { editIn } from './messages.ts';
import { loadDkp } from './state.ts';

/** About 40 external calls an invocation (order 5), D1 and Discord together. */
const TIMER_CALL_CAP = 40;
export type Handler = (env: Env, guildId: string, id: string, due: number, now: number) => Promise<number | null>;

/** lapse:<pending id>: an approval nobody gave in time. */
const lapse: Handler = async (env, guildId, id, _due, now) => {
  const p = await env.DB.prepare(
    "UPDATE dkp_pending SET status = 'lapsed', decided_at = ?1 WHERE id = ?2 AND guild_id = ?3 AND status = 'open' AND due_at <= ?1 RETURNING message_id",
  )
    .bind(new Date(now).toISOString(), Number(id), guildId)
    .first<{ message_id: string | null }>();
  if (!p?.message_id || !env.DISCORD_BOT_TOKEN) return null;
  const state = await loadDkp(env.DB, guildId);
  if (!state.channel_id) return null;
  const api = botApi(env.DISCORD_BOT_TOKEN, { d1: () => 2, discord: 0, cap: TIMER_CALL_CAP, deadline: now + 10_000 });
  // The card's text is its embed, which the edit keeps (order 22: an edit keeps every field it does not send); the
  // status line is the content, and the Approve button goes.
  await editIn(api, state.channel_id, p.message_id, { content: DKP_COPY.lapsed, components: [] });
  return null;
};

/** The handlers by item kind ("kind:id"); PR B adds check, close and render. */
export const HANDLERS: Record<string, Handler> = { lapse };

export async function runDue(env: Env, guildId: string, key: string, due: number, now: number): Promise<number | null> {
  const [kind, id] = key.split(':');
  const h = HANDLERS[kind];
  if (!h) {
    console.error('dkp timer: unknown item', key);
    return null;
  }
  return h(env, guildId, id, due, now);
}

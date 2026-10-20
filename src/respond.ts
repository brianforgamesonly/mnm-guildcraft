// The deferred path (order 4, ITEM 1.2). The Worker acknowledges at once (type 5 or 6, see planFor in
// src/interactions.ts), then does the D1 work inside ctx.waitUntil and delivers the reply through the
// interaction webhook (https://docs.discord.com/developers/interactions/receiving-and-responding):
//   PATCH /webhooks/{application_id}/{token}/messages/@original   the deferred message (type 5), or the
//                                                                  component's message (type 6 + an edit);
//   POST  /webhooks/{application_id}/{token}                       a new message after a type 6 (a follow-up).
// The interaction token is the only credential these calls need, and it is valid for 15 minutes.
//
// Never silent: an exception, or a delivery Discord refuses, logs Discord's answer and sends the polite
// ERROR_REPLY privately.
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import type { Interaction, MessageData, MessageReply } from './discord.ts';
import type { Plan } from './interactions.ts';

export const DISCORD_API = 'https://discord.com/api/v10';
export const ERROR_REPLY = 'Sorry, something went wrong on our side and GuildCraft could not answer. Please try again in a moment. If it keeps happening, tell Joegandomi.';
const DELIVERY_TIMEOUT_MS = 10_000;

type Deferred = Extract<Plan, { defer: true }>;

/** One webhook call, as the timing line records it. */
export interface Delivery {
  op: 'edit' | 'followup' | 'delete';
  status: number;
  /** Discord's error code and message on a refusal (no ids; Discord's messages name fields, not users). */
  error?: string;
}

/** The type 5 / 6 acknowledgement. A private reply's flag must be set here: Discord ignores it later. */
export function ackFor(plan: Deferred) {
  return {
    type: plan.ack,
    ...(plan.ack === InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE && plan.private ? { data: { flags: InteractionResponseFlags.EPHEMERAL } } : {}),
  };
}

const isPrivate = (data: MessageData) => ((data.flags ?? 0) & InteractionResponseFlags.EPHEMERAL) !== 0;
/** An edit cannot change visibility, so the flags field is left out of it. */
const editBody = ({ flags: _flags, ...rest }: MessageData) => rest;

async function call(i: Interaction, op: Delivery['op'], body?: unknown): Promise<Delivery> {
  const base = `${DISCORD_API}/webhooks/${i.application_id}/${i.token}`;
  const url = op === 'followup' ? base : `${base}/messages/@original`;
  const method = op === 'followup' ? 'POST' : op === 'edit' ? 'PATCH' : 'DELETE';
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    if (res.ok) return { op, status: res.status };
    const text = await res.text().catch(() => '');
    return { op, status: res.status, error: text.slice(0, 500) };
  } catch (e) {
    return { op, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sends `data` as a private message: an edit of a private deferred message, otherwise a private follow-up. */
async function sendPrivately(i: Interaction, plan: Deferred, data: MessageData, log: Delivery[]): Promise<boolean> {
  if (plan.ack === InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) {
    if (plan.private) {
      log.push(await call(i, 'edit', editBody(data)));
      return log.at(-1)!.status >= 200 && log.at(-1)!.status < 300;
    }
    // A public "thinking" message cannot become private: remove it, then answer privately.
    log.push(await call(i, 'delete'));
  }
  log.push(await call(i, 'followup', { ...data, flags: InteractionResponseFlags.EPHEMERAL }));
  return log.at(-1)!.status >= 200 && log.at(-1)!.status < 300;
}

/** Delivers a deferred reply. Returns true when Discord accepted it. */
export async function deliver(i: Interaction, plan: Deferred, reply: MessageReply, log: Delivery[]): Promise<boolean> {
  const ok = (d: Delivery) => d.status >= 200 && d.status < 300;
  if (plan.ack === InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) {
    // A private reply after a public defer would show publicly: send it privately instead. A public reply
    // after a private defer stays private (the safe direction).
    if (isPrivate(reply.data) && !plan.private) return sendPrivately(i, plan, reply.data, log);
    log.push(await call(i, 'edit', editBody(reply.data)));
    return ok(log.at(-1)!);
  }
  // Type 6: an UPDATE_MESSAGE edits the component's message; a new message is a follow-up with its own flags.
  if (reply.type === InteractionResponseType.UPDATE_MESSAGE) log.push(await call(i, 'edit', editBody(reply.data)));
  else log.push(await call(i, 'followup', reply.data));
  return ok(log.at(-1)!);
}

/** The polite private error, after an exception or a refused delivery. */
export function deliverError(i: Interaction, plan: Deferred, log: Delivery[]): Promise<boolean> {
  return sendPrivately(i, plan, { content: ERROR_REPLY, embeds: [], components: [], allowed_mentions: { parse: [] } }, log);
}

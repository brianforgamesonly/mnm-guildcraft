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
//
// Order 45: an edit whose answer never came (our 10 s abort, a network error: status 0) or a 5xx may still have
// been applied: on 2026-11-09 a Change a slot edit showed after ~10 s and the member got the error too. Such an
// edit is checked once, by reading the message back (GET @original: "Returns the initial Interaction response.
// Functions the same as Get Webhook Message", which "Returns a message object"), before the member is told it
// failed. A 4xx is a refusal and is never re-checked; a read that fails or doesn't show the edit still sends the error.
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import type { Interaction, MessageData, MessageReply } from './discord.ts';
import type { Plan } from './interactions.ts';
import { snowflakeMs } from './telemetry.ts';

export const DISCORD_API = 'https://discord.com/api/v10';
export const ERROR_REPLY = 'Sorry, something went wrong on our side and GuildCraft could not answer. Please try again in a moment. If it keeps happening, tell Joegandomi.';
export const DELIVERY_TIMEOUT_MS = 10_000;
/** Order 45: the one read-back after an unanswered edit. */
export const READ_TIMEOUT_MS = 5_000;
/** Cloudflare keeps ctx.waitUntil work for up to 30 s after the response: the edit, its read-back and the error must fit. */
export const WAIT_UNTIL_MS = 30_000;
/** Kept back from the 30 s for the timing line and the work after the reply. */
const DEADLINE_MARGIN_MS = 1_000;
/** Each call of the error reply: a public type 5 error is a delete and a follow-up, so two fit in ERROR_RESERVE_MS. */
export const ERROR_CALL_MS = 4_000;
/** Time the reply's own calls (edit, follow-up, read-back) leave before the deadline, for the error reply. */
export const ERROR_RESERVE_MS = 2 * ERROR_CALL_MS;
/** The deadline every webhook call of one deferred run shares: 30 s from when the Worker received it, less the margin. */
export const deadlineFrom = (receivedAt: number) => receivedAt + WAIT_UNTIL_MS - DEADLINE_MARGIN_MS;
/** One call's timeout: its own limit, cut to what is left before the deadline (at least 1 ms). */
export const timeoutFor = (limit: number, deadline: number, now: number) => Math.max(1, Math.min(limit, deadline - now));
/** Order 45: a read-back runs only when its own time and the error's still fit before the deadline. */
export const canReadBack = (deadline: number, now: number) => deadline - now >= READ_TIMEOUT_MS + ERROR_RESERVE_MS;
/** Message flag LOADING (1 << 7): the deferred message is still "thinking". */
const LOADING = 1 << 7;

type Deferred = Extract<Plan, { defer: true }>;

/** One webhook call, as the timing line records it. */
export interface Delivery {
  op: 'edit' | 'followup' | 'delete' | 'read';
  status: number;
  /** Discord's error code and message on a refusal (no ids; Discord's messages name fields, not users). */
  error?: string;
  /** Order 45, op read: whether the message shows the unanswered edit. */
  landed?: boolean;
}

/** No answer (status 0) or a server error: Discord may have applied it. A 4xx is a refusal. */
const unanswered = (d: Delivery) => d.status === 0 || d.status >= 500;

/** What the read-back judges: the fields of the message object it needs. */
export interface ReadBack {
  content?: string;
  edited_timestamp?: string | null;
  flags?: number;
}

/**
 * Order 45: does the message read back show the edit we sent? Its content must equal what was sent, ends trimmed
 * (Discord returns the content of messages the app sends: "Content in messages that an app sends"), and it must have
 * been edited after the interaction was created; a type 5 message, which this interaction itself created, counts once
 * it is no longer "thinking". An edit sent without content is never judged landed: time alone can't tell it from
 * another press's edit, so the member gets the error (never silent).
 */
export function editLanded(m: ReadBack, sent: { content?: unknown }, createdMs: number | null, ack: number): boolean {
  if (typeof sent.content !== 'string' || typeof m.content !== 'string' || m.content.trim() !== sent.content.trim()) return false;
  const edited = m.edited_timestamp ? Date.parse(m.edited_timestamp) : NaN;
  if (createdMs !== null && edited >= createdMs) return true;
  return ack === InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE && ((m.flags ?? 0) & LOADING) === 0;
}

const hook = (i: Interaction) => `${DISCORD_API}/webhooks/${i.application_id}/${i.token}`;

/** Order 45: one GET of @original after an unanswered edit. Logs op read; true only when it shows the edit. */
async function readBack(i: Interaction, plan: Deferred, sent: { content?: unknown }, log: Delivery[], deadline: number): Promise<boolean> {
  try {
    const res = await fetch(`${hook(i)}/messages/@original`, {
      method: 'GET',
      headers: { 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
      signal: AbortSignal.timeout(timeoutFor(READ_TIMEOUT_MS, deadline - ERROR_RESERVE_MS, Date.now())),
    });
    if (!res.ok) {
      log.push({ op: 'read', status: res.status, error: (await res.text().catch(() => '')).slice(0, 500) });
      return false;
    }
    const landed = editLanded((await res.json()) as ReadBack, sent, snowflakeMs(i.id), plan.ack);
    log.push({ op: 'read', status: res.status, landed });
    return landed;
  } catch (e) {
    log.push({ op: 'read', status: 0, error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

/**
 * Edits @original; an unanswered edit is read back once (order 45), when `check` and the time left allow it (the
 * error reply is never read back: nothing would follow it). True when the member sees the edit.
 */
async function edit(i: Interaction, plan: Deferred, data: MessageData, log: Delivery[], deadline: number, check: boolean): Promise<boolean> {
  const sent = editBody(data);
  const d = check ? await call(i, 'edit', deadline - ERROR_RESERVE_MS, sent) : await call(i, 'edit', deadline, sent, ERROR_CALL_MS);
  log.push(d);
  if (d.status >= 200 && d.status < 300) return true;
  return check && unanswered(d) && canReadBack(deadline, Date.now()) && readBack(i, plan, sent, log, deadline);
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

/**
 * Order 33: a reply with files is multipart/form-data: "Non-file parameters can be sent ... collectively as JSON in the
 * `payload_json` form field", each file as `files[n]`, and "The `attachments` JSON parameter includes all files"
 * (docs.discord.com/developers/reference, Uploading Files). fetch sets the form's own Content-Type.
 */
function encoded(body: unknown): { headers: Record<string, string>; body?: BodyInit } {
  if (body === undefined) return { headers: { 'Content-Type': 'application/json' } };
  const { files, noFiles: _noFiles, ...rest } = body as MessageData;
  if (!files?.length) return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rest) };
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ ...rest, attachments: files.map((f, id) => ({ id, filename: f.name })) }));
  files.forEach((f, n) => form.append(`files[${n}]`, new Blob([f.text], { type: f.type }), f.name));
  return { headers: {}, body: form };
}

async function call(i: Interaction, op: Exclude<Delivery['op'], 'read'>, deadline: number, body?: unknown, limit = DELIVERY_TIMEOUT_MS): Promise<Delivery> {
  const base = hook(i);
  const url = op === 'followup' ? base : `${base}/messages/@original`;
  const method = op === 'followup' ? 'POST' : op === 'edit' ? 'PATCH' : 'DELETE';
  const sent = encoded(body);
  try {
    const res = await fetch(url, {
      method,
      headers: { ...sent.headers, 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
      ...(sent.body === undefined ? {} : { body: sent.body }),
      signal: AbortSignal.timeout(timeoutFor(limit, deadline, Date.now())),
    });
    if (res.ok) return { op, status: res.status };
    const text = await res.text().catch(() => '');
    return { op, status: res.status, error: text.slice(0, 500) };
  } catch (e) {
    return { op, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Sends `data` as a private message: an edit of a private deferred message, otherwise a private follow-up. */
async function sendPrivately(i: Interaction, plan: Deferred, data: MessageData, log: Delivery[], deadline: number, check: boolean): Promise<boolean> {
  if (plan.ack === InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) {
    if (plan.private) return edit(i, plan, data, log, deadline, check);
    // A public "thinking" message cannot become private: remove it, then answer privately.
    log.push(check ? await call(i, 'delete', deadline - ERROR_RESERVE_MS) : await call(i, 'delete', deadline, undefined, ERROR_CALL_MS));
  }
  const body = { ...data, flags: InteractionResponseFlags.EPHEMERAL };
  log.push(check ? await call(i, 'followup', deadline - ERROR_RESERVE_MS, body) : await call(i, 'followup', deadline, body, ERROR_CALL_MS));
  return log.at(-1)!.status >= 200 && log.at(-1)!.status < 300;
}

/**
 * Delivers a deferred reply. Returns true when Discord accepted it, or (order 45) when an unanswered edit is read
 * back applied. `deadline` (deadlineFrom the time the Worker received the interaction) bounds every call.
 */
export async function deliver(i: Interaction, plan: Deferred, reply: MessageReply, log: Delivery[], deadline = deadlineFrom(Date.now())): Promise<boolean> {
  const ok = (d: Delivery) => d.status >= 200 && d.status < 300;
  if (plan.ack === InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE) {
    // A private reply after a public defer would show publicly: send it privately instead. A public reply
    // after a private defer stays private (the safe direction).
    if (isPrivate(reply.data) && !plan.private) return sendPrivately(i, plan, reply.data, log, deadline, true);
    return edit(i, plan, reply.data, log, deadline, true);
  }
  // Type 6: an UPDATE_MESSAGE edits the component's message; a new message is a follow-up with its own flags.
  if (reply.type === InteractionResponseType.UPDATE_MESSAGE) return edit(i, plan, reply.data, log, deadline, true);
  else {
    log.push(await call(i, 'followup', deadline - ERROR_RESERVE_MS, reply.data));
    // Order 33: Discord's documents don't say a private reply may always carry a file. If it won't, the reply still goes.
    if (!ok(log.at(-1)!) && reply.data.files?.length) {
      const { files: _files, noFiles, ...rest } = reply.data;
      log.push(await call(i, 'followup', deadline - ERROR_RESERVE_MS, { ...rest, content: noFiles ?? rest.content }));
    }
  }
  return ok(log.at(-1)!);
}

/** The polite private error, after an exception or a refused delivery. Never read back (order 45); bounded by `deadline`. */
export function deliverError(i: Interaction, plan: Deferred, log: Delivery[], deadline = deadlineFrom(Date.now())): Promise<boolean> {
  return sendPrivately(i, plan, { content: ERROR_REPLY, embeds: [], components: [], allowed_mentions: { parse: [] } }, log, deadline, false);
}

import { Hono } from 'hono';
import { InteractionType, verifyKey } from 'discord-interactions';
import type { Env } from './env.ts';
import { audit } from './access.ts';
import { deferredReply, immediateReply, planFor, type Interaction, type InteractionReply, type Plan } from './interactions.ts';
import { refreshAfterCommand, scheduled as runScheduled } from './board/refresh.ts';
import type { Effects } from './context.ts';
import { ackFor, deliver, deliverError, ERROR_REPLY, type Delivery } from './respond.ts';
import { countD1, isolateSnapshot, timingLine, type D1Call } from './telemetry.ts';
import { timersOf } from './dkp/timers.ts';

// Order 27 (override 5 of order 10): the DKP timer object's class, bound as DKP_TIMERS in each copy (wrangler.jsonc).
export { DkpTimers } from './dkp/timers.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('mnm-guildcraft: Discord interactions endpoint'));

/** The answer when the immediate path throws: autocomplete gets no suggestions, anything else the polite error. */
const fallback = (i: Interaction): InteractionReply =>
  i.type === InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE ? { type: 8, data: { choices: [] } } : { type: 4, data: { content: ERROR_REPLY, flags: 64, allowed_mentions: { parse: [] } } };

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

type Isolate = ReturnType<typeof isolateSnapshot> & { receivedAt: number };

/**
 * The deferred work, inside ctx.waitUntil (up to 30 seconds after the acknowledgement). Logs the one timing
 * line. A handler that marked board posts dirty gets them rewritten here, after its reply is delivered
 * (order 5); if that fails the posts stay dirty for the 15-minute sweep.
 */
async function runDeferred(i: Interaction, plan: Extract<Plan, { defer: true }>, env: Env, ctx: ExecutionContext, calls: D1Call[], colo: string | undefined, started: number, { receivedAt, ...isolate }: Isolate) {
  const log: Delivery[] = [];
  const effects: Effects = {};
  let err: string | null = null;
  try {
    const reply = await deferredReply(i, env, ctx, effects);
    if (!(await deliver(i, plan, reply, log))) err = 'delivery refused';
  } catch (e) {
    err = errText(e);
  }
  if (err) {
    console.error('interaction failed', err, JSON.stringify(log.filter((d) => d.error)));
    await deliverError(i, plan, log);
  }
  // Order 7: a read's audit row, after the member has the reply (it adds nothing to what they wait for).
  let audited: { action: string; ok: boolean } | undefined;
  if (effects.audit) {
    const a = effects.audit;
    try {
      await audit(env.DB, a.guildId, a.actor, a.action, a.target, null, a.detail).run();
      audited = { action: a.action, ok: true };
    } catch (e) {
      audited = { action: a.action, ok: false };
      console.error('audit write failed', a.action, errText(e));
    }
  }
  // Order 27: DKP timers, after the member has the reply (one Durable Object request each).
  try {
    if (effects.dkpCancel) await timersOf(env, effects.dkpCancel).cancel();
    if (effects.dkpTimers?.items.length) await timersOf(env, effects.dkpTimers.guildId).schedule(effects.dkpTimers.guildId, effects.dkpTimers.items);
  } catch (e) {
    console.error('dkp timers failed', errText(e));
  }
  console.log(timingLine(i, calls, colo, Date.now() - started, { ack: plan.ack, deliveries: log, err, isolate, receivedAt, audit: audited }));
  if ((effects.board || effects.factions) && i.guild_id)
    console.log(
      JSON.stringify(
        await refreshAfterCommand(env, i.guild_id, calls, { rebuild: effects.rebuild, discordCalls: effects.discordCalls, tradeskills: !!effects.board, factions: !!effects.factions }),
      ),
    );
}

app.post('/', async (c) => {
  const receivedAt = Date.now();
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  const body = await c.req.text();
  const valid =
    !!signature &&
    !!timestamp &&
    !!c.env.DISCORD_PUBLIC_KEY &&
    (await verifyKey(body, signature, timestamp, c.env.DISCORD_PUBLIC_KEY));
  if (!valid) return c.text('invalid request signature', 401);

  // Past this point the caller is Discord: never answer with a 500, always with a polite reply.
  const started = Date.now();
  const isolate = isolateSnapshot();
  const counted = countD1(c.env.DB);
  const env = { ...c.env, DB: counted.db };
  const colo = (c.req.raw.cf as { colo?: string } | undefined)?.colo;
  let interaction: Interaction = { type: 0 };
  let plan: Plan = { defer: false };
  try {
    interaction = JSON.parse(body) as Interaction;
    plan = planFor(interaction);
  } catch (err) {
    console.error('interaction failed', errText(err));
    console.log(timingLine(interaction, counted.calls, colo, Date.now() - started, { ack: null, err: errText(err), isolate, receivedAt }));
    return c.json(fallback(interaction));
  }

  // Deferred: acknowledge now (no I/O on this path), work and deliver after the response.
  if (plan.defer) {
    c.executionCtx.waitUntil(runDeferred(interaction, plan, env, c.executionCtx as ExecutionContext, counted.calls, colo, started, { ...isolate, receivedAt }));
    return c.json(ackFor(plan));
  }

  let err: string | null = null;
  try {
    return c.json(await immediateReply(interaction, env));
  } catch (e) {
    err = errText(e);
    console.error('interaction failed', err);
    return c.json(fallback(interaction));
  } finally {
    // One line per interaction (ITEM 3.1). io_ms covers D1 and network waits only (see src/telemetry.ts).
    console.log(timingLine(interaction, counted.calls, colo, Date.now() - started, { ack: null, err, isolate, receivedAt }));
  }
});

// fetch: Discord's interactions. scheduled: the one "*/15 * * * *" cron trigger (board sweep; nightly rebuild at 08:00 UTC).
export default {
  fetch: (req: Request, env: Env, ctx: ExecutionContext) => app.fetch(req, env, ctx),
  scheduled: async (controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> => {
    await runScheduled(controller, env, ctx);
  },
};

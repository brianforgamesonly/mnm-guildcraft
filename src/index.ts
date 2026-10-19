import { Hono } from 'hono';
import { verifyKey } from 'discord-interactions';
import type { Env } from './env.ts';
import { handleInteraction, NOT_YET, type Interaction } from './interactions.ts';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) => c.text('mnm-guildcraft: Discord interactions endpoint'));

app.post('/', async (c) => {
  const signature = c.req.header('X-Signature-Ed25519');
  const timestamp = c.req.header('X-Signature-Timestamp');
  const body = await c.req.text();
  const valid =
    !!signature &&
    !!timestamp &&
    !!c.env.DISCORD_PUBLIC_KEY &&
    (await verifyKey(body, signature, timestamp, c.env.DISCORD_PUBLIC_KEY));
  if (!valid) return c.text('invalid request signature', 401);

  // Past this point the caller is Discord: never answer with a 500, always with a polite ephemeral reply.
  try {
    return c.json(handleInteraction(JSON.parse(body) as Interaction));
  } catch (err) {
    console.error('interaction failed', err instanceof Error ? err.message : String(err));
    return c.json({ type: 4, data: { content: NOT_YET, flags: 64 } });
  }
});

export default app;

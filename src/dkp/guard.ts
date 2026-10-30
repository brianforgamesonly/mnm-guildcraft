// Order 30 (ITEM 4): a guild with DKP on always has exactly one decay item. The one function that ensures it is
// DkpTimers.ensureDecay; this file finds the guilds to call it on: once a day from the cron (a Durable Object with no
// alarm and no presses never wakes, so nothing inside it can notice the item is missing) and after a deploy, through the
// Worker's signed route (a GitHub runner cannot reach a Durable Object). It must stay free of `cloudflare:workers`:
// src/board/refresh.ts imports it, and the board job runs that file in Node.
//
// The route needs no new credential: both ends already hold the copy's bot token, and only an HMAC of the request goes
// over the wire. It reports counts only (the public Actions log): no guild id.
import type { Env } from '../env.ts';

export const DKP_ON_SQL = 'SELECT guild_id FROM dkp_guild WHERE enabled = 1 ORDER BY guild_id';
export const GUARD_PATH = '/ops/decay-guard';
/** The cron's daily slot: the 15-minute trigger at 09:00 UTC, after the 08:00 board run and the 08:15 departures. */
export const DECAY_GUARD_HOUR_UTC = 9;
export const isDecayGuardRun = (scheduledTime: number) => {
  const d = new Date(scheduledTime);
  return d.getUTCHours() === DECAY_GUARD_HOUR_UTC && d.getUTCMinutes() < 15;
};
/** Guilds one request of the route checks: under the 40-call cap (order 5), counting a Durable Object call as one. */
export const GUARD_PER_REQUEST = 39;
/** How old a signed request may be. */
const SIGNATURE_MS = 300_000;

export type EnsureResult = 'kept' | 'added' | 'would-add' | 'off' | 'failed';

export interface GuardResult {
  /** Guilds with DKP on in this copy's D1. */
  guilds: number;
  checked: number;
  counts: Record<EnsureResult, number>;
}

/** Calls ensureDecay on the DKP-on guilds `pick` chooses, one Durable Object request each. One guild's failure stops nothing. */
export async function guardDecay(env: Pick<Env, 'DB' | 'DKP_TIMERS'>, pick: (ids: string[]) => string[], dry = false): Promise<GuardResult> {
  const { results } = await env.DB.prepare(DKP_ON_SQL).all<{ guild_id: string }>();
  const ids = results.map((r) => r.guild_id);
  const chosen = pick(ids);
  const counts: Record<EnsureResult, number> = { kept: 0, added: 0, 'would-add': 0, off: 0, failed: 0 };
  for (const g of chosen) {
    try {
      counts[await env.DKP_TIMERS.get(env.DKP_TIMERS.idFromName(g)).ensureDecay(g, dry)]++;
    } catch (e) {
      console.error('dkp decay guard failed', e instanceof Error ? e.message : String(e));
      counts.failed++;
    }
  }
  return { guilds: ids.length, checked: chosen.length, counts };
}

/** The cron's pick: at most `limit`, starting further along each day, so every guild is reached when they don't all fit. */
export const rotate = (limit: number, scheduledTime: number) => (ids: string[]) => {
  if (ids.length <= limit) return ids;
  const start = (Math.floor(scheduledTime / 86_400_000) * limit) % ids.length;
  return [...ids.slice(start), ...ids.slice(0, start)].slice(0, limit);
};

const bytes = (s: string) => new TextEncoder().encode(s);
const hmacKey = (token: string, use: 'sign' | 'verify') => crypto.subtle.importKey('raw', bytes(token), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);
const signed = (time: number, dry: boolean, offset: number) => `decay-guard:${time}:${dry ? 1 : 0}:${offset}`;

/** The route's signature (seconds since the epoch, the dry flag and the page, under the copy's bot token), as hex. */
export async function signGuard(token: string, time: number, dry: boolean, offset: number): Promise<string> {
  const mac = await crypto.subtle.sign('HMAC', await hmacKey(token, 'sign'), bytes(signed(time, dry, offset)));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** crypto.subtle.verify, so the comparison takes the same time whatever the guess. */
export async function verifyGuard(token: string, time: number, dry: boolean, offset: number, signature: string, nowMs: number): Promise<boolean> {
  if (!Number.isFinite(time) || Math.abs(nowMs - time * 1000) > SIGNATURE_MS || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const mac = Uint8Array.from(signature.match(/../g)!, (h) => parseInt(h, 16));
  return crypto.subtle.verify('HMAC', await hmacKey(token, 'verify'), mac, bytes(signed(time, dry, offset)));
}

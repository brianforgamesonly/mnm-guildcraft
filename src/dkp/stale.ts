// Order 33 (ITEM 1): a card Discord would not take is put right later. Nothing drops a card edit any more: a failed edit
// marks the card out of date (card_stale, migrations/0025), the 15-minute cron finds the flag and asks that guild's timer
// object to redraw it from its current rows, and that goes on until Discord accepts it. Each guild's object does its own
// redraws (src/dkp/timers.ts), so no one run nears the 50 subrequests. The cron pays one D1 read when nothing is out of date
// and makes no Discord call of its own. It must stay free of `cloudflare:workers`: src/board/refresh.ts imports it, and the
// board job runs that file in Node.
//
// Discord's answers that end it (docs.discord.com/developers/topics/opcodes-and-status-codes): 10003 "Unknown channel", 10008
// "Unknown message", 50001 "Missing access". Retrying can't help, so they stop the retries and are recorded. A 429 waits for
// its retry_after ("The number of seconds to wait before submitting another request", /topics/rate-limits).
import { audit } from '../access.ts';
import { MISSING_ACCESS, UNKNOWN_CHANNEL, UNKNOWN_MESSAGE, type ApiResult } from '../board/api.ts';
import type { Env } from '../env.ts';

/** The timer items that draw a card. Each draws from the current rows, so running one late is always right. */
export const CARD_KINDS = ['render', 'acard', 'scard', 'evcard'] as const;
export const isCardItem = (key: string) => (CARD_KINDS as readonly string[]).includes(key.split(':')[0]);
const STOPS: readonly number[] = [UNKNOWN_CHANNEL, UNKNOWN_MESSAGE, MISSING_ACCESS];

type Refused = Extract<ApiResult<unknown>, { ok: false }>;

/** Discord didn't take this edit, and might later. A timer item's retries catch it; `waitMs` is a 429's retry_after. */
export class CardEditRefused extends Error {
  readonly status: number;
  readonly code: number | null;
  readonly waitMs: number | null;
  constructor(r: Pick<Refused, 'status' | 'code' | 'retryMs'>) {
    super(`card edit refused: ${r.status}`);
    this.status = r.status;
    this.code = r.code ?? null;
    this.waitMs = r.retryMs ?? null;
  }
}

/** Marks a card out of date; the first answer's `since` stays. */
export const markStale = (db: D1Database, guildId: string, item: string, r: { status: number; code?: number | null }) =>
  db
    .prepare('INSERT INTO card_stale (guild_id, item, since, status, code) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (guild_id, item) DO UPDATE SET status = ?4, code = ?5')
    .bind(guildId, item, new Date().toISOString(), r.status, r.code ?? null);

export const clearStale = (db: D1Database, guildId: string, item: string) => db.prepare('DELETE FROM card_stale WHERE guild_id = ? AND item = ?').bind(guildId, item);

/**
 * A refused edit's one decision: 10003, 10008 and 50001 end the card's retries, recorded in the audit log; anything else
 * throws CardEditRefused, for the timer item's retries (or editCard's flag).
 */
export async function cardRefused(db: D1Database, guildId: string, item: string, r: Refused): Promise<void> {
  if (r.code === undefined || !STOPS.includes(r.code)) throw new CardEditRefused(r);
  await db.batch([clearStale(db, guildId, item), audit(db, guildId, 'bot', 'card.stopped', item, null, { status: r.status, code: r.code })]);
}

/** Cards out of date, for servers that can act on them: while the Events module is off, its evcard items do nothing. */
export const STALE_SQL = `SELECT c.guild_id, c.item FROM card_stale c
  WHERE c.item NOT LIKE 'ev%' OR EXISTS (SELECT 1 FROM event_guild g WHERE g.guild_id = c.guild_id AND g.enabled = 1)
  ORDER BY c.guild_id LIMIT 500`;
/** Guilds one cron run asks: one Durable Object request each, counted against the run's 40 calls. */
export const STALE_GUILDS = 8;

/** The cron's part: finds the flags, and hands each guild its items. Its object draws them, on its own invocations. */
export async function sweepStale(env: Pick<Env, 'DB' | 'DKP_TIMERS'>, pick: (ids: string[]) => string[]): Promise<{ cards: number; guilds: number; asked: number }> {
  const { results } = await env.DB.prepare(STALE_SQL).all<{ guild_id: string; item: string }>();
  const byGuild = new Map<string, string[]>();
  for (const r of results) byGuild.set(r.guild_id, [...(byGuild.get(r.guild_id) ?? []), r.item]);
  const chosen = pick([...byGuild.keys()]);
  const due = Date.now();
  for (const g of chosen) {
    try {
      await env.DKP_TIMERS.get(env.DKP_TIMERS.idFromName(g)).schedule(g, byGuild.get(g)!.map((key) => ({ key, due, stale: true })));
    } catch (e) {
      console.error('stale card sweep failed', e instanceof Error ? e.message : String(e));
    }
  }
  return { cards: results.length, guilds: byGuild.size, asked: chosen.length };
}

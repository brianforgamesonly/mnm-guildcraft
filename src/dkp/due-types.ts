// Order 32: the timer item's handler shape, apart from src/dkp/due.ts so the Events handlers can share it.
import type { BotApi } from '../board/api.ts';
import type { Env } from '../env.ts';

export interface DueResult {
  /** Run this item again at this time (it was not due yet). */
  again?: number;
  /** Other items to set (a card edit after a window closes). */
  schedule?: { key: string; due: number }[];
  /** Discord's rate-limit headers on the card edit, for the pace of the next one (src/dkp/pace.ts). */
  headers?: { remaining?: string | null; resetAfter?: string | null; retryAfter?: number | null } | null;
  /** Order 33: this card item drew nothing, so an out-of-date card stays flagged. */
  skip?: boolean;
}
/** `stale`: the sweep's redraw of an out-of-date card (src/dkp/stale.ts). */
export type DueHandler = (env: Env, guildId: string, id: string, due: number, now: number, api: BotApi | null, stale?: boolean) => Promise<DueResult | null>;

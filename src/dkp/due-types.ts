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
/** About 40 external calls an invocation (order 5), D1 and Discord together; shared by every item one alarm runs. */
export const TIMER_CALL_CAP = 40;

/** What the object keeps for an item across its runs. */
export interface ItemRun {
  /** The sweep's redraw of an out-of-date card (src/dkp/stale.ts). */
  stale?: boolean;
  /** Order 33: how far a chunked send has got, as `save` left it. */
  cursor?: string;
  /** Stores the cursor at once, so a run that dies part-way never messages anyone twice. */
  save?: (cursor: string) => Promise<void>;
  /** Sets other items now, not with the result: what a committed write owes survives this run dying. */
  schedule?: (items: { key: string; due: number }[]) => Promise<void>;
}
export type DueHandler = (env: Env, guildId: string, id: string, due: number, now: number, api: BotApi | null, run?: ItemRun) => Promise<DueResult | null>;

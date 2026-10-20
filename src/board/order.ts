// The board's A→Z order (order 6, ITEM 1.1). Discord has no alphabetical forum sort. With the forum's
// default sort set to creation date ("from most recent to oldest"), the posts show A→Z from the top when
// they were created Z→A. Nothing here is stored: the order is read from the thread ids, which are
// snowflakes carrying their creation time (docs.discord.com/developers/reference, "Snowflakes").
import { byName } from '../collation.ts';

const DISCORD_EPOCH = 1420070400000n;

/** A snowflake's creation time, epoch ms. */
export const snowflakeMs = (id: string): number => Number((BigInt(id) >> 22n) + DISCORD_EPOCH);

/** The smallest snowflake created at or after `ms`: every id created later compares greater. */
export const snowflakeAt = (ms: number): bigint => (BigInt(Math.floor(ms)) - DISCORD_EPOCH) << 22n;

/** The tradeskills in display order (A→Z): the reverse of the order their posts are created in. */
export const displayOrder = <T extends { id: number; name: string }>(skills: T[]): T[] => [...skills].sort(byName);

/**
 * Whether the posts that exist show A→Z under a creation-date sort: walking the tradeskills A→Z, each
 * post's thread must be older than the one before it. Tradeskills without a post are skipped (the board
 * then also shows fewer posts than tradeskills); the pinned index is not part of the order.
 */
export function boardInOrder(skills: { id: number; name: string }[], threadOf: (tradeskillId: number) => string | null | undefined): boolean {
  let prev: bigint | null = null;
  for (const t of displayOrder(skills)) {
    const thread = threadOf(t.id);
    if (!thread) continue;
    const id = BigInt(thread);
    if (prev !== null && id >= prev) return false;
    prev = id;
  }
  return true;
}

/** The /guildcraft status line, in both states. */
export const boardOrderLine = (inOrder: boolean) => (inOrder ? '**Board order:** A→Z' : '**Board order:** out of order — run `/guildcraft rebuild-board`');

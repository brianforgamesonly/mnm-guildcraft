// Order 27 (ITEM 3): how often a raid card is edited. A tap answers its presser at once (a private follow-up) and asks for
// one card edit; edits are coalesced on the guild's timer object to at most one per interval, and the interval comes from
// Discord's own answers to the card's previous edit, never from a typed limit ("should not be hard coded"; the headers
// "X-RateLimit-Remaining: The number of remaining requests that can be made" and "X-RateLimit-Reset-After: Total time (in
// seconds) of when the current rate limit bucket will reset", docs.discord.com/developers/topics/rate-limits, read
// 2026-10-29). The bucket's remaining edits are spread over the time left in it; at 0, nothing is sent before the reset.

/** Before any edit has been answered: one edit every 2 seconds. */
export const DEFAULT_GAP_MS = 2_000;
/** Never closer than this, whatever the headers allow: one edit carries every tap since the last. */
export const MIN_GAP_MS = 1_000;

export interface Pace {
  /** When the last edit was sent (epoch ms), or null. */
  last: number | null;
  /** The spacing the last answer allows. */
  gap: number;
  /** No edit before this (the bucket is spent until its reset). */
  blockedUntil: number;
}

export const START: Pace = { last: null, gap: DEFAULT_GAP_MS, blockedUntil: 0 };

/** When the next edit may go, for a tap at `at`. */
export const nextEditAt = (p: Pace, at: number): number => Math.max(at, p.last === null ? at : p.last + p.gap, p.blockedUntil);

/** The pace after an edit sent at `at`, from its answer's headers (or a 429's retry_after, in seconds). */
export function afterEdit(p: Pace, at: number, h: { remaining?: string | null; resetAfter?: string | null; retryAfter?: number | null }): Pace {
  const resetMs = Number(h.resetAfter) * 1000;
  const remaining = h.remaining === null || h.remaining === undefined || h.remaining === '' ? NaN : Number(h.remaining);
  if (h.retryAfter !== null && h.retryAfter !== undefined && Number.isFinite(h.retryAfter)) return { last: at, gap: Math.max(p.gap, MIN_GAP_MS), blockedUntil: at + h.retryAfter * 1000 };
  if (!Number.isFinite(remaining) || !Number.isFinite(resetMs)) return { ...p, last: at };
  if (remaining <= 0) return { last: at, gap: Math.max(MIN_GAP_MS, resetMs), blockedUntil: at + resetMs };
  return { last: at, gap: Math.max(MIN_GAP_MS, Math.ceil(resetMs / remaining)), blockedUntil: 0 };
}

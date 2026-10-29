// Order 27 (ITEM 3): twenty taps in ten seconds never trip a 429. Each tap asks for a card edit at nextEditAt; requests
// already waiting coalesce into one edit. A simulated Discord bucket answers each edit with its headers (a fixed window of
// `limit` edits per `windowMs`, as X-RateLimit-* describe it) and refuses with 429 past its limit. Several bucket sizes,
// since Discord publishes none for message edits.
import { describe, expect, it } from 'vitest';
import { afterEdit, DEFAULT_GAP_MS, nextEditAt, START, type Pace } from '../../src/dkp/pace.ts';

function simulate(limit: number, windowMs: number, taps: number[], naive = false) {
  let pace: Pace = START;
  let windowStart = -Infinity;
  let used = 0;
  let pending: number | null = null;
  const edits: number[] = [];
  let refused = 0;
  const lag: number[] = [];
  let waiting: number[] = [];
  const events = [...taps];
  const edit = (at: number) => {
    if (at >= windowStart + windowMs) {
      windowStart = at;
      used = 0;
    }
    if (used >= limit) {
      refused++;
      pace = afterEdit(pace, at, { retryAfter: (windowStart + windowMs - at) / 1000 });
      return;
    }
    used++;
    edits.push(at);
    lag.push(...waiting.map((t) => at - t));
    waiting = [];
    pace = afterEdit(pace, at, { remaining: String(limit - used), resetAfter: String((windowStart + windowMs - at) / 1000) });
  };
  for (;;) {
    const tap = events[0];
    if (pending !== null && (tap === undefined || pending <= tap)) {
      const at = pending;
      pending = null;
      edit(at);
      if (waiting.length) pending = nextEditAt(pace, at);
      continue;
    }
    if (tap === undefined) break;
    events.shift();
    waiting.push(tap);
    const want = naive ? tap : nextEditAt(pace, tap);
    if (pending === null || want < pending) pending = want;
  }
  return { edits, refused, maxLag: Math.max(...lag), allShown: lag.length === taps.length };
}

describe('raid card edits are coalesced from the X-RateLimit headers', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => i * 500);
  for (const [limit, windowMs] of [[5, 5_000], [5, 2_000], [1, 1_000], [3, 10_000], [50, 1_000]] as const)
    it(`20 taps in 10 s, a bucket of ${limit} per ${windowMs / 1000} s: no 429, every tap shown`, () => {
      const r = simulate(limit, windowMs, twenty);
      expect(r.refused).toBe(0);
      expect(r.allShown).toBe(true);
      // The card shows a tap within one window of the bucket (or the default gap).
      expect(r.maxLag).toBeLessThanOrEqual(Math.max(windowMs, DEFAULT_GAP_MS));
    });

  it('a control: editing on every tap, as the simulated bucket sees it, trips 429s (so the zero above is measured)', () => {
    expect(simulate(5, 5_000, twenty, true).refused).toBeGreaterThan(0);
  });

  it('the first tap is shown at once; a 429 (if Discord ever sends one) holds edits until its retry_after', () => {
    expect(nextEditAt(START, 1000)).toBe(1000);
    const held = afterEdit(START, 1000, { retryAfter: 3 });
    expect(nextEditAt(held, 1500)).toBe(4000);
  });
});

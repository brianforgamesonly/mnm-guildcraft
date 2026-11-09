// Order 43 (Brian, 2026-11-08): a filter on one slot's upgrade list, by minimum AC and (weapon slots) minimum ratio.
//
// - A filter only removes candidates; it never changes a score, a gain or the order (docs/ORDER-RULES.md, "Order 43").
// - A missing stat never passes a floor: AC is v's AC (0 when missing or recorded as 0, and either fails a floor above 0);
//   the ratio is the item's exact item.ratio (NULL when damage or delay is missing), never v's rounded RATIO.
// - The list's state (the cap and the floors) travels in one custom_id segment, written by listState and read by
//   listFilter, and every control of the slot list keeps it (src/gear/upgrades.ts).
import { MIN_AC_MAX, MIN_RATIO_MAX } from './options.ts';
import { WEIGHT_KEYS, type GearItem } from './score.ts';
import { WEAPON_TOKENS, type SlotToken } from './slots.ts';

/** The list's state: a level cap (null: none), a minimum AC (null: none) and a minimum ratio in thousandths (null: none). */
export interface ListFilter {
  cap: number | null;
  minAc: number | null;
  minRatio: number | null;
}
export const NO_FILTER: ListFilter = { cap: null, minAc: null, minRatio: null };

/**
 * The state as one segment: "c", then the cap's level, then "a<AC>", then "r<ratio × 1000>", each only when set:
 * c · c30 · ca20 · c30a20r450. Order 36 follow-up's "c" and "c<level>" are this format with no floors.
 */
export const listState = (f: ListFilter) => `c${f.cap ?? ''}${f.minAc !== null ? `a${f.minAc}` : ''}${f.minRatio !== null ? `r${f.minRatio}` : ''}`;

const STATE = /^c(\d+)?(?:a(\d+))?(?:r(\d+))?$/;
/**
 * The one reader of the segment. Anything else (a window number from before the cap, a missing segment) is no cap and no
 * filter (order 18: old controls keep working). A floor of 0, or one out of range, is no floor.
 */
export function listFilter(s: string | undefined): ListFilter {
  const m = s ? STATE.exec(s) : null;
  if (!m) return NO_FILTER;
  const floor = (x: string | undefined, max: number) => (x === undefined || Number(x) === 0 || Number(x) > max ? null : Number(x));
  return { cap: m[1] !== undefined ? Number(m[1]) : null, minAc: floor(m[2], MIN_AC_MAX), minRatio: floor(m[3], MIN_RATIO_MAX * 1000) };
}

/** Whether any floor is set (the cap alone is not a filter). */
export const isFiltered = (f: ListFilter) => f.minAc !== null || f.minRatio !== null;

/** The slots that take a Minimum ratio: by token alone (Primary, Secondary, Range), never by the class preset. */
export const takesRatio = (token: SlotToken) => WEAPON_TOKENS.includes(token);

/** The filter a slot's list applies: a ratio floor only on a weapon slot. */
export const forSlot = (f: ListFilter, token: SlotToken): ListFilter => (takesRatio(token) || f.minRatio === null ? f : { ...f, minRatio: null });

const AC_I = WEIGHT_KEYS.indexOf('AC');
/**
 * Which floor an item fails first ('ac', then 'ratio'), or null when it passes both. A floor in thousandths is compared as
 * ratio >= floor / 1000: both sides are the nearest double to their exact value, so a ratio equal to the floor passes and one
 * below it (0.4499 against 0.450) fails.
 */
export function floorMiss(it: Pick<GearItem, 'v' | 'ratio'>, f: ListFilter): 'ac' | 'ratio' | null {
  if (f.minAc !== null && !(it.v[AC_I] >= f.minAc)) return 'ac';
  if (f.minRatio !== null && !(it.ratio !== null && it.ratio >= f.minRatio / 1000)) return 'ratio';
  return null;
}

/** A ratio in thousandths as shown: "0.450". */
export const showRatio = (thousandths: number) => (thousandths / 1000).toFixed(3);

/** A typed Minimum AC: empty is no floor; a whole number from 0 to MIN_AC_MAX (0: no floor); anything else is refused. */
export function parseAc(typed: string): { ok: true; value: number | null } | { ok: false } {
  const t = typed.trim();
  if (!t) return { ok: true, value: null };
  if (!/^\d{1,4}$/.test(t) || Number(t) > MIN_AC_MAX) return { ok: false };
  return { ok: true, value: Number(t) || null };
}

/** A typed Minimum ratio: empty is no floor; 0 to MIN_RATIO_MAX with up to 3 decimals (0: no floor); else refused. */
export function parseRatio(typed: string): { ok: true; value: number | null } | { ok: false } {
  const t = typed.trim();
  if (!t) return { ok: true, value: null };
  if (!/^(\d{1,2}(\.\d{0,3})?|\.\d{1,3})$/.test(t) || Number(t) > MIN_RATIO_MAX) return { ok: false };
  return { ok: true, value: Math.round(Number(t) * 1000) || null };
}

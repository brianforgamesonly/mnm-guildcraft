// The one name collation (order 6, ITEM 1.1): SQLite's NOCASE, everywhere a list of names is ordered.
// NOCASE folds ASCII A–Z only, then compares binary (UTF-8 bytes, which is code point order). JS's
// localeCompare and toLowerCase fold far more, so they would order some names differently from SQL; this
// comparator does exactly what NOCASE does. Ties (names equal under NOCASE) are broken by id, in SQL too.

/** The SQL side: `ORDER BY ${NAME_ORDER}` for a table with name and id columns. */
export const NAME_ORDER = 'name COLLATE NOCASE, id';

const fold = (s: string) => s.replace(/[A-Z]/g, (c) => c.toLowerCase());

/** SQLite NOCASE: ASCII case folded, then code point order. */
export function nocase(a: string, b: string): number {
  const x = fold(a);
  const y = fold(b);
  if (x === y) return 0;
  const xs = [...x];
  const ys = [...y];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const d = xs[i].codePointAt(0)! - ys[i].codePointAt(0)!;
    if (d) return d < 0 ? -1 : 1;
  }
  return xs.length < ys.length ? -1 : 1;
}

/** NOCASE, then id: the same order as `ORDER BY ${NAME_ORDER}`. */
export const byName = <T extends { id: number; name: string }>(a: T, b: T) => nocase(a.name, b.name) || a.id - b.id;

// Order 17: how a zone name becomes its key, and how a level text sorts. Shared by the import (scripts/import/zones.ts)
// and the Worker (/zone, /gear find's zone option), so a typed name and a stored one meet by the same rule.

/** U+2018 and U+2019, the curly apostrophes (by code point: the copy rules keep curly quotes out of src/). */
const CURLY = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, 'g');
/** The only two normalisations allowed (order 17, section D): case, and curly to straight apostrophes. */
export const zoneKey = (name: string): string => name.replace(CURLY, "'").toLowerCase();

/** The first whole number in a level text ("~36-37" → 36, "< 20" → 20); null when it holds none. The sort key only. */
export function levelSort(level: string | null | undefined): number | null {
  const m = /\d+/.exec(level ?? '');
  return m ? Number(m[0]) : null;
}

/** The mapping's sources (zone_name.source) the Worker reads: items' wikiZones and the mobs' zones. */
export const WIKI_ZONES_SOURCE = 'mnm-tools:wikiZones';
export const MOB_ZONES_SOURCE = 'mnm-tools:mobs';

/**
 * The names a source uses for a zone, as an uncorrelated subquery: SQLite reads it once per statement. (Order 17,
 * measured locally on the real data: a JOIN to zone_name inside the per-row EXISTS re-read the source's mapping for
 * every item, 71,380 rows_read for one card's drops.)
 */
export const zoneNamesSql = (source: string, param = '?1') =>
  `(SELECT name FROM zone_name WHERE source = '${source}' AND zone_key = ${param} AND active = 1)`;

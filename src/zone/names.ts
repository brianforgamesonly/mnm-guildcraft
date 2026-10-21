// Order 17: how a zone name becomes its key, and how a level text sorts. Shared by the import (scripts/import/zones.ts)
// and the Worker (/zone, /gear find's zone option), so a typed name and a stored one meet by the same rule.

/** The only two normalisations allowed (order 17, section D): case, and curly to straight apostrophes. */
export const zoneKey = (name: string): string => name.replace(/[‘’]/g, "'").toLowerCase();

/** The first whole number in a level text ("~36-37" → 36, "< 20" → 20); null when it holds none. The sort key only. */
export function levelSort(level: string | null | undefined): number | null {
  const m = /\d+/.exec(level ?? '');
  return m ? Number(m[0]) : null;
}

/** The mapping's sources (zone_name.source) the Worker reads: items' wikiZones and the mobs' zones. */
export const WIKI_ZONES_SOURCE = 'mnm-tools:wikiZones';
export const MOB_ZONES_SOURCE = 'mnm-tools:mobs';

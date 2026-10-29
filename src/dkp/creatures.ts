// Order 27: a raid zone's creatures for Named killed and /dkp kill: the union of the zone's mobs (mnm-tools, through the
// zone_name mapping, as the zone card reads them) and its NPCs (Mo Betta), deduplicated by case-insensitive name, without
// merchants (npc.kind). Order 27's override 6 of order 4's "Game meaning is never inferred from item names", as a display
// order only (approved by the owner, 2026-10-29): names that don't start with "a " or "an " (case-insensitive) first, then
// the rest, each part A→Z. Nothing is stored or labelled "named"; every creature stays selectable. One statement.
import { MOB_ZONES_SOURCE, zoneNamesSql } from '../zone/names.ts';

/** The statement, for a zone key given as an SQL expression (a parameter, or the open raid's pool). */
export const creaturesSql = (zone: string) => `WITH c AS (
  SELECT title AS name FROM mob WHERE active = 1 AND EXISTS (SELECT 1 FROM json_each(mob.zones_json) j WHERE j.value IN ${zoneNamesSql(MOB_ZONES_SOURCE, zone)})
  UNION ALL
  SELECT name FROM npc WHERE zone_key = ${zone} AND active = 1 AND coalesce(lower(kind), '') <> 'merchant')
SELECT min(name) AS name FROM c GROUP BY lower(name)
ORDER BY (lower(min(name)) LIKE 'a %' OR lower(min(name)) LIKE 'an %'), lower(min(name))`;

export const CREATURES_SQL = creaturesSql('?1');
/** /dkp kill named: the open raid's zone (?1: the guild), one statement per keystroke. */
export const OPEN_RAID_CREATURES_SQL = creaturesSql('(SELECT pool FROM dkp_raid WHERE guild_id = ?1 AND closed_at IS NULL)');

export async function zoneCreatures(db: D1Database, zoneKey: string): Promise<string[]> {
  return (await db.prepare(CREATURES_SQL).bind(zoneKey).all<{ name: string }>()).results.map((r) => r.name);
}

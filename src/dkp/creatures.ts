// Order 27: a raid zone's creatures for Named killed and /dkp kill: the union of the zone's mobs (mnm-tools, through the
// zone_name mapping, as the zone card reads them) and its NPCs (the wiki), deduplicated by case-insensitive name, without
// merchants (npc.kind). Order 28's override 4 of order 27's override 6: the order comes from the wiki's own tags
// (npc.raid and npc.named, migrations/0022, from Category:Raid Encounters and Category:Named Mobs): raid encounters,
// then named mobs, then other creatures, each part A→Z. Nothing is inferred from a name; mob rows carry no tag, so a
// creature is tagged when any NPC row of that name in the zone is. Every creature stays selectable. One statement.
import { MOB_ZONES_SOURCE, zoneNamesSql } from '../zone/names.ts';

/** Which part of the list a creature sits in: the wiki's tags, never its name. */
export type CreaturePart = 'raid' | 'named' | 'other';
export interface Creature {
  name: string;
  part: CreaturePart;
}

/** The statement, for a zone key given as an SQL expression (a parameter, or the open raid's pool). */
export const creaturesSql = (zone: string) => `WITH c AS (
  SELECT title AS name, 0 AS raid, 0 AS named FROM mob WHERE active = 1 AND EXISTS (SELECT 1 FROM json_each(mob.zones_json) j WHERE j.value IN ${zoneNamesSql(MOB_ZONES_SOURCE, zone)})
  UNION ALL
  SELECT name, coalesce(raid, 0), coalesce(named, 0) FROM npc WHERE zone_key = ${zone} AND active = 1 AND coalesce(lower(kind), '') <> 'merchant')
SELECT min(name) AS name, CASE WHEN max(raid) = 1 THEN 'raid' WHEN max(named) = 1 THEN 'named' ELSE 'other' END AS part
FROM c GROUP BY lower(name)
ORDER BY max(raid) DESC, max(named) DESC, lower(min(name))`;

export const CREATURES_SQL = creaturesSql('?1');
/** /dkp kill named: the open raid's zone (?1: the guild), one statement per keystroke. */
export const OPEN_RAID_CREATURES_SQL = creaturesSql('(SELECT pool FROM dkp_raid WHERE guild_id = ?1 AND closed_at IS NULL)');

export async function zoneCreatures(db: D1Database, zoneKey: string): Promise<Creature[]> {
  return (await db.prepare(CREATURES_SQL).bind(zoneKey).all<Creature>()).results;
}

-- Order 35, PR B (gear upgrades, part 1; docs/PRD.md "Gear upgrades"), named schema departures from docs/PRD-schema.sql.
--
-- character.race: the character's race, optional: a game_race code (not a mount race), or NULL = any race.
-- character_gear: saved gear, one row per filled slot (src/gear/wear.ts WEAR_SLOTS keys). It names the item by
--   item.name_key (the import's stable key), never item.id, and holds no foreign key to item, so no cascade can reach
--   it and an import never removes it (an item gone upstream is flagged, item.gone_at). It never copies stats.
--   set_by: who made the change (the member, or the officer acting for them). Written only when a slot changes; its
--   rows go with the character (Remove character, /officer remove-member, the departure notice's Remove).
--   character_id names character (created before this table: order 34's foreign-key rule).

ALTER TABLE character ADD COLUMN race TEXT;

CREATE TABLE character_gear (
character_id INTEGER NOT NULL REFERENCES character(id),
guild_id TEXT NOT NULL,
slot TEXT NOT NULL,
item_key TEXT NOT NULL,
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (character_id, slot)
) WITHOUT ROWID;

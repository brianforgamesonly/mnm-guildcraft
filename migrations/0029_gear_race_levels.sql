-- Order 35 (gear upgrades, part 1; docs/PRD.md "Gear upgrades"), named schema departures from docs/PRD-schema.sql.
--
-- game_race: the game's races, derived from items' race tokens at import time (scripts/import/core.ts deriveRaces), built
--   the way game_class is: item_count 0 = no longer kept (deactivated, never deleted); bit = the race's bit in
--   item.race_mask, assigned once (next free bit) and never reused. mount = 1 when every item carrying the race fits only
--   mount slots (src/gear/vocab.ts MOUNT_SLOTS): such races are never offered for characters. name: NULL, because the data
--   holds race codes only ("HUM", "DEF"); nothing is invented.
-- Derived item columns, rewritten on every import from data already held (order 13's override 3, as order 35 extends it):
--   race_mask:   bit game_race.bit for each kept race token; -1 (every bit) for ALL in any case; 0 = no race recorded.
--   level_low, level_high, level_kind, level_kinds: the item's level (scripts/import/levels.ts), for gear (slot_mask <> 0)
--     only. level_low NULL = no level; level_high NULL = open-ended or none; level_kind the primary kind; level_kinds
--     every kind that applies, primary first. NULL kind = not worked out (not gear, or new on a night the zone data was kept).
-- item.gone_at: when the source stopped listing the item; NULL while listed. The import never deletes an item (saved gear
--   names items by name_key); it sets this, and clears it when the item is listed again.
-- No new index: nothing reads these columns by range yet (part 2 decides), and each index would add a write per changed row.

CREATE TABLE game_race (
code TEXT PRIMARY KEY,
name TEXT,
item_count INTEGER NOT NULL,
bit INTEGER CHECK (bit BETWEEN 0 AND 30),
mount INTEGER NOT NULL DEFAULT 0 CHECK (mount IN (0, 1))
);
CREATE UNIQUE INDEX game_race_bit ON game_race(bit) WHERE bit IS NOT NULL;

ALTER TABLE item ADD COLUMN race_mask INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN level_low INTEGER;
ALTER TABLE item ADD COLUMN level_high INTEGER;
ALTER TABLE item ADD COLUMN level_kind TEXT;
ALTER TABLE item ADD COLUMN level_kinds TEXT;
ALTER TABLE item ADD COLUMN gone_at TEXT;

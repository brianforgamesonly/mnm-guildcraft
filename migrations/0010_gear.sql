-- Order 13 (gear finder), named schema departures from docs/PRD-schema.sql.
--
-- Generated columns on item (order 13, override 3: they duplicate nothing by hand; each reads stats_json). VIRTUAL, so
-- adding them writes no rows. Each has a partial index over the items that carry it.
--   ac, dmg, delay, skill (weapon type code), handed: one JSON path each.
--   ratio: dmg / delay, NULL when either is missing or not above 0 (a generated column from two paths; named here).
-- Derived columns rewritten on every import (override 3's three permitted ones), scripts/import/core.ts itemMasks:
--   class_mask:  bit game_class.bit for each recognised class token; -1 (every bit) for ALL; 0 for none or NONE.
--   slot_mask:   bit i for each slot token SLOTS[i] (src/gear/vocab.ts). 0 = not gear.
--   source_mask: bit i for each source SOURCES[i]; REMOVED_BIT for the wiki's "Removed Items" category (not a source;
--                held here so /gear find's exclusion is read from the index).
-- item.origin_json: the source's from (mob names), wikiZones, soldBy ({base, shady, vendors} as recorded) and categories.
-- game_class.bit: the class's bit in class_mask, assigned once (next free bit) and never reused, so a new class never
--   rewrites other items' masks. NULL for a code that was never kept.
-- mob: the source's mobs section (order 13, override 1), deactivated (active = 0) when it disappears upstream.
--   zones_json: zone names, wiki markup stripped to link text and comma lists split. loot_json: as recorded.

ALTER TABLE item ADD COLUMN ac INTEGER GENERATED ALWAYS AS (json_extract(stats_json, '$.ac')) VIRTUAL;
ALTER TABLE item ADD COLUMN dmg INTEGER GENERATED ALWAYS AS (json_extract(stats_json, '$.dmg')) VIRTUAL;
ALTER TABLE item ADD COLUMN delay INTEGER GENERATED ALWAYS AS (json_extract(stats_json, '$.delay')) VIRTUAL;
ALTER TABLE item ADD COLUMN ratio REAL GENERATED ALWAYS AS (CASE WHEN dmg > 0 AND delay > 0 THEN CAST(dmg AS REAL) / delay END) VIRTUAL;
ALTER TABLE item ADD COLUMN skill TEXT GENERATED ALWAYS AS (json_extract(stats_json, '$.skill')) VIRTUAL;
ALTER TABLE item ADD COLUMN handed TEXT GENERATED ALWAYS AS (json_extract(stats_json, '$.handed')) VIRTUAL;
ALTER TABLE item ADD COLUMN class_mask INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN slot_mask INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN source_mask INTEGER NOT NULL DEFAULT 0;
ALTER TABLE item ADD COLUMN origin_json TEXT;

CREATE INDEX item_ac ON item(ac) WHERE ac IS NOT NULL;
CREATE INDEX item_dmg ON item(dmg) WHERE dmg IS NOT NULL;
CREATE INDEX item_delay ON item(delay) WHERE delay IS NOT NULL;
CREATE INDEX item_ratio ON item(ratio) WHERE ratio IS NOT NULL;
CREATE INDEX item_skill ON item(skill) WHERE skill IS NOT NULL;
CREATE INDEX item_handed ON item(handed) WHERE handed IS NOT NULL;
-- Gear only: /gear find's class, slot and source filters are tested on these index entries.
CREATE INDEX item_gear ON item(slot_mask, class_mask, source_mask) WHERE slot_mask <> 0;

ALTER TABLE game_class ADD COLUMN bit INTEGER CHECK (bit BETWEEN 0 AND 30);
CREATE UNIQUE INDEX game_class_bit ON game_class(bit) WHERE bit IS NOT NULL;

CREATE TABLE mob (
key TEXT PRIMARY KEY COLLATE NOCASE, -- the source's mobs key; item from-names match it case-insensitively
title TEXT NOT NULL COLLATE NOCASE, -- the second match, when no key matches
level TEXT, -- as recorded ("3 - 10", "31-33", "~15"); never parsed
race TEXT,
class TEXT,
image_url TEXT,
zones_json TEXT,
loot_json TEXT,
active INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;
CREATE INDEX mob_by_title ON mob(title);

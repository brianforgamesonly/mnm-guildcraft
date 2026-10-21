-- Order 17 (zone card), named schema departures from docs/PRD-schema.sql (the PRD has no zones).
--
-- zone: one row per zone, keyed by its name with only the two allowed normalisations (case; curly to straight
--   apostrophes: scripts/import/zones.ts zoneKey). The zones are the names in Mo Betta's zones.json, mnm-tools' maps.json,
--   items' wikiZones and the mobs' zones; MnM Atlas map ids are matched onto them, never the other way round.
--   level, description, adjacent_json: Mo Betta, as recorded. wiki_url: Mo Betta's url (Miraheze).
--   map_json: a map image only where its licence and author or source are known (order 17, override 2), else NULL.
--   markers_json: mnm-tools maps.json markers' label, category and notes, as recorded (pixel positions dropped).
-- zone_name: the derived mapping, one row per name each source uses; zone_key NULL = unmatched (reported, never guessed).
-- npc: Mo Betta's NPCs, one row per zone their zone text maps to, keyed by name (case-insensitive) and zone. mnm-tools'
--   mob table keeps its fields; the card fills only what a mob lacks from here (src/zone/creatures.ts).
-- import_source: each source file's pinned commit and its commit date (from GitHub), for the staleness warning.
-- Rows that disappear upstream are deactivated (active = 0), never deleted.

CREATE TABLE zone (
key TEXT PRIMARY KEY,
name TEXT NOT NULL,
level TEXT,
description TEXT,
adjacent_json TEXT,
atlas_id TEXT,
wiki_url TEXT,
map_json TEXT,
markers_json TEXT,
active INTEGER NOT NULL DEFAULT 1
) WITHOUT ROWID;

CREATE TABLE zone_name (
source TEXT NOT NULL,
name TEXT NOT NULL,
zone_key TEXT,
active INTEGER NOT NULL DEFAULT 1,
PRIMARY KEY (source, name)
) WITHOUT ROWID;

CREATE TABLE npc (
zone_key TEXT NOT NULL,
name TEXT NOT NULL COLLATE NOCASE,
kind TEXT NOT NULL,
level TEXT,
race TEXT,
class TEXT,
location TEXT,
loot_json TEXT,
active INTEGER NOT NULL DEFAULT 1,
PRIMARY KEY (zone_key, name)
) WITHOUT ROWID;

CREATE TABLE import_source (
name TEXT PRIMARY KEY,
sha TEXT NOT NULL,
changed_at TEXT NOT NULL
) WITHOUT ROWID;

-- Order 24 (ITEMs 1 and 2), named schema departures from docs/PRD-schema.sql (the PRD has no factions).
--
-- faction: one row per faction name Mo Betta's npcs.json records in an NPC's factions or opposing_factions, trimmed and
--   never merged or re-spelled (near-identical names stay separate rows). A name that disappears upstream is deactivated
--   (active = 0), never deleted, so its id (and a guild's post for it) is kept.
--   changed_at: when the import last changed what the faction's post shows (its links, or a linked creature's row or
--   zone). It is the one value no table holds; the factions board re-renders a post rendered before it
--   (src/board/kinds.ts), so the import never writes a guild's rows.
-- npc_faction: an NPC row (npc.zone_key, npc.name) and one of its factions. kind = the wiki infobox field the name came
--   from, by the wiki's own labels: 'lost' (factions, "Reputation Lost") or 'gained' (opposing_factions, "Reputation
--   Gained"). One link per zone row, as the npc table holds one row per zone. Deactivated, never deleted.
-- faction_post: the factions board's posts, as board_post holds the tradeskill board's (a separate table, because
--   board_post's key and foreign key name the tradeskill; changing them would rebuild a live table).
-- guild.faction_*: the factions board's counterparts of the tradeskill board's channel, index post, lease and rebuild
--   (0001, 0005, 0006).
-- Rollback: scripts/rollback/0018_factions.down.sql.

CREATE TABLE faction (
id INTEGER PRIMARY KEY,
name TEXT NOT NULL UNIQUE,
active INTEGER NOT NULL DEFAULT 1,
changed_at TEXT
);

CREATE TABLE npc_faction (
zone_key TEXT NOT NULL,
npc_name TEXT NOT NULL COLLATE NOCASE,
faction_id INTEGER NOT NULL REFERENCES faction(id),
kind TEXT NOT NULL CHECK (kind IN ('lost','gained')),
active INTEGER NOT NULL DEFAULT 1,
PRIMARY KEY (zone_key, npc_name, faction_id, kind)
) WITHOUT ROWID;
CREATE INDEX npc_faction_by_faction ON npc_faction(faction_id);

CREATE TABLE faction_post (
guild_id TEXT NOT NULL,
faction_id INTEGER NOT NULL REFERENCES faction(id),
thread_id TEXT NOT NULL,
message_ids_json TEXT NOT NULL,
content_hash TEXT,
dirty INTEGER NOT NULL DEFAULT 1,
last_rendered_at TEXT,
PRIMARY KEY (guild_id, faction_id)
);

ALTER TABLE guild ADD COLUMN faction_board_channel_id TEXT;
ALTER TABLE guild ADD COLUMN faction_index_thread_id TEXT;
ALTER TABLE guild ADD COLUMN faction_index_message_id TEXT;
ALTER TABLE guild ADD COLUMN faction_index_hash TEXT;
ALTER TABLE guild ADD COLUMN faction_lock_until TEXT;
ALTER TABLE guild ADD COLUMN faction_rebuild_since TEXT;

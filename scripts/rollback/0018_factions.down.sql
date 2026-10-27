-- The down path of migrations/0018_factions.sql (order 24, PR A). Run with the Worker rolled back first: the factions
-- board names these columns and tables. Removes the faction data (the next import writes it again) and every guild's
-- factions board record; the bot's posts stay in Discord (board.yml's delete, run before this, removes them).
ALTER TABLE guild DROP COLUMN faction_rebuild_since;
ALTER TABLE guild DROP COLUMN faction_lock_until;
ALTER TABLE guild DROP COLUMN faction_index_hash;
ALTER TABLE guild DROP COLUMN faction_index_message_id;
ALTER TABLE guild DROP COLUMN faction_index_thread_id;
ALTER TABLE guild DROP COLUMN faction_board_channel_id;
DROP TABLE faction_post;
DROP INDEX npc_faction_by_faction;
DROP TABLE npc_faction;
DROP TABLE faction;
DELETE FROM d1_migrations WHERE name = '0018_factions.sql';

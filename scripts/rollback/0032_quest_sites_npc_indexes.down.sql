-- Rollback of migrations/0032_quest_sites_npc_indexes.sql (order 37, PR B). Run before reverting the code that reads them:
-- the Worker then reads quest links from nothing (no link, never an error: src/gear/howto.ts questLinks), and the drop and
-- vendor lines read NPC rows without the indexes (correct, at more rows). Then DELETE the migration's d1_migrations row.
DROP INDEX IF EXISTS npc_by_name;
DROP INDEX IF EXISTS npc_loot;
DROP TABLE IF EXISTS quest_site_run;
DROP TABLE IF EXISTS quest_site;

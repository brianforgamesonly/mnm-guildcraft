-- The down path of migrations/0019_faction_quest.sql (order 25). Run with the Worker and import rolled back first: they
-- read and write this table. Removes the quest lines (the next import writes them again); the factions board's posts
-- lose their Quests section at their next re-render.
DROP TABLE faction_quest;
DELETE FROM d1_migrations WHERE name = '0019_faction_quest.sql';

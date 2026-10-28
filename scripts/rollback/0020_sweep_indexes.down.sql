-- The down path of migrations/0020_sweep_indexes.sql (order 26). Not needed for a Worker rollback alone: no statement
-- names the indexes, so the previous code runs unchanged with or without them.
DROP INDEX IF EXISTS faction_post_dirty;
DROP INDEX IF EXISTS faction_post_rendered;
DROP INDEX IF EXISTS faction_changed;
DELETE FROM d1_migrations WHERE name = '0020_sweep_indexes.sql';

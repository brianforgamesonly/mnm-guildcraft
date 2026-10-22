-- The down path of migrations/0014_component_by_item.sql (order 19, PR A). Not needed for a Worker rollback alone: no
-- statement names the index, so the previous code runs unchanged with or without it.
DROP INDEX IF EXISTS recipe_component_by_item;
DELETE FROM d1_migrations WHERE name = '0014_component_by_item.sql';

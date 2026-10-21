-- The down path of migrations/0013_zones.sql (order 17, PR A). Not needed for a Worker rollback alone: the previous
-- code never reads these tables, so it runs unchanged on the new schema. Running this removes the zone data only; the
-- next import with zone sources writes it again.
DROP TABLE import_source;
DROP TABLE npc;
DROP TABLE zone_name;
DROP TABLE zone;
DELETE FROM d1_migrations WHERE name = '0013_zones.sql';

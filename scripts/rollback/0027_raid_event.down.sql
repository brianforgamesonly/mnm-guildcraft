-- Rollback of migrations/0027_raid_event.sql. It loses which raid was linked to which event: export them first.
DROP INDEX dkp_raid_event;
ALTER TABLE dkp_raid DROP COLUMN event_id;

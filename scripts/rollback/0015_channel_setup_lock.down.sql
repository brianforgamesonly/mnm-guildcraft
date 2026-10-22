-- The down path of migrations/0015_channel_setup_lock.sql (order 19, PR B). Run with the Worker rolled back first: the
-- Create GuildCraft channels button names the column. The lease is transient, so nothing is lost.
ALTER TABLE guild DROP COLUMN channel_setup_lock_until;
DELETE FROM d1_migrations WHERE name = '0015_channel_setup_lock.sql';

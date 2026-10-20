-- The down path of migrations/0010_gear.sql (order 13), for a rollback that must also remove the schema. Not needed for a
-- Worker rollback alone: 0010 only adds, and the previous code names its columns, so it runs unchanged on the new schema.
-- Run on a copy with: npx wrangler d1 execute <database> --remote --env <copy> --file scripts/rollback/0010_gear.down.sql
-- Dry run first on the local database (test/worker/rollback.test.ts applies it after 0010 and checks the schema).
DROP INDEX item_gear;
DROP INDEX item_handed;
DROP INDEX item_skill;
DROP INDEX item_ratio;
DROP INDEX item_delay;
DROP INDEX item_dmg;
DROP INDEX item_ac;
DROP INDEX game_class_bit;
DROP INDEX mob_by_title;
DROP TABLE mob;
ALTER TABLE item DROP COLUMN origin_json;
ALTER TABLE item DROP COLUMN source_mask;
ALTER TABLE item DROP COLUMN slot_mask;
ALTER TABLE item DROP COLUMN class_mask;
ALTER TABLE item DROP COLUMN handed;
ALTER TABLE item DROP COLUMN skill;
ALTER TABLE item DROP COLUMN ratio;
ALTER TABLE item DROP COLUMN delay;
ALTER TABLE item DROP COLUMN dmg;
ALTER TABLE item DROP COLUMN ac;
ALTER TABLE game_class DROP COLUMN bit;
DELETE FROM d1_migrations WHERE name = '0010_gear.sql';

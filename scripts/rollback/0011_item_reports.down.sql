-- The down path of migrations/0011_item_reports.sql (order 13, PR B). Run before 0010's down path, if both are undone.
-- Not needed for a Worker rollback alone: the previous code names its columns, so it runs unchanged on the new schema.
-- Item reports already filed stay rows of recipe_report, read as recipe reports once kind is gone.
ALTER TABLE item DROP COLUMN total_stats;
ALTER TABLE recipe_report DROP COLUMN kind;
DELETE FROM d1_migrations WHERE name = '0011_item_reports.sql';

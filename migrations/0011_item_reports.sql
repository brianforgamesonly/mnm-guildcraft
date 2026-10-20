-- Order 13 (PR B), named schema departures from docs/PRD-schema.sql.
--
-- recipe_report.kind (override 2): a report on an item's own data (stats, source, classes; from /gear find's item card)
-- or on its recipe (/craft report). Both share the table, so a member's open-report limit
-- (src/commands/reports.ts MAX_OPEN_REPORTS) counts both kinds together.
ALTER TABLE recipe_report ADD COLUMN kind TEXT NOT NULL DEFAULT 'recipe' CHECK (kind IN ('recipe', 'item'));

-- item.total_stats: the sum of the seven stats, a VIRTUAL generated column (override 3; adding it writes no rows) that
-- /gear find sorts and breaks ties by. Its expression is src/gear/options.ts TOTAL_STATS_SQL (test/worker/gear.test.ts
-- checks the two are the same). Not indexed: measured on the real data, an index holding the sort keys did not lower
-- D1's rows_read (SQLite still reads the rows to sort on a virtual column), and it cost 3,162 rows written per copy.
ALTER TABLE item ADD COLUMN total_stats INTEGER GENERATED ALWAYS AS ((ifnull(json_extract(stats_json, '$.stats.STR'), 0) + ifnull(json_extract(stats_json, '$.stats.STA'), 0) + ifnull(json_extract(stats_json, '$.stats.DEX'), 0) + ifnull(json_extract(stats_json, '$.stats.AGI'), 0) + ifnull(json_extract(stats_json, '$.stats.INT'), 0) + ifnull(json_extract(stats_json, '$.stats.WIS'), 0) + ifnull(json_extract(stats_json, '$.stats.CHA'), 0))) VIRTUAL;

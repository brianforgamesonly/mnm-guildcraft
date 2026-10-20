-- Order 13 (override 2), a named schema departure from docs/PRD-schema.sql: recipe_report.kind tells a report on an item's
-- own data (stats, source, classes; from /gear find's item card) from a report on its recipe (/craft report). Both share
-- the table, so a member's open-report limit (src/commands/reports.ts MAX_OPEN_REPORTS) counts both kinds together.
ALTER TABLE recipe_report ADD COLUMN kind TEXT NOT NULL DEFAULT 'recipe' CHECK (kind IN ('recipe', 'item'));

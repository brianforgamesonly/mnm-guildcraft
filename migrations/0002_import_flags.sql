-- Order 1 fix (named departures from docs/PRD-schema.sql):
-- recipe.unknown_components: source component rows named "Unknown" (a placeholder, not an item); they are counted, never stored.
-- recipe.trivial_unconfirmed: mirrors the source's trivialUnconfirmed flag (1 = the wiki marks this trivial as unconfirmed).
-- data_import.warnings: JSON list of unrecognised source fields, Recipe: scroll decisions and unmatched component names.
ALTER TABLE recipe ADD COLUMN unknown_components INTEGER NOT NULL DEFAULT 0;
ALTER TABLE recipe ADD COLUMN trivial_unconfirmed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE data_import ADD COLUMN warnings TEXT;

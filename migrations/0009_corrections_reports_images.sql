-- Order 9 (named schema departures from docs/PRD-schema.sql: two new tables, three new columns).
--
-- recipe_correction: one guild's corrections to a shared recipe, keyed (guild_id, recipe_id) (order 9, override 2).
--   The PRD stores acquisition, faction and acquisition_note on the shared recipe row and makes officer overrides
--   recipe rows with source = 'override'; one deployment serves many guilds, so one guild's officer would change every
--   guild's data, and the nightly upsert could overwrite it. Here each guild's corrections are a layer: readers use the
--   guild's value where one is set (not NULL) and the imported value otherwise, and the import never touches the layer
--   (FR-3.1, FR-7: "corrections survive the nightly import"). recipe.acquisition, faction and acquisition_note stay
--   (the import never sets them: acquisition is 'unknown' on every row); source = 'override' goes unused.
-- recipe_correction_component: a guild's corrected component list for a recipe. When any row exists for
--   (guild_id, recipe_id), it replaces the whole imported list for that guild.
-- recipe_report.details: the member's optional free text (at most 300 characters). A named departure from the PRD's
--   privacy line ("no message content"): it is text the member typed into this report for officers to read.
-- item_image.vault_channel_id: the vault channel each image was posted in, so changing the vault later never
--   orphans an older image. item_image.gone_at: when the bot found its vault message deleted by hand.
CREATE TABLE recipe_correction (
guild_id TEXT NOT NULL REFERENCES guild(id),
recipe_id INTEGER NOT NULL REFERENCES recipe(id),
acquisition TEXT CHECK (acquisition IN ('vendor','reputation','discovery','unknown')),
faction TEXT,
note TEXT,
trivial INTEGER CHECK (trivial >= 0),
updated_by TEXT NOT NULL,
updated_at TEXT NOT NULL,
PRIMARY KEY (guild_id, recipe_id)
);

CREATE TABLE recipe_correction_component (
guild_id TEXT NOT NULL,
recipe_id INTEGER NOT NULL,
item_id INTEGER NOT NULL REFERENCES item(id),
qty INTEGER NOT NULL CHECK (qty > 0),
PRIMARY KEY (guild_id, recipe_id, item_id),
FOREIGN KEY (guild_id, recipe_id) REFERENCES recipe_correction(guild_id, recipe_id) ON DELETE CASCADE
);

ALTER TABLE recipe_report ADD COLUMN details TEXT CHECK (length(details) <= 300);
ALTER TABLE item_image ADD COLUMN vault_channel_id TEXT;
ALTER TABLE item_image ADD COLUMN gone_at TEXT;

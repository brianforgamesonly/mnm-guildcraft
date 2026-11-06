-- Order 36, PR B (gear upgrades, part 2; docs/PRD.md "Gear upgrades"), named schema departures from docs/PRD-schema.sql.
--
-- Defaults live in code (src/gear/score.ts defaultWeights; DEFAULT_WINDOW). Only an officer's change is stored, per server:
-- gear_weight: one row per server, class (game_class code) and stat (src/gear/score.ts WEIGHT_KEYS) whose value differs
--   from the class's default: the absolute weight × 100 (0.35 is 35; 0 to 200), who set it and when. A preset is expanded
--   when applied and only its differences from the default are stored; a stat set back to its default, and a reset,
--   delete rows.
-- gear_setting: one row per server and setting that differs from its default (order 36: 'window', 0 to 60), who and when.
-- guild_id names guild (created before these tables: order 34's foreign-key rule).

CREATE TABLE gear_weight (
guild_id TEXT NOT NULL REFERENCES guild(id),
class TEXT NOT NULL,
stat TEXT NOT NULL,
value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 200),
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (guild_id, class, stat)
) WITHOUT ROWID;

CREATE TABLE gear_setting (
guild_id TEXT NOT NULL REFERENCES guild(id),
key TEXT NOT NULL,
value INTEGER NOT NULL,
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (guild_id, key)
) WITHOUT ROWID;

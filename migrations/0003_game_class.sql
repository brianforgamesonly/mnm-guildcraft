-- Order 2 (named departure from docs/PRD-schema.sql): the game's classes, derived at import time
-- from item class tokens (scripts/import/core.ts deriveClasses), so /character class autocomplete is
-- one small indexed read instead of a scan of item.stats_json on every keystroke.
-- item_count: items carrying the code at the latest import; 0 = the code no longer meets the rule
-- (deactivated, never deleted). Autocomplete reads item_count > 0.
CREATE TABLE game_class (
code TEXT PRIMARY KEY,
item_count INTEGER NOT NULL
);

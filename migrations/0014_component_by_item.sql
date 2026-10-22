-- Order 19 (ITEM 2): /item's "used in" statement (src/commands/item.ts USED_IN_SQL) filters recipe_component on item_id,
-- which the primary key (recipe_id, item_id) cannot seek, so it scanned the whole table. (item_id, recipe_id) covers it.
-- Rollback: scripts/rollback/0014_component_by_item.down.sql (kept outside migrations/, which D1 applies in full).
CREATE INDEX recipe_component_by_item ON recipe_component(item_id, recipe_id);

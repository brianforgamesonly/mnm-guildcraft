-- Order 26 (ITEM 2): the 15-minute cron's "anything to do?" query (src/board/refresh.ts SWEEP_SQL) answers from indexes,
-- not by reading every faction post of every guild with a factions board on every run.
--   faction_post_dirty: a guild's dirty posts (none, when idle: the partial index is empty);
--   faction_post_rendered: a guild's oldest render, the floor for "changed since its post was rendered";
--   faction_changed: the factions the import changed after that floor (none, when idle).
-- Index writes: one row per faction_post and faction row at creation; then a render that sets last_rendered_at or dirty,
-- and an import that sets changed_at, write one more row each.
-- Rollback: scripts/rollback/0020_sweep_indexes.down.sql.
CREATE INDEX faction_post_dirty ON faction_post(guild_id) WHERE dirty <> 0;
CREATE INDEX faction_post_rendered ON faction_post(guild_id, last_rendered_at);
CREATE INDEX faction_changed ON faction(changed_at);

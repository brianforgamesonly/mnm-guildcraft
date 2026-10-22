-- Order 20 (ITEM 1, a named schema departure: one new table, no new column on an existing table). The heartbeat: one row
-- per cron invocation, written first thing in the scheduled handler (src/heartbeat.ts), so a sweep that later fails is
-- still recorded as having run; finished_at is set as its last step, NULL when the invocation died before it. No existing
-- row records every sweep: the sweep writes only when a board has work (order 20 ITEM 1). The health job
-- (scripts/health/run.ts) judges it against the cron expression in wrangler.jsonc.
-- scheduled_ms is the invocation's controller.scheduledTime (ms, UTC): the rowid, so a row costs no index write (2 rows
-- written per sweep: the insert and the finish). A retried or duplicate invocation for the same slot keeps the first row.
-- Rollback: scripts/rollback/0016_sweep_run.down.sql.
CREATE TABLE sweep_run (
scheduled_ms INTEGER PRIMARY KEY,
started_at TEXT NOT NULL,
finished_at TEXT
);

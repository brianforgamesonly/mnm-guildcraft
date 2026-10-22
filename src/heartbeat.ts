// Order 20 (ITEM 1): proof each sweep ran, in the bot's own database (migrations/0016_sweep_run.sql). The start is
// written before any other work, so a sweep that fails later still counts as having run; the finish is its last step.
// Neither write may stop the sweep: a failure is logged and the run goes on.

/** One row per invocation, keyed by its scheduled slot. A repeat for the same slot keeps the first row. */
export const sweepStarted = (db: D1Database, scheduledMs: number, at: string) =>
  db.prepare('INSERT OR IGNORE INTO sweep_run (scheduled_ms, started_at) VALUES (?, ?)').bind(scheduledMs, at);

/** The slot's row, while finished_at is still NULL (a repeat invocation for the same slot can finish it too). */
export const sweepFinished = (db: D1Database, scheduledMs: number, at: string) =>
  db.prepare('UPDATE sweep_run SET finished_at = ? WHERE scheduled_ms = ? AND finished_at IS NULL').bind(at, scheduledMs);

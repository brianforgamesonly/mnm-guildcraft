-- Order 22 (ITEM 2): a data-only migration, no schema change. Marks every roster board post dirty, so the ordinary
-- 15-minute sweeps re-render each one with its new first-message line (src/board/render.ts skillLine) within the
-- 40-call cap per run. A content hash change alone marks nothing dirty; only the nightly run would reach them otherwise.
-- dirty 2 (claimed by a running refresh) already counts as dirty and is left as it is. The index is edited by the same
-- runs, because its hashed text now ends with its line.
-- deploy.yml applies this before the new Worker is live: an old-code refresh in that gap can clear these flags without
-- adding the line (its render matches the stored hash). The nightly run (every post, new hash) is the backstop, within a day.
-- Rollback: scripts/rollback/0017_board_preview_line.down.sql (with BOARD_LINE 'clear' deployed first).
UPDATE board_post SET dirty = 1 WHERE dirty = 0;

-- Order 5 (named departure from docs/PRD-schema.sql): the board's pinned index post (PRD FR-5, FR-9).
-- board_post holds one row per tradeskill (its tradeskill_id is a NOT NULL key referencing tradeskill),
-- so the index, which belongs to no tradeskill, is held on the guild row instead:
--   board_index_thread_id:  the index forum post (its first message is edited in place);
--   board_index_message_id: that first message;
--   board_index_hash:       the index content hash (skip the edit when nothing changed).
-- board_lock_until: a lease, so a refresh after a command and a cron sweep never both create the same
-- post (src/board/refresh.ts). NULL or past = free.
ALTER TABLE guild ADD COLUMN board_index_thread_id TEXT;
ALTER TABLE guild ADD COLUMN board_index_message_id TEXT;
ALTER TABLE guild ADD COLUMN board_index_hash TEXT;
ALTER TABLE guild ADD COLUMN board_lock_until TEXT;

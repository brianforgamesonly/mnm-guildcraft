-- The down path of migrations/0017_board_preview_line.sql (order 22). Reverting the code alone leaves the line on
-- every post: a Discord message edit keeps any field it does not send. So, in this order:
--   1. deploy with BOARD_LINE = 'clear' (src/board/refresh.ts): each first message is then rendered with content "",
--      which removes the line (order 22's explicit override 1, board message edits only);
--   2. run this script on each copy: every post and the index are marked for a rewrite, with their hashes cleared,
--      so the sweeps edit each one once (several runs per guild under the 40-call cap);
--   3. once no post is dirty, revert the line's code and remove migrations/0017 in the same change, then delete its
--      record: DELETE FROM d1_migrations WHERE name = '0017_board_preview_line.sql';
--      (Not here: while 0017 still ships, a deploy would apply it again and mark every post dirty once more.)
-- Nothing is lost: the hashes are recomputed by the next edit.
UPDATE board_post SET dirty = 1, content_hash = NULL;
UPDATE guild SET board_index_hash = NULL WHERE board_index_hash IS NOT NULL;

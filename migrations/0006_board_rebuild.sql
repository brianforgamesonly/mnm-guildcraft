-- Order 6 (named departure from docs/PRD-schema.sql): the roster board's A→Z rebuild (PRD FR-8 rebuild-board).
-- board_rebuild_since: set by /guildcraft rebuild-board, cleared when the rebuild is done. NULL = no rebuild.
-- It is the one value no table holds: that a rebuild was asked for, and from when. Everything else is derived
-- from it (src/board/order.ts): a post whose thread snowflake predates it is an old post still to be replaced;
-- a bot-owned thread in the forum that board_post no longer references is an old post still to be deleted.
ALTER TABLE guild ADD COLUMN board_rebuild_since TEXT;

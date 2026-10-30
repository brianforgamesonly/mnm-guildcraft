-- Rollback of migrations/0025_card_stale.sql. The table holds only cards awaiting a redraw: nothing a member wrote.
DROP TABLE card_stale;

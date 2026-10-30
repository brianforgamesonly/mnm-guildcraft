-- Order 33 (ITEM 1): a card Discord would not take an edit for. One row while a card is out of date, keyed by its timer item
-- (render:<raid>, acard:<auction>, scard:<listing>, evcard:<event>), so the sweep needs nothing but this table to ask for the
-- redraw; the card itself is drawn from its current rows. The row goes when Discord accepts the card, or when Discord says
-- the card can't be edited at all (10003, 10008, 50001: an audit row records that). An empty table costs the 15-minute cron
-- one read and no Discord calls.
--   status, code   Discord's last answer (0 when it gave none), so a stuck card can be diagnosed.
-- Rollback: scripts/rollback/0025_card_stale.down.sql.
CREATE TABLE card_stale (
guild_id TEXT NOT NULL REFERENCES guild(id),
item TEXT NOT NULL,
since TEXT NOT NULL,
status INTEGER NOT NULL,
code INTEGER,
PRIMARY KEY (guild_id, item)
) WITHOUT ROWID;

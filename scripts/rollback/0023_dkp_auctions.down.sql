-- Order 29: undoes migrations/0023_dkp_auctions.sql. Revert the code that reads the new tables first.
-- Dry-run first: SELECT count(*) FROM dkp_ledger WHERE kind IN ('standby', 'spend', 'refund', 'decay') must be 0, or the
-- rows must be exported first. The old CHECK refuses those kinds, so the copy below fails whole (and changes nothing)
-- rather than drop a member's points. Drops the auction, wishlist and shop rows and the kill rosters: run only on a copy
-- where none matter, or after an export.
PRAGMA defer_foreign_keys = on;
DROP TRIGGER dkp_ledger_no_update;
DROP TRIGGER dkp_ledger_no_delete;
ALTER TABLE dkp_ledger RENAME TO dkp_ledger_0023;
CREATE TABLE dkp_ledger (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
member_id TEXT NOT NULL,
pool TEXT NOT NULL,
amount INTEGER NOT NULL,
cut INTEGER NOT NULL,
balance_after INTEGER NOT NULL,
kind TEXT NOT NULL CHECK (kind IN ('kill', 'flat', 'adjust', 'correction')),
raid_id INTEGER REFERENCES dkp_raid(id),
kill_id INTEGER REFERENCES dkp_kill(id),
corrects INTEGER REFERENCES dkp_ledger(id),
reason TEXT,
actor TEXT NOT NULL,
at TEXT NOT NULL
);
INSERT INTO dkp_ledger (id, guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
SELECT id, guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at FROM dkp_ledger_0023 ORDER BY id;
DROP TABLE dkp_ledger_0023;
CREATE INDEX dkp_ledger_balance ON dkp_ledger(guild_id, pool, member_id);
CREATE INDEX dkp_ledger_kill ON dkp_ledger(kill_id, member_id) WHERE kill_id IS NOT NULL;
CREATE TRIGGER dkp_ledger_no_update BEFORE UPDATE ON dkp_ledger BEGIN SELECT RAISE(ABORT, 'dkp_ledger is append-only'); END;
CREATE TRIGGER dkp_ledger_no_delete BEFORE DELETE ON dkp_ledger BEGIN SELECT RAISE(ABORT, 'dkp_ledger is append-only'); END;
DROP TABLE dkp_purchase;
DROP TABLE dkp_listing;
DROP TABLE dkp_wishlist;
DROP TABLE dkp_nudge;
DROP TABLE dkp_bid;
DROP TABLE dkp_auction;
DROP TABLE dkp_kill_member;
ALTER TABLE dkp_raid DROP COLUMN standby_once;
DELETE FROM d1_migrations WHERE name = '0023_dkp_auctions.sql';

-- Order 29 (DKP part 2; docs/PRD.md "DKP add-on", "Order 29"): named departures from the PRD schema, each for the DKP
-- add-on. Removing DKP never deletes these rows.
--   dkp_kill_member  who was Present or Standby at each kill (ITEM 3), written with the kill's ledger rows; Check again and
--                    corrections update it. state NULL: unknown (a kill recorded before order 29, which stored no state;
--                    backfilled below from the kill ledger rows, net of correction rows).
--   dkp_raid.standby_once  1 for raids opened from order 29 on: Standby earns the standby value once, at close (override 2).
--                    0 (every raid opened before): Standby earns every kill, as order 27 paid it, so nothing is paid twice.
--   dkp_auction      a raid auction (raid points of the raid's zone) or a general auction (guild points); queued drops wait
--                    in the item queue. The pool is derived: the raid's zone, or the guild pool.
--   dkp_bid          a member's sealed bid (one per auction, changed or withdrawn while open); dropped: why it did not
--                    count at close (NULL: it counted).
--   dkp_nudge        a wishlist nudge sent (or refused, or failed) for an auction, one per member.
--   dkp_wishlist     a member's wishlist (guild-public), at most the wishlist size each.
--   dkp_listing      a shop listing (guild points, fixed price); dkp_purchase one purchase from it.
--   dkp_ledger       rebuilt (order 29's override 1 of order 27's append-only rule): the kinds standby, spend, refund and
--                    decay are added (SQLite cannot alter a CHECK), with auction_id and purchase_id naming what a spend
--                    (or refund) paid for. Every row is copied unchanged, ids included; the triggers and indexes are
--                    recreated. Proved by test/worker/dkp-ledger-rebuild.test.ts and the backup job's migration check
--                    (row count and a checksum of every column, before and after).
-- Rollback: scripts/rollback/0023_dkp_auctions.down.sql.
PRAGMA defer_foreign_keys = on;

CREATE TABLE dkp_kill_member (
kill_id INTEGER NOT NULL REFERENCES dkp_kill(id),
member_id TEXT NOT NULL,
state TEXT CHECK (state IN ('present', 'standby')),
PRIMARY KEY (kill_id, member_id)
) WITHOUT ROWID;
CREATE INDEX dkp_kill_member_by_member ON dkp_kill_member(member_id, kill_id);

ALTER TABLE dkp_raid ADD COLUMN standby_once INTEGER NOT NULL DEFAULT 0 CHECK (standby_once IN (0, 1));

CREATE TABLE dkp_auction (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
kind TEXT NOT NULL CHECK (kind IN ('raid', 'general')),
raid_id INTEGER REFERENCES dkp_raid(id),
kill_id INTEGER REFERENCES dkp_kill(id),
from_auction INTEGER REFERENCES dkp_auction(id),
item_id INTEGER NOT NULL REFERENCES item(id),
min_bid INTEGER NOT NULL CHECK (min_bid >= 1),
seconds INTEGER NOT NULL CHECK (seconds > 0),
status TEXT NOT NULL CHECK (status IN ('queued', 'open', 'sold', 'unsold', 'cancelled')),
created_by TEXT NOT NULL,
created_at TEXT NOT NULL,
opened_at TEXT,
closes_at TEXT,
message_id TEXT,
closed_at TEXT,
winner TEXT,
price INTEGER,
reason TEXT,
cancelled_by TEXT,
disposal TEXT,
disposal_by TEXT,
disposal_at TEXT,
CHECK ((kind = 'raid') = (raid_id IS NOT NULL))
);
CREATE INDEX dkp_auction_live ON dkp_auction(guild_id, status);
CREATE INDEX dkp_auction_by_raid ON dkp_auction(raid_id) WHERE raid_id IS NOT NULL;
CREATE INDEX dkp_auction_wins ON dkp_auction(guild_id, winner, closed_at) WHERE winner IS NOT NULL;

CREATE TABLE dkp_bid (
auction_id INTEGER NOT NULL REFERENCES dkp_auction(id),
member_id TEXT NOT NULL,
amount INTEGER NOT NULL CHECK (amount >= 1),
at TEXT NOT NULL,
dropped TEXT,
PRIMARY KEY (auction_id, member_id)
) WITHOUT ROWID;

CREATE TABLE dkp_nudge (
auction_id INTEGER NOT NULL REFERENCES dkp_auction(id),
member_id TEXT NOT NULL,
result TEXT NOT NULL CHECK (result IN ('sent', 'refused', 'failed')),
at TEXT NOT NULL,
PRIMARY KEY (auction_id, member_id)
) WITHOUT ROWID;

CREATE TABLE dkp_wishlist (
guild_id TEXT NOT NULL REFERENCES guild(id),
member_id TEXT NOT NULL,
item_id INTEGER NOT NULL REFERENCES item(id),
character TEXT,
added_at TEXT NOT NULL,
PRIMARY KEY (guild_id, member_id, item_id)
) WITHOUT ROWID;
CREATE INDEX dkp_wishlist_by_item ON dkp_wishlist(guild_id, item_id);

CREATE TABLE dkp_listing (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
item_id INTEGER NOT NULL REFERENCES item(id),
price INTEGER NOT NULL CHECK (price >= 1),
quantity INTEGER NOT NULL CHECK (quantity >= 1),
per_member INTEGER NOT NULL CHECK (per_member >= 1),
posted_by TEXT NOT NULL,
posted_at TEXT NOT NULL,
message_id TEXT,
closed_at TEXT,
closed_by TEXT
);
CREATE INDEX dkp_listing_live ON dkp_listing(guild_id) WHERE closed_at IS NULL;

CREATE TABLE dkp_purchase (
id INTEGER PRIMARY KEY,
listing_id INTEGER NOT NULL REFERENCES dkp_listing(id),
member_id TEXT NOT NULL,
at TEXT NOT NULL,
message_id TEXT
);
CREATE INDEX dkp_purchase_by_listing ON dkp_purchase(listing_id, member_id);

-- The ledger rebuild (override 1): the triggers come off before the old table is renamed and dropped.
DROP TRIGGER dkp_ledger_no_update;
DROP TRIGGER dkp_ledger_no_delete;
ALTER TABLE dkp_ledger RENAME TO dkp_ledger_0021;
CREATE TABLE dkp_ledger (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
member_id TEXT NOT NULL,
pool TEXT NOT NULL,
amount INTEGER NOT NULL,
cut INTEGER NOT NULL,
balance_after INTEGER NOT NULL,
kind TEXT NOT NULL CHECK (kind IN ('kill', 'flat', 'adjust', 'correction', 'standby', 'spend', 'refund', 'decay')),
raid_id INTEGER REFERENCES dkp_raid(id),
kill_id INTEGER REFERENCES dkp_kill(id),
corrects INTEGER REFERENCES dkp_ledger(id),
reason TEXT,
actor TEXT NOT NULL,
at TEXT NOT NULL,
auction_id INTEGER REFERENCES dkp_auction(id),
purchase_id INTEGER REFERENCES dkp_purchase(id)
);
INSERT INTO dkp_ledger (id, guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at)
SELECT id, guild_id, member_id, pool, amount, cut, balance_after, kind, raid_id, kill_id, corrects, reason, actor, at FROM dkp_ledger_0021 ORDER BY id;
DROP TABLE dkp_ledger_0021;
CREATE INDEX dkp_ledger_balance ON dkp_ledger(guild_id, pool, member_id);
CREATE INDEX dkp_ledger_kill ON dkp_ledger(kill_id, member_id) WHERE kill_id IS NOT NULL;
-- Order 29: a raid's standby payout is paid once per member and pool; a spend once per auction or purchase.
CREATE UNIQUE INDEX dkp_ledger_standby_once ON dkp_ledger(raid_id, pool, member_id) WHERE kind = 'standby';
CREATE UNIQUE INDEX dkp_ledger_auction_spend ON dkp_ledger(auction_id) WHERE kind = 'spend';
CREATE UNIQUE INDEX dkp_ledger_purchase_spend ON dkp_ledger(purchase_id) WHERE kind = 'spend';
CREATE TRIGGER dkp_ledger_no_update BEFORE UPDATE ON dkp_ledger BEGIN SELECT RAISE(ABORT, 'dkp_ledger is append-only'); END;
CREATE TRIGGER dkp_ledger_no_delete BEFORE DELETE ON dkp_ledger BEGIN SELECT RAISE(ABORT, 'dkp_ledger is append-only'); END;

-- The kill rosters, backfilled (ITEM 3): a member was at a kill when their kill (or flat) rows for it in the raid's pool
-- outnumber their removals. A reversal is a correction row with amount + cut below 0 (it returns what the kill asked,
-- which a reversal requires to be above 0); a re-add is a correction row at or above 0. Counted by rows, never by
-- sum > 0, because a named's value can be 0. state NULL: order 27 stored no state.
INSERT INTO dkp_kill_member (kill_id, member_id, state)
SELECT l.kill_id, l.member_id, NULL FROM dkp_ledger l JOIN dkp_kill k ON k.id = l.kill_id JOIN dkp_raid r ON r.id = k.raid_id
WHERE l.pool = r.pool
GROUP BY l.kill_id, l.member_id
HAVING sum(CASE WHEN l.kind IN ('kill', 'flat') THEN 1 WHEN l.kind = 'correction' AND l.amount + l.cut < 0 THEN -1 WHEN l.kind = 'correction' THEN 1 ELSE 0 END) > 0;

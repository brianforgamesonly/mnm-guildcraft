-- Order 27 (DKP add-on, part 1; docs/PRD.md "DKP add-on (orders 27-28)"): named departures from the PRD schema, each for
-- the DKP add-on a server's admin adds or removes in /guildcraft setup. Removing DKP never deletes these rows.
--   dkp_guild        the switch per server: on or off, GC-DKP's channel id, /dkp's command id on that server.
--   dkp_setting      a setting changed from its default (src/dkp/settings.ts SETTINGS holds the list and the defaults).
--   dkp_named_value  an officer's per-named raid points (/dkp named-value), applied from then on.
--   dkp_pool         a pool that has a standings message: one per raid zone used, plus the guild pool.
--   dkp_raid         a raid night; at most one open per server (dkp_raid_open).
--   dkp_attendance   a member's state in a raid (present, standby, absent), carried to every later kill.
--   dkp_kill         a named kill or a flat payout, with its check-again window.
--   dkp_recheck      who tapped Present again inside a kill's check-again window.
--   dkp_pending      a change over the second-officer threshold, waiting for another officer.
--   dkp_ledger       the points: append-only (the triggers below refuse UPDATE and DELETE). A correction is a new row
--                    naming the row it corrects. balance_after is order 27's explicit override 8 of "Never add a column
--                    for a value the table already holds": the member's balance in that pool once the row applies,
--                    written in the same statement as the row, so a balance is one indexed row, not the whole history
--                    (test/worker/dkp-ledger.test.ts recomputes every one). cut: what the cap cut (asked - amount).
-- Columns: dkp_pool.pool and dkp_ledger.pool are a zone key, or 'guild'. dkp_raid.closes_at is opened_at plus the
-- auto-close setting at opening (a later setting applies to later raids). dkp_kill.name is the named, as picked or typed;
-- NULL for a flat payout. dkp_ledger.actor is a Discord user id, or 'bot' for payouts and timers.
-- Rollback: scripts/rollback/0021_dkp.down.sql.
CREATE TABLE dkp_guild (
guild_id TEXT PRIMARY KEY REFERENCES guild(id),
enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
channel_id TEXT,
command_id TEXT,
changed_at TEXT NOT NULL,
changed_by TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE dkp_setting (
guild_id TEXT NOT NULL REFERENCES guild(id),
key TEXT NOT NULL,
value TEXT NOT NULL,
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (guild_id, key)
) WITHOUT ROWID;

CREATE TABLE dkp_named_value (
guild_id TEXT NOT NULL REFERENCES guild(id),
zone_key TEXT NOT NULL,
name TEXT NOT NULL COLLATE NOCASE,
points INTEGER NOT NULL,
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (guild_id, zone_key, name)
) WITHOUT ROWID;

CREATE TABLE dkp_pool (
guild_id TEXT NOT NULL REFERENCES guild(id),
pool TEXT NOT NULL,
message_id TEXT,
created_at TEXT NOT NULL,
PRIMARY KEY (guild_id, pool)
) WITHOUT ROWID;

CREATE TABLE dkp_raid (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
pool TEXT NOT NULL,
mode TEXT NOT NULL CHECK (mode IN ('named', 'flat')),
message_id TEXT,
opened_by TEXT NOT NULL,
opened_at TEXT NOT NULL,
closes_at TEXT NOT NULL,
closed_at TEXT,
closed_by TEXT,
close_reason TEXT CHECK (close_reason IN ('officer', 'auto', 'removed'))
);
CREATE UNIQUE INDEX dkp_raid_open ON dkp_raid(guild_id) WHERE closed_at IS NULL;
CREATE INDEX dkp_raid_by_pool ON dkp_raid(guild_id, pool, opened_at);
CREATE INDEX dkp_raid_by_time ON dkp_raid(guild_id, opened_at);

CREATE TABLE dkp_attendance (
raid_id INTEGER NOT NULL REFERENCES dkp_raid(id),
member_id TEXT NOT NULL,
state TEXT NOT NULL CHECK (state IN ('present', 'standby', 'absent')),
since TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (raid_id, member_id)
) WITHOUT ROWID;

CREATE TABLE dkp_kill (
id INTEGER PRIMARY KEY,
raid_id INTEGER NOT NULL REFERENCES dkp_raid(id),
name TEXT,
points INTEGER NOT NULL,
guild_points INTEGER NOT NULL,
at TEXT NOT NULL,
by TEXT NOT NULL,
check_due TEXT,
check_closed_at TEXT,
check_by TEXT
);
CREATE INDEX dkp_kill_by_raid ON dkp_kill(raid_id);

CREATE TABLE dkp_recheck (
kill_id INTEGER NOT NULL REFERENCES dkp_kill(id),
member_id TEXT NOT NULL,
at TEXT NOT NULL,
PRIMARY KEY (kill_id, member_id)
) WITHOUT ROWID;

CREATE TABLE dkp_pending (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
kind TEXT NOT NULL CHECK (kind IN ('adjust', 'correction')),
member_id TEXT NOT NULL,
pool TEXT NOT NULL,
amount INTEGER NOT NULL,
action TEXT CHECK (action IN ('add', 'remove')),
raid_id INTEGER REFERENCES dkp_raid(id),
kill_id INTEGER REFERENCES dkp_kill(id),
reason TEXT NOT NULL,
asked_by TEXT NOT NULL,
asked_at TEXT NOT NULL,
due_at TEXT NOT NULL,
message_id TEXT,
status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'lapsed')),
decided_by TEXT,
decided_at TEXT
);

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
CREATE INDEX dkp_ledger_balance ON dkp_ledger(guild_id, pool, member_id);
CREATE INDEX dkp_ledger_kill ON dkp_ledger(kill_id, member_id) WHERE kill_id IS NOT NULL;
CREATE TRIGGER dkp_ledger_no_update BEFORE UPDATE ON dkp_ledger BEGIN SELECT RAISE(ABORT, 'dkp_ledger is append-only'); END;
CREATE TRIGGER dkp_ledger_no_delete BEFORE DELETE ON dkp_ledger BEGIN SELECT RAISE(ABORT, 'dkp_ledger is append-only'); END;

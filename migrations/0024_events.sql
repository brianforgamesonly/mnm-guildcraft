-- Order 32 (Events module, part 1; docs/PRD.md "Events module"): named departures from the PRD schema, each for the
-- optional module a server's admin adds or removes in /guildcraft setup. Removing it never deletes these rows.
--   event_guild           the switch per server: on or off, #gc-events' channel id, /event's command id on that server.
--   event_setting         a setting changed from its default (src/events/settings.ts holds the list and the defaults).
--   event_class_role      a class's default role, set by an admin; none at first, and GuildCraft never guesses.
--   event                 one event and its card. lock_at and closes_at are worked out from start_at and the settings when
--                         the event is posted or its start moves (a later setting applies to later events); lock_at NULL
--                         means never. A limit or a capacity NULL means none. zone_key is a zone's key (the name is read
--                         from zone). status 'draft' is a preview not yet posted. lock_done_at: the lock's work is
--                         finished; left_cursor: the last member the lock's Left check looked up.
--   event_signup          one current row per member per event. Roles and statuses are fixed keys. 'signed_up' is shown
--                         as Going, and 'tentative' as Maybe, on Social and Other. char_name, char_class and char_level
--                         are a deliberate snapshot (order 32, section E; not a value this table already holds): a
--                         deleted or renamed character never breaks a card. queued_at: the place in the waitlist.
--   event_signup_history  every change, with time and actor (src/events/signup.ts, the one writer of event_signup).
-- History is written by that function, not a trigger: a dump that restores event_signup would fire a trigger and write
-- history a second time.
-- Rollback: scripts/rollback/0024_events.down.sql.
CREATE TABLE event_guild (
guild_id TEXT PRIMARY KEY REFERENCES guild(id),
enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
channel_id TEXT,
command_id TEXT,
changed_at TEXT NOT NULL,
changed_by TEXT NOT NULL
) WITHOUT ROWID;

CREATE TABLE event_setting (
guild_id TEXT NOT NULL REFERENCES guild(id),
key TEXT NOT NULL,
value TEXT NOT NULL,
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (guild_id, key)
) WITHOUT ROWID;

CREATE TABLE event_class_role (
guild_id TEXT NOT NULL REFERENCES guild(id),
class_code TEXT NOT NULL COLLATE NOCASE,
role TEXT NOT NULL CHECK (role IN ('tank', 'healer', 'dps', 'support')),
set_at TEXT NOT NULL,
set_by TEXT NOT NULL,
PRIMARY KEY (guild_id, class_code)
) WITHOUT ROWID;

CREATE TABLE event (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL REFERENCES guild(id),
type TEXT NOT NULL CHECK (type IN ('raid', 'group', 'social', 'other')),
title TEXT NOT NULL,
start_at TEXT NOT NULL,
duration_minutes INTEGER NOT NULL,
zone_key TEXT,
description TEXT,
capacity INTEGER,
limit_tank INTEGER,
limit_healer INTEGER,
limit_dps INTEGER,
limit_support INTEGER,
when_full TEXT NOT NULL DEFAULT 'waitlist' CHECK (when_full IN ('waitlist', 'bench')),
signup_role TEXT,
lock_at TEXT,
closes_at TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'cancelled', 'closed')),
message_id TEXT,
posted_by TEXT NOT NULL,
created_at TEXT NOT NULL,
cancelled_by TEXT,
cancel_reason TEXT,
closed_at TEXT,
lock_done_at TEXT,
left_cursor TEXT
);
CREATE INDEX event_upcoming ON event(guild_id, status, start_at);

CREATE TABLE event_signup (
event_id INTEGER NOT NULL REFERENCES event(id),
guild_id TEXT NOT NULL REFERENCES guild(id),
member_id TEXT NOT NULL,
status TEXT NOT NULL CHECK (status IN ('signed_up', 'tentative', 'bench', 'waitlist', 'declined', 'left', 'removed')),
role TEXT CHECK (role IN ('tank', 'healer', 'dps', 'support')),
character_id INTEGER,
char_name TEXT,
char_class TEXT,
char_level INTEGER,
queued_at TEXT,
updated_at TEXT NOT NULL,
changed_by TEXT NOT NULL,
change_reason TEXT,
PRIMARY KEY (event_id, member_id)
);

CREATE TABLE event_signup_history (
id INTEGER PRIMARY KEY,
event_id INTEGER NOT NULL REFERENCES event(id),
guild_id TEXT NOT NULL REFERENCES guild(id),
member_id TEXT NOT NULL,
status TEXT NOT NULL,
role TEXT,
char_name TEXT,
actor TEXT NOT NULL,
reason TEXT,
at TEXT NOT NULL
);
CREATE INDEX event_history_by_member ON event_signup_history(event_id, member_id, at);

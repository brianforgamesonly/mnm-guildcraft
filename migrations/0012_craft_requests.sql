-- Order 16 (PR B), named schema additions to docs/PRD-schema.sql: craft requests routed to opted-in crafters.
--
-- guild.request_channel_id: the text channel /guildcraft setup requests: sets; each request is a private thread in it.
ALTER TABLE guild ADD COLUMN request_channel_id TEXT;

-- craft_notify: a member's opt-in to request notices, per tradeskill (off unless a row exists). A named departure from the
-- order's two tables: an opt-in belongs to a member and a tradeskill, not to any request.
CREATE TABLE craft_notify (
guild_id TEXT NOT NULL,
discord_user_id TEXT NOT NULL,
tradeskill_id INTEGER NOT NULL REFERENCES tradeskill(id),
created_at TEXT NOT NULL,
PRIMARY KEY (guild_id, discord_user_id, tradeskill_id)
);

-- craft_request: one request. 'unsent' while the requester adds items (no thread yet), 'open' once its thread exists,
-- 'closed' when every item is done or cancelled, or the sweep expired it. Its last activity is not a column: it is the
-- latest request.* audit row for 'request:<id>' (audit_by_target).
CREATE TABLE craft_request (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL,
requester TEXT NOT NULL, -- Discord user ID
note TEXT,
status TEXT NOT NULL DEFAULT 'unsent' CHECK (status IN ('unsent','open','closed')),
close_reason TEXT CHECK (close_reason IN ('done','cancelled','expired','inactive','discarded')),
thread_id TEXT, -- the private thread in the request channel
message_id TEXT, -- the bot's first message in it (status lives there)
thread_name TEXT, -- the name last set on Discord; renames are rate-limited, so the sweep catches up when it differs
created_at TEXT NOT NULL,
opened_at TEXT,
closed_at TEXT
);
CREATE INDEX craft_request_live ON craft_request(status, guild_id) WHERE status <> 'closed';
CREATE INDEX craft_request_by_requester ON craft_request(guild_id, requester, status);

-- craft_request_item: up to 5 per request. crafters_json holds the members added to the thread for this item when the
-- request was sent (Discord does not keep that per item).
CREATE TABLE craft_request_item (
request_id INTEGER NOT NULL REFERENCES craft_request(id),
position INTEGER NOT NULL,
item_id INTEGER NOT NULL REFERENCES item(id),
quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','claimed','done','cancelled')),
claimer TEXT, -- Discord user ID of the member who pressed I'll craft this
crafters_json TEXT,
PRIMARY KEY (request_id, position)
);

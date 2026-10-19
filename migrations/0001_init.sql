-- ============ Reference data (shared, refreshed nightly) ============
CREATE TABLE tradeskill (
id INTEGER PRIMARY KEY,
name TEXT NOT NULL UNIQUE, -- 'Blacksmithing'
kind TEXT NOT NULL CHECK (kind IN ('crafting','gathering')),
sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE item (
id INTEGER PRIMARY KEY,
name TEXT NOT NULL,
name_key TEXT NOT NULL UNIQUE, -- lower(name), for autocomplete
icon_url TEXT, -- wiki icon, 64 px
slot TEXT,
stats_json TEXT, -- {ac, dmg, delay, hp, mana, stats{}, resists{}, weight, size, class, race, flags[]}
wiki_url TEXT,
mnmdb_url TEXT,
mnmrealm_url TEXT,
source TEXT NOT NULL DEFAULT 'wiki',
imported_at TEXT NOT NULL
);

CREATE TABLE recipe (
id INTEGER PRIMARY KEY,
source_key TEXT NOT NULL UNIQUE, -- tradeskill + result item (+ variant #); stable when components change
tradeskill_id INTEGER NOT NULL REFERENCES tradeskill(id),
result_item_id INTEGER NOT NULL REFERENCES item(id),
result_qty INTEGER NOT NULL DEFAULT 1,
trivial INTEGER, -- NULL = unknown
station TEXT,
acquisition TEXT NOT NULL DEFAULT 'unknown'
CHECK (acquisition IN ('vendor','reputation','discovery','unknown')),
faction TEXT, -- reputation recipes: faction that sells it
acquisition_note TEXT, -- vendor name, standing needed, discovery hint
source TEXT NOT NULL CHECK (source IN ('wiki','override','guild')),
guild_id TEXT, -- set = guild-private recipe added by members
active INTEGER NOT NULL DEFAULT 1, -- 0 = superseded, removed upstream, or awaiting approval
imported_at TEXT NOT NULL
);
CREATE INDEX recipe_by_result ON recipe(result_item_id) WHERE active = 1;

CREATE TABLE recipe_component (
recipe_id INTEGER NOT NULL REFERENCES recipe(id) ON DELETE CASCADE,
item_id INTEGER NOT NULL REFERENCES item(id),
qty INTEGER NOT NULL,
PRIMARY KEY (recipe_id, item_id)
);

-- ============ Guild data (keyed by Discord server) ============
CREATE TABLE guild (
id TEXT PRIMARY KEY, -- Discord guild (server) ID
name TEXT NOT NULL,
board_channel_id TEXT, -- forum channel
review_channel_id TEXT,
vault_channel_id TEXT, -- private channel holding approved images
member_role_id TEXT,
officer_role_id TEXT,
skill_cap INTEGER NOT NULL DEFAULT 300,
stale_days INTEGER NOT NULL DEFAULT 60,
created_at TEXT NOT NULL
);

CREATE TABLE member (
guild_id TEXT NOT NULL REFERENCES guild(id),
discord_user_id TEXT NOT NULL,
display_name TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
first_seen_at TEXT NOT NULL,
PRIMARY KEY (guild_id, discord_user_id)
);

CREATE TABLE character (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL,
owner_user_id TEXT NOT NULL,
name TEXT NOT NULL,
name_key TEXT NOT NULL, -- lower(name)
class TEXT,
level INTEGER,
is_main INTEGER NOT NULL DEFAULT 0,
deleted_at TEXT,
created_at TEXT NOT NULL,
updated_at TEXT NOT NULL,
FOREIGN KEY (guild_id, owner_user_id) REFERENCES member(guild_id, discord_user_id),
UNIQUE (guild_id, name_key)
);
CREATE INDEX character_by_owner ON character(guild_id, owner_user_id);

CREATE TABLE character_skill (
character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
tradeskill_id INTEGER NOT NULL REFERENCES tradeskill(id),
level INTEGER NOT NULL CHECK (level >= 0),
updated_at TEXT NOT NULL,
updated_by TEXT NOT NULL, -- Discord user ID (owner or officer)
PRIMARY KEY (character_id, tradeskill_id)
);
CREATE INDEX skill_ranking ON character_skill(tradeskill_id, level DESC);

CREATE TABLE character_recipe (
character_id INTEGER NOT NULL REFERENCES character(id) ON DELETE CASCADE,
recipe_id INTEGER NOT NULL REFERENCES recipe(id),
created_at TEXT NOT NULL,
PRIMARY KEY (character_id, recipe_id)
);

CREATE TABLE item_image (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL,
item_id INTEGER NOT NULL REFERENCES item(id),
vault_message_id TEXT, -- message in the vault channel
attachment_id TEXT, -- used to refresh the expiring CDN URL
cached_url TEXT,
cached_url_expires_at TEXT,
submitted_by TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
reviewed_by TEXT,
created_at TEXT NOT NULL
);
CREATE INDEX image_by_item ON item_image(guild_id, item_id, status);

CREATE TABLE recipe_report (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL,
item_id INTEGER REFERENCES item(id),
recipe_id INTEGER REFERENCES recipe(id),
reporter TEXT NOT NULL,
issue TEXT NOT NULL,
status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','fixed','dismissed')),
resolved_by TEXT,
created_at TEXT NOT NULL,
resolved_at TEXT
);

CREATE TABLE board_post (
guild_id TEXT NOT NULL,
tradeskill_id INTEGER NOT NULL REFERENCES tradeskill(id),
thread_id TEXT NOT NULL, -- forum post
message_ids_json TEXT NOT NULL, -- ordered bot-owned messages: [first, ...overflow]
content_hash TEXT, -- skip edits when nothing changed
dirty INTEGER NOT NULL DEFAULT 1,
last_rendered_at TEXT,
PRIMARY KEY (guild_id, tradeskill_id)
);

-- ============ System ============
CREATE TABLE data_import (
id INTEGER PRIMARY KEY,
source TEXT NOT NULL, -- 'mnm-tools/wiki.json'
source_version TEXT NOT NULL, -- dataset generatedAt or commit SHA
items INTEGER, recipes INTEGER,
status TEXT NOT NULL, -- 'ok' | 'failed'
error TEXT,
started_at TEXT NOT NULL,
finished_at TEXT
);

CREATE TABLE audit_log (
id INTEGER PRIMARY KEY,
guild_id TEXT NOT NULL,
actor TEXT NOT NULL,
action TEXT NOT NULL, -- 'skill.set', 'character.remove', 'craft.find', ...
target TEXT,
detail_json TEXT,
created_at TEXT NOT NULL
);

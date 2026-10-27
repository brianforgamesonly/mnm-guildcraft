-- Order 25 (ITEM 1), a named schema departure from docs/PRD-schema.sql (the PRD has no factions or quests).
--
-- faction_quest: one row per quest reward line (Mo Betta's quests.json, a "Faction…" reward line) and each faction it
--   mentions (scripts/import/quests.ts). quest_title and wiki_url as quests.json records them; line is the reward line,
--   trimmed, quoted on the faction's post. Written by the import only; a row that disappears upstream is deactivated
--   (active = 0), never deleted. A change sets the faction's changed_at in the same statement group (0018), so the
--   factions board re-renders the post.
-- Rollback: scripts/rollback/0019_faction_quest.down.sql.

CREATE TABLE faction_quest (
faction_id INTEGER NOT NULL REFERENCES faction(id),
quest_title TEXT NOT NULL,
line TEXT NOT NULL,
wiki_url TEXT,
active INTEGER NOT NULL DEFAULT 1,
PRIMARY KEY (faction_id, quest_title, line)
) WITHOUT ROWID;

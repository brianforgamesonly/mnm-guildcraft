-- Order 37, PR B (the owner, 2026-11-06: Way A).
--
-- npc_by_name, npc_loot: /gear upgrades' drop and vendor lines read NPC rows by name per page, and the rows whose loot
--   names something once per import version (src/gear/sources.ts), instead of every NPC row: a new isolate's first slot
--   list stays under order 36's 5,000 rows. Both cover their reads (the table's key, zone_key and name, is in every index
--   of a WITHOUT ROWID table): npc_loot reads only the rows with loot, npc_by_name one index row per NPC row found.
-- quest_site: the quest lines' monstersandmemories.wiki links, kept by the monthly check (.github/workflows/quest-sites.yml,
--   scripts/gear/quest-sites.ts), replacing src/gear/quest-sites.json. One row per quest, keyed by the import's quest key
--   (origin_json.quests[].name: the quest's title, trimmed, scripts/import/core.ts questsByItem). `linked` 1: the line
--   offers the link. `counted_at`: the last counted check (a scheduled run at least 25 days after the one before);
--   `fails`: counted 404s in a row (the second removes the link). The nightly import never touches it.
-- quest_site_run: one row per check that finished (a stopped check writes nothing), read by the health check: no scheduled
--   success in 35 days fails it. The seed row is the order 36 follow-up's check by hand (quest-sites.json's checkedAt).
-- Seeded with the 48 links of src/gear/quest-sites.json at 65728c4, as literal rows.

CREATE INDEX npc_by_name ON npc(name, active, level);
CREATE INDEX npc_loot ON npc(name, level, loot_json) WHERE active = 1 AND loot_json IS NOT NULL;

CREATE TABLE quest_site (
quest TEXT PRIMARY KEY,
url TEXT NOT NULL,
linked INTEGER NOT NULL,
last_result TEXT,
counted_at TEXT,
fails INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE quest_site_run (
id INTEGER PRIMARY KEY,
started_at TEXT NOT NULL,
finished_at TEXT NOT NULL,
event TEXT NOT NULL, -- 'schedule' | 'workflow_dispatch' | 'seed'
checked INTEGER,
added INTEGER,
removed INTEGER,
errors INTEGER
);

INSERT INTO quest_site (quest, url, linked, last_result, counted_at, fails) VALUES
('A Sweet Treat', 'https://monstersandmemories.wiki/quests/a-sweet-treat', 1, '200', NULL, 0),
('A Winged Terror', 'https://monstersandmemories.wiki/quests/a-winged-terror', 1, '200', NULL, 0),
('Ail''Vorith Starter Quest', 'https://monstersandmemories.wiki/quests/ailvorith-starter-quest', 1, '200', NULL, 0),
('Archer Starter Quest (Faelindral)', 'https://monstersandmemories.wiki/quests/archer-starter-quest-faelindral', 1, '200', NULL, 0),
('Bard Starter Quest (Faelindral)', 'https://monstersandmemories.wiki/quests/bard-starter-quest-faelindral', 1, '200', NULL, 0),
('Blacktide Orders', 'https://monstersandmemories.wiki/quests/blacktide-orders', 1, '200', NULL, 0),
('Chompers'' Hide Tunic Quest', 'https://monstersandmemories.wiki/quests/chompers-hide-tunic-quest', 1, '200', NULL, 0),
('Cinder Beetle Armor Quests', 'https://monstersandmemories.wiki/quests/cinder-beetle-armor-quests', 1, '200', NULL, 0),
('Cleric Starter Quest (Underdocks)', 'https://monstersandmemories.wiki/quests/cleric-starter-quest-underdocks', 1, '200', NULL, 0),
('Cloth Scraps Quest', 'https://monstersandmemories.wiki/quests/cloth-scraps-quest', 1, '200', NULL, 0),
('Dispose of the Onyx Outlaws', 'https://monstersandmemories.wiki/quests/dispose-of-the-onyx-outlaws', 1, '200', NULL, 0),
('Druid Starter Quest (Night Harbor)', 'https://monstersandmemories.wiki/quests/druid-starter-quest-night-harbor', 1, '200', NULL, 0),
('Elementalist Starter Quest (Night Harbor)', 'https://monstersandmemories.wiki/quests/elementalist-starter-quest-night-harbor', 1, '200', NULL, 0),
('Escort Head Researcher Aashir', 'https://monstersandmemories.wiki/quests/escort-head-researcher-aashir', 1, '200', NULL, 0),
('Fariha''s Shawl Quest', 'https://monstersandmemories.wiki/quests/farihas-shawl-quest', 1, '200', NULL, 0),
('Find Delilah''s Pet', 'https://monstersandmemories.wiki/quests/find-delilahs-pet', 1, '200', NULL, 0),
('Fungal Armor Quests', 'https://monstersandmemories.wiki/quests/fungal-armor-quests', 1, '200', NULL, 0),
('Green Drakeling Scale Armor Quests', 'https://monstersandmemories.wiki/quests/green-drakeling-scale-armor-quests', 1, '200', NULL, 0),
('Growing Threat of the Sangrel Fist', 'https://monstersandmemories.wiki/quests/growing-threat-of-the-sangrel-fist', 1, '200', NULL, 0),
('Hult''s Beetle Bowl (Quest)', 'https://monstersandmemories.wiki/quests/hults-beetle-bowl-quest', 1, '200', NULL, 0),
('Inquisitor Starter Quest (Night Harbor)', 'https://monstersandmemories.wiki/quests/inquisitor-starter-quest-night-harbor', 1, '200', NULL, 0),
('Joining the Red Mantles', 'https://monstersandmemories.wiki/quests/joining-the-red-mantles', 1, '200', NULL, 0),
('Kill Tora''Galdo', 'https://monstersandmemories.wiki/quests/kill-toragaldo', 1, '200', NULL, 0),
('Landing Loop Quest', 'https://monstersandmemories.wiki/quests/landing-loop-quest', 1, '200', NULL, 0),
('Laundry Day Quest', 'https://monstersandmemories.wiki/quests/laundry-day-quest', 1, '200', NULL, 0),
('Left Behind', 'https://monstersandmemories.wiki/quests/left-behind', 1, '200', NULL, 0),
('Mushroom Menace', 'https://monstersandmemories.wiki/quests/mushroom-menace', 1, '200', NULL, 0),
('Necrolyte''s Pouch Quest', 'https://monstersandmemories.wiki/quests/necrolytes-pouch-quest', 1, '200', NULL, 0),
('Necromancer Starter Quest (Underdocks)', 'https://monstersandmemories.wiki/quests/necromancer-starter-quest-underdocks', 1, '200', NULL, 0),
('Perilous to Leave by Oneself', 'https://monstersandmemories.wiki/quests/perilous-to-leave-by-oneself', 1, '200', NULL, 0),
('Pests at the Farm', 'https://monstersandmemories.wiki/quests/pests-at-the-farm', 1, '200', NULL, 0),
('Platinum Badge of the Living City Quest', 'https://monstersandmemories.wiki/quests/platinum-badge-of-the-living-city-quest', 1, '200', NULL, 0),
('Poacher''s Knives', 'https://monstersandmemories.wiki/quests/poachers-knives', 1, '200', NULL, 0),
('Quarry Samples', 'https://monstersandmemories.wiki/quests/quarry-samples', 1, '200', NULL, 0),
('Ranger Starter Quest (Faelindral)', 'https://monstersandmemories.wiki/quests/ranger-starter-quest-faelindral', 1, '200', NULL, 0),
('Rogue Starter Quest (Underdocks)', 'https://monstersandmemories.wiki/quests/rogue-starter-quest-underdocks', 1, '200', NULL, 0),
('Scarab Armor Quests', 'https://monstersandmemories.wiki/quests/scarab-armor-quests', 1, '200', NULL, 0),
('Shadow Knight Starter Quest (Underdocks)', 'https://monstersandmemories.wiki/quests/shadow-knight-starter-quest-underdocks', 1, '200', NULL, 0),
('Shaman Starter Quest (Faelindral)', 'https://monstersandmemories.wiki/quests/shaman-starter-quest-faelindral', 1, '200', NULL, 0),
('Stolen Gems', 'https://monstersandmemories.wiki/quests/stolen-gems', 1, '200', NULL, 0),
('Survey the Creatures of the Cavern Sea', 'https://monstersandmemories.wiki/quests/survey-the-creatures-of-the-cavern-sea', 1, '200', NULL, 0),
('The Claw Arena', 'https://monstersandmemories.wiki/quests/the-claw-arena', 1, '200', NULL, 0),
('The Delvestone Mining Company Quarrel', 'https://monstersandmemories.wiki/quests/the-delvestone-mining-company-quarrel', 1, '200', NULL, 0),
('The Missing Apprentice', 'https://monstersandmemories.wiki/quests/the-missing-apprentice', 1, '200', NULL, 0),
('The Yowling', 'https://monstersandmemories.wiki/quests/the-yowling', 1, '200', NULL, 0),
('Tig''s Measuring Quest', 'https://monstersandmemories.wiki/quests/tigs-measuring-quest', 1, '200', NULL, 0),
('Underdocks Starter Quest', 'https://monstersandmemories.wiki/quests/underdocks-starter-quest', 1, '200', NULL, 0),
('Wilna''s Ring', 'https://monstersandmemories.wiki/quests/wilnas-ring', 1, '200', NULL, 0);

INSERT INTO quest_site_run (started_at, finished_at, event, checked, added, removed, errors) VALUES
('2026-11-06T18:27:31.314Z', '2026-11-06T18:27:31.314Z', 'seed', NULL, 48, 0, NULL);

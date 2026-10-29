-- Order 28 (override 4 of order 27's override 6): the wiki's own tags on an NPC row, stored from its categories.
--   named: 1 when the NPC's page is in Category:Named Mobs, 0 when it is not; NULL from a source without tags (Mo Betta).
--   raid:  1 when the page is in Category:Raid Encounters, 0 when it is not; NULL likewise.
-- New values from the source, held nowhere else (order 28, B 11). Both are in the import's NPC_FIELDS and the upsert's
-- "differs" guard (scripts/import/core.ts). DKP's Named killed reads them from npc; mob rows carry none.
-- Down path: scripts/rollback/0022_npc_tags.down.sql.
ALTER TABLE npc ADD COLUMN named INTEGER;
ALTER TABLE npc ADD COLUMN raid INTEGER;

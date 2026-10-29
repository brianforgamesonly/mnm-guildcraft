-- The down path of migrations/0022_npc_tags.sql (order 28). The tags are re-read from the wiki snapshot by the next
-- import, so nothing is lost. Revert the code that reads npc.named and npc.raid first.
ALTER TABLE npc DROP COLUMN raid;
ALTER TABLE npc DROP COLUMN named;

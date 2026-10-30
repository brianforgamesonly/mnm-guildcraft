-- Order 34 (Events module, part 3; docs/PRD.md "Adjusting a whole event"): a whole event's adjustment waiting for a second officer.
--   dkp_pending.event_id  the event a batch adjusts; NULL for every other approval. A batch's member_id holds event:<id>,
--                         since that column is NOT NULL and its members are the rows below.
--   dkp_pending_member    who a batch covers, fixed when it was requested: members who sign up later aren't in it.
--   dkp_raid.event_id     rebuilt without REFERENCES event(id), which 0027 gave it. A D1 export writes tables in the order they
--                         were created, so a dkp_raid row came before the event table it pointed at, and the dump couldn't
--                         load ("no such table: main.event"): dkp_raid was created first. Values are kept. dkp_pending.event_id
--                         takes no REFERENCES for the same reason. The code keeps both true: an event with a link can't be
--                         deleted (only a preview ever is, and a preview can't link: src/events/link.ts).
-- Rollback: scripts/rollback/0028_pending_batch.down.sql.
DROP INDEX dkp_raid_event;
ALTER TABLE dkp_raid ADD COLUMN linked_event INTEGER;
UPDATE dkp_raid SET linked_event = event_id;
ALTER TABLE dkp_raid DROP COLUMN event_id;
ALTER TABLE dkp_raid RENAME COLUMN linked_event TO event_id;
CREATE UNIQUE INDEX dkp_raid_event ON dkp_raid(event_id) WHERE event_id IS NOT NULL;

ALTER TABLE dkp_pending ADD COLUMN event_id INTEGER;

CREATE TABLE dkp_pending_member (
pending_id INTEGER NOT NULL REFERENCES dkp_pending(id),
member_id TEXT NOT NULL,
PRIMARY KEY (pending_id, member_id)
) WITHOUT ROWID;

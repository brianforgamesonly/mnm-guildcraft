-- Order 34 (Events module, part 3; docs/PRD.md "Adjusting a whole event"): a whole event's adjustment waiting for a second officer.
--   dkp_pending.event_id  the event a batch adjusts; NULL for every other approval. A batch's member_id holds event:<id>,
--                         since that column is NOT NULL and its members are the rows below.
--   dkp_pending_member    who a batch covers, fixed when it was requested: members who sign up later aren't in it.
-- Rollback: scripts/rollback/0028_pending_batch.down.sql.
ALTER TABLE dkp_pending ADD COLUMN event_id INTEGER REFERENCES event(id);

CREATE TABLE dkp_pending_member (
pending_id INTEGER NOT NULL REFERENCES dkp_pending(id),
member_id TEXT NOT NULL,
PRIMARY KEY (pending_id, member_id)
) WITHOUT ROWID;

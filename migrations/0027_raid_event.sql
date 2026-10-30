-- Order 34 (Events module, part 3; docs/PRD.md "Events module"): the DKP link, one column.
--   dkp_raid.event_id  the event this raid was linked to when it opened; NULL: none. It never changes. Cancelling the event
--                      unlinks it: every reader takes a cancelled event as no link (src/events/link.ts), so the raid card can
--                      still say what happened, and nothing is stored twice. At most one raid per event (dkp_raid_event).
-- Rollback: scripts/rollback/0027_raid_event.down.sql.
ALTER TABLE dkp_raid ADD COLUMN event_id INTEGER REFERENCES event(id);
CREATE UNIQUE INDEX dkp_raid_event ON dkp_raid(event_id) WHERE event_id IS NOT NULL;

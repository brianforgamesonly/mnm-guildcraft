-- Order 33 (Events module, part 2; docs/PRD.md "Who gets which message"): direct messages to a roster.
--   event_member          one row per member per server, once they have a choice to keep: reminders_off is their No reminders
--                         (src/events/dm.ts reads it; only reminders stop), told_at the first sign-up's one-time note.
--   event.reminded_start  the start_at the reminder was sent for: at most one reminder per start time. A new start differs,
--                         so it gets its own; a start moved back to one already reminded doesn't get a second.
-- Rollback: scripts/rollback/0026_event_messages.down.sql.
CREATE TABLE event_member (
guild_id TEXT NOT NULL REFERENCES guild(id),
member_id TEXT NOT NULL,
reminders_off INTEGER NOT NULL DEFAULT 0 CHECK (reminders_off IN (0, 1)),
told_at TEXT,
PRIMARY KEY (guild_id, member_id)
) WITHOUT ROWID;

ALTER TABLE event ADD COLUMN reminded_start TEXT;

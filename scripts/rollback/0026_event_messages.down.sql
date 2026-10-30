-- Rollback of migrations/0026_event_messages.sql. It loses members' No reminders choices: export them first.
ALTER TABLE event DROP COLUMN reminded_start;
DROP TABLE event_member;

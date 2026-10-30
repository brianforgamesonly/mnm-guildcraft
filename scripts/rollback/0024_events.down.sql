-- Rollback of migrations/0024_events.sql. Destroys every event, sign-up and history row: only on an empty module
-- (dry-run: SELECT count(*) FROM event first), or after an export. Run Remove Events module on each server first.
DROP INDEX event_history_by_member;
DROP TABLE event_signup_history;
DROP TABLE event_signup;
DROP INDEX event_upcoming;
DROP TABLE event;
DROP TABLE event_class_role;
DROP TABLE event_setting;
DROP TABLE event_guild;

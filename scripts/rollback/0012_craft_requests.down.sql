-- The down path of migrations/0012_craft_requests.sql (order 16, PR B). Not needed for a Worker rollback alone: the
-- previous code never reads these tables or the column, so it runs unchanged on the new schema. Running this removes
-- every request and opt-in (the threads stay in Discord).
DROP TABLE craft_request_item;
DROP INDEX craft_request_by_requester;
DROP INDEX craft_request_live;
DROP TABLE craft_request;
DROP TABLE craft_notify;
ALTER TABLE guild DROP COLUMN request_channel_id;
DELETE FROM d1_migrations WHERE name = '0012_craft_requests.sql';

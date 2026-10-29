-- Order 27: undoes migrations/0021_dkp.sql. Drops every DKP row: run only on a copy where DKP was never turned on
-- (dry-run: SELECT count(*) FROM dkp_guild first), or after an export.
DROP TRIGGER dkp_ledger_no_delete;
DROP TRIGGER dkp_ledger_no_update;
DROP TABLE dkp_ledger;
DROP TABLE dkp_pending;
DROP TABLE dkp_recheck;
DROP TABLE dkp_kill;
DROP TABLE dkp_attendance;
DROP TABLE dkp_raid;
DROP TABLE dkp_pool;
DROP TABLE dkp_named_value;
DROP TABLE dkp_setting;
DROP TABLE dkp_guild;
DELETE FROM d1_migrations WHERE name = '0021_dkp.sql';

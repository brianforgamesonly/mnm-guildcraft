-- The down path of migrations/0016_sweep_run.sql (order 20). Run with the Worker rolled back first: the scheduled handler
-- writes the table. The rows are the health job's record of which sweeps ran; dropping them loses that history only.
DROP TABLE sweep_run;
DELETE FROM d1_migrations WHERE name = '0016_sweep_run.sql';

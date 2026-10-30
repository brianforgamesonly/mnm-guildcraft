-- Rollback of migrations/0028_pending_batch.sql. It loses who an open batch covers: let open batches lapse first.
DROP TABLE dkp_pending_member;
ALTER TABLE dkp_pending DROP COLUMN event_id;

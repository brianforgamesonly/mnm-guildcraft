-- Rollback of migrations/0028_pending_batch.sql. Open batches lapse first: the old code would pay a member called event:<id>.
UPDATE dkp_pending SET status = 'lapsed' WHERE event_id IS NOT NULL AND status = 'open';
DROP TABLE dkp_pending_member;
ALTER TABLE dkp_pending DROP COLUMN event_id;

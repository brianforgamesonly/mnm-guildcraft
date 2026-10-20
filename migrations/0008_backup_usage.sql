-- Order 8 (named schema departures from docs/PRD-schema.sql, two new tables, no new column on an existing table).
--
-- backup_status: one row per nightly backup run (.github/workflows/backup.yml, scripts/backup/run.ts), read by
--   /guildcraft status. A system record like data_import; audit_log cannot hold it (its rows belong to one guild).
--   token_expires is 'unknown' when GitHub sent no GitHub-Authentication-Token-Expiration header, never a guess.
-- usage_daily: one row per UTC day per free-tier metric, account-wide (.github/workflows/usage.yml,
--   scripts/usage/run.ts), read by /guildcraft status and the cron's usage warning (src/usage.ts). The limits are
--   not stored: they live in src/limits.ts, and the over/under-10% state is derived from value and limit, never stored.
CREATE TABLE backup_status (
id INTEGER PRIMARY KEY,
started_at TEXT NOT NULL,
finished_at TEXT NOT NULL,
result TEXT NOT NULL, -- 'ok' | 'failed'
error TEXT,
file TEXT, -- backups/<YYYY-MM-DD>.sql in the backup repository
size_bytes INTEGER,
export_ms INTEGER,
commit_sha TEXT, -- the backup repository's commit
token_expires TEXT -- ISO date, or 'unknown'
);

CREATE TABLE usage_daily (
day TEXT NOT NULL, -- UTC date, YYYY-MM-DD
metric TEXT NOT NULL, -- a key of FREE_LIMITS (src/limits.ts)
value INTEGER NOT NULL,
measured_at TEXT NOT NULL,
PRIMARY KEY (metric, day)
);

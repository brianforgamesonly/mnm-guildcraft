// The Cloudflare Free plan's daily limits that /guildcraft status shows usage against (order 8, ITEM 2; PRD FR-8).
// A HAND-KEPT LIST, by necessity: Cloudflare publishes these limits only as prose on its docs pages, with no API to
// read them from. Each value names the page it was read from (2026-10-20). A limit Cloudflare changes is changed here.
// All are per account: every script and every database counts toward the same limit.

export interface FreeLimit {
  /** What /guildcraft status calls it. */
  label: string;
  limit: number;
  unit: 'count' | 'bytes';
  /** The docs page the value was read from. */
  source: string;
}

export const FREE_LIMITS = {
  // "Accounts on the Workers Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC."
  workers_requests: { label: 'Worker requests', limit: 100_000, unit: 'count', source: 'https://developers.cloudflare.com/workers/platform/limits/' },
  // D1 Free, rows read: "5 million / day" ("Free limits reset daily at 00:00 UTC").
  d1_rows_read: { label: 'D1 rows read', limit: 5_000_000, unit: 'count', source: 'https://developers.cloudflare.com/d1/platform/pricing/' },
  // D1 Free, rows written: "100,000 / day".
  d1_rows_written: { label: 'D1 rows written', limit: 100_000, unit: 'count', source: 'https://developers.cloudflare.com/d1/platform/pricing/' },
  // D1 Free, storage: "5 GB (total)" across the account's databases (decimal GB assumed: unverified, the page does not define it).
  d1_storage_bytes: { label: 'D1 storage', limit: 5_000_000_000, unit: 'bytes', source: 'https://developers.cloudflare.com/d1/platform/pricing/' },
  // Workers Logs, Workers Free: log events written "200,000 per day" (retention "3 Days").
  workers_logs_events: { label: 'Workers Logs events', limit: 200_000, unit: 'count', source: 'https://developers.cloudflare.com/workers/observability/logs/workers-logs/' },
} as const satisfies Record<string, FreeLimit>;

export type Metric = keyof typeof FREE_LIMITS;
export const METRICS = Object.keys(FREE_LIMITS) as Metric[];

/** PRD success measure: "Free-tier usage stays under 10% of every limit". The usage warning's threshold. */
export const USAGE_TARGET_SHARE = 0.1;

/** A figure older than this is marked stale: GitHub can delay or drop a scheduled run (order 8). */
export const STALE_MS = 36 * 3_600_000;

/**
 * The backup token's expiry, as its owner chose it: none. Joegandomi's note of 2026-10-20 (work order 10, section A):
 * BACKUP_REPO_TOKEN was made with no expiration, so GitHub sends no GitHub-Authentication-Token-Expiration header and
 * the backup records 'unknown'. Status then reads "no expiry (owner's note)", and the 30-day warning never fires.
 * A header, when GitHub sends one, still wins: a replacement token with an expiry is warned about as before.
 */
export const BACKUP_TOKEN_EXPIRY_NOTE: 'none' | 'unset' = 'none';

// Free-tier usage and the nightly backup in /guildcraft status, and the usage warning (order 8, ITEMs 1 and 2; PRD FR-8).
//
// The figures arrive from Actions: scripts/usage/run.ts writes usage_daily (one row per UTC day per metric,
// account-wide) and scripts/backup/run.ts writes backup_status. The Worker holds no Cloudflare credential.
//
// The usage warning (an alarm, ORDER-RULES order 8):
//   who:   the review channel of every guild that set one (/guildcraft setup review:), one line each;
//   state: per metric, 'over' when the last full day's value is at least 10% of its Free limit (src/limits.ts),
//          else 'under'; derived from usage_daily and the limit, never stored;
//   when:  the */15 cron (src/board/refresh.ts) posts only when a metric's state differs from the state of the last
//          line posted for it (none yet counts as 'under'), at most once per UTC day per metric. Each line posted is
//          recorded as a usage.alert audit row (system), which is what "the last line posted" reads. A post Discord
//          refuses is recorded too, with the old state, so it is retried the next UTC day, not every 15 minutes.
import { budgetLeft, type BotApi } from './board/api.ts';
import { BACKUP_TOKEN_EXPIRY_NOTE, FREE_LIMITS, METRICS, STALE_MS, USAGE_TARGET_SHARE, type Metric } from './limits.ts';

export interface UsageRow {
  metric: string;
  day: string;
  value: number;
  measured_at: string;
}

export interface BackupRow {
  finished_at: string;
  result: string;
  error: string | null;
  size_bytes: number | null;
  token_expires: string | null;
}

/** Eight days back from `nowMs` (the last full day and the seven before it, for the 7-day peak). */
export const usageSince = (nowMs: number) => new Date(nowMs - 8 * 86_400_000).toISOString().slice(0, 10);
export const USAGE_SQL = 'SELECT metric, day, value, measured_at FROM usage_daily WHERE metric IN (SELECT value FROM json_each(?1)) AND day >= ?2 ORDER BY metric, day';
export const usageParams = (nowMs: number): [string, string] => [JSON.stringify(METRICS), usageSince(nowMs)];

/** The last run, and the last successful one (status shows when the last good backup was made). */
export const BACKUP_SQL = `SELECT finished_at, result, error, size_bytes, token_expires, (SELECT max(finished_at) FROM backup_status WHERE result = 'ok') AS last_ok
  FROM backup_status ORDER BY id DESC LIMIT 1`;

const fmt = (n: number) => n.toLocaleString('en-US');
const fmtBytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(0)} KB` : `${n} B`);
const amount = (m: Metric, n: number) => (FREE_LIMITS[m].unit === 'bytes' ? fmtBytes(n) : fmt(n));
export const share = (m: Metric, n: number) => n / FREE_LIMITS[m].limit;
const pct = (x: number) => `${x < 0.001 && x > 0 ? '<0.1' : (x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;
/** "N of LIMIT (P%)". */
export const ofLimit = (m: Metric, n: number) => `${amount(m, n)} of ${amount(m, FREE_LIMITS[m].limit)} (${pct(share(m, n))})`;
export const stateOf = (m: Metric, n: number): 'over' | 'under' => (share(m, n) >= USAGE_TARGET_SHARE ? 'over' : 'under');

const ts = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:f>`;
const stale = (iso: string | null | undefined, nowMs: number) => !iso || nowMs - Date.parse(iso) > STALE_MS;

/** The latest day's row per metric. */
export function latestByMetric(rows: UsageRow[]): Map<Metric, UsageRow> {
  const out = new Map<Metric, UsageRow>();
  for (const r of rows) if (r.metric in FREE_LIMITS && (!out.has(r.metric as Metric) || out.get(r.metric as Metric)!.day < r.day)) out.set(r.metric as Metric, r);
  return out;
}

/** The status section: one line per metric for the last full day, with its 7-day peak; stale after 36 hours. */
export function usageLines(rows: UsageRow[], nowMs: number): string[] {
  const latest = latestByMetric(rows);
  if (!latest.size) return ['**Usage against the free-tier limits:** no figures yet (the nightly usage job writes them)'];
  const measured = rows.reduce((m, r) => (r.measured_at > m ? r.measured_at : m), '');
  const lines = [`**Usage against the free-tier limits** (whole Cloudflare account, per UTC day; target under ${USAGE_TARGET_SHARE * 100}%) · measured ${ts(measured)}${stale(measured, nowMs) ? ' · **stale**: the nightly usage job has not run for over 36 hours' : ''}`];
  for (const m of METRICS) {
    const last = latest.get(m);
    if (!last) {
      lines.push(`- ${FREE_LIMITS[m].label}: not measured`);
      continue;
    }
    const week = rows.filter((r) => r.metric === m && r.day <= last.day && r.day > new Date(Date.parse(last.day) - 7 * 86_400_000).toISOString().slice(0, 10));
    const peak = week.reduce((p, r) => (r.value > p.value ? r : p), last);
    lines.push(`- ${FREE_LIMITS[m].label}: ${ofLimit(m, last.value)} on ${last.day} · 7-day peak ${ofLimit(m, peak.value)} (${peak.day}, ${week.length} day${week.length === 1 ? '' : 's'} measured)`);
  }
  return lines;
}

/** The token part of the backup line: its expiry date, else the owner's note, else unknown. */
export function tokenExpiryText(tokenExpires: string | null | undefined, note = BACKUP_TOKEN_EXPIRY_NOTE): string {
  if (tokenExpires && tokenExpires !== 'unknown') return `token expires ${tokenExpires.slice(0, 10)}`;
  return note === 'none' ? "token: no expiry (owner's note)" : 'token expires unknown';
}

/** "Backup: last <time> · token expires <date>" (or the owner's no-expiry note); stale after 36 hours. */
export function backupLine(row: (BackupRow & { last_ok: string | null }) | undefined, nowMs: number): string {
  if (!row) return '**Backup:** none yet (the nightly backup job writes this line)';
  const parts = [`last ${row.last_ok ? ts(row.last_ok) : 'never succeeded'}`, tokenExpiryText(row.token_expires)];
  if (row.result !== 'ok') parts.push(`latest run ${ts(row.finished_at)} **failed**${row.error ? `: ${row.error.slice(0, 160)}` : ''}`);
  else if (row.size_bytes) parts.push(fmtBytes(row.size_bytes));
  if (stale(row.last_ok, nowMs)) parts.push('**stale**: no successful backup for over 36 hours');
  return `**Backup:** ${parts.join(' · ')}`;
}

// ---------------------------------------------------------------- the warning, in the cron

/** Every guild with a review channel, with the last usage.alert row per metric (audit_by_action serves it). */
export const ALERT_GUILDS_SQL = `SELECT g.id, g.review_channel_id,
  (SELECT json_group_array(json_object('target', a.target, 'detail', a.detail_json, 'at', a.created_at)) FROM audit_log a
    WHERE a.id IN (SELECT max(id) FROM audit_log WHERE guild_id = g.id AND action = 'usage.alert' GROUP BY target)) AS alerts
  FROM guild g WHERE g.review_channel_id IS NOT NULL ORDER BY g.id`;

/** The one line posted (DRAFT copy, docs/COPY.md: approved before launch). */
export function alertText(m: Metric, row: UsageRow, state: 'over' | 'under'): string {
  return state === 'over'
    ? `Free-tier usage: **${FREE_LIMITS[m].label}** was ${ofLimit(m, row.value)} on ${row.day}, at or over GuildCraft's ${USAGE_TARGET_SHARE * 100}% target. Nothing stops until 100%; \`/guildcraft status\` shows every figure.`
    : `Free-tier usage: **${FREE_LIMITS[m].label}** is back under the ${USAGE_TARGET_SHARE * 100}% target: ${ofLimit(m, row.value)} on ${row.day}.`;
}

export interface AlertLog {
  gc: 'usage-alert';
  guilds: number;
  posted: number;
  /** Metrics whose figure was too old to judge. */
  stale: number;
  errors: string[];
}

/** One D1 call when nothing changed (both reads in one batch); one Discord call per line posted, then one D1 write. */
export async function usageAlerts(db: D1Database, api: BotApi, nowMs = Date.now(), keep = 0): Promise<AlertLog> {
  const log: AlertLog = { gc: 'usage-alert', guilds: 0, posted: 0, stale: 0, errors: [] };
  const [usage, guilds] = await db.batch([db.prepare(USAGE_SQL).bind(...usageParams(nowMs)), db.prepare(ALERT_GUILDS_SQL)]);
  const latest = latestByMetric(usage.results as unknown as UsageRow[]);
  const rows = guilds.results as { id: string; review_channel_id: string; alerts: string | null }[];
  log.guilds = rows.length;
  if (!latest.size || !rows.length) return log;
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const at = new Date(nowMs).toISOString();
  const record: D1PreparedStatement[] = [];
  try {
    for (const g of rows) {
      let alerts: { target: string; detail: string | null; at: string }[] = [];
      try {
        alerts = JSON.parse(g.alerts ?? '[]');
      } catch {}
      for (const [m, row] of latest) {
        if (stale(row.measured_at, nowMs)) {
          log.stale++;
          continue;
        }
        const state = stateOf(m, row.value);
        const last = alerts.find((a) => a.target === `usage:${m}`);
        const lastState = (() => {
          try {
            return (JSON.parse(last?.detail ?? '{}') as { state?: string }).state ?? 'under';
          } catch {
            return 'under';
          }
        })();
        if (state === lastState || last?.at.slice(0, 10) === today) continue;
        // `keep`: calls left for whatever runs after (a post and the final write need 2 of their own).
        if (budgetLeft(api.budget) < keep + 2 || Date.now() >= api.budget.deadline) return log;
        const sent = await api.call('POST', `/channels/${g.review_channel_id}/messages`, { content: alertText(m, row, state), allowed_mentions: { parse: [] } });
        const recordAs = (s: string, extra: Record<string, unknown> = {}) =>
          db
            .prepare("INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) VALUES (?, 'system', 'usage.alert', ?, ?, ?)")
            .bind(g.id, `usage:${m}`, JSON.stringify({ state: s, day: row.day, value: row.value, limit: FREE_LIMITS[m].limit, ...extra }), at);
        if (!sent.ok) {
          log.errors.push(`usage alert: HTTP ${sent.status}${sent.code ? ` code ${sent.code}` : ''}`);
          // A refused post keeps the old state but counts as today's try: it is retried tomorrow, not every 15 minutes.
          if (!sent.skipped) record.push(recordAs(lastState, { failed: sent.status, wanted: state }));
          break;
        }
        log.posted++;
        record.push(recordAs(state));
      }
    }
  } finally {
    // Whatever was posted is recorded, even if a later step threw: a line is never posted twice for one change.
    if (record.length) await db.batch(record);
  }
  return log;
}

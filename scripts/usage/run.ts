// Nightly free-tier usage (order 8, ITEM 2; PRD FR-8): the previous UTC day(s), summed across the whole Cloudflare
// account (every script, every database), written to usage_daily, one row per day per metric (src/limits.ts).
//   node scripts/usage/run.ts [--dry-run] [--introspect-only] [--days N]
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID. Prints field names and account-wide counts only; never a
// credential, never a script or database name (other projects may share the account).
//
// Sources:
//   GraphQL Analytics API (token permission Account Analytics Read): Worker requests, D1 rows read / written, D1
//   storage. "Metrics can be queried (and are retained) for the past 31 days" (D1 metrics docs). Which dataset and
//   block holds each field is confirmed by schema introspection on every run, never assumed: the D1 docs list the
//   fields without mapping them to datasets.
//   Workers Logs telemetry query API (token permission Workers Observability Write, as scripts/bench/timings.mjs):
//   events per day, for days still inside the logs' 3-day retention.
// The first run (usage_daily empty) backfills 7 days; later runs re-measure the last 2 (late data settles).
import { parseArgs } from 'node:util';
import { alarm, summary } from '../ci/alarm.ts';
import { copyDatabaseId, remoteDb } from '../import/db.ts';
import { FREE_LIMITS, STALE_MS, type Metric } from '../../src/limits.ts';

const { values: args } = parseArgs({
  options: { 'dry-run': { type: 'boolean', default: false }, 'introspect-only': { type: 'boolean', default: false }, days: { type: 'string' } },
});
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');

const cf = async (path: string, body: unknown) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: any; errors?: { message?: string }[] | null; result?: any; success?: boolean };
  const errors = (json.errors ?? []).map((e) => String(e.message ?? e).replace(/\d{15,}/g, '<id>')).slice(0, 3);
  if (!res.ok || errors.length || json.success === false) throw new Error(`${path} HTTP ${res.status}: ${errors.join('; ') || 'no detail'}`);
  return json;
};
const gql = async (query: string, variables: Record<string, unknown> = {}) => (await cf('/graphql', { query, variables })).data;

// ---------------------------------------------------------------- 1. introspection: where each field lives

interface TypeRef {
  name: string | null;
  kind: string;
  ofType?: TypeRef | null;
}
// Cloudflare names its wrapper types (NON_NULL, LIST) "" rather than null (CI run 39382439208), so `||`, never `??`.
const named = (t: TypeRef | null | undefined): string | null => (!t ? null : t.name || named(t.ofType));
// One __schema read, resolved in memory.
const T = 'name kind ofType { name kind ofType { name kind ofType { name kind ofType { name kind } } } }';
const schemaRead = (
  await gql(`{ __schema { queryType { name } types { name kind fields { name type { ${T} } args { name type { ${T} } } } inputFields { name } } } }`)
).__schema as { queryType: { name: string }; types: { name: string; kind: string; fields: any[] | null; inputFields: { name: string }[] | null }[] };
const types = new Map(schemaRead.types.map((t) => [t.name, t]));
console.log(`schema: ${types.size} types; query type ${schemaRead.queryType.name}`);
async function typeOf(name: string) {
  const t = types.get(name);
  if (!t) console.log(`introspection: type ${JSON.stringify(name)} not in the schema; types like it: ${[...types.keys()].filter((n) => n.toLowerCase().includes(String(name).toLowerCase().slice(0, 5))).slice(0, 10).join(', ')}`);
  return t ?? null;
}

const DATASETS = ['workersInvocationsAdaptive', 'd1AnalyticsAdaptiveGroups', 'd1StorageAdaptiveGroups', 'd1QueriesAdaptiveGroups'] as const;
const WANTED = ['requests', 'rowsRead', 'rowsWritten', 'databaseSizeBytes'] as const;

/** dataset → block (sum, max, …) → field names; plus each dataset's dimensions and filter fields. */
async function introspect() {
  const query = await typeOf(schemaRead.queryType.name);
  const viewerField = query?.fields?.find((f: any) => f.name === 'viewer');
  const viewer = viewerField ? await typeOf(named(viewerField.type)!) : null;
  const accountsField = viewer?.fields?.find((f: any) => f.name === 'accounts');
  const accounts = accountsField ? await typeOf(named(accountsField.type)!) : null;
  if (!accounts?.fields)
    throw new Error(`introspection: no accounts type (viewer field ${JSON.stringify(viewerField?.type ?? null)}, accounts field ${JSON.stringify(accountsField?.type ?? null)})`);
  const out: Record<string, { blocks: Record<string, string[]>; dimensions: string[]; filter: string[] }> = {};
  for (const ds of DATASETS) {
    const f = accounts.fields.find((x: any) => x.name === ds);
    if (!f) continue;
    const t = await typeOf(named(f.type)!);
    if (!t?.fields) continue;
    const filterArg = (f.args ?? []).find((a: any) => a.name === 'filter');
    const filter = filterArg ? ((await typeOf(named(filterArg.type)!))?.inputFields ?? []).map((x: any) => x.name) : [];
    const blocks: Record<string, string[]> = {};
    let dimensions: string[] = [];
    for (const b of t.fields) {
      const bt = named(b.type);
      if (!bt) continue;
      const inner = await typeOf(bt);
      if (!inner?.fields) continue; // a scalar (count, …)
      const names = inner.fields.map((x: any) => x.name as string);
      if (b.name === 'dimensions') dimensions = names;
      else blocks[b.name] = names;
    }
    out[ds] = { blocks, dimensions, filter };
  }
  // Is there a dataset for Workers Logs events? Named candidates only; their fields are not used unless confirmed.
  const logsCandidates = accounts.fields.map((x: any) => x.name as string).filter((n: string) => /observ|telemetry|workersLog|logEvent/i.test(n));
  return { datasets: out, logsCandidates };
}

const problems: string[] = [];
const notes: string[] = [];
/** null until usage_daily has been read (unknown counts as a change, scripts/ci/alarm.ts). */
let previousFailing: boolean | null = null;
const DAY = 86_400_000;
let summaryLine = '';
try {
/**
 * How a dataset is filtered and grouped by UTC day, from its introspected filter and dimension names: date_geq/date_leq
 * with the date dimension (the D1 docs' example), else datetime_geq/datetime_leq with date, datetimeHour or datetime.
 */
function dayShape(ds: { dimensions: string[]; filter: string[] }) {
  const dim = ['date', 'datetimeHour', 'datetime'].find((d) => ds.dimensions.includes(d));
  if (!dim) return null;
  if (ds.filter.includes('date_geq') && ds.filter.includes('date_leq')) return { dim, geq: 'date_geq', leq: 'date_leq', type: 'Date', day: true };
  if (ds.filter.includes('datetime_geq') && ds.filter.includes('datetime_leq')) return { dim, geq: 'datetime_geq', leq: 'datetime_leq', type: 'Time', day: false };
  return null;
}
const found = await introspect();
/** The first dataset/block holding each wanted field (sum before max for counts; max for a size). */
const where: Partial<Record<(typeof WANTED)[number], { dataset: string; block: string }>> = {};
for (const field of WANTED)
  for (const ds of DATASETS) {
    const blocks = found.datasets[ds]?.blocks ?? {};
    const order = field === 'databaseSizeBytes' ? ['max', 'sum', 'avg'] : ['sum', 'max'];
    const block = order.find((b) => blocks[b]?.includes(field));
    if (block && !where[field]) where[field] = { dataset: ds, block };
  }
console.log(
  JSON.stringify({
    introspection: Object.fromEntries(
      Object.entries(found.datasets).map(([ds, v]) => [
        ds,
        {
          blocks_with_wanted_fields: Object.fromEntries(Object.entries(v.blocks).map(([b, f]) => [b, f.filter((x) => (WANTED as readonly string[]).includes(x))]).filter(([, f]) => f.length)),
          dimensions_date: v.dimensions.filter((d) => /^(date|datetimeHour|datetime|databaseId|scriptName)$/.test(d)),
          filter_date: v.filter.filter((x) => /^(date|datetime)_(geq|leq)$/.test(x)),
          day_shape: dayShape(v),
        },
      ]),
    ),
    resolved: where,
    workers_logs_dataset_candidates: found.logsCandidates,
  }),
);
const missing = WANTED.filter((f) => !where[f]);
for (const f of WANTED) {
  const w = where[f];
  if (!w) continue;
  const ds = found.datasets[w.dataset];
  if (!dayShape(ds)) missing.push(f);
  if (f === 'databaseSizeBytes' && !ds.dimensions.includes('databaseId')) missing.push(f);
}
if (missing.length) throw new Error(`introspection: no usable dataset for ${[...new Set(missing)].join(', ')}`);
if (args['introspect-only']) {
  // One small query against a D1 dataset: yesterday's account-wide rows read (order 8, ITEM 0).
  const y = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const w = where.rowsRead!;
  const s = dayShape(found.datasets[w.dataset])!;
  const data = await gql(
    `query($a: String!, $f: ${s.type}!, $t: ${s.type}!) { viewer { accounts(filter: { accountTag: $a }) { ${w.dataset}(limit: 100, filter: { ${s.geq}: $f, ${s.leq}: $t }) { ${w.block} { rowsRead } dimensions { ${s.dim} } } } } }`,
    s.day ? { a: account, f: y, t: y } : { a: account, f: `${y}T00:00:00Z`, t: `${y}T23:59:59Z` },
  );
  const rows = (data.viewer.accounts[0]?.[w.dataset] ?? []) as any[];
  console.log(`D1 probe: ${w.dataset}.${w.block}.rowsRead for ${y} (filter ${s.geq}, dimension ${s.dim}): ${rows.reduce((n, r) => n + (Number(r[w.block].rowsRead) || 0), 0)} (${rows.length} group(s))`);
  process.exit(0);
}

// ---------------------------------------------------------------- 2. the figures

// Order 10: the figures are account-wide; each copy's database gets the same rows (usage.yml runs once per copy), so
// /guildcraft status shows the account-wide figures in both apps.
const db = remoteDb({ accountId: account, apiToken: token, databaseId: copyDatabaseId() });
const [existing] = await db.all<{ n: number; last: string | null }>('SELECT count(*) AS n, max(measured_at) AS last FROM usage_daily');
// The previous state: failing when the last figures written are older than the alarm window.
previousFailing = existing.last ? Date.now() - Date.parse(existing.last) > STALE_MS - 6 * 3_600_000 : null;
const days = Number(args.days) || (existing.n ? 2 : 7);
const today = Date.parse(new Date().toISOString().slice(0, 10));
const dayList = Array.from({ length: days }, (_, i) => new Date(today - (i + 1) * DAY).toISOString().slice(0, 10)).reverse();
const first = dayList[0];
const last = dayList.at(-1)!;

async function daily(field: (typeof WANTED)[number]): Promise<Map<string, number>> {
  const w = where[field]!;
  const s = dayShape(found.datasets[w.dataset])!;
  const perDb = field === 'databaseSizeBytes';
  const data = await gql(
    `query($a: String!, $f: ${s.type}!, $t: ${s.type}!) { viewer { accounts(filter: { accountTag: $a }) {
      ${w.dataset}(limit: 10000, filter: { ${s.geq}: $f, ${s.leq}: $t }) { ${w.block} { ${field} } dimensions { ${s.dim} ${perDb ? 'databaseId' : ''} } } } } }`,
    s.day ? { a: account, f: first, t: last } : { a: account, f: `${first}T00:00:00Z`, t: `${last}T23:59:59Z` },
  );
  const rows = (data.viewer.accounts[0]?.[w.dataset] ?? []) as any[];
  // A read that fills its limit may be cut short: a failed measurement, never an undercount.
  if (rows.length >= 10000) throw new Error(`${w.dataset}: ${rows.length} groups, at the query limit: the figures may be incomplete`);
  const out = new Map<string, number>();
  if (perDb && s.dim !== 'date') {
    // Storage by hour or finer: each database's largest size per day, then summed over the databases.
    const max = new Map<string, number>();
    for (const r of rows) {
      const k = `${String(r.dimensions[s.dim]).slice(0, 10)}|${r.dimensions.databaseId}`;
      max.set(k, Math.max(max.get(k) ?? 0, Number(r[w.block][field]) || 0));
    }
    for (const [k, v] of max) out.set(k.slice(0, 10), (out.get(k.slice(0, 10)) ?? 0) + v);
    return out;
  }
  // Counts: summed per day. Storage by date: each database's size that day, summed over the account's databases
  // ("5 GB (total)").
  for (const r of rows) {
    const d = String(r.dimensions[s.dim]).slice(0, 10);
    out.set(d, (out.get(d) ?? 0) + (Number(r[w.block][field]) || 0));
  }
  return out;
}

async function logsEvents(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const d of dayList) {
    const from = Date.parse(d);
    // Only whole days still inside the 3-day retention.
    if (from < Date.now() - 72 * 3_600_000 + 10 * 60_000) continue;
    const r = await cf(`/accounts/${account}/workers/observability/telemetry/query`, {
      queryId: `usage-logs-${d}`,
      timeframe: { from, to: from + DAY - 1 },
      view: 'calculations',
      dry: true,
      parameters: { calculations: [{ operator: 'count', alias: 'n' }], groupBys: [{ type: 'string', value: '$metadata.type' }], limit: 50 },
    });
    const aggs = (r.result?.calculations?.[0]?.aggregates ?? []) as any[];
    out.set(d, aggs.reduce((s, a) => s + (Number(a.count ?? a.value) || 0), 0));
  }
  return out;
}

const metricField: Record<Exclude<Metric, 'workers_logs_events'>, (typeof WANTED)[number]> = {
  workers_requests: 'requests',
  d1_rows_read: 'rowsRead',
  d1_rows_written: 'rowsWritten',
  d1_storage_bytes: 'databaseSizeBytes',
};
const measuredAt = new Date().toISOString();
const rows: { metric: Metric; day: string; value: number }[] = [];
for (const [metric, field] of Object.entries(metricField) as [Metric, (typeof WANTED)[number]][]) {
  const m = await daily(field);
  for (const d of dayList) if (m.has(d)) rows.push({ metric, day: d, value: Math.round(m.get(d)!) });
}
try {
  const logs = await logsEvents();
  for (const [d, v] of logs) rows.push({ metric: 'workers_logs_events', day: d, value: v });
} catch (e) {
  // "if they can be queried" (order 8): a note, not a failure; status shows the metric as not measured.
  notes.push(`Workers Logs events unread: ${e instanceof Error ? e.message : String(e)}`);
}
for (const n of notes) console.log(`note: ${n}`);

// An implausible control is presumed broken: the */15 cron alone makes 96 Worker requests a day, and the board
// sweep reads D1 on each of them, so a zero (or missing) yesterday for either is a failed measurement. Storage is
// sampled on its own schedule (unverified when yesterday's lands), so a missing day there is a note: the day is not
// written and status shows the last day measured.
const y = dayList.at(-1)!;
for (const m of ['workers_requests', 'd1_rows_read'] as Metric[])
  if (!(rows.find((r) => r.metric === m && r.day === y)?.value ?? 0)) problems.push(`${m} reads 0 for ${y}: implausible`);
if (!rows.some((r) => r.metric === 'd1_storage_bytes' && r.day === y && r.value > 0)) console.log(`note: d1_storage_bytes: no figure for ${y} yet`);
for (let i = rows.length - 1; i >= 0; i--) if (rows[i].metric === 'd1_storage_bytes' && rows[i].value <= 0) rows.splice(i, 1);

console.log('\nmetric\tday\tvalue\tof limit');
for (const r of rows) console.log([r.metric, r.day, r.value, `${((r.value / FREE_LIMITS[r.metric].limit) * 100).toFixed(2)}%`].join('\t'));

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql = rows.map(
  (r) =>
    `INSERT INTO usage_daily (day, metric, value, measured_at) VALUES (${lit(r.day)}, ${lit(r.metric)}, ${r.value}, ${lit(measuredAt)}) ON CONFLICT (metric, day) DO UPDATE SET value = excluded.value, measured_at = excluded.measured_at`,
);
if (problems.length) {
  // A failed measurement writes nothing: a false zero would read as "under" (a false "back under" warning) and
  // would refresh measured_at, hiding the failing state from the next run's alarm.
  console.log(`\nNOT WRITTEN: ${problems.length} implausible reading(s); usage_daily is left as it was`);
} else if (args['dry-run']) {
  console.log(`\nDRY RUN: would upsert ${sql.length} usage_daily row(s); nothing written. First statement:\n${sql[0] ?? '(none)'}`);
} else if (sql.length) {
  const meta = await db.run(sql);
  console.log(`\nwrote ${meta.reduce((s, m) => s + m.changes, 0)} usage_daily row change(s) for ${days} day(s), ${first}..${last}`);
}
// Order 9 (read only): the review channel's usage warnings as the Worker recorded them, posted or refused. The log is
// public, so no guild id: metric, state, day and outcome only.
const posted = await db.all<{ target: string; detail_json: string; created_at: string }>(
  "SELECT target, detail_json, created_at FROM audit_log WHERE action = 'usage.alert' ORDER BY id DESC LIMIT 20",
);
console.log(`\nusage.alert rows (newest first, ${posted.length}):`);
for (const a of posted) {
  const d = (() => { try { return JSON.parse(a.detail_json) as { state?: string; day?: string; value?: number; failed?: number; wanted?: string }; } catch { return {}; } })();
  console.log([a.created_at, a.target, d.failed ? `refused HTTP ${d.failed} (wanted ${d.wanted})` : `posted ${d.state}`, d.day, d.value].join('\t'));
}
summaryLine = `usage: ${rows.length} figure(s), ${first}..${last}${args['dry-run'] ? ' (dry run)' : ''}`;
} catch (e) {
  // A GraphQL outage or schema drift is this job's failure too, and goes through the same alarm.
  problems.push(e instanceof Error ? e.message : String(e));
}

alarm({ job: 'usage', failed: problems.length > 0, reason: problems.join('; '), previousFailing });
if (!problems.length) summary(summaryLine);

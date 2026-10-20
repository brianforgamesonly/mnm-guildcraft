// Reads the dev Worker's interactions back from Workers Logs (orders 3 and 4) and prints, per path
// (interaction kind + command + focused option), the sample count and p50/p95 of:
//   wall_ms / cpu_ms: the platform's own per-invocation figures ($workers.wallTimeMs / cpuTimeMs);
//   io_ms, q:         from the Worker's timing line (src/telemetry.ts): D1 and network waits, query count.
// With REQUESTS=1 it also prints one line per request (time, path, outcome, status, wall, cpu, q, errors).
// API: POST /accounts/{id}/workers/observability/telemetry/query (token permission "Workers Observability Write").
// Usage: node scripts/bench/timings.mjs [hours=72]
//   Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; optional FROM / TO (ISO times, override hours),
//   REQUESTS=1 (per-request lines).
// Prints figures only, never a credential. Digit runs of 15+ (Discord ids) are redacted from every printed string.
//
// Order 4 fix: Workers Logs stores a JSON log line as an object under `source`, not as a `message`
// string, so order 3's reader matched none of the timing lines. Both forms are read now, and the
// population (all events in the window, by type) is counted first so a short read shows as one.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { alarm, summary } from '../ci/alarm.ts';
import { DROP_BOUND_CONFIDENCE, DROP_BOUND_MIN_N, DROP_BOUND_THRESHOLD, DROP_HISTORY_DAYS, explainGaps, INGEST_GRACE_MS, reconcile, rollHistory, SLOT_MS } from './logs-check.mjs';

const SCRIPT = 'mnm-guildcraft-dev';
const hours = Math.min(72, Math.max(1, Number(process.argv[2]) || 72));
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');

const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`;
const to = process.env.TO ? Date.parse(process.env.TO) : Date.now();
const from = process.env.FROM ? Date.parse(process.env.FROM) : to - hours * 3_600_000;
if (!(from < to)) throw new Error('FROM must be before TO');
const perRequest = process.env.REQUESTS === '1';
const SCRIPT_FILTER = { key: '$workers.scriptName', operation: 'eq', type: 'string', value: SCRIPT };

const redact = (s) => String(s).replace(/\d{15,}/g, '<id>');

async function query(body) {
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    console.log(JSON.stringify({ http: res.status, errors: (json.errors ?? []).map((e) => ({ code: e.code, message: redact(e.message) })) }));
    console.log('Read-back failed. If this is an authorization error, the API token needs the account permission "Workers Observability Write" (the repository owner adds it).');
    process.exit(1);
  }
  return json.result ?? {};
}

// 1. The population: every event in the window, counted by the platform, grouped by event type.
const counted = await query({
  queryId: `timings-count-${to}`,
  timeframe: { from, to },
  view: 'calculations',
  dry: true,
  parameters: {
    filters: [SCRIPT_FILTER],
    calculations: [{ operator: 'count', alias: 'n' }],
    groupBys: [{ type: 'string', value: '$metadata.type' }],
    limit: 50,
  },
});
const groups = (counted.calculations?.[0]?.aggregates ?? []).map((a) => ({ type: a.groups?.[0]?.value ?? null, n: a.count ?? a.value }));
const population = groups.reduce((s, g) => s + (Number(g.n) || 0), 0);

// Order 7 (ITEM 1.1): the same count with no filter at all, by script, dataset and type, so an event that lacks
// $workers.scriptName (and so escapes the filter above) shows as a group of its own.
// (A three-way groupBy with an empty filter list came back empty on 2026-10-20, so: one key per query, no filters key.)
const unfilteredGroups = {};
for (const key of ['$workers.scriptName', 'dataset', '$metadata.type']) {
  const u = await query({
    queryId: `timings-unfiltered-${key}-${to}`,
    timeframe: { from, to },
    view: 'calculations',
    dry: true,
    parameters: { calculations: [{ operator: 'count', alias: 'n' }], groupBys: [{ type: 'string', value: key }], limit: 50 },
  });
  const rows = (u.calculations?.[0]?.aggregates ?? []).map((a) => ({ value: a.groups?.[0]?.value ?? null, n: Number(a.count ?? a.value) || 0 }));
  // Public logs: other Workers in the account are never named, only counted together.
  unfilteredGroups[key] =
    key === '$workers.scriptName'
      ? [...rows.filter((x) => x.value === SCRIPT || x.value === null), { value: '(other scripts)', n: rows.filter((x) => x.value !== SCRIPT && x.value !== null).reduce((s, x) => s + x.n, 0) }]
      : rows;
}

// 2. The events themselves, paged by cursor. Order 7: a read that stops at the page cap is reported, never silent.
const PAGE_CAP = 50;
const events = [];
let offset;
let pages = 0;
let pageCapHit = false;
for (let page = 0; page < PAGE_CAP; page++) {
  pages++;
  if (page === PAGE_CAP - 1) pageCapHit = true;
  const result = await query({
    queryId: `timings-events-${to}`,
    timeframe: { from, to },
    view: 'events',
    limit: 2000,
    dry: true,
    ...(offset ? { offset, offsetDirection: 'next' } : {}),
    parameters: { filters: [SCRIPT_FILTER] },
  });
  const batch = result.events?.events ?? (Array.isArray(result.events) ? result.events : []);
  if (!batch.length) {
    pageCapHit = false;
    break;
  }
  events.push(...batch);
  const next = batch.at(-1)?.$metadata?.id;
  if (!next || next === offset || batch.length < 2000) {
    pageCapHit = false;
    break;
  }
  offset = next;
}

/** Finds the first value under `key` anywhere in an event (field placement differs between event kinds). */
function find(obj, key, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  if (key in obj) return obj[key];
  for (const v of Object.values(obj)) {
    const hit = find(v, key, depth + 1);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** A structured line (gc = 'interaction' or 'board'), whether stored parsed (`source`) or as a message string. */
function timingOf(e, gc = 'interaction') {
  if (e.source && typeof e.source === 'object' && e.source.gc === gc) return e.source;
  for (const m of [e.$metadata?.message, find(e, 'message'), ...(Array.isArray(find(e, 'messages')) ? find(e, 'messages') : [])]) {
    if (typeof m !== 'string') continue;
    const at = m.indexOf(`{"gc":"${gc}"`);
    if (at !== -1)
      try {
        return JSON.parse(m.slice(at));
      } catch {}
  }
  return undefined;
}

// Group by request: the invocation event carries wall/cpu/outcome/status, the log event our timing line.
const byRequest = new Map();
let maxEventSize = 0;
for (const e of events) {
  const id = e.$workers?.requestId ?? e.$metadata?.requestId ?? find(e, 'requestId');
  if (id === undefined) continue;
  const r = byRequest.get(id) ?? { errors: [] };
  const w = e.$workers ?? {};
  if (typeof w.wallTimeMs === 'number') r.wall = w.wallTimeMs;
  if (typeof w.cpuTimeMs === 'number') r.cpu = w.cpuTimeMs;
  if (w.outcome) r.outcome = w.outcome;
  const status = w.event?.response?.status ?? e.$metadata?.statusCode;
  if (typeof status === 'number') r.status = status;
  if (w.event?.request?.method) r.method = w.event.request.method;
  if (w.eventType) r.eventType = w.eventType;
  if (w.truncated) r.truncated = true;
  const size = Number(e.$metadata?.eventSize);
  if (size > maxEventSize) maxEventSize = size;
  r.at = Math.min(r.at ?? Infinity, Number(e.timestamp) || Infinity);
  const t = timingOf(e);
  if (t) r.line = t;
  const b = timingOf(e, 'board');
  if (b) r.board = b;
  const level = e.$metadata?.level ?? e.source?.level;
  if (e.$metadata?.error || level === 'error') r.errors.push(redact(e.$metadata?.error ?? e.$metadata?.message ?? JSON.stringify(e.source)).slice(0, 400));
  byRequest.set(id, r);
}

const pct = (xs, p) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const pathOf = (r) => (r.line ? `${r.line.kind} ${r.line.cmd ?? ''}`.trim() : r.board ? `board ${r.board.trigger}` : `(no timing line) ${r.method ?? ''}`.trim());
const paths = new Map();
const meta = { colos: new Set(), d1Regions: new Set() };
for (const r of byRequest.values()) {
  const key = pathOf(r);
  const p = paths.get(key) ?? { n: 0, wall: [], cpu: [], io: [], q: [] };
  p.n++;
  p.wall.push(r.wall);
  p.cpu.push(r.cpu);
  p.io.push(r.line?.io_ms);
  p.q.push(r.line?.q);
  paths.set(key, p);
  if (r.line?.colo) meta.colos.add(r.line.colo);
  if (r.line?.d1_region) meta.d1Regions.add(r.line.d1_region);
}

console.log(
  JSON.stringify({
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    population_by_type: groups,
    population,
    events_read: events.length,
    requests: byRequest.size,
    requests_with_timing_line: [...byRequest.values()].filter((r) => r.line).length,
    worker_colos: [...meta.colos],
    d1_regions: [...meta.d1Regions],
    // Order 7: the unfiltered population, the pages read, and the largest event against the 256 KB limit.
    unfiltered_by_script_dataset_type: unfilteredGroups,
    pages,
    page_cap_hit: pageCapHit,
    max_event_size_bytes: maxEventSize || null,
    truncated_events: [...byRequest.values()].filter((r) => r.truncated).length,
  }),
);
let readShort = false;
if (population && events.length < population) {
  readShort = true;
  console.log(`WARNING: read ${events.length} of ${population} events in the window; figures below cover only those read.`);
}
if (pageCapHit) {
  readShort = true;
  console.log(`WARNING: stopped at the ${PAGE_CAP}-page cap; the read is incomplete.`);
}
// p95 only from 20 samples up (order 4, ITEM 2.1).
const p95 = (xs, n) => (n >= 20 ? pct(xs, 95) : '-');
console.log('path\tn\twall_p50\twall_p95\tcpu_p50\tcpu_p95\tio_p50\tio_p95\tqueries_max');
for (const [k, p] of [...paths].sort()) {
  const qs = p.q.filter((x) => typeof x === 'number');
  console.log([k, p.n, pct(p.wall, 50), p95(p.wall, p.n), pct(p.cpu, 50), p95(p.cpu, p.n), pct(p.io, 50), p95(p.io, p.n), qs.length ? Math.max(...qs) : null].join('\t'));
}
/**
 * Order 4's definition of a failed request: an exception, an outcome other than ok, a status other than 200,
 * or 3 s or more before Discord got its answer. A deferred request (ack 5/6) answers before any I/O, so its
 * wall time includes the delivery after the answer; for it, a refused delivery or an err counts instead.
 */
const failed = (r) =>
  r.board && !r.line ? r.errors.length > 0 || !!r.board.err || (r.outcome && r.outcome !== 'ok') :
  r.errors.length > 0 || (r.outcome && r.outcome !== 'ok') || (r.status !== undefined && r.status !== 200) || !!r.line?.err ||
  (r.line?.ack ? (r.line.deliveries ?? []).some((d) => d.status < 200 || d.status >= 300) : typeof r.wall === 'number' && r.wall >= 3000);
console.log(`failed requests (order 4 definition): ${[...byRequest.values()].filter(failed).length} of ${byRequest.size}`);
if (perRequest) {
  // Order 5 (ITEM 2): sql_ms / d1_dur are D1's own server-side times, rows its rows read (a game-list cache
  // reload reads the whole list), first = the isolate's first request, idle = ms since this isolate's last D1 call.
  // gap_s = seconds since the previous request of any kind (from the logs, across isolates).
  // Order 6: lag_ms = Discord creating the interaction (its snowflake id) → the Worker receiving it; board = the
  // board run in this request (a sweep, or the refresh after a command): its trigger, calls and what it did.
  const boardOf = (b) => {
    if (!b) return '';
    const res = (b.results ?? []).map((x) =>
      x.locked ? 'locked' : x.no_board ? 'no_board' :
      Object.entries({ c: x.created, e: x.edited, u: x.unarchived, s: x.skipped_unchanged, b: x.bumped, rep: x.replaced, del: x.deleted_old, dirty: x.left_dirty, gone: x.gone, g: x.guarded?.length })
        .filter(([, v]) => v).map(([k, v]) => `${k}${v}`).join(' ') + ` idx:${x.index}${x.rebuild && x.rebuild !== 'none' ? ` rebuild:${x.rebuild}` : ''}${x.in_order === false ? ' OUT_OF_ORDER' : ''}${x.errors?.length ? ` errors:${x.errors.length}` : ''}`,
    );
    return `${b.trigger} d1=${b.d1_calls} discord=${b.discord_calls} [${res.join('; ')}]`;
  };
  console.log('time\tpath\toutcome\tstatus\twall\tcpu\tio\tq\td1_ms\tsql_ms\td1_dur\trows\tfirst\tidle_ms\tgap_s\tlag_ms\tcolo\td1_region\tack\tdeliveries\tboard\tfailed\terrors');
  let prev = null;
  for (const r of [...byRequest.values()].sort((a, b) => a.at - b.at)) {
    const l = r.line ?? r.board;
    console.log(
      [
        new Date(r.at).toISOString(), redact(pathOf(r)), r.outcome, r.status, r.wall, r.cpu, r.line?.io_ms, r.line?.q ?? r.board?.d1_calls, JSON.stringify(r.line?.d1_ms ?? (r.board ? [r.board.first_query_ms] : null)),
        JSON.stringify(r.line?.sql_ms ?? (r.board ? [r.board.first_sql_ms] : null)), JSON.stringify(r.line?.d1_duration ?? null), JSON.stringify(r.line?.rows_read ?? (r.board ? [r.board.first_rows_read] : null)),
        l?.isolate_first_request ?? '', l?.ms_since_last_d1_in_isolate ?? '', prev === null ? '' : ((r.at - prev) / 1000).toFixed(1), r.line?.discord_lag_ms ?? '', r.line?.colo, r.line?.d1_region,
        r.line?.ack ?? '', redact(JSON.stringify(r.line?.deliveries ?? r.board?.calls ?? [])), redact(boardOf(r.board)), failed(r) ? 'FAILED' : '',
        [...r.errors, r.line?.err, r.board?.err, ...(r.board?.results ?? []).flatMap((x) => x.errors ?? [])].filter(Boolean).map(redact).join(' | '),
      ].join('\t'),
    );
    prev = r.at;
  }
}
if (events[0]) {
  const e = events.find((x) => x.source && Object.keys(x.source).length) ?? events[0];
  console.log('field mapping (keys only):', JSON.stringify({ top: Object.keys(e), workers: Object.keys(e.$workers ?? {}), metadata: Object.keys(e.$metadata ?? {}), source: Object.keys(e.source ?? {}) }));
  const cronEvent = events.find((x) => x.$workers?.eventType && x.$workers.eventType !== 'fetch');
  if (cronEvent) console.log('non-fetch event (keys only):', JSON.stringify({ eventType: cronEvent.$workers.eventType, event: Object.keys(cronEvent.$workers.event ?? {}) }));
}

// ---------------------------------------------------------------- order 7, ITEM 1.1: completeness check
// Each event type against its own record (scripts/bench/logs-check.mjs). Order 8 (ITEM 3.1): exits 1 only on a gap
// Cloudflare's analytics does not explain, a short read, or the 7-day drop-rate bound crossing its threshold.
const cf = async (path, init) => {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false && !json.errors?.length, status: res.status, json };
};
const errorsOf = (r) => redact(JSON.stringify((r.json.errors ?? []).map((x) => x.message ?? x).slice(0, 3)));

// The independent records: audit_log rows (D1), deploy times and the schedule's creation (Workers API).
const cfg = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const databaseId = cfg.env.dev.d1_databases[0].database_id;
const auditSql = 'SELECT action, actor, created_at FROM audit_log WHERE created_at >= ? AND created_at <= ? ORDER BY id';
const d1 = await cf(`/accounts/${account}/d1/database/${databaseId}/query`, {
  method: 'POST',
  body: JSON.stringify({ sql: auditSql, params: [new Date(from - 60_000).toISOString(), new Date(to + 60_000).toISOString()] }),
});
const deploysRes = await cf(`/accounts/${account}/workers/scripts/${SCRIPT}/deployments`);
const schedulesRes = await cf(`/accounts/${account}/workers/scripts/${SCRIPT}/schedules`);
const audit = d1.ok ? d1.json.result[0].results.map((x) => ({ action: x.action, actor: x.actor === 'system' ? 'system' : 'member', at: Date.parse(x.created_at) })) : [];
const deploys = (deploysRes.json.result?.deployments ?? []).map((d) => Date.parse(d.created_on)).filter(Number.isFinite);
const schedule = (schedulesRes.json.result?.schedules ?? [])[0];
const cronSince = schedule?.created_on ? Date.parse(schedule.created_on) : null;
console.log(
  JSON.stringify({
    records: {
      audit_rows: d1.ok ? audit.length : `unread: HTTP ${d1.status} ${errorsOf(d1)}`,
      deployments: deploysRes.ok ? deploys.filter((d) => d >= from - 86_400_000).map((d) => new Date(d).toISOString()) : `unread: HTTP ${deploysRes.status} ${errorsOf(deploysRes)}`,
      schedule: schedulesRes.ok ? (schedulesRes.json.result?.schedules ?? []).map((s) => ({ cron: s.cron, created_on: s.created_on, modified_on: s.modified_on })) : `unread: HTTP ${schedulesRes.status} ${errorsOf(schedulesRes)}`,
    },
  }),
);

const requestsForCheck = [...byRequest.values()].map((r) => ({
  at: r.at,
  path: pathOf(r),
  // A command's own board refresh also logs a board line, so only the platform's event type marks a cron run.
  kind: r.eventType === 'scheduled' ? 'cron' : r.line && r.line.kind !== 'ping' ? 'interaction' : 'other',
  // A read names its audit action (audit), or the action whose write failed (audit_failed): either way a row is owed.
  audit: r.line?.audit ?? r.line?.audit_failed ?? null,
}));
const check = reconcile({ from, to, requests: requestsForCheck, audit, deploys, cronSince });
console.log('\ncompleteness check (order 7): expected vs found per event type');
console.log('type\texpected\tfound\tmissing\tnote');
for (const r of check.rows) console.log([r.type, r.expected, r.found, r.missing.join(' ') || '-', r.note ?? ''].join('\t'));

// A second, separate pipeline: Cloudflare's invocation analytics (GraphQL), per 15-minute slot, against the logs.
// Not every token can read it; a refusal is printed and does not fail the check.
const gql = await cf('/graphql', {
  method: 'POST',
  body: JSON.stringify({
    query: `query($a: String!, $s: String!, $f: Time!, $t: Time!) { viewer { accounts(filter: { accountTag: $a }) {
      workersInvocationsAdaptive(limit: 5000, filter: { scriptName: $s, datetime_geq: $f, datetime_leq: $t }) { sum { requests errors } dimensions { datetime status } } } } }`,
    variables: { a: account, s: SCRIPT, f: new Date(from).toISOString(), t: new Date(to).toISOString() },
  }),
});
const inv = gql.json?.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
const settled = to - INGEST_GRACE_MS;
// Order 8 (ITEM 3.1): the missing events that have an independent record, to be explained by analytics or not.
const gaps = [];
for (const r of check.rows) {
  if (r.type.startsWith('cron run')) for (const s of r.missing) gaps.push({ at: Date.parse(s), what: `cron run ${s}` });
  else if (r.type.startsWith('audit ')) for (const s of r.missing) gaps.push({ at: Date.parse(s), what: `${r.type} ${s}` });
}
// A read that named its audit row with no row behind it is a D1 write gap, not a logs gap: analytics cannot explain it.
const unexplained = check.rows.filter((r) => !r.type.startsWith('cron run') && !r.type.startsWith('audit ')).flatMap((r) => r.missing.map((m) => `${r.type}: ${m}`));
let explained = { drops: 0, invocations: 0, dropSlots: [], explained: [], unexplained: [] };
if (!gql.ok || !inv) {
  console.log(`invocation analytics (GraphQL): unread, HTTP ${gql.status} ${errorsOf(gql)}`);
  unexplained.push(...gaps.map((g) => `${g.what}: missing, and analytics unread`));
} else {
  const slot = (ms) => new Date(Math.floor(ms / SLOT_MS) * SLOT_MS).toISOString().slice(0, 16);
  const analytics = new Map();
  for (const x of inv) {
    const k = slot(Date.parse(x.dimensions.datetime));
    const a = analytics.get(k) ?? { requests: 0, ok: 0 };
    a.requests += x.sum.requests ?? 0;
    if (x.dimensions.status === 'success') a.ok += x.sum.requests ?? 0;
    analytics.set(k, a);
  }
  const logged = new Map();
  for (const r of byRequest.values()) logged.set(slot(r.at), (logged.get(slot(r.at)) ?? 0) + 1);
  const keys = [...new Set([...analytics.keys(), ...logged.keys()])].sort();
  const differ = keys.filter((k) => (analytics.get(k)?.requests ?? 0) !== (logged.get(k) ?? 0));
  console.log(`invocation analytics (GraphQL): ${[...analytics.values()].reduce((a, b) => a + b.requests, 0)} invocations vs ${byRequest.size} logged requests; slots that differ: ${differ.length}`);
  for (const k of differ) {
    const rows = inv.filter((x) => slot(Date.parse(x.dimensions.datetime)) === k).map((x) => `${x.dimensions.datetime.slice(11, 19)} ${x.dimensions.status} ×${x.sum.requests}`);
    const seen = [...byRequest.values()].filter((r) => slot(r.at) === k).map((r) => `${new Date(r.at).toISOString().slice(11, 19)} ${redact(pathOf(r))}`);
    console.log(`  ${k}Z\tanalytics ${analytics.get(k)?.requests ?? 0} [${rows.join(', ')}]\tlogged ${logged.get(k) ?? 0} [${seen.join(', ')}]`);
  }
  explained = explainGaps({ analytics, logged, gaps, settled });
  unexplained.push(...explained.unexplained);
}

// The drop rate over a rolling 7 days (the history comes from the previous scheduled run's artifact).
let history = [];
if (process.env.DROP_HISTORY_IN && existsSync(process.env.DROP_HISTORY_IN)) {
  try {
    history = JSON.parse(readFileSync(process.env.DROP_HISTORY_IN, 'utf8'));
  } catch {
    console.log('drop history unreadable: starting a new one');
  }
}
const previousBreach = history.length ? !!history.at(-1).breach : null;
const rolled = rollHistory(history, { from: new Date(from).toISOString(), to: new Date(to).toISOString(), drops: explained.drops, invocations: explained.invocations }, to);
rolled.history.at(-1).breach = rolled.breach;
if (process.env.DROP_HISTORY_OUT) writeFileSync(process.env.DROP_HISTORY_OUT, JSON.stringify(rolled.history));

const rate = (x) => `${(x * 100).toFixed(1)}%`;
summary(`\n### Logs completeness (order 8 rule) ${new Date(from).toISOString()} → ${new Date(to).toISOString()}`);
summary(`- platform drops (missing from Workers Logs, counted as successes by Cloudflare analytics): ${explained.drops} of ${explained.invocations} invocations${explained.dropSlots.length ? ` (${explained.dropSlots.map((d) => `${d.slot} ×${d.n}`).join(', ')})` : ''}`);
for (const e of explained.explained) summary(`  - explained: ${e}`);
summary(
  `- rolling ${DROP_HISTORY_DAYS} days (${rolled.history.length} window(s)): ${rolled.drops} drops of ${rolled.invocations} invocations; ${DROP_BOUND_CONFIDENCE * 100}% upper bound ${rate(rolled.bound)} (exact binomial, one-sided) against the threshold ${rate(DROP_BOUND_THRESHOLD)}${rolled.judged ? '' : ` — not judged: under ${DROP_BOUND_MIN_N} invocations`}`,
);
for (const u of unexplained) summary(`  - UNEXPLAINED: ${u}`);

const reasons = [readShort && 'the reader came up short', !d1.ok && 'audit rows unread', unexplained.length && `${unexplained.length} unexplained gap(s)`].filter(Boolean);
// Unexplained gaps belong to their own window (scheduled windows do not overlap), so each is a new state: it notifies.
// The drop-rate bound is one rolling state: it notifies only on crossing the threshold (scripts/ci/alarm.ts).
if (reasons.length) alarm({ job: 'logs completeness', failed: true, reason: reasons.join('; '), previousFailing: null });
else alarm({ job: 'logs completeness (drop-rate bound)', failed: rolled.breach, reason: `drop-rate upper bound ${rate(rolled.bound)} over ${rate(DROP_BOUND_THRESHOLD)}`, previousFailing: previousBreach });

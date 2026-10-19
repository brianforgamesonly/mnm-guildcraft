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
    console.log('Read-back failed. If this is an authorization error, the API token needs the account permission "Workers Observability Write" (Brian adds it).');
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

// 2. The events themselves, paged by cursor.
const events = [];
let offset;
for (let page = 0; page < 50; page++) {
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
  if (!batch.length) break;
  events.push(...batch);
  const next = batch.at(-1)?.$metadata?.id;
  if (!next || next === offset) break;
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

/** The timing line, whether stored parsed (`source`) or as a message string. */
function timingOf(e) {
  if (e.source && typeof e.source === 'object' && e.source.gc === 'interaction') return e.source;
  for (const m of [e.$metadata?.message, find(e, 'message'), ...(Array.isArray(find(e, 'messages')) ? find(e, 'messages') : [])]) {
    if (typeof m !== 'string') continue;
    const at = m.indexOf('{"gc":"interaction"');
    if (at !== -1)
      try {
        return JSON.parse(m.slice(at));
      } catch {}
  }
  return undefined;
}

// Group by request: the invocation event carries wall/cpu/outcome/status, the log event our timing line.
const byRequest = new Map();
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
  r.at = Math.min(r.at ?? Infinity, Number(e.timestamp) || Infinity);
  const t = timingOf(e);
  if (t) r.line = t;
  const level = e.$metadata?.level ?? e.source?.level;
  if (e.$metadata?.error || level === 'error') r.errors.push(redact(e.$metadata?.error ?? e.$metadata?.message ?? JSON.stringify(e.source)).slice(0, 400));
  byRequest.set(id, r);
}

const pct = (xs, p) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const pathOf = (r) => (r.line ? `${r.line.kind} ${r.line.cmd ?? ''}`.trim() : `(no timing line) ${r.method ?? ''}`.trim());
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
  }),
);
if (population && events.length < population) console.log(`WARNING: read ${events.length} of ${population} events in the window; figures below cover only those read.`);
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
  r.errors.length > 0 || (r.outcome && r.outcome !== 'ok') || (r.status !== undefined && r.status !== 200) || !!r.line?.err ||
  (r.line?.ack ? (r.line.deliveries ?? []).some((d) => d.status < 200 || d.status >= 300) : typeof r.wall === 'number' && r.wall >= 3000);
console.log(`failed requests (order 4 definition): ${[...byRequest.values()].filter(failed).length} of ${byRequest.size}`);
if (perRequest) {
  console.log('time\tpath\toutcome\tstatus\twall\tcpu\tio\tq\td1_ms\tcolo\td1_region\tack\tdeliveries\tfailed\terrors');
  for (const r of [...byRequest.values()].sort((a, b) => a.at - b.at))
    console.log(
      [
        new Date(r.at).toISOString(), redact(pathOf(r)), r.outcome, r.status, r.wall, r.cpu, r.line?.io_ms, r.line?.q, JSON.stringify(r.line?.d1_ms ?? null), r.line?.colo, r.line?.d1_region,
        r.line?.ack ?? '', redact(JSON.stringify(r.line?.deliveries ?? [])), failed(r) ? 'FAILED' : '', [...r.errors, r.line?.err].filter(Boolean).map(redact).join(' | '),
      ].join('\t'),
    );
}
if (events[0]) {
  const e = events.find((x) => x.source && Object.keys(x.source).length) ?? events[0];
  console.log('field mapping (keys only):', JSON.stringify({ top: Object.keys(e), workers: Object.keys(e.$workers ?? {}), metadata: Object.keys(e.$metadata ?? {}), source: Object.keys(e.source ?? {}) }));
}

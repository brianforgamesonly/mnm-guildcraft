// Reads the dev Worker's interactions back from Workers Logs (work order 3, ITEM 3.1 b) and prints, per
// path (interaction kind + command + focused option), the sample count and p50/p95 of:
//   wall_ms / cpu_ms: the platform's own per-invocation figures ($workers.wallTimeMs / cpuTimeMs);
//   io_ms, q:         from the Worker's timing line (src/telemetry.ts): D1 and network waits, query count.
// API: POST /accounts/{id}/workers/observability/telemetry/query (token permission "Workers Observability Write").
// Usage: node scripts/bench/timings.mjs [hours=72]   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID from the environment)
// Prints figures only, never a credential.

const SCRIPT = 'mnm-guildcraft-dev';
const hours = Math.min(72, Math.max(1, Number(process.argv[2]) || 72));
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');

const url = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`;
const to = Date.now();
const from = to - hours * 3_600_000;

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

const events = [];
let offset;
for (let page = 0; page < 20; page++) {
  const body = {
    queryId: `order3-timings-${to}`,
    timeframe: { from, to },
    view: 'events',
    limit: 2000,
    dry: true,
    ...(offset ? { offset } : {}),
    parameters: { filters: [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: SCRIPT }] },
  };
  const res = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    console.log(JSON.stringify({ http: res.status, errors: (json.errors ?? []).map((e) => ({ code: e.code, message: e.message })) }));
    console.log('Read-back failed. If this is an authorization error, the API token needs the account permission "Workers Observability Write" (Brian adds it).');
    process.exit(1);
  }
  const batch = json.result?.events?.events ?? json.result?.events ?? [];
  if (!Array.isArray(batch) || !batch.length) break;
  events.push(...batch);
  offset = batch.at(-1)?.$metadata?.id;
  if (batch.length < 2000 || !offset) break;
}

// Group by request: the invocation log carries wall/cpu, the console line carries our timing JSON.
const byRequest = new Map();
for (const e of events) {
  const id = find(e, 'requestId');
  if (id === undefined) continue;
  const r = byRequest.get(id) ?? {};
  const wall = find(e, 'wallTimeMs');
  const cpu = find(e, 'cpuTimeMs');
  if (typeof wall === 'number') r.wall = wall;
  if (typeof cpu === 'number') r.cpu = cpu;
  const msg = [find(e, 'message'), ...(Array.isArray(find(e, 'messages')) ? find(e, 'messages') : [])].filter((m) => typeof m === 'string');
  for (const m of msg) {
    const at = m.indexOf('{"gc":"interaction"');
    if (at !== -1)
      try {
        r.line = JSON.parse(m.slice(at));
      } catch {}
  }
  byRequest.set(id, r);
}

const pct = (xs, p) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const paths = new Map();
const meta = { colos: new Set(), d1Regions: new Set() };
for (const r of byRequest.values()) {
  if (!r.line) continue;
  const key = `${r.line.kind} ${r.line.cmd ?? ''}`.trim();
  const p = paths.get(key) ?? { wall: [], cpu: [], io: [], q: [] };
  p.wall.push(r.wall);
  p.cpu.push(r.cpu);
  p.io.push(r.line.io_ms);
  p.q.push(r.line.q);
  paths.set(key, p);
  if (r.line.colo) meta.colos.add(r.line.colo);
  if (r.line.d1_region) meta.d1Regions.add(r.line.d1_region);
}

console.log(JSON.stringify({ window_hours: hours, events: events.length, requests_with_timing_line: [...byRequest.values()].filter((r) => r.line).length, worker_colos: [...meta.colos], d1_regions: [...meta.d1Regions] }));
console.log('path\tn\twall_p50\twall_p95\tcpu_p50\tcpu_p95\tio_p50\tio_p95\tqueries_max');
for (const [k, p] of [...paths].sort()) {
  console.log([k, p.io.length, pct(p.wall, 50), pct(p.wall, 95), pct(p.cpu, 50), pct(p.cpu, 95), pct(p.io, 50), pct(p.io, 95), Math.max(...p.q)].join('\t'));
}
if (events[0]) console.log('first event keys (for field mapping):', JSON.stringify(Object.keys(events[0])), JSON.stringify(Object.keys(events[0].$workers ?? {})));

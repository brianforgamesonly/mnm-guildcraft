// Order 38, ITEM 4: one Worker's invocations on the judged UTC day, for the daily health check (scripts/health/run.ts).
//
// Statuses: Cloudflare's GraphQL Analytics API, from both invocation datasets the account schema offers,
// workersInvocationsAdaptive and workersInvocationsScheduled (Cloudflare lists the second beside the first, so cron runs
// are read there too even if the adaptive dataset also counts them). Each dataset's fields, filter and descriptions are
// read from the schema itself (introspection) before it is queried: a field the schema lacks is never assumed, and the
// field descriptions (the unit of cpuTime among them) are printed as the schema states them.
// CPU: the whole Worker's day from the adaptive dataset's quantiles; the sweep and everything else from Workers Logs
// ($workers.cpuTimeMs and $workers.eventType per invocation; "scheduled" is the cron). Figures only, never an alert.
//
// Every read here is GraphQL or Workers Logs: no D1 rows.

import type { StatusCount } from './judge.ts';

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

/** A GraphQL client that throws on an HTTP error or any GraphQL error, so a failed read can never look like no data. */
export function graphql(token: string, fetchImpl: typeof fetch = fetch): Gql {
  return async (query, variables = {}) => {
    const res = await fetchImpl('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(60_000),
    });
    const json = (await res.json().catch(() => ({}))) as { data?: any; errors?: { message?: string }[] | null };
    const errors = (json.errors ?? []).map((e) => String(e.message ?? e).replace(/[0-9a-f]{32}/gi, '<id>')).slice(0, 3);
    if (!res.ok || errors.length || !json.data) throw new Error(`GraphQL HTTP ${res.status}: ${errors.join('; ') || 'no data'}`);
    return json.data;
  };
}

interface TypeRef {
  name: string | null;
  kind: string;
  ofType: TypeRef | null;
}
interface Field {
  name: string;
  description: string | null;
  type: TypeRef;
  args?: { name: string; type: TypeRef }[];
}
const REF = 'name kind ofType { name kind ofType { name kind ofType { name kind } } }';
const TYPE_Q = `query ($n: String!) { __type(name: $n) { name fields { name description type { ${REF} } args { name type { ${REF} } } } inputFields { name description type { ${REF} } } } }`;
const leaf = (t: TypeRef): TypeRef => (t.ofType ? leaf(t.ofType) : t);

/** The invocation datasets read, by their names in the account schema. */
export const DATASETS = ['workersInvocationsAdaptive', 'workersInvocationsScheduled'] as const;

export interface Dataset {
  name: string;
  /** Top-level fields of one group or row. */
  fields: Map<string, Field>;
  /** For each object-typed field (sum, quantiles, max, dimensions…): its own fields. */
  blocks: Map<string, Map<string, Field>>;
  /** The filter's input fields. */
  filter: Set<string>;
}

async function typeOf(gql: Gql, name: string): Promise<{ fields: Field[]; inputFields: Field[] }> {
  const t = (await gql(TYPE_Q, { n: name }))?.__type;
  if (!t) throw new Error(`the schema has no type ${name}`);
  return { fields: t.fields ?? [], inputFields: t.inputFields ?? [] };
}

/** The datasets' shapes, from the schema: the account type's name from the data path, then introspection. */
export async function readSchema(gql: Gql, account: string): Promise<{ datasets: Map<string, Dataset>; missing: string[] }> {
  const d = await gql('query ($a: String!) { viewer { accounts(filter: { accountTag: $a }) { __typename } } }', { a: account });
  const accountType = d?.viewer?.accounts?.[0]?.__typename;
  if (!accountType) throw new Error('the account is not visible to this token');
  const acc = new Map((await typeOf(gql, accountType)).fields.map((f) => [f.name, f]));
  const datasets = new Map<string, Dataset>();
  const missing: string[] = [];
  for (const name of DATASETS) {
    const f = acc.get(name);
    if (!f) {
      missing.push(name);
      continue;
    }
    const row = await typeOf(gql, leaf(f.type).name!);
    const fields = new Map(row.fields.map((x) => [x.name, x]));
    const blocks = new Map<string, Map<string, Field>>();
    for (const x of row.fields) if (leaf(x.type).kind === 'OBJECT') blocks.set(x.name, new Map((await typeOf(gql, leaf(x.type).name!)).fields.map((y) => [y.name, y])));
    const filterArg = f.args?.find((a) => a.name === 'filter');
    const filter = new Set(filterArg ? (await typeOf(gql, leaf(filterArg.type).name!)).inputFields.map((x) => x.name) : []);
    datasets.set(name, { name, fields, blocks, filter });
  }
  return { datasets, missing };
}

/** The query's filter for one Worker and one window, from the fields the schema offers (never assumed). */
function scope(ds: Dataset): string {
  for (const need of ['scriptName', 'datetime_geq', 'datetime_lt'])
    if (!ds.filter.has(need)) throw new Error(`${ds.name}: its filter has no ${need} (it has ${[...ds.filter].slice(0, 12).join(', ')})`);
  return 'filter: { scriptName: $s, datetime_geq: $f, datetime_lt: $t }';
}
const VARS = '$a: String!, $s: String!, $f: Time!, $t: Time!';
const ROW_CAP = 10_000;

/** One dataset's invocations by status for the window. Aggregated groups where the schema has them, else rows counted. */
export async function statusesOf(gql: Gql, ds: Dataset, v: { a: string; s: string; f: string; t: string }): Promise<StatusCount[]> {
  const where = scope(ds);
  const dims = ds.blocks.get('dimensions');
  const out = new Map<string, number>();
  if (dims?.has('status')) {
    const measure = ds.blocks.get('sum')?.has('requests') ? 'sum { requests }' : ds.fields.has('count') ? 'count' : null;
    if (!measure) throw new Error(`${ds.name}: no count field (sum.requests or count) in the schema`);
    const rows = (await gql(`query (${VARS}) { viewer { accounts(filter: { accountTag: $a }) { ${ds.name}(limit: 1000, ${where}) { ${measure} dimensions { status } } } } }`, v))?.viewer?.accounts?.[0]?.[ds.name] ?? [];
    for (const r of rows) out.set(String(r.dimensions.status), (out.get(String(r.dimensions.status)) ?? 0) + Number(r.sum?.requests ?? r.count ?? 0));
  } else if (ds.fields.has('status')) {
    const rows = (await gql(`query (${VARS}) { viewer { accounts(filter: { accountTag: $a }) { ${ds.name}(limit: ${ROW_CAP}, ${where}) { status } } } }`, v))?.viewer?.accounts?.[0]?.[ds.name] ?? [];
    if (rows.length >= ROW_CAP) throw new Error(`${ds.name}: ${ROW_CAP} rows or more, so the count would be incomplete`);
    for (const r of rows) out.set(String(r.status), (out.get(String(r.status)) ?? 0) + 1);
  } else throw new Error(`${ds.name}: no status field in the schema`);
  return [...out].map(([status, count]) => ({ dataset: ds.name, status, count }));
}

/** Nearest-rank quantile of a list (q in 0..1). */
export const quantile = (xs: number[], q: number): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
};
export const cpuLine = (label: string, xs: number[], unit: string) =>
  xs.length ? `${label}: ${xs.length} invocations, CPU p50 ${quantile(xs, 0.5)}, p99 ${quantile(xs, 0.99)}, max ${Math.max(...xs)} (${unit})` : `${label}: no invocations`;

/** The schema's own words for the CPU and status fields, so the unit is the schema's, never inferred. */
export function describe(ds: Dataset): string[] {
  const out: string[] = [];
  const say = (where: string, f: Field | undefined) => f && out.push(`${ds.name} ${where}${f.name}: ${f.description?.replace(/\s+/g, ' ').trim() || '(the schema gives no description)'}`);
  for (const [b, fs] of ds.blocks) for (const f of fs.values()) if (/^cpuTime|^status$/.test(f.name)) say(`${b}.`, f);
  for (const f of ds.fields.values()) if (/^cpuTime|^status$/.test(f.name)) say('', f);
  return out;
}

/** The whole Worker's CPU for the window from the adaptive dataset's quantiles and max, as the schema names them. */
async function adaptiveCpu(gql: Gql, ds: Dataset, v: { a: string; s: string; f: string; t: string }): Promise<string> {
  const q = ['cpuTimeP50', 'cpuTimeP99'].filter((f) => ds.blocks.get('quantiles')?.has(f));
  const m = ds.blocks.get('max')?.has('cpuTime');
  if (!q.length && !m) return `${ds.name}: no CPU fields in the schema`;
  const sel = [q.length ? `quantiles { ${q.join(' ')} }` : '', m ? 'max { cpuTime }' : ''].join(' ');
  const g = (await gql(`query (${VARS}) { viewer { accounts(filter: { accountTag: $a }) { ${ds.name}(limit: 1, ${scope(ds)}) { ${sel} } } } }`, v))?.viewer?.accounts?.[0]?.[ds.name]?.[0];
  return `whole Worker (${ds.name}): cpuTimeP50 ${g?.quantiles?.cpuTimeP50 ?? '-'}, cpuTimeP99 ${g?.quantiles?.cpuTimeP99 ?? '-'}, max cpuTime ${g?.max?.cpuTime ?? '-'} (unit: the schema's description above)`;
}

/**
 * The sweep and everything else, per invocation, from Workers Logs (events view, paged as scripts/bench/timings.mjs reads
 * it): each request's $workers.cpuTimeMs and $workers.eventType. Workers Logs keeps 3 days, so yesterday is there.
 */
export async function logsCpu(o: { token: string; account: string; script: string; from: number; to: number; fetchImpl?: typeof fetch }): Promise<{ sweep: number[]; other: number[]; events: number }> {
  const f = o.fetchImpl ?? fetch;
  const url = `https://api.cloudflare.com/client/v4/accounts/${o.account}/workers/observability/telemetry/query`;
  const byRequest = new Map<string, { cpu?: number; type?: string }>();
  let offset: string | undefined;
  let events = 0;
  for (let page = 0; page < 25; page++) {
    const res = await f(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queryId: `health-cpu-${o.to}-${page}`,
        timeframe: { from: o.from, to: o.to },
        view: 'events',
        limit: 2000,
        dry: true,
        ...(offset ? { offset, offsetDirection: 'next' } : {}),
        parameters: { filters: [{ key: '$workers.scriptName', operation: 'eq', type: 'string', value: o.script }] },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: any; errors?: { code?: number }[] };
    if (!res.ok || json.success === false) throw new Error(`Workers Logs HTTP ${res.status} ${(json.errors ?? []).map((e) => e.code).join(',')}`);
    const batch: any[] = json.result?.events?.events ?? [];
    events += batch.length;
    for (const e of batch) {
      const w = e.$workers ?? {};
      const id = w.requestId ?? e.$metadata?.requestId;
      if (!id) continue;
      const r = byRequest.get(id) ?? {};
      if (typeof w.cpuTimeMs === 'number') r.cpu = w.cpuTimeMs;
      if (w.eventType) r.type = w.eventType;
      byRequest.set(id, r);
    }
    const next = batch.at(-1)?.$metadata?.id;
    if (!next || next === offset || batch.length < 2000) break;
    offset = next;
  }
  const sweep: number[] = [];
  const other: number[] = [];
  for (const r of byRequest.values()) if (typeof r.cpu === 'number') (r.type === 'scheduled' ? sweep : other).push(r.cpu);
  return { sweep, other, events };
}

/** Everything the health check needs about one Worker's day. Statuses fail clearly; CPU figures are notes only. */
export async function workerDay(o: { token: string; account: string; script: string; from: number; to: number; fetchImpl?: typeof fetch }): Promise<{ statuses: { rows: StatusCount[] } | { error: string }; notes: string[] }> {
  const gql = graphql(o.token, o.fetchImpl);
  const v = { a: o.account, s: o.script, f: new Date(o.from).toISOString(), t: new Date(o.to).toISOString() };
  const notes: string[] = [];
  let statuses: { rows: StatusCount[] } | { error: string };
  let schema: Awaited<ReturnType<typeof readSchema>> | null = null;
  try {
    schema = await readSchema(gql, o.account);
    if (!schema.datasets.size) throw new Error(`the schema has neither ${DATASETS.join(' nor ')}`);
    for (const m of schema.missing) notes.push(`${m}: not in this account's schema, so not read`);
    for (const ds of schema.datasets.values()) notes.push(...describe(ds));
    const rows: StatusCount[] = [];
    for (const ds of schema.datasets.values()) rows.push(...(await statusesOf(gql, ds, v)));
    statuses = { rows };
  } catch (e) {
    statuses = { error: e instanceof Error ? e.message : String(e) };
  }
  const adaptive = schema?.datasets.get('workersInvocationsAdaptive');
  if (adaptive)
    try {
      notes.push(await adaptiveCpu(gql, adaptive, v));
    } catch (e) {
      notes.push(`whole Worker CPU unread: ${e instanceof Error ? e.message : String(e)}`);
    }
  try {
    const c = await logsCpu(o);
    notes.push(cpuLine('the sweep (Workers Logs, eventType scheduled)', c.sweep, 'ms, $workers.cpuTimeMs'), cpuLine('everything else (Workers Logs)', c.other, 'ms, $workers.cpuTimeMs'));
  } catch (e) {
    notes.push(`sweep and other CPU unread from Workers Logs: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { statuses, notes };
}

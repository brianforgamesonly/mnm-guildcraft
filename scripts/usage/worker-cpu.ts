// Order 37, PR B (the owner, 2026-11-06, option (b)): each copy's Worker's CPU time and invocation status, from the
// GraphQL Analytics API's workersInvocationsAdaptive. Reads only; costs no D1 rows.
//   node scripts/usage/worker-cpu.ts [--days 7] [--from ISO --to ISO]
// Environment: CLOUDFLARE_API_TOKEN (Account Analytics Read), CLOUDFLARE_ACCOUNT_ID.
// The dataset's fields are read from the schema first (introspection), with their descriptions, so the units and the
// fields used are the API's own, never assumed: a field the schema lacks is reported as missing, never queried.
// One query per Worker per UTC day (an adaptive dataset limits a query's time range). A quantile cannot be combined across
// days, so the window's p50 and p99 are reported per day, with the highest daily p99; the max is the highest daily max.
import { parseArgs } from 'node:util';
import { copies } from '../copies.ts';

const { values: args } = parseArgs({ options: { days: { type: 'string', default: '7' }, from: { type: 'string' }, to: { type: 'string' } } });
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');

async function gql(query: string, variables: Record<string, unknown> = {}): Promise<any> {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: any; errors?: { message?: string }[] | null };
  const errors = (json.errors ?? []).map((e) => String(e.message ?? e).replace(/[0-9a-f]{32}/gi, '<id>')).slice(0, 3);
  if (!res.ok || errors.length) throw new Error(`graphql HTTP ${res.status}: ${errors.join('; ') || 'no detail'}`);
  return json.data;
}

interface Field {
  name: string;
  description: string | null;
  type: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType: { name: string | null; kind: string; ofType: { name: string | null } | null } | null } | null };
}
const TYPE_Q = 'query ($n: String!) { __type(name: $n) { fields { name description type { name kind ofType { name kind ofType { name kind ofType { name } } } } } } }';
const named = (t: Field['type']): string | null => t.name ?? t.ofType?.name ?? t.ofType?.ofType?.name ?? t.ofType?.ofType?.ofType?.name ?? null;
const fieldsOf = async (type: string): Promise<Field[]> => ((await gql(TYPE_Q, { n: type }))?.__type?.fields ?? []) as Field[];

// The dataset's block types, by asking the API itself for their __typename (no type unwrapping), then each type's fields.
// Run 42292289498 found the introspection path through "account" empty, so this asks the data path instead.
const now = new Date().toISOString();
const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
const blocks = new Map<string, Field[]>();
let groupType = '';
for (const block of ['sum', 'quantiles', 'max', 'dimensions'] as const) {
  try {
    const d = await gql(
      `query ($a: String!, $f: Time!, $t: Time!) { viewer { accounts(filter: { accountTag: $a }) { workersInvocationsAdaptive(limit: 1, filter: { datetime_geq: $f, datetime_lt: $t }) { __typename ${block} { __typename } } } } }`,
      { a: account, f: dayAgo, t: now },
    );
    const g = d?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0];
    groupType ||= g?.__typename ?? '';
    const t = g?.[block]?.__typename;
    if (t) blocks.set(block, await fieldsOf(t));
    else console.log(`- ${block}: no group returned in the last day, so its type is unread`);
  } catch (e) {
    console.log(`- ${block}: ${(e as Error).message}`);
  }
}
const has = (block: string, field: string) => !!blocks.get(block)?.some((f) => f.name === field);
void named;
const describe = (block: string, re: RegExp) =>
  (blocks.get(block) ?? []).filter((f) => re.test(f.name)).map((f) => `${block}.${f.name}${f.description ? ` — ${f.description.replace(/\s+/g, ' ').trim()}` : ''}`);
console.log(`### workersInvocationsAdaptive (${groupType || 'type not read'}): the fields used, as the schema describes them`);
for (const l of [...describe('quantiles', /^cpuTimeP(50|99)$/), ...describe('max', /^cpuTime$/), ...describe('sum', /^(requests|errors)$/), ...describe('dimensions', /^(status|scriptName)$/)]) console.log(`- ${l}`);
for (const [b, f] of [['quantiles', 'cpuTimeP50'], ['quantiles', 'cpuTimeP99'], ['max', 'cpuTime'], ['dimensions', 'status']] as const) if (!has(b, f)) console.log(`- ${b}.${f}: NOT in the schema; not queried`);

const end = args.to ? Date.parse(args.to) : Date.now();
const start = args.from ? Date.parse(args.from) : end - Number(args.days) * 86_400_000;
const days: { from: string; to: string }[] = [];
for (let t = start; t < end; t += 86_400_000) days.push({ from: new Date(t).toISOString(), to: new Date(Math.min(end, t + 86_400_000)).toISOString() });

// The documented quantile names (developers.cloudflare.com/analytics/graphql-api/tutorials/querying-workers-metrics/) are
// tried even if the schema read above failed; each block is its own query, so a missing field fails only its own figure.
const cpuQ = (blocks.size ? ['cpuTimeP50', 'cpuTimeP99'].filter((f) => has('quantiles', f)) : ['cpuTimeP50', 'cpuTimeP99']).join(' ');
const maxField = blocks.has('max') ? (blocks.get('max')!.find((f) => f.name === 'cpuTime') ? 'cpuTime' : null) : 'cpuTime';
const window = '$a: String!, $s: String!, $f: Time!, $t: Time!';
const scope = 'filter: { scriptName: $s, datetime_geq: $f, datetime_lt: $t }';
const Q_SUM = `query (${window}) { viewer { accounts(filter: { accountTag: $a }) { workersInvocationsAdaptive(limit: 10, ${scope}) { sum { requests errors } dimensions { scriptName } } } } }`;
const Q_P = `query (${window}) { viewer { accounts(filter: { accountTag: $a }) { workersInvocationsAdaptive(limit: 10, ${scope}) { quantiles { ${cpuQ} } dimensions { scriptName } } } } }`;
const Q_MAX = `query (${window}) { viewer { accounts(filter: { accountTag: $a }) { workersInvocationsAdaptive(limit: 10, ${scope}) { max { ${maxField} } dimensions { scriptName } } } } }`;
const Q_ST = `query (${window}) { viewer { accounts(filter: { accountTag: $a }) { workersInvocationsAdaptive(limit: 100, ${scope}) { sum { requests errors } dimensions { status } } } } }`;
const one = async (q: string, v: Record<string, unknown>) => {
  try {
    return { rows: ((await gql(q, v))?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? []) as any[], error: null };
  } catch (e) {
    return { rows: [] as any[], error: (e as Error).message };
  }
};
const reported = new Set<string>();

console.log(`\n### CPU time per Worker, per UTC day, ${new Date(start).toISOString()} → ${new Date(end).toISOString()}`);
for (const c of copies()) {
  const statuses = new Map<string, number>();
  let worstP99 = 0;
  let worstMax = 0;
  let requests = 0;
  console.log(`\n${c.name} (Worker ${c.worker}):\nday (from)\trequests\terrors\tcpuTimeP50\tcpuTimeP99\tmax cpuTime`);
  for (const d of days) {
    const v = { a: account, s: c.worker, f: d.from, t: d.to };
    const [sum, p, mx, st] = await Promise.all([one(Q_SUM, v), cpuQ ? one(Q_P, v) : Promise.resolve({ rows: [], error: 'no quantile field' }), maxField ? one(Q_MAX, v) : Promise.resolve({ rows: [], error: 'no max cpuTime field' }), one(Q_ST, v)]);
    for (const [label, r] of [['sum', sum], ['quantiles', p], ['max', mx], ['status', st]] as const)
      if (r.error && !reported.has(label)) {
        reported.add(label);
        console.log(`  (${label} query: ${r.error})`);
      }
    for (const s of st.rows) statuses.set(s.dimensions.status, (statuses.get(s.dimensions.status) ?? 0) + Number(s.sum.requests));
    const g = sum.rows[0];
    const q = p.rows[0]?.quantiles;
    const m = mx.rows[0]?.max;
    requests += Number(g?.sum.requests ?? 0);
    worstP99 = Math.max(worstP99, Number(q?.cpuTimeP99 ?? 0));
    worstMax = Math.max(worstMax, Number(m?.cpuTime ?? 0));
    console.log([d.from.slice(0, 16), g?.sum.requests ?? 0, g?.sum.errors ?? 0, q?.cpuTimeP50 ?? '-', q?.cpuTimeP99 ?? '-', m?.cpuTime ?? '-'].join('\t'));
  }
  console.log(`${c.name}: ${requests} invocations; highest daily cpuTimeP99 ${worstP99}; highest daily max cpuTime ${worstMax} (the schema's units: see the field descriptions above)`);
  console.log(`${c.name}: invocations by status: ${[...statuses].map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`);
}

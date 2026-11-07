// Order 37, PR B (the owner, 2026-11-06, option (b)): each copy's Worker's CPU time and invocation status, from the
// GraphQL Analytics API's workersInvocationsAdaptive. Reads only; costs no D1 rows.
//   node scripts/usage/worker-cpu.ts [--days 7] [--from ISO --to ISO]
// Environment: CLOUDFLARE_API_TOKEN (Account Analytics Read), CLOUDFLARE_ACCOUNT_ID.
//
// Order 40, ITEM 2: the windows and the schema tell the truth.
// - Windows are whole UTC days, 00:00 to 24:00, so "per UTC day" is true and lines up with the health check's day. --days N
//   is the N whole UTC days before today plus today's partial day ("partial, to <time> UTC"); --from/--to are rounded out to
//   day boundaries, and the output says so. The account's own range limit is read first (settings.workersInvocationsAdaptive
//   { maxDuration notOlderThan }: developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/, "notOlderThan
//   returns a number of seconds on how far back in time a query can read"; maxDuration "shows how wide the requested time range
//   could be", in seconds per the limits page). Where whole days don't fit it, the windows stay rolling and are labelled so.
// - The schema is read by the health check's one reader (scripts/health/workers.ts readSchema), which needs no data row.
//   When it can't be read, each field prints "unknown (schema not read)", never "NOT in the schema"; the documented names
//   are still queried, each block in its own query, so a missing field fails only its own figure.
// A quantile cannot be combined across windows, so p50 and p99 are reported per window, with the highest p99; the max is the
// highest window max. Everything below main() is a pure or injected-client function (scripts/usage/worker-cpu.test.ts).
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { copies } from '../copies.ts';
import { describe as describeFields, graphql, readSchema, type Dataset } from '../health/workers.ts';

type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;
export const DATASET = 'workersInvocationsAdaptive';
const DAY = 86_400_000;

// ---------------------------------------------------------------- windows

export interface Window {
  from: string;
  to: string;
  label: string;
}
/** The account's range limit for the dataset, in seconds (null: not stated or not read). */
export interface Limits {
  maxDuration: number | null;
  notOlderThan: number | null;
}
export const utcDay = (t: number) => Math.floor(t / DAY) * DAY;
const iso = (t: number) => new Date(t).toISOString();
const minute = (t: number) => iso(t).slice(0, 16).replace('T', ' ');

/**
 * The windows to read. Whole UTC days when the account's limit allows a day-wide range reaching back to the first day;
 * otherwise rolling windows of at most a day (or maxDuration), ending now, labelled "<n> h to <time> UTC".
 */
export function planWindows(now: number, o: { days?: string; from?: string; to?: string }, limits: Limits | null): { windows: Window[]; wholeDays: boolean; notes: string[] } {
  const notes: string[] = [];
  let start: number;
  let end: number;
  if (o.from !== undefined || o.to !== undefined) {
    const f = o.from !== undefined ? Date.parse(o.from) : NaN;
    const t = o.to !== undefined ? Date.parse(o.to) : now;
    if (!Number.isFinite(f) || !Number.isFinite(t) || f >= t) throw new Error('--from (and --to, if given) must be ISO times, --from before --to');
    start = utcDay(f);
    end = Math.min(now, utcDay(t) === t ? t : utcDay(t) + DAY);
    notes.push(`--from/--to rounded out to whole UTC days: ${iso(start)} → ${iso(end)}${end === now ? ' (now: the last day is partial)' : ''}`);
  } else {
    const n = Number(o.days ?? '7');
    if (!Number.isInteger(n) || n < 0) throw new Error('--days must be a whole number, 0 or more');
    start = utcDay(now) - n * DAY;
    end = now;
  }
  if (!limits) notes.push(`${DATASET}'s range limit unread (settings): whole UTC days assumed`);
  else notes.push(`${DATASET}'s range limit (the account's settings): maxDuration ${limits.maxDuration ?? 'not stated'} s, notOlderThan ${limits.notOlderThan ?? 'not stated'} s`);
  const width = limits?.maxDuration ? Math.min(DAY, limits.maxDuration * 1000) : DAY;
  const oldest = limits?.notOlderThan ? now - limits.notOlderThan * 1000 : -Infinity;
  const windows: Window[] = [];
  if (width === DAY && start >= oldest) {
    for (let d = start; d < end; d += DAY) {
      const to = Math.min(end, d + DAY);
      windows.push({ from: iso(d), to: iso(to), label: `${iso(d).slice(0, 10)}${to - d === DAY ? '' : ` (partial, to ${iso(to).slice(11, 16)} UTC)`}` });
    }
    return { windows, wholeDays: true, notes };
  }
  notes.push(`whole UTC days don't fit that limit (${width < DAY ? 'a day is wider than maxDuration' : 'the first day starts before notOlderThan'}): rolling windows instead`);
  const floor = Math.max(start, oldest);
  for (let t = end; t > floor; t -= width) windows.unshift({ from: iso(Math.max(floor, t - width)), to: iso(t), label: `${Math.round(Math.min(width, t - floor) / 3_600_000)} h to ${minute(t)} UTC` });
  return { windows, wholeDays: false, notes };
}

const LIMITS_Q = `query ($a: String!) { viewer { accounts(filter: { accountTag: $a }) { settings { ${DATASET} { maxDuration notOlderThan } } } } }`;
/** The account's own range limit for the dataset (null, with the reason, when it can't be read). */
export async function readLimits(gql: Gql, account: string): Promise<{ limits: Limits | null; error: string | null }> {
  try {
    const s = (await gql(LIMITS_Q, { a: account }))?.viewer?.accounts?.[0]?.settings?.[DATASET];
    if (!s) return { limits: null, error: 'the settings node returned nothing for the dataset' };
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    return { limits: { maxDuration: n(s.maxDuration), notOlderThan: n(s.notOlderThan) }, error: null };
  } catch (e) {
    return { limits: null, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------- the schema

/** The dataset's shape as read, or why it wasn't. */
export type Schema = { ds: Dataset } | { error: string };
export type FieldState = 'present' | 'absent' | 'unknown';
/** Whether a block's field is in the schema; 'unknown' when the schema wasn't read (never "absent" without reading it). */
export const fieldState = (s: Schema, block: string, field: string): FieldState => ('error' in s ? 'unknown' : s.ds.blocks.get(block)?.has(field) ? 'present' : 'absent');
/** The fields the report uses. */
export const USED = [['quantiles', 'cpuTimeP50'], ['quantiles', 'cpuTimeP99'], ['max', 'cpuTime'], ['sum', 'requests'], ['sum', 'errors'], ['dimensions', 'status']] as const;

export async function loadSchema(gql: Gql, account: string): Promise<Schema> {
  try {
    const { datasets } = await readSchema(gql, account);
    const ds = datasets.get(DATASET);
    return ds ? { ds } : { error: `the account schema has no ${DATASET}` };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** The schema's own words for the fields used (their units among them), or what couldn't be read. */
export function schemaLines(s: Schema): string[] {
  const out: string[] = [];
  if ('error' in s) out.push(`- schema not read: ${s.error}`);
  else out.push(...describeFields(s.ds).filter((l) => /cpuTimeP50|cpuTimeP99|max\.cpuTime|status/.test(l)).map((l) => `- ${l}`));
  for (const [b, f] of USED) {
    const st = fieldState(s, b, f);
    if (st === 'unknown') out.push(`- ${b}.${f}: unknown (schema not read)`);
    else if (st === 'absent') out.push(`- ${b}.${f}: NOT in the schema; not queried`);
  }
  return out;
}

/** The quantile and max fields to query: present or unknown (the documented names are tried when unread). */
export function queriedFields(s: Schema): { quantiles: string[]; max: string | null } {
  const q = (['cpuTimeP50', 'cpuTimeP99'] as const).filter((f) => fieldState(s, 'quantiles', f) !== 'absent');
  return { quantiles: q, max: fieldState(s, 'max', 'cpuTime') !== 'absent' ? 'cpuTime' : null };
}

// ---------------------------------------------------------------- the report

const VARS = '$a: String!, $s: String!, $f: Time!, $t: Time!';
const SCOPE = 'filter: { scriptName: $s, datetime_geq: $f, datetime_lt: $t }';
const q = (sel: string, limit = 10) => `query (${VARS}) { viewer { accounts(filter: { accountTag: $a }) { ${DATASET}(limit: ${limit}, ${SCOPE}) { ${sel} } } } }`;

/** The whole report, as lines. `workers`: each copy's name and Worker. */
export async function report(gql: Gql, account: string, workers: { name: string; worker: string }[], now: number, args: { days?: string; from?: string; to?: string }): Promise<string[]> {
  const out: string[] = [];
  const schema = await loadSchema(gql, account);
  const lim = await readLimits(gql, account);
  const plan = planWindows(now, args, lim.limits);
  out.push(`### ${DATASET}: the fields used, as the schema describes them`, ...schemaLines(schema));
  if (lim.error) out.push(`- range limit unread: ${lim.error}`);
  out.push(...plan.notes.map((n) => `- ${n}`));
  const f = queriedFields(schema);
  const one = async (query: string | null, v: Record<string, unknown>) => {
    if (!query) return { rows: [] as any[], error: 'no such field in the schema' };
    try {
      return { rows: ((await gql(query, v))?.viewer?.accounts?.[0]?.[DATASET] ?? []) as any[], error: null };
    } catch (e) {
      return { rows: [] as any[], error: (e as Error).message };
    }
  };
  const Q_SUM = q('sum { requests errors } dimensions { scriptName }');
  const Q_P = f.quantiles.length ? q(`quantiles { ${f.quantiles.join(' ')} } dimensions { scriptName }`) : null;
  const Q_MAX = f.max ? q(`max { ${f.max} } dimensions { scriptName }`) : null;
  const Q_ST = q('sum { requests errors } dimensions { status }', 100);
  const reported = new Set<string>();
  const first = plan.windows[0]?.from ?? '-';
  const last = plan.windows.at(-1)?.to ?? '-';
  out.push('', `### CPU time per Worker, ${plan.wholeDays ? 'per UTC day' : 'per rolling window (whole UTC days did not fit the range limit)'}, ${first} → ${last}`);
  for (const c of workers) {
    const statuses = new Map<string, number>();
    let worstP99 = 0;
    let worstMax = 0;
    let requests = 0;
    out.push('', `${c.name} (Worker ${c.worker}):`, `${plan.wholeDays ? 'UTC day' : 'window'}\trequests\terrors\tcpuTimeP50\tcpuTimeP99\tmax cpuTime`);
    for (const w of plan.windows) {
      const v = { a: account, s: c.worker, f: w.from, t: w.to };
      const [sum, p, mx, st] = await Promise.all([one(Q_SUM, v), one(Q_P, v), one(Q_MAX, v), one(Q_ST, v)]);
      for (const [label, r] of [['sum', sum], ['quantiles', p], ['max', mx], ['status', st]] as const)
        if (r.error && !reported.has(label)) {
          reported.add(label);
          out.push(`  (${label} query: ${r.error})`);
        }
      for (const s of st.rows) statuses.set(s.dimensions.status, (statuses.get(s.dimensions.status) ?? 0) + Number(s.sum.requests));
      const g = sum.rows[0];
      const qs = p.rows[0]?.quantiles;
      const m = mx.rows[0]?.max;
      requests += Number(g?.sum.requests ?? 0);
      worstP99 = Math.max(worstP99, Number(qs?.cpuTimeP99 ?? 0));
      worstMax = Math.max(worstMax, Number(m?.cpuTime ?? 0));
      out.push([w.label, g?.sum.requests ?? 0, g?.sum.errors ?? 0, qs?.cpuTimeP50 ?? '-', qs?.cpuTimeP99 ?? '-', m?.cpuTime ?? '-'].join('\t'));
    }
    out.push(`${c.name}: ${requests} invocations; highest cpuTimeP99 ${worstP99}; highest max cpuTime ${worstMax} (units: the schema's descriptions above${'error' in schema ? ', unread this run' : ''})`);
    out.push(`${c.name}: invocations by status: ${[...statuses].map(([s, n]) => `${s} ${n}`).join(', ') || 'none'}`);
  }
  return out;
}

async function main(): Promise<void> {
  const { values: args } = parseArgs({ options: { days: { type: 'string', default: '7' }, from: { type: 'string' }, to: { type: 'string' } } });
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
  if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
  const lines = await report(graphql(token), account, copies(), Date.now(), args.from || args.to ? { from: args.from, to: args.to } : { days: args.days });
  console.log(lines.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error((e as Error).message);
    process.exitCode = 1;
  });

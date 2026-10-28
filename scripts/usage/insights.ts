// Order 26: reads D1's figures per database and per query from the GraphQL Analytics API. No top-level effects:
// scripts/usage/insights-cli.ts (the order's measuring) and scripts/usage/run.ts (the level alarm's cause) call it.
// Every dataset's fields, filter and sort order are read from the schema on each run, never assumed: the D1 docs name
// d1QueriesAdaptiveGroups ("via GraphQL's d1QueriesAdaptiveGroups or wrangler d1 insights") without listing its fields.
// The settings node gives each dataset's reach ("notOlderThan: … how far back in time a query can read",
// developers.cloudflare.com/analytics/graphql-api/features/discovery/settings/).
import { byShape, dbLabel, queryShape, type DbLabel, type QueryFigure } from './queries.ts';

export type Gql = (query: string, variables?: Record<string, unknown>) => Promise<any>;

interface TypeRef {
  name: string | null;
  kind: string;
  ofType?: TypeRef | null;
}
interface SchemaType {
  name: string;
  fields: { name: string; type: TypeRef; args: { name: string; type: TypeRef }[] }[] | null;
  inputFields: { name: string }[] | null;
  enumValues: { name: string }[] | null;
}
// Cloudflare names its wrapper types "" rather than null (run.ts), so `||`.
const named = (t: TypeRef | null | undefined): string | null => (!t ? null : t.name || named(t.ofType));
const T = 'name kind ofType { name kind ofType { name kind ofType { name kind ofType { name kind } } } }';

export interface Dataset {
  name: string;
  dims: string[];
  sums: string[];
  hasCount: boolean;
  filter: string[];
  orderBy: string[];
  /** How a day is filtered and grouped (date_geq/date_leq with date, else datetime_geq/datetime_leq). */
  day: { dim: string; geq: string; leq: string; type: 'Date' | 'Time' } | null;
}

/** One __schema read; each named account dataset's dimensions, sum fields, filter fields and sort values. */
export async function datasets(gql: Gql, names: string[]): Promise<Record<string, Dataset>> {
  const s = (
    await gql(
      `{ __schema { queryType { name } types { name fields { name type { ${T} } args { name type { ${T} } } } inputFields { name } enumValues { name } } } }`,
    )
  ).__schema as { queryType: { name: string }; types: SchemaType[] };
  const types = new Map(s.types.map((t) => [t.name, t]));
  const field = (t: SchemaType | undefined, f: string) => t?.fields?.find((x) => x.name === f);
  const typeOf = (f: { type: TypeRef } | undefined) => (f ? types.get(named(f.type) ?? '') : undefined);
  const accounts = typeOf(field(typeOf(field(types.get(s.queryType.name), 'viewer')), 'accounts'));
  const out: Record<string, Dataset> = {};
  for (const n of names) {
    const f = field(accounts, n);
    const t = typeOf(f);
    if (!f || !t?.fields) continue;
    const arg = (a: string) => f.args.find((x) => x.name === a);
    const filter = (types.get(named(arg('filter')?.type) ?? '')?.inputFields ?? []).map((x) => x.name);
    const orderBy = (types.get(named(arg('orderBy')?.type) ?? '')?.enumValues ?? []).map((x) => x.name);
    const sub = (b: string) => (typeOf(field(t, b))?.fields ?? []).map((x) => x.name);
    const dims = sub('dimensions');
    const dim = ['date', 'datetimeHour', 'datetime'].find((d) => dims.includes(d));
    const day = !dim
      ? null
      : filter.includes('date_geq') && filter.includes('date_leq') && dims.includes('date')
        ? { dim: 'date', geq: 'date_geq', leq: 'date_leq', type: 'Date' as const }
        : filter.includes('datetime_geq') && filter.includes('datetime_leq')
          ? { dim, geq: 'datetime_geq', leq: 'datetime_leq', type: 'Time' as const }
          : null;
    out[n] = { name: n, dims, sums: sub('sum'), hasCount: !!field(t, 'count'), filter, orderBy, day };
  }
  return out;
}

/** The settings node for a dataset: its reach and page size, or why it could not be read. */
export async function settingsOf(gql: Gql, account: string, name: string): Promise<Record<string, unknown> | string> {
  try {
    const d = await gql(
      `query($a: String!) { viewer { accounts(filter: { accountTag: $a }) { settings { ${name} { enabled notOlderThan maxDuration maxPageSize } } } } }`,
      { a: account },
    );
    return d.viewer.accounts[0]?.settings?.[name] ?? 'no settings node returned';
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

const range = (ds: Dataset, from: string, to: string) =>
  ds.day!.type === 'Date' ? { f: from, t: to } : { f: `${from}T00:00:00Z`, t: `${to}T23:59:59Z` };

export interface DbFigure {
  /** YYYY-MM-DD, or YYYY-MM-DDTHH for an hour. */
  at: string;
  db: DbLabel;
  rowsRead: number;
  rowsWritten: number;
}

/** Rows read and written per database, per day (or per hour when the dataset has datetimeHour and `hourly`). */
export async function perDatabase(
  gql: Gql,
  account: string,
  ds: Dataset,
  from: string,
  to: string,
  copies: { name: string; databaseId: string }[],
  hourly = false,
): Promise<DbFigure[]> {
  if (!ds.day || !ds.dims.includes('databaseId')) throw new Error(`${ds.name}: no day filter or no databaseId dimension`);
  const dim = hourly ? 'datetimeHour' : ds.day.dim;
  if (!ds.dims.includes(dim)) throw new Error(`${ds.name}: no ${dim} dimension`);
  const sums = ['rowsRead', 'rowsWritten'].filter((x) => ds.sums.includes(x));
  const data = await gql(
    `query($a: String!, $f: ${ds.day.type}!, $t: ${ds.day.type}!) { viewer { accounts(filter: { accountTag: $a }) {
      ${ds.name}(limit: 10000, filter: { ${ds.day.geq}: $f, ${ds.day.leq}: $t }) { sum { ${sums.join(' ')} } dimensions { ${dim} databaseId } } } } }`,
    { a: account, ...range(ds, from, to) },
  );
  const rows = (data.viewer.accounts[0]?.[ds.name] ?? []) as any[];
  if (rows.length >= 10000) throw new Error(`${ds.name}: 10000 groups, at the query limit: the figures may be incomplete`);
  const m = new Map<string, DbFigure>();
  for (const r of rows) {
    const at = String(r.dimensions[dim]).slice(0, hourly ? 13 : 10);
    const db = dbLabel(String(r.dimensions.databaseId), copies);
    const k = `${at}|${db}`;
    const o = m.get(k) ?? { at, db, rowsRead: 0, rowsWritten: 0 };
    o.rowsRead += Number(r.sum.rowsRead) || 0;
    o.rowsWritten += Number(r.sum.rowsWritten) || 0;
    m.set(k, o);
  }
  return [...m.values()].sort((a, b) => a.at.localeCompare(b.at) || a.db.localeCompare(b.db));
}

/**
 * One UTC day's (or hour's) heaviest statements by a metric, merged by shape. Sorted by the dataset when it offers
 * sum_<metric>_DESC; `limit` groups are read, so a shape spread over many literal variants may be cut short: the
 * caller compares the total with perDatabase's (its coverage).
 */
export async function heaviest(
  gql: Gql,
  account: string,
  ds: Dataset,
  window: { from: string; to: string },
  metric: 'rowsRead' | 'rowsWritten',
  limit: number,
  copies: { name: string; databaseId: string }[],
): Promise<{ figures: QueryFigure[]; groups: number; sorted: boolean }> {
  const qdim = ds.dims.find((d) => d === 'query') ?? ds.dims.find((d) => /query/i.test(d) && !/hash|id/i.test(d));
  if (!qdim || !ds.dims.includes('databaseId')) throw new Error(`${ds.name}: no query or databaseId dimension (dimensions: ${ds.dims.join(', ')})`);
  const order = `sum_${metric}_DESC`;
  const sorted = ds.orderBy.includes(order);
  const sums = ['rowsRead', 'rowsWritten'].filter((x) => ds.sums.includes(x));
  // A window inside one day (an hour) needs a datetime filter.
  const exact = window.from.length > 10;
  const geq = exact ? 'datetime_geq' : ds.day!.geq;
  const leq = exact ? 'datetime_leq' : ds.day!.leq;
  const type = exact ? 'Time' : ds.day!.type;
  const vars = exact ? { f: window.from, t: window.to } : range(ds, window.from, window.to);
  const data = await gql(
    `query($a: String!, $f: ${type}!, $t: ${type}!) { viewer { accounts(filter: { accountTag: $a }) {
      ${ds.name}(limit: ${limit}, filter: { ${geq}: $f, ${leq}: $t }${sorted ? `, orderBy: [${order}]` : ''}) {
        ${ds.hasCount ? 'count' : ''} sum { ${sums.join(' ')} } dimensions { ${qdim} databaseId } } } } }`,
    { a: account, ...vars },
  );
  const rows = (data.viewer.accounts[0]?.[ds.name] ?? []) as any[];
  const day = window.from.slice(0, 10);
  const figures = byShape(
    rows.map((r) => ({
      day,
      db: dbLabel(String(r.dimensions.databaseId), copies),
      shape: queryShape(String(r.dimensions[qdim] ?? '')),
      rowsRead: Number(r.sum.rowsRead) || 0,
      rowsWritten: Number(r.sum.rowsWritten) || 0,
      count: Number(r.count) || 0,
    })),
  );
  return { figures, groups: rows.length, sorted };
}

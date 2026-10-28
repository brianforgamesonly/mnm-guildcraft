// Order 26: D1 rows read and written per database, per day and per hour, and the heaviest statements, from the
// GraphQL Analytics API (scripts/usage/insights.ts). Reads only; costs no D1 rows.
//   node scripts/usage/insights-cli.ts --from YYYY-MM-DD --to YYYY-MM-DD [--top-days d,d] [--written-days d,d]
//     [--hours d,d] [--windows ISO/ISO,ISO/ISO] [--top 10] [--top-written 5] [--limit 2000]
// Environment: CLOUDFLARE_API_TOKEN (Account Analytics Read), CLOUDFLARE_ACCOUNT_ID. The log is public: databases are
// printed as dev, production or other, and statements with every literal as ? (scripts/usage/queries.ts).
import { parseArgs } from 'node:util';
import { copies } from '../copies.ts';
import { datasets, heaviest, perDatabase, settingsOf, type Gql } from './insights.ts';
import { figureLine, redact, timed, topBy } from './queries.ts';

const { values: args } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string' },
    'top-days': { type: 'string', default: '' },
    'written-days': { type: 'string', default: '' },
    hours: { type: 'string', default: '' },
    windows: { type: 'string', default: '' },
    top: { type: 'string', default: '10' },
    'top-written': { type: 'string', default: '5' },
    limit: { type: 'string', default: '2000' },
  },
});
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
if (!args.from || !args.to || !isDay(args.from) || !isDay(args.to)) throw new Error('--from and --to must be YYYY-MM-DD');

const gql: Gql = async (query, variables = {}) => {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    ...timed(60_000),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: any; errors?: { message?: string }[] | null };
  const errors = (json.errors ?? []).map((e) => redact(String(e.message ?? e))).slice(0, 3);
  if (!res.ok || errors.length) throw new Error(`graphql HTTP ${res.status}: ${errors.join('; ') || 'no detail'}`);
  return json.data;
};

const from = args.from;
const to = args.to;
const dbs = copies().map((c) => ({ name: c.name, databaseId: c.databaseId() }));
const Q = 'd1QueriesAdaptiveGroups';
const A = 'd1AnalyticsAdaptiveGroups';
const found = await datasets(gql, [Q, A]);
for (const n of [Q, A]) {
  const d = found[n];
  console.log(`${n}: ${d ? `dimensions ${d.dims.join(', ')}; sum ${d.sums.join(', ')}; count ${d.hasCount}; filter by day ${d.day ? `${d.day.geq}/${d.day.leq} (${d.day.type})` : 'none'}; sort ${d.orderBy.filter((o) => /rows(Read|Written)/.test(o)).join(', ') || 'none'}` : 'not in the schema for this token'}`);
  console.log(`  settings: ${JSON.stringify(await settingsOf(gql, account, n))}`);
}
const totals = found[A] ?? found[Q];
if (!totals) throw new Error(`neither ${A} nor ${Q} is readable with this token`);

console.log(`\nper database, per UTC day (${totals.name}):\nday\tdatabase\trows read\trows written`);
const perDay = await perDatabase(gql, account, totals, from, to, dbs);
for (const r of perDay) console.log([r.at, r.db, r.rowsRead, r.rowsWritten].join('\t'));

for (const d of list(args.hours)) {
  console.log(`\nper database, per UTC hour, ${d}:\nhour\tdatabase\trows read\trows written`);
  for (const r of await perDatabase(gql, account, totals, d, d, dbs, true)) console.log([r.at.slice(11) + ':00', r.db, r.rowsRead, r.rowsWritten].join('\t'));
}

const q = found[Q];
const limit = Number(args.limit);
async function tops(window: { from: string; to: string }, label: string, metric: 'rowsRead' | 'rowsWritten', n: number) {
  if (!q) return console.log(`\n${label}: ${Q} is not readable with this token`);
  const { figures, groups, sorted } = await heaviest(gql, account, q, window, metric, limit, dbs);
  const word = metric === 'rowsRead' ? 'read' : 'written';
  console.log(`\n${label}: top ${n} statements by rows ${word}, per database (${groups} groups read${sorted ? ', sorted by the dataset' : ', UNSORTED: the dataset offers no sort'}; groups at the limit ${groups >= limit})`);
  for (const db of ['production', 'dev', 'other'] as const) {
    const mine = figures.filter((f) => f.db === db);
    if (!mine.length) continue;
    const covered = mine.reduce((s, f) => s + f[metric], 0);
    const total = window.from.length === 10 ? perDay.filter((r) => r.at === window.from && r.db === db).reduce((s, r) => s + r[metric], 0) : 0;
    console.log(`  ${db}: these groups hold ${covered.toLocaleString('en-US')} rows ${word}${total ? ` of the day's ${total.toLocaleString('en-US')} (${((covered / total) * 100).toFixed(1)}%)` : ''}`);
    topBy(mine, metric, n).forEach((f, i) => console.log(`   ${i + 1}. ${figureLine(f, metric)}`));
  }
}
for (const d of list(args['top-days'])) await tops({ from: d, to: d }, d, 'rowsRead', Number(args.top));
for (const d of list(args['written-days'])) await tops({ from: d, to: d }, d, 'rowsWritten', Number(args['top-written']));
for (const w of list(args.windows)) {
  const [from, to] = w.split('/');
  if (!from || !to) throw new Error(`--windows: ${JSON.stringify(w)} is not FROM/TO`);
  await tops({ from, to }, `window ${from}..${to}`, 'rowsRead', Number(args.top));
  await tops({ from, to }, `window ${from}..${to}`, 'rowsWritten', Number(args['top-written']));
}

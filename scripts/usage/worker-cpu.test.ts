// Order 40, ITEM 2: scripts/usage/worker-cpu.ts's windows and schema reading, against recorded responses (no env vars, no
// live dispatch). The schema's descriptions are those health run 42327649984 logged (2026-11-07).
// Run: npm run test:health.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fieldState, planWindows, queriedFields, readLimits, report, schemaLines, type Schema } from './worker-cpu.ts';

const NOW = Date.parse('2026-11-07T17:42:10Z');

test('--days 2: two whole UTC days and today\'s partial day, labelled so', () => {
  const p = planWindows(NOW, { days: '2' }, { maxDuration: 2_678_400, notOlderThan: 2_764_800 });
  assert.equal(p.wholeDays, true);
  assert.deepEqual(p.windows, [
    { from: '2026-11-05T00:00:00.000Z', to: '2026-11-06T00:00:00.000Z', label: '2026-11-05' },
    { from: '2026-11-06T00:00:00.000Z', to: '2026-11-07T00:00:00.000Z', label: '2026-11-06' },
    { from: '2026-11-07T00:00:00.000Z', to: '2026-11-07T17:42:10.000Z', label: '2026-11-07 (partial, to 17:42 UTC)' },
  ]);
  assert.ok(p.notes.some((n) => /maxDuration 2678400 s, notOlderThan 2764800 s/.test(n)));
});

test('--from/--to are rounded out to day boundaries, and the output says so', () => {
  const p = planWindows(NOW, { from: '2026-11-03T10:00:00Z', to: '2026-11-04T05:00:00Z' }, null);
  assert.deepEqual(p.windows.map((w) => [w.from, w.to, w.label]), [
    ['2026-11-03T00:00:00.000Z', '2026-11-04T00:00:00.000Z', '2026-11-03'],
    ['2026-11-04T00:00:00.000Z', '2026-11-05T00:00:00.000Z', '2026-11-04'],
  ]);
  assert.ok(p.notes.some((n) => n.startsWith('--from/--to rounded out to whole UTC days: 2026-11-03T00:00:00.000Z → 2026-11-05T00:00:00.000Z')));
  assert.ok(p.notes.some((n) => /range limit unread/.test(n)));
  assert.throws(() => planWindows(NOW, { from: 'nonsense' }, null));
  assert.throws(() => planWindows(NOW, { days: '1.5' }, null));
});

test('a limit whole days don\'t fit: rolling windows, labelled "<n> h to <time> UTC"', () => {
  const narrow = planWindows(NOW, { days: '1' }, { maxDuration: 21_600, notOlderThan: null });
  assert.equal(narrow.wholeDays, false);
  assert.equal(narrow.windows.at(-1)!.label, '6 h to 2026-11-07 17:42 UTC');
  assert.ok(narrow.notes.some((n) => /a day is wider than maxDuration/.test(n)));
  const shallow = planWindows(NOW, { days: '3' }, { maxDuration: 86_400, notOlderThan: 172_800 });
  assert.equal(shallow.wholeDays, false);
  assert.deepEqual(shallow.windows.map((w) => w.label), ['24 h to 2026-11-06 17:42 UTC', '24 h to 2026-11-07 17:42 UTC']);
});

// ---------------------------------------------------------------- the schema, against a recorded endpoint

const ref = (name: string) => ({ name: null, kind: 'LIST', ofType: { name, kind: 'OBJECT', ofType: null } });
const scalar = (name: string) => ({ name, kind: 'SCALAR', ofType: null });
const field = (name: string, description: string) => ({ name, description, type: scalar('uint64'), args: [] });
const TYPES: Record<string, { fields?: unknown[]; inputFields?: unknown[] }> = {
  account: { fields: [{ name: 'workersInvocationsAdaptive', description: null, type: ref('Adaptive'), args: [{ name: 'filter', type: { name: 'F', kind: 'INPUT_OBJECT', ofType: null } }] }] },
  Adaptive: { fields: ['sum', 'quantiles', 'max', 'dimensions'].map((n) => ({ name: n, description: null, type: { name: `A_${n}`, kind: 'OBJECT', ofType: null }, args: [] })) },
  A_sum: { fields: [field('requests', 'Number of requests'), field('errors', 'Number of errors')] },
  // health run 42327649984's log, word for word
  A_quantiles: { fields: [field('cpuTimeP50', 'CPU time 50th percentile - microseconds'), field('cpuTimeP99', 'CPU time 99th percentile - microseconds')] },
  A_max: { fields: [field('cpuTime', 'Maximum CPU time for one request - microseconds')] },
  A_dimensions: { fields: [field('status', 'Result of the invocation'), field('scriptName', 'Worker')] },
  F: { inputFields: ['scriptName', 'datetime_geq', 'datetime_lt'].map((name) => ({ name, description: null, type: scalar('string') })) },
};

/** A recorded endpoint: `introspection` false answers every __type with an error (the schema can't be read). */
function recorded(o: { introspection: boolean; limits?: unknown; seen?: string[] }) {
  return async (query: string, v: Record<string, unknown> = {}): Promise<any> => {
    o.seen?.push(query);
    if (query.includes('__type(')) {
      if (!o.introspection) throw new Error('GraphQL HTTP 200: introspection refused');
      return { __type: { name: v.n, fields: null, inputFields: null, ...TYPES[v.n as string] } };
    }
    if (query.includes('__typename')) return { viewer: { accounts: [{ __typename: 'account' }] } };
    if (query.includes('settings')) {
      if (o.limits === undefined) throw new Error('GraphQL HTTP 200: unknown field settings');
      return { viewer: { accounts: [{ settings: { workersInvocationsAdaptive: o.limits } }] } };
    }
    if (query.includes('dimensions { status }')) return { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 96, errors: 0 }, dimensions: { status: 'success' } }] }] } };
    if (query.includes('quantiles')) return { viewer: { accounts: [{ workersInvocationsAdaptive: [{ quantiles: { cpuTimeP50: 6830, cpuTimeP99: 17120 } }] }] } };
    if (query.includes('max {')) return { viewer: { accounts: [{ workersInvocationsAdaptive: [{ max: { cpuTime: 17675 } }] }] } };
    if (query.includes('sum {')) return { viewer: { accounts: [{ workersInvocationsAdaptive: [{ sum: { requests: 96, errors: 0 } }] }] } };
    throw new Error(`unexpected query ${query.slice(0, 80)}`);
  };
}
const W = [{ name: 'production', worker: 'mnm-guildcraft' }];

test('schema read (no data row needed): the units are the schema\'s own words, whole days, "per UTC day"', async () => {
  const lines = await report(recorded({ introspection: true, limits: { maxDuration: 2_678_400, notOlderThan: 2_764_800 } }), 'acct', W, NOW, { days: '1' });
  const text = lines.join('\n');
  assert.match(text, /quantiles\.cpuTimeP50: CPU time 50th percentile - microseconds/);
  assert.match(text, /max\.cpuTime: Maximum CPU time for one request - microseconds/);
  assert.match(text, /### CPU time per Worker, per UTC day, 2026-11-06T00:00:00\.000Z → 2026-11-07T17:42:10\.000Z/);
  assert.match(text, /\n2026-11-06\t96\t0\t6830\t17120\t17675/);
  assert.match(text, /\n2026-11-07 \(partial, to 17:42 UTC\)\t96/);
  assert.doesNotMatch(text, /NOT in the schema|unknown \(schema not read\)/);
});

test('schema unread: every field "unknown (schema not read)", never "NOT in the schema", and the documented names still queried', async () => {
  const seen: string[] = [];
  const lines = await report(recorded({ introspection: false, seen }), 'acct', W, NOW, { days: '0' });
  const text = lines.join('\n');
  for (const f of ['quantiles.cpuTimeP50', 'quantiles.cpuTimeP99', 'max.cpuTime', 'dimensions.status']) assert.match(text, new RegExp(`${f.replace('.', '\\.')}: unknown \\(schema not read\\)`));
  assert.doesNotMatch(text, /NOT in the schema/);
  assert.ok(seen.some((q) => q.includes('quantiles { cpuTimeP50 cpuTimeP99 }')));
  assert.ok(seen.some((q) => q.includes('max { cpuTime }')));
  assert.match(text, /range limit unread: GraphQL HTTP 200: unknown field settings/);
  assert.match(text, /units: the schema's descriptions above, unread this run/);
});

test('a field the read schema lacks is "NOT in the schema" and not queried', () => {
  const s: Schema = { ds: { name: 'workersInvocationsAdaptive', fields: new Map(), blocks: new Map([['quantiles', new Map()], ['max', new Map([['cpuTime', {} as never]])]]), filter: new Set() } };
  assert.equal(fieldState(s, 'quantiles', 'cpuTimeP50'), 'absent');
  assert.equal(fieldState({ error: 'x' }, 'quantiles', 'cpuTimeP50'), 'unknown');
  assert.deepEqual(queriedFields(s), { quantiles: [], max: 'cpuTime' });
  assert.ok(schemaLines(s).includes('- quantiles.cpuTimeP50: NOT in the schema; not queried'));
});

test('readLimits reads the settings node, or says why not', async () => {
  assert.deepEqual(await readLimits(recorded({ introspection: true, limits: { maxDuration: 86_400, notOlderThan: 7_776_000 } }), 'a'), { limits: { maxDuration: 86_400, notOlderThan: 7_776_000 }, error: null });
  const r = await readLimits(recorded({ introspection: true }), 'a');
  assert.equal(r.limits, null);
  assert.match(r.error!, /unknown field settings/);
});

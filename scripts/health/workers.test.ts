// Order 38, ITEM 4: the health check's invocation-status alert (scripts/health/judge.ts judgeWorkerStatuses) and its reads
// (scripts/health/workers.ts), against a fake GraphQL endpoint that answers introspection as the schema would.
// Run: npm run test:health.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { judgeWorkerStatuses, OK_STATUSES } from './judge.ts';
import { quantile, workerDay } from './workers.ts';

const W = 'mnm-guildcraft';

test('zero errors: no alert', () => {
  const l = judgeWorkerStatuses(W, { rows: [{ dataset: 'workersInvocationsAdaptive', status: 'success', count: 101 }, { dataset: 'workersInvocationsAdaptive', status: 'clientDisconnected', count: 2 }] });
  assert.equal(l.verdict, 'pass');
});

test('one CPU-limit error: an alert naming the Worker, the status and the count', () => {
  const l = judgeWorkerStatuses(W, { rows: [{ dataset: 'workersInvocationsAdaptive', status: 'success', count: 95 }, { dataset: 'workersInvocationsAdaptive', status: 'exceededResources', count: 1 }] });
  assert.equal(l.verdict, 'fail');
  assert.match(l.text, /mnm-guildcraft/);
  assert.match(l.text, /1 exceededResources/);
});

test('a status nobody expected alerts', () => {
  assert.ok(!OK_STATUSES.has('somethingNew'));
  const l = judgeWorkerStatuses(W, { rows: [{ dataset: 'workersInvocationsScheduled', status: 'somethingNew', count: 3 }, { dataset: 'workersInvocationsScheduled', status: 'success', count: 93 }] });
  assert.equal(l.verdict, 'fail');
  assert.match(l.text, /3 somethingNew \(workersInvocationsScheduled\)/);
});

test('a failed read, or no invocations at all, is never a pass', () => {
  assert.equal(judgeWorkerStatuses(W, { error: 'GraphQL HTTP 500' }).verdict, 'fail');
  assert.equal(judgeWorkerStatuses(W, { rows: [] }).verdict, 'fail');
});

// ---------------------------------------------------------------- the reads, against a fake endpoint

const ref = (name: string, kind = 'OBJECT') => ({ name: null, kind: 'LIST', ofType: { name, kind, ofType: null } });
const scalar = (name: string) => ({ name, kind: 'SCALAR', ofType: null });
const TYPES: Record<string, { fields?: unknown[]; inputFields?: unknown[] }> = {
  account: {
    fields: [
      { name: 'workersInvocationsAdaptive', description: null, type: ref('Adaptive'), args: [{ name: 'filter', type: { name: 'AdaptiveFilter', kind: 'INPUT_OBJECT', ofType: null } }] },
      { name: 'workersInvocationsScheduled', description: null, type: ref('Scheduled'), args: [{ name: 'filter', type: { name: 'ScheduledFilter', kind: 'INPUT_OBJECT', ofType: null } }] },
    ],
  },
  Adaptive: { fields: ['sum', 'quantiles', 'max', 'dimensions'].map((n) => ({ name: n, description: null, type: { name: `Adaptive_${n}`, kind: 'OBJECT', ofType: null }, args: [] })) },
  Adaptive_sum: { fields: [{ name: 'requests', description: 'requests', type: scalar('uint64'), args: [] }] },
  Adaptive_quantiles: { fields: [{ name: 'cpuTimeP50', description: 'CPU time 50th percentile - microseconds', type: scalar('float32'), args: [] }] },
  Adaptive_max: { fields: [{ name: 'cpuTime', description: 'Maximum CPU time - microseconds', type: scalar('uint64'), args: [] }] },
  Adaptive_dimensions: { fields: [{ name: 'status', description: 'Result of the invocation', type: scalar('string'), args: [] }] },
  Scheduled: { fields: [{ name: 'status', description: 'status', type: scalar('string'), args: [] }, { name: 'cpuTimeUs', description: 'CPU time, microseconds', type: scalar('uint64'), args: [] }] },
  AdaptiveFilter: { inputFields: ['scriptName', 'datetime_geq', 'datetime_lt'].map((name) => ({ name, description: null, type: scalar('string') })) },
  ScheduledFilter: { inputFields: ['scriptName', 'datetime_geq', 'datetime_lt'].map((name) => ({ name, description: null, type: scalar('string') })) },
};

function fakeFetch(data: { adaptive: { status: string; n: number }[]; scheduled: string[]; graphqlStatus?: number }): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/telemetry/query')) return new Response(JSON.stringify({ success: true, result: { events: { events: [] } } }));
    if (data.graphqlStatus) return new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: data.graphqlStatus });
    const { query, variables } = JSON.parse(String(init?.body));
    if (query.includes('__type(')) return Response.json({ data: { __type: { name: variables.n, fields: null, inputFields: null, ...TYPES[variables.n] } } });
    if (query.includes('__typename')) return Response.json({ data: { viewer: { accounts: [{ __typename: 'account' }] } } });
    if (query.includes('workersInvocationsAdaptive') && query.includes('dimensions { status }'))
      return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: data.adaptive.map((a) => ({ sum: { requests: a.n }, dimensions: { status: a.status } })) }] } } });
    if (query.includes('workersInvocationsAdaptive')) return Response.json({ data: { viewer: { accounts: [{ workersInvocationsAdaptive: [{ quantiles: { cpuTimeP50: 7000 }, max: { cpuTime: 21000 } }] }] } } });
    if (query.includes('workersInvocationsScheduled')) return Response.json({ data: { viewer: { accounts: [{ workersInvocationsScheduled: data.scheduled.map((status) => ({ status })) }] } } });
    throw new Error(`unexpected query ${query.slice(0, 80)}`);
  }) as typeof fetch;
}
const day = { token: 't', account: 'a', script: W, from: Date.parse('2026-11-06T00:00:00Z'), to: Date.parse('2026-11-07T00:00:00Z') };

test('both datasets are read, so cron (scheduled) invocations are covered; a limit error in either alerts', async () => {
  const ok = await workerDay({ ...day, fetchImpl: fakeFetch({ adaptive: [{ status: 'success', n: 100 }], scheduled: Array(96).fill('success') }) });
  assert.ok('rows' in ok.statuses);
  assert.deepEqual(new Set(ok.statuses.rows.map((r) => r.dataset)), new Set(['workersInvocationsAdaptive', 'workersInvocationsScheduled']));
  assert.equal(judgeWorkerStatuses(W, ok.statuses).verdict, 'pass');
  // the schema's own descriptions are printed, the unit among them
  assert.ok(ok.notes.some((n) => /cpuTimeP50: CPU time 50th percentile - microseconds/.test(n)));
  const bad = await workerDay({ ...day, fetchImpl: fakeFetch({ adaptive: [{ status: 'success', n: 100 }], scheduled: [...Array(95).fill('success'), 'exceededResources'] }) });
  const l = judgeWorkerStatuses(W, bad.statuses);
  assert.equal(l.verdict, 'fail');
  assert.match(l.text, /1 exceededResources \(workersInvocationsScheduled\)/);
});

test('the GraphQL call failing: the check fails clearly, never a silent pass', async () => {
  const r = await workerDay({ ...day, fetchImpl: fakeFetch({ adaptive: [], scheduled: [], graphqlStatus: 500 }) });
  assert.ok('error' in r.statuses);
  const l = judgeWorkerStatuses(W, r.statuses);
  assert.equal(l.verdict, 'fail');
  assert.match(l.text, /statuses unread \(GraphQL HTTP 500: boom\)/);
});

test('quantile is nearest-rank', () => {
  assert.equal(quantile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.99), 10);
  assert.equal(quantile([], 0.5), null);
});

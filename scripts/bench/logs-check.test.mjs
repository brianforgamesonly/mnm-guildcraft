// Red/green tests for the Workers Logs completeness check (order 7, ITEM 1.1). Run: node --test scripts/bench/
// The fixture is the real 2026-10-19 22:00 → 2026-10-20 01:53 UTC window as read back by timings run 39355923958:
// cron schedule created by the 22:21 deploy, a second deploy at 01:10, runs in every slot but 23:30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DROP_BOUND_THRESHOLD, explainGaps, reconcile, rollHistory, slotKey, SLOT_MS, upperBound } from './logs-check.mjs';

const t = (s) => Date.parse(s);
const from = t('2026-10-19T22:00:00Z');
const to = t('2026-10-20T01:53:41Z');
const deploys = [t('2026-10-19T22:20:47Z'), t('2026-10-20T01:10:15Z')];
const cronSince = deploys[0];
const seenSlots = [];
for (let s = t('2026-10-19T22:30:00Z'); s <= t('2026-10-20T01:45:00Z'); s += SLOT_MS) if (s !== t('2026-10-19T23:30:00Z')) seenSlots.push(s);
const crons = (slots) => slots.map((s) => ({ at: s + 38_000, path: 'board sweep', kind: 'cron' }));
const interactions = [
  { at: t('2026-10-20T00:29:56.643Z'), path: 'command guildcraft setup', kind: 'interaction' },
  { at: t('2026-10-20T00:33:32.074Z'), path: 'autocomplete craft set :skill', kind: 'interaction' },
  { at: t('2026-10-20T00:33:47.850Z'), path: 'command craft set', kind: 'interaction' },
  { at: t('2026-10-20T01:33:55.365Z'), path: 'command guildcraft status', kind: 'interaction' },
];
const audit = [
  { action: 'guild.setup', actor: 'u', at: t('2026-10-20T00:29:55.956Z') },
  { action: 'skill.set', actor: 'u', at: t('2026-10-20T00:33:47.507Z') },
];
const missingOf = (r, type) => r.rows.find((x) => x.type === type)?.missing;

test('red: the real window fails on the missing 23:30 run', () => {
  const r = reconcile({ from, to, requests: [...crons(seenSlots), ...interactions], audit, deploys, cronSince });
  assert.equal(r.ok, false);
  assert.deepEqual(missingOf(r, 'cron run per 15-minute slot'), ['2026-10-19T23:30:00.000Z']);
  assert.deepEqual(missingOf(r, 'audit guild.setup → log'), []);
  assert.deepEqual(missingOf(r, 'audit skill.set → log'), []);
});

test('green: the same window with the 23:30 run present passes', () => {
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions], audit, deploys, cronSince });
  assert.equal(r.ok, true, JSON.stringify(r.rows));
  // 22:30 and 01:15 fall inside a deploy's 15-minute propagation window: not counted either way.
  assert.match(r.rows.find((x) => x.type.startsWith('cron')).note, /^2 slot/);
});

test('red: an audit row whose interaction is not in the logs', () => {
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions.filter((x) => x.path !== 'command craft set')], audit, deploys, cronSince });
  assert.equal(r.ok, false);
  assert.deepEqual(missingOf(r, 'audit skill.set → log'), ['2026-10-20T00:33:47.507Z']);
});

test('red: a read that names its audit action but has no row; green once the row exists', () => {
  const read = { at: t('2026-10-20T01:40:00Z'), path: 'command craft find', kind: 'interaction', audit: 'craft.find' };
  const all = [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions, read];
  const red = reconcile({ from, to, requests: all, audit, deploys, cronSince });
  assert.deepEqual(missingOf(red, 'read log (audit named) → audit row'), ['2026-10-20T01:40:00.000Z craft.find']);
  const green = reconcile({ from, to, requests: all, audit: [...audit, { action: 'craft.find', actor: 'u', at: read.at + 300 }], deploys, cronSince });
  assert.equal(green.ok, true, JSON.stringify(green.rows));
});

test('one log event never satisfies two audit rows', () => {
  const two = [...audit, { action: 'skill.set', actor: 'u', at: t('2026-10-20T00:33:48.000Z') }];
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions], audit: two, deploys, cronSince });
  assert.equal(missingOf(r, 'audit skill.set → log').length, 1);
});

test('rows and reads in the last minutes of the window are not judged yet (their other half may still be ingesting)', () => {
  const late = [...audit, { action: 'skill.set', actor: 'u', at: to - 30_000 }];
  const read = { at: to - 20_000, path: 'command craft find', kind: 'interaction', audit: 'craft.find' };
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions, read], audit: late, deploys, cronSince });
  assert.equal(r.ok, true, JSON.stringify(r.rows));
});

test('system rows (the departure run) are not matched to interactions', () => {
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions], audit: [...audit, { action: 'member.left', actor: 'system', at: t('2026-10-20T00:15:40Z') }], deploys, cronSince });
  assert.equal(r.ok, true);
});

// ---------------------------------------------------------------- order 8, ITEM 3.1
// Analytics per slot as read back by timings run 39359048481 (2026-10-20 02:28): 40 invocations, all success; the
// logs held 37. Slots 23:30 (the missing cron run), 01:15 and 01:30 are one short each.
const realAnalytics = () => {
  const a = new Map();
  const add = (k, n, ok = n) => a.set(k, { requests: (a.get(k)?.requests ?? 0) + n, ok: (a.get(k)?.ok ?? 0) + ok });
  for (const s of [...seenSlots, t('2026-10-19T23:30:00Z')]) add(slotKey(s), 1);
  add('2026-10-20T01:15', 2); // 01:23:41 ×2; one logged
  add('2026-10-20T01:30', 7); // 8 in the slot with the cron; 7 logged
  return a;
};
const realLogged = () => {
  const l = new Map();
  for (const s of seenSlots) l.set(slotKey(s), 1);
  l.set('2026-10-20T01:15', 2);
  l.set('2026-10-20T01:30', 7);
  return l;
};

test('green under the order 8 rule: the 23:30 gap is a confirmed platform drop, and 3 drops are counted', () => {
  const r = explainGaps({ analytics: realAnalytics(), logged: realLogged(), gaps: [{ at: t('2026-10-19T23:30:00Z'), what: 'cron run 23:30' }], settled: to });
  assert.deepEqual(r.unexplained, []);
  assert.equal(r.explained.length, 1);
  assert.match(r.explained[0], /platform drop/);
  assert.equal(r.drops, 3);
  assert.deepEqual(r.dropSlots.map((d) => d.slot), ['2026-10-19T23:30Z', '2026-10-20T01:15Z', '2026-10-20T01:30Z']);
});

test('red: a missing cron run that analytics does not count either (the cron did not run) is unexplained', () => {
  const a = realAnalytics();
  a.delete('2026-10-19T23:30');
  const r = explainGaps({ analytics: a, logged: realLogged(), gaps: [{ at: t('2026-10-19T23:30:00Z'), what: 'cron run 23:30' }], settled: to });
  assert.equal(r.unexplained.length, 1);
  assert.match(r.unexplained[0], /^cron run 23:30: missing/);
});

test('red: logs short of an invocation that did not succeed is not a platform drop', () => {
  const a = realAnalytics();
  a.set('2026-10-19T23:30', { requests: 1, ok: 0 });
  const r = explainGaps({ analytics: a, logged: realLogged(), gaps: [{ at: t('2026-10-19T23:30:00Z'), what: 'cron run 23:30' }], settled: to });
  assert.equal(r.drops, 2);
  assert.equal(r.unexplained.length, 2);
});

test('a request logged in the neighbouring slot offsets a shortfall (no drop, no gap)', () => {
  const a = new Map([['2026-10-20T00:00', { requests: 1, ok: 1 }], ['2026-10-20T00:15', { requests: 0, ok: 0 }]]);
  const l = new Map([['2026-10-20T00:15', 1]]);
  const r = explainGaps({ analytics: a, logged: l, gaps: [], settled: t('2026-10-20T01:00:00Z') });
  assert.equal(r.drops, 0);
  assert.deepEqual(r.unexplained, []);
});

test('the exact upper bound: 3 of 40 alone is 18%, over the threshold; over a 7-day volume it is not', () => {
  assert.ok(Math.abs(upperBound(3, 40) - 0.1814) < 0.002, String(upperBound(3, 40)));
  assert.ok(upperBound(3, 40) > DROP_BOUND_THRESHOLD);
  // 7 days of the */15 cron alone (672 runs) at the same 7.5% rate: the bound sits under the threshold.
  assert.ok(upperBound(50, 672) < DROP_BOUND_THRESHOLD, String(upperBound(50, 672)));
  assert.ok(upperBound(0, 672) < 0.005);
  assert.equal(upperBound(0, 0), 1);
});

test('the rolling history keeps 7 days, replaces an overlapping window, and flags a breach', () => {
  const now = t('2026-10-27T09:00:00Z');
  const day = (d, drops, invocations) => ({ from: `2026-10-${d}T09:00:00Z`, to: `2026-10-${d + 1}T09:00:00Z`, drops, invocations });
  const r = rollHistory([day(19, 50, 100), day(21, 3, 120), day(22, 2, 110)], day(26, 1, 130), now);
  assert.deepEqual(r.history.map((h) => h.from.slice(8, 10)), ['21', '22', '26']); // the 19th is over 7 days old
  assert.equal(r.drops, 6);
  assert.equal(r.breach, false);
  const replaced = rollHistory(r.history, day(26, 40, 130), now);
  assert.equal(replaced.history.length, 3);
  assert.equal(replaced.breach, true);
});

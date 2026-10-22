// Order 20 (ITEM 2): the health check's rules (scripts/health/judge.ts). Run: npm run test:health.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copies } from '../copies.ts';
import { cronSlots, DAY_MS, failed, judgeCommands, judgeNightly, judgeSweeps, previousUtcDay, type SweepRow } from './judge.ts';

const CRON = '*/15 * * * *';
const DAY = Date.parse('2026-10-22T00:00:00Z');
const SLOT = 15 * 60_000;
const at = (hhmm: string, day = DAY) => day + Date.parse(`1970-01-01T${hhmm}:00Z`);

/** A heartbeat row for every 15-minute slot from the day before through the day, except `skip`; finished unless in `unfinished`. */
function rows(day = DAY, skip: number[] = [], unfinished: number[] = []): SweepRow[] {
  return cronSlots([CRON], day - DAY_MS, day + DAY_MS)
    .filter((s) => !skip.includes(s))
    .map((s) => ({ scheduled_ms: s, started_at: new Date(s + 2_000).toISOString(), finished_at: unfinished.includes(s) ? null : new Date(s + 5_000).toISOString() }));
}
const judge = (over: Partial<Parameters<typeof judgeSweeps>[0]> = {}) =>
  judgeSweeps({ crons: [CRON], dayStart: DAY, rows: rows(), trackStart: DAY - 7 * DAY_MS, deploys: [], ...over });
const line = (lines: ReturnType<typeof judgeSweeps>, rule: string) => lines.find((l) => l.rule === rule)!;

test('the expected slots come from the cron expression in wrangler.jsonc: 96 a day per copy', () => {
  const all = copies();
  assert.ok(all.length >= 2);
  for (const c of all) {
    assert.ok(c.crons.length, `${c.name} has a cron trigger`);
    assert.equal(cronSlots(c.crons, DAY, DAY + DAY_MS).length, 96);
  }
  assert.deepEqual(cronSlots(['0 8 * * 1'], DAY, DAY + 7 * DAY_MS).map((s) => new Date(s).toISOString()), ['2026-10-26T08:00:00.000Z']);
  assert.deepEqual(cronSlots(['5,35 1-2 * * *'], DAY, DAY + DAY_MS).length, 4);
  assert.throws(() => cronSlots(['0 8 * * MON'], DAY, DAY + DAY_MS), /unsupported/);
  assert.throws(() => cronSlots(['* * * *'], DAY, DAY + DAY_MS), /5 fields/);
  // A copy with no cron trigger is a broken config: the check cannot run, never a pass.
  assert.throws(() => judgeSweeps({ crons: [], dayStart: DAY, rows: [], trackStart: null, deploys: [] }), /no cron trigger/);
});

test('a clean day passes', () => {
  const l = judge();
  assert.equal(failed(l), false);
  assert.match(line(l, 'missed sweeps').text, /^0 missed of 96 tracked slots/);
  assert.equal(line(l, 'unfinished sweeps').verdict, 'pass');
});

test('one missing slot is reported, not failed (and a deliberately missing slot is seen)', () => {
  const l = judge({ rows: rows(DAY, [at('12:30')]) });
  assert.equal(failed(l), false);
  assert.equal(line(l, 'missed sweeps').verdict, 'report');
  assert.match(line(l, 'missed sweeps').text, /1 missed of 96.*missed: 12:30/);
});

test('3 consecutive misses fail', () => {
  const l = judge({ rows: rows(DAY, [at('12:30'), at('12:45'), at('13:00')]) });
  assert.equal(failed(l), true);
  assert.match(line(l, 'missed sweeps').text, /3 in a row/);
  // Two in a row only reports.
  assert.equal(failed(judge({ rows: rows(DAY, [at('12:30'), at('12:45')]) })), false);
});

test('a run of misses across midnight fails on the day it ends', () => {
  const l = judge({ rows: rows(DAY, [at('23:30', DAY - DAY_MS), at('23:45', DAY - DAY_MS), at('00:00')]) });
  assert.equal(failed(l), true);
  assert.match(line(l, 'missed sweeps').text, /longest run 3 from 23:30/);
});

test('5 scattered misses fail; 4 are reported', () => {
  const five = ['01:00', '05:00', '09:00', '13:00', '17:00'].map((t) => at(t));
  assert.equal(failed(judge({ rows: rows(DAY, five) })), true);
  assert.match(line(judge({ rows: rows(DAY, five) }), 'missed sweeps').text, /more than 4 in the day/);
  assert.equal(failed(judge({ rows: rows(DAY, five.slice(0, 4)) })), false);
});

test('an unfinished sweep is counted; more than 2 fail', () => {
  const one = judge({ rows: rows(DAY, [], [at('10:00')]) });
  assert.equal(line(one, 'unfinished sweeps').verdict, 'report');
  assert.match(line(one, 'unfinished sweeps').text, /^1 of 96 .*\(10:00\)/);
  assert.equal(failed(one), false);
  // An unfinished sweep still counts as having run: it is not a missed slot.
  assert.match(line(one, 'missed sweeps').text, /^0 missed/);
  assert.equal(failed(judge({ rows: rows(DAY, [], [at('10:00'), at('11:00'), at('12:00')]) })), true);
});

test('the command error threshold works', () => {
  assert.equal(judgeCommands({ commands: 20, errors: 2 }).verdict, 'report');
  assert.equal(judgeCommands({ commands: 20, errors: 3 }).verdict, 'fail');
  assert.equal(judgeCommands({ commands: 100, errors: 10 }).verdict, 'report');
  assert.equal(judgeCommands({ commands: 100, errors: 11 }).verdict, 'fail');
  // Under 20 commands: never judged.
  assert.equal(judgeCommands({ commands: 19, errors: 19 }).verdict, 'report');
  assert.equal(judgeCommands({ commands: 50, errors: 0 }).verdict, 'pass');
  // No exact record: not measurable, never a failure.
  assert.equal(judgeCommands(null).verdict, 'report');
  assert.match(judgeCommands(null).text, /not measurable/);
});

test('a breach fails on two days running (no state: it never goes quiet)', () => {
  const next = DAY + DAY_MS;
  const gap = (day: number) => [at('03:00', day), at('03:15', day), at('03:30', day)];
  assert.equal(failed(judge({ rows: rows(DAY, gap(DAY)) })), true);
  assert.equal(failed(judgeSweeps({ crons: [CRON], dayStart: next, rows: rows(next, gap(next)), trackStart: DAY - 7 * DAY_MS, deploys: [] })), true);
  // A sweep that stopped for good: every slot missing, both days.
  for (const d of [DAY, next]) assert.equal(failed(judgeSweeps({ crons: [CRON], dayStart: d, rows: [], trackStart: DAY - DAY_MS, deploys: [] })), true);
});

test('slots before tracking starts are not counted', () => {
  const start = at('14:15');
  const l = judge({ rows: rows().filter((r) => r.scheduled_ms >= start), trackStart: start });
  assert.equal(failed(l), false);
  assert.match(line(l, 'missed sweeps').text, /^0 missed of 39 tracked slots; 57 not yet tracked/);
  // No heartbeat row yet: the whole day is untracked, and passes.
  const none = judge({ rows: [], trackStart: null });
  assert.equal(failed(none), false);
  assert.match(line(none, 'missed sweeps').text, /all not yet tracked \(no heartbeat row yet\)/);
});

test('a slot just after a deploy is exempt, and reported', () => {
  const deploy = { start: at('14:58'), end: at('15:01') };
  const miss = [at('15:00'), at('15:15'), at('15:30')];
  const l = judge({ rows: rows(DAY, miss), deploys: [deploy] });
  // 15:00 and 15:15 fall within the deploy step or 15 minutes after its end; 15:30 does not.
  assert.equal(failed(l), false);
  assert.equal(line(l, 'missed sweeps').verdict, 'report');
  assert.match(line(l, 'missed sweeps').text, /1 missed of 96.*2 in a deploy window \(15:00, 15:15\)/);
  // The same three without the deploy fail.
  assert.equal(failed(judge({ rows: rows(DAY, miss) })), true);
});

test('a missing nightly row with no failed workflow run fails (including a run that never started)', () => {
  const l = judgeNightly({ job: 'backup', rows: [], failedRuns: 0 });
  assert.equal(l.verdict, 'fail');
  assert.equal(judgeNightly({ job: 'backup', rows: [], failedRuns: null }).verdict, 'fail');
});

test('a missing nightly row with a failed workflow run is reported only', () => {
  assert.equal(judgeNightly({ job: 'import', rows: [], failedRuns: 1 }).verdict, 'report');
  // A row that failed: its own workflow alarms, so reported only.
  assert.equal(judgeNightly({ job: 'import', rows: [{ ok: false, status: 'failed' }], failedRuns: 1 }).verdict, 'report');
  assert.equal(judgeNightly({ job: 'usage', rows: [{ ok: true, status: '9 metric(s)' }], failedRuns: 0 }).verdict, 'pass');
});

test('the judged day is the previous UTC day', () => {
  assert.equal(new Date(previousUtcDay(Date.parse('2026-10-23T01:17:00Z'))).toISOString(), '2026-10-22T00:00:00.000Z');
  assert.equal(new Date(previousUtcDay(Date.parse('2026-10-23T00:00:00Z'))).toISOString(), '2026-10-22T00:00:00.000Z');
});

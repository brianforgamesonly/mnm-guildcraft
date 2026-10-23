// Order 20 (ITEM 2) and order 21: the health check's rules (scripts/health/judge.ts). Run: npm run test:health.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copies } from '../copies.ts';
import { cronSlots, DAY_MS, failed, judgeCommands, judgeNightly, judgeSweeps, previousUtcDay, SLOT_MATCH_MS, slotOf, type SweepRow } from './judge.ts';

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

// ---------------------------------------------------------------- order 21: rows as the Workers really write them
// Health run 39917313274 (2026-10-23) read every sweep_run row: 63 per copy, 2026-10-22 15:45 to 2026-10-23 07:15, each
// on its own slot, scheduledTime a constant offset after the slot. Production's 16:00 row, as stored:
const PROD_16 = { scheduled_ms: 1792684808996, started_at: '2026-10-22T16:00:10.057Z', finished_at: '2026-10-22T16:00:10.721Z' };
const PROD_OFFSET = 8_996;
const DEV_OFFSET = 37_257;
const FIRST_ROW = 1792683908996; // production's first row, 2026-10-22T15:45:08.996Z

/** Rows at `offset` after each slot from the day before through the day (or from `from`), started and finished as production's 16:00 row. */
function real(offset: number, skip: number[] = [], from = DAY - DAY_MS): SweepRow[] {
  const started = Date.parse(PROD_16.started_at) - (PROD_16.scheduled_ms - PROD_OFFSET);
  const finished = Date.parse(PROD_16.finished_at!) - (PROD_16.scheduled_ms - PROD_OFFSET);
  return cronSlots([CRON], from, DAY + DAY_MS)
    .filter((s) => !skip.includes(s))
    .map((s) => ({ scheduled_ms: s + offset, started_at: new Date(s + started).toISOString(), finished_at: new Date(s + finished).toISOString() }));
}

test('the real rows: production 16:00 is 8.996 s after its slot, and slotOf maps it there', () => {
  assert.equal(PROD_16.scheduled_ms - at('16:00'), PROD_OFFSET);
  assert.equal(slotOf(PROD_16.scheduled_ms), at('16:00'));
  assert.equal(slotOf(FIRST_ROW), at('15:45'));
});

test('a day of real-offset rows passes, on both copies\' offsets', () => {
  for (const offset of [PROD_OFFSET, DEV_OFFSET]) {
    const l = judge({ rows: real(offset) });
    assert.equal(failed(l), false, `offset ${offset}`);
    assert.match(line(l, 'missed sweeps').text, /^0 missed of 96 tracked slots/);
    assert.equal(line(l, 'check broken').verdict, 'pass');
    assert.match(line(l, 'check broken').text, /^0 of 96 recorded sweeps match no expected slot/);
  }
});

test('2026-10-22 as stored: tracking from the first row\'s slot, 15:45, and nothing missed', () => {
  const l = judge({ rows: real(PROD_OFFSET, [], at('15:45')), trackStart: FIRST_ROW });
  assert.equal(failed(l), false);
  assert.match(line(l, 'missed sweeps').text, /^0 missed of 33 tracked slots; 63 not yet tracked/);
  assert.equal(line(l, 'check broken').verdict, 'pass');
});

test('one real-offset slot removed is reported; 3 in a row fail', () => {
  const one = judge({ rows: real(PROD_OFFSET, [at('12:30')]) });
  assert.equal(failed(one), false);
  assert.match(line(one, 'missed sweeps').text, /1 missed of 96.*missed: 12:30/);
  const three = judge({ rows: real(DEV_OFFSET, [at('12:30'), at('12:45'), at('13:00')]) });
  assert.equal(failed(three), true);
  assert.equal(line(three, 'missed sweeps').verdict, 'fail');
  assert.match(line(three, 'missed sweeps').text, /3 in a row/);
});

test('an offset at the edge of the minute matches; one just past it does not', () => {
  const edge = judge({ rows: real(SLOT_MATCH_MS - 1) });
  assert.equal(failed(edge), false);
  assert.match(line(edge, 'missed sweeps').text, /^0 missed/);
  const past = judge({ rows: real(SLOT_MATCH_MS) });
  assert.equal(line(past, 'check broken').verdict, 'fail');
});

test('two rows in one slot count once', () => {
  const dup = { scheduled_ms: at('12:30') + PROD_OFFSET + 400, started_at: new Date(at('12:30') + 11_000).toISOString(), finished_at: null };
  const l = judge({ rows: [...real(PROD_OFFSET), dup] });
  assert.equal(failed(l), false);
  assert.match(line(l, 'missed sweeps').text, /^0 missed of 96/);
  assert.match(line(l, 'unfinished sweeps').text, /^0 of 96 /);
  assert.match(line(l, 'start delay').text, /1 slot\(s\) with more than one row, counted once \(12:30\)/);
});

test('a late, separate invocation cannot fill a missed slot', () => {
  const miss = [at('12:30'), at('12:45'), at('13:00')];
  // A minute after each missed slot, and the second before the next one: none is in an expected slot's minute.
  const late = [at('12:31') + 5_000, at('12:44') + 59_999, at('13:14')].map((ms) => ({ scheduled_ms: ms, started_at: new Date(ms + 1_000).toISOString(), finished_at: new Date(ms + 2_000).toISOString() }));
  const l = judge({ rows: [...real(PROD_OFFSET, miss), ...late] });
  assert.equal(failed(l), true);
  assert.match(line(l, 'missed sweeps').text, /3 missed of 96.*missed: 12:30, 12:45, 13:00/);
  assert.equal(line(l, 'check broken').verdict, 'fail');
  assert.match(line(l, 'check broken').text, /^3 of 96 .*\(12:31:05, 12:44:59, 13:14:00\)/);
});

test('tracking starts at the first row\'s slot, not its raw milliseconds', () => {
  const l = judge({ rows: real(DEV_OFFSET, [], at('14:15')), trackStart: at('14:15') + DEV_OFFSET });
  assert.match(line(l, 'missed sweeps').text, /^0 missed of 39 tracked slots; 57 not yet tracked/);
});

test('start delay is measured from the matched slot', () => {
  const l = judge({ rows: real(PROD_OFFSET) });
  // Production's 16:00 row started 10.057 s after 16:00, 1.061 s after its own scheduledTime.
  assert.match(line(l, 'start delay').text, /^largest start after its slot 10\.1 s; scheduledTime after its slot 9\.0 s/);
});

test('rows the matcher does not accept fail "check broken", not a "missed sweeps" verdict built on them', () => {
  const l = judge({ rows: real(61_000) });
  assert.equal(failed(l), true);
  const broken = line(l, 'check broken');
  assert.equal(broken.verdict, 'fail');
  assert.match(broken.text, /^96 of 96 recorded sweeps match no expected slot/);
  assert.match(broken.text, /the check's matching, the cron configuration, or a manual trigger; such a row is not itself a missed sweep/);
  assert.match(broken.text, /\(00:01:01, .*, 02:16:01, … 86 more\)/);
  const missed = line(l, 'missed sweeps');
  assert.notEqual(missed.verdict, 'fail');
  assert.match(missed.text, /^96 recorded sweep\(s\) match no expected slot \(see check broken\)\. As matched: .*Counting each unmatched row toward the slot before it: 0 missed, longest run 0 — not a breach/);
});

test('a genuine outage still fails "missed sweeps" on a day with an unmatched row', () => {
  const stray = at('09:03');
  const l = judge({ rows: [...real(PROD_OFFSET, [at('12:30'), at('12:45'), at('13:00')]), { scheduled_ms: stray, started_at: new Date(stray).toISOString(), finished_at: null }] });
  assert.equal(line(l, 'check broken').verdict, 'fail');
  assert.match(line(l, 'check broken').text, /1 of them did not finish/);
  assert.equal(line(l, 'missed sweeps').verdict, 'fail');
  assert.match(line(l, 'missed sweeps').text, /3 missed, longest run 3 from 12:30 — a breach even so/);
});

test('the limit of the rule: a trigger inside a missed slot\'s own minute is credited to it, and the offset range shows it', () => {
  const manual = at('12:30') + 40_000;
  const l = judge({ rows: [...real(PROD_OFFSET, [at('12:30')]), { scheduled_ms: manual, started_at: new Date(manual + 900).toISOString(), finished_at: new Date(manual + 1_500).toISOString() }] });
  assert.match(line(l, 'missed sweeps').text, /^0 missed/);
  assert.match(line(l, 'start delay').text, /scheduledTime after its slot 9\.0 s–40\.0 s/);
});

test('a row on no expected slot inside a deploy window is reported, not failed', () => {
  const stray = at('15:03') + 2_000;
  const l = judge({ rows: [...real(PROD_OFFSET), { scheduled_ms: stray, started_at: new Date(stray + 500).toISOString(), finished_at: new Date(stray + 900).toISOString() }], deploys: [{ start: at('14:58'), end: at('15:01') }] });
  assert.equal(failed(l), false);
  assert.equal(line(l, 'check broken').verdict, 'report');
  assert.match(line(l, 'check broken').text, /1 in a deploy window, reported/);
  // The same row with no deploy fails: a manual trigger is not exempt.
  assert.equal(line(judge({ rows: [...real(PROD_OFFSET), { scheduled_ms: stray, started_at: new Date(stray).toISOString(), finished_at: null }] }), 'check broken').verdict, 'fail');
});

test('the judged day is the previous UTC day', () => {
  assert.equal(new Date(previousUtcDay(Date.parse('2026-10-23T01:17:00Z'))).toISOString(), '2026-10-22T00:00:00.000Z');
  assert.equal(new Date(previousUtcDay(Date.parse('2026-10-23T00:00:00Z'))).toISOString(), '2026-10-22T00:00:00.000Z');
});

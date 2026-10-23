// Order 20 (ITEM 2): the health check's rules, judged on the bot's own D1 records for one UTC day and one copy. Pure, so
// scripts/health/judge.test.ts runs it; scripts/health/run.ts reads the records and acts on the verdict.
//
// No state is kept between runs: every verdict comes from the day's records alone, so a breach fails on every day it
// lasts (order 20's override 2 of order 8's fail-once rule, for this alarm only), and the first run needs no baseline.
//
// The thresholds are judgement (Cowork's, order 20), not a Cloudflare figure: Cloudflare's cron documentation states no
// reliability or delivery guarantee (developers.cloudflare.com/workers/configuration/cron-triggers/, read 2026-10-22).
// It does state that a cron change "may take several minutes (up to 15 minutes) to propagate", hence DEPLOY_GRACE_MS.

export const DAY_MS = 86_400_000;
/** Fail on this many missed slots in a row (3 at every 15 minutes: 45 minutes or more without a sweep). */
export const CONSECUTIVE_FAIL = 3;
/** Fail on more than this many missed slots in the day. */
export const DAY_MISSED_MAX = 4;
/** Fail on more than this many sweeps in the day that started but never finished. */
export const UNFINISHED_MAX = 2;
/** Command errors: fail above this share, only on days with at least COMMAND_MIN commands. */
export const COMMAND_ERROR_SHARE = 0.1;
export const COMMAND_MIN = 20;
/** A slot this long after a deploy of the copy (its deploy step's end) is reported, not failed. */
export const DEPLOY_GRACE_MS = 15 * 60_000;

/**
 * Order 21 (ITEM 2): the matching rule. A heartbeat row belongs to the expected slot whose own minute holds its
 * scheduled_ms (controller.scheduledTime): the cron expression's resolution is the minute, and Cloudflare defines
 * scheduledTime only as "the time the ScheduledEvent was scheduled to be executed", with no alignment to the minute
 * (developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/, read 2026-10-23). The rows show a constant offset
 * per Worker, inside the minute: production +8.996 s, dev +37.257 s on all 63 rows each (2026-10-22 15:45 to
 * 2026-10-23 07:15, health run 39917313274). A row can never stand in for another slot: the next expected slot is 15
 * minutes on, and any later invocation carries its own, later scheduledTime. A row in no expected slot's minute fails
 * "check broken" (ITEM 3), never a silent pass. src/heartbeat.ts keeps the raw scheduledTime, so the offset stays seen.
 */
export const SLOT_MATCH_MS = 60_000;
export const slotOf = (ms: number) => Math.floor(ms / SLOT_MATCH_MS) * SLOT_MATCH_MS;

// ---------------------------------------------------------------- the expected slots, from the cron expression

const FIELDS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'day of month', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'day of week', min: 0, max: 7 },
] as const;

/** One field's allowed values. Only numbers, *, ranges, steps and lists: anything else throws (never a guess). */
function field(text: string, f: (typeof FIELDS)[number]): Set<number> {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron ${f.name} "${text}": unsupported syntax (numbers, *, a-b, /n and lists only)`);
    const lo = m[1] === '*' ? f.min : Number(m[2]);
    const hi = m[1] === '*' ? f.max : m[3] !== undefined ? Number(m[3]) : m[4] !== undefined ? f.max : lo;
    const step = m[4] !== undefined ? Number(m[4]) : 1;
    if (lo < f.min || hi > f.max || lo > hi || step < 1) throw new Error(`cron ${f.name} "${text}": out of range`);
    for (let v = lo; v <= hi; v += step) out.add(f.name === 'day of week' && v === 7 ? 0 : v);
  }
  return out;
}

/** Every slot (ms, UTC) in [from, to) that any of these cron expressions fires on. Cron Triggers run on UTC. */
export function cronSlots(crons: string[], from: number, to: number): number[] {
  const slots = new Set<number>();
  for (const expr of crons) {
    const parts = expr.trim().split(/\s+/);
    if (parts.length !== 5) throw new Error(`cron "${expr}": expected 5 fields`);
    const [min, hour, dom, mon, dow] = parts.map((p, i) => field(p, FIELDS[i]));
    // Standard cron: when both day fields are restricted, a day matching either fires.
    const domAny = parts[2] === '*';
    const dowAny = parts[4] === '*';
    const start = Math.ceil(from / 60_000) * 60_000;
    for (let t = start; t < to; t += 60_000) {
      const d = new Date(t);
      if (!min.has(d.getUTCMinutes()) || !hour.has(d.getUTCHours()) || !mon.has(d.getUTCMonth() + 1)) continue;
      const domHit = dom.has(d.getUTCDate());
      const dowHit = dow.has(d.getUTCDay());
      if (domAny && dowAny ? true : domAny ? dowHit : dowAny ? domHit : domHit || dowHit) slots.add(t);
    }
  }
  return [...slots].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- verdicts

export type Verdict = 'pass' | 'report' | 'fail';
export interface Line {
  rule: string;
  verdict: Verdict;
  /** One line: the figure and why it got its verdict. */
  text: string;
}

export interface SweepRow {
  scheduled_ms: number;
  started_at: string;
  finished_at: string | null;
}
export interface Window {
  start: number;
  end: number;
}

const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);

/**
 * Missed and unfinished sweeps for the day starting at `dayStart`. `rows` must cover the day and the CONSECUTIVE_FAIL - 1
 * slots before it (a run of misses across midnight is judged on the day it ends). `trackStart`: the copy's first heartbeat
 * (null: none yet); slots before its slot are "not yet tracked", never missed. Rows map to slots by `slotOf`.
 */
export function judgeSweeps(input: { crons: string[]; dayStart: number; rows: SweepRow[]; trackStart: number | null; deploys: Window[] }): Line[] {
  const { crons, dayStart, rows, trackStart, deploys } = input;
  // A copy with no cron trigger has nothing to judge: that is a broken config, never a pass (order 20 review).
  if (!crons.length) throw new Error('no cron trigger in wrangler.jsonc for this copy: the expected slots cannot be derived');
  const dayEnd = dayStart + DAY_MS;
  const daySlots = cronSlots(crons, dayStart, dayEnd);
  const before = cronSlots(crons, dayStart - DAY_MS, dayStart).slice(-(CONSECUTIVE_FAIL - 1));
  const expected = new Set([...before, ...daySlots]);
  // Each row to its slot (order 21): a slot ran if at least one row maps to it, so two rows in one slot count once.
  const bySlot = new Map<number, SweepRow[]>();
  for (const r of rows) if (expected.has(slotOf(r.scheduled_ms))) bySlot.set(slotOf(r.scheduled_ms), [...(bySlot.get(slotOf(r.scheduled_ms)) ?? []), r]);
  // Tracking starts at the first row's slot, never its raw milliseconds (on 2026-10-22 the 15:45 slot that ran was untracked).
  const trackSlot = trackStart === null ? null : slotOf(trackStart);
  const tracked = (s: number) => trackSlot !== null && s >= trackSlot;
  const exempt = (s: number) => deploys.some((d) => s >= d.start && s <= d.end + DEPLOY_GRACE_MS);

  // Order 21 (ITEM 3, its explicit override 1 of order 20's report-only line): a day's row on no expected slot means the
  // matching, the cron configuration or a manual trigger, never a missed sweep. It fails, except inside a deploy window.
  const inDay = rows.filter((r) => r.scheduled_ms >= dayStart && r.scheduled_ms < dayEnd);
  const off = inDay.filter((r) => !bySlot.has(slotOf(r.scheduled_ms)));
  const offExempt = off.filter((r) => exempt(r.scheduled_ms));
  const broken = off.length - offExempt.length;
  // While rows match no slot, the misses are also judged on the most generous reading: each unmatched row counted toward
  // the expected slot before it. A breach that survives that is genuine whatever broke the match, so it still fails;
  // one that does not is left to "check broken" (order 21 review). The strict match is what the line shows.
  const allSlots = [...before, ...daySlots];
  const generous = new Set<number>();
  for (const r of rows) {
    if (bySlot.has(slotOf(r.scheduled_ms))) continue;
    const s = allSlots.findLast((x) => x <= r.scheduled_ms);
    if (s !== undefined) generous.add(s);
  }

  type State = 'ran' | 'missed' | 'exempt' | 'untracked';
  const misses = (ran: (s: number) => boolean) => {
    const state = (s: number): State => (!tracked(s) ? 'untracked' : ran(s) ? 'ran' : exempt(s) ? 'exempt' : 'missed');
    // Runs of consecutive misses: exempt, untracked and recorded slots each end a run. A run counts if it reaches into the day.
    let longest: number[] = [];
    let run: number[] = [];
    for (const s of allSlots) {
      if (state(s) === 'missed') run.push(s);
      else run = [];
      if (run.length > longest.length && run.at(-1)! >= dayStart) longest = [...run];
    }
    const missed = daySlots.filter((s) => state(s) === 'missed');
    return { missed, exempted: daySlots.filter((s) => state(s) === 'exempt'), longest, fail: longest.length >= CONSECUTIVE_FAIL || missed.length > DAY_MISSED_MAX };
  };
  const { missed, exempted, longest, fail: strictFail } = misses((s) => bySlot.has(s));

  const lines: Line[] = [];
  const untracked = daySlots.filter((s) => !tracked(s));
  const judged = daySlots.length - untracked.length;

  if (!judged) {
    lines.push({
      rule: 'missed sweeps',
      verdict: 'pass',
      text: `${daySlots.length} expected slots, all not yet tracked (${trackStart === null ? 'no heartbeat row yet' : `tracking starts ${new Date(trackStart).toISOString()}`})`,
    });
  } else {
    const fail = strictFail;
    const parts = [
      `${missed.length} missed of ${judged} tracked slots`,
      untracked.length ? `${untracked.length} not yet tracked` : '',
      exempted.length ? `${exempted.length} in a deploy window (${exempted.map(hhmm).join(', ')}), reported` : '',
      missed.length ? `missed: ${missed.map(hhmm).join(', ')}` : '',
      `longest run ${longest.length}${longest.length ? ` from ${hhmm(longest[0])}` : ''}`,
    ].filter(Boolean);
    const why = fail
      ? longest.length >= CONSECUTIVE_FAIL
        ? `${longest.length} in a row (fails at ${CONSECUTIVE_FAIL})`
        : `more than ${DAY_MISSED_MAX} in the day`
      : missed.length
        ? `under the thresholds (${CONSECUTIVE_FAIL} in a row, or more than ${DAY_MISSED_MAX} a day), reported`
        : 'none missed';
    if (broken) {
      const g = misses((s) => bySlot.has(s) || generous.has(s));
      const gText = `${g.missed.length} missed, longest run ${g.longest.length}${g.longest.length ? ` from ${hhmm(g.longest[0])}` : ''}`;
      lines.push({
        rule: 'missed sweeps',
        verdict: g.fail ? 'fail' : 'report',
        text: `${broken} recorded sweep(s) match no expected slot (see check broken). As matched: ${parts.join('; ')}. Counting each unmatched row toward the slot before it: ${gText} — ${g.fail ? 'a breach even so: genuine missed work' : 'not a breach on that reading, so left to check broken'}`,
      });
    } else lines.push({ rule: 'missed sweeps', verdict: fail ? 'fail' : missed.length || exempted.length ? 'report' : 'pass', text: `${parts.join('; ')} — ${why}` });
  }

  const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  const hhmmss = (ms: number) => new Date(ms).toISOString().slice(11, 19);
  const offUnfinished = off.filter((r) => r.finished_at === null).length;
  lines.push({
    rule: 'check broken',
    verdict: broken ? 'fail' : offExempt.length ? 'report' : 'pass',
    text: `${off.length} of ${inDay.length} recorded sweeps match no expected slot (rule: the slot whose minute holds scheduledTime)${off.length ? ` (${off.slice(0, 10).map((r) => hhmmss(r.scheduled_ms)).join(', ')}${off.length > 10 ? `, … ${off.length - 10} more` : ''})` : ''}${offUnfinished ? `; ${offUnfinished} of them did not finish` : ''}${offExempt.length ? `; ${offExempt.length} in a deploy window, reported` : ''}${broken ? ' — the cause is the check\'s matching, the cron configuration, or a manual trigger; such a row is not itself a missed sweep' : ''}`,
  });

  // Unfinished, per slot: a slot whose rows all lack finished_at (a repeat invocation that finished covers it).
  const ranInDay = [...bySlot].filter(([s]) => s >= dayStart && s < dayEnd).sort(([a], [b]) => a - b);
  const unfinished = ranInDay.filter(([, rs]) => rs.every((r) => r.finished_at === null)).map(([s]) => s);
  lines.push({
    rule: 'unfinished sweeps',
    verdict: unfinished.length > UNFINISHED_MAX ? 'fail' : unfinished.length ? 'report' : 'pass',
    text: `${unfinished.length} of ${ranInDay.length} slots that ran started but did not finish${unfinished.length ? ` (${unfinished.map(hhmm).join(', ')})` : ''} — fails above ${UNFINISHED_MAX}`,
  });

  // Report only: how late the sweeps started, measured from the matched slot (order 21: from the row's own scheduledTime
  // it hid the offset), the offset itself, and slots with more than one row.
  if (ranInDay.length) {
    const delays = ranInDay.map(([s, rs]) => Math.min(...rs.map((r) => Date.parse(r.started_at))) - s).filter(Number.isFinite);
    const offsets = ranInDay.flatMap(([s, rs]) => rs.map((r) => r.scheduled_ms - s));
    const dup = ranInDay.filter(([, rs]) => rs.length > 1);
    const range = Math.min(...offsets) === Math.max(...offsets) ? sec(offsets[0]) : `${sec(Math.min(...offsets))}–${sec(Math.max(...offsets))}`;
    lines.push({
      rule: 'start delay',
      verdict: 'pass',
      text: `largest start after its slot ${delays.length ? sec(Math.max(...delays)) : 'unknown'}; scheduledTime after its slot ${range}${dup.length ? `; ${dup.length} slot(s) with more than one row, counted once (${dup.map(([s]) => hhmm(s)).join(', ')})` : ''} (reported only)`,
    });
  }
  return lines;
}

/** Command errors. null: no exact error record exists, so the rule is "not measurable" (order 20), never a failure. */
export function judgeCommands(c: { commands: number; errors: number } | null): Line {
  if (!c) return { rule: 'command errors', verdict: 'report', text: 'not measurable: no exact per-command error record exists (no record added, order 20)' };
  const share = c.commands ? c.errors / c.commands : 0;
  const pct = `${(share * 100).toFixed(1)}%`;
  if (c.commands < COMMAND_MIN) return { rule: 'command errors', verdict: c.errors ? 'report' : 'pass', text: `${c.errors} of ${c.commands} (${pct}) — not judged under ${COMMAND_MIN} commands` };
  const fail = share > COMMAND_ERROR_SHARE;
  return { rule: 'command errors', verdict: fail ? 'fail' : c.errors ? 'report' : 'pass', text: `${c.errors} of ${c.commands} (${pct}) — fails above ${COMMAND_ERROR_SHARE * 100}%` };
}

export interface NightlyInput {
  job: string;
  /** The job's D1 rows started (or measured) on the day: whether each succeeded, and its status as stored. */
  rows: { ok: boolean; status: string }[];
  /** The job's workflow runs created on the day that failed (GitHub already mailed each); null when the runs were unread. */
  failedRuns: number | null;
}

/**
 * A nightly job's own workflow already alarms on its failures, so this only reports, except for the one case nothing
 * else catches: no row at all, and no failed run of its workflow that day (a run that never started, or one that
 * passed without writing). Unread runs with a missing row also fail: the check cannot rule that case out.
 */
export function judgeNightly({ job, rows, failedRuns }: NightlyInput): Line {
  const rule = `nightly ${job}`;
  if (rows.length) {
    const ok = rows.some((r) => r.ok);
    return { rule, verdict: ok ? 'pass' : 'report', text: `${rows.length} row(s): ${rows.map((r) => r.status).join(', ')}${ok ? '' : ' — none succeeded; its own workflow alarms, so reported only'}` };
  }
  if (failedRuns === null) return { rule, verdict: 'fail', text: 'no row, and its workflow runs could not be read' };
  if (failedRuns > 0) return { rule, verdict: 'report', text: `no row; ${failedRuns} failed run(s) of its workflow that day already alarmed, so reported only` };
  return { rule, verdict: 'fail', text: 'no row, and no failed run of its workflow that day: it never ran, or ran without recording' };
}

export const failed = (lines: Line[]) => lines.some((l) => l.verdict === 'fail');

/** The UTC day before `nowMs`, as its start (ms). */
export const previousUtcDay = (nowMs: number) => Math.floor(nowMs / DAY_MS) * DAY_MS - DAY_MS;

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
 * (null: none yet); slots before it are "not yet tracked", never missed.
 */
export function judgeSweeps(input: { crons: string[]; dayStart: number; rows: SweepRow[]; trackStart: number | null; deploys: Window[] }): Line[] {
  const { crons, dayStart, rows, trackStart, deploys } = input;
  // A copy with no cron trigger has nothing to judge: that is a broken config, never a pass (order 20 review).
  if (!crons.length) throw new Error('no cron trigger in wrangler.jsonc for this copy: the expected slots cannot be derived');
  const dayEnd = dayStart + DAY_MS;
  const daySlots = cronSlots(crons, dayStart, dayEnd);
  const before = cronSlots(crons, dayStart - DAY_MS, dayStart).slice(-(CONSECUTIVE_FAIL - 1));
  const recorded = new Set(rows.map((r) => r.scheduled_ms));
  const tracked = (s: number) => trackStart !== null && s >= trackStart;
  const exempt = (s: number) => deploys.some((d) => s >= d.start && s <= d.end + DEPLOY_GRACE_MS);
  type State = 'ran' | 'missed' | 'exempt' | 'untracked';
  const state = (s: number): State => (!tracked(s) ? 'untracked' : recorded.has(s) ? 'ran' : exempt(s) ? 'exempt' : 'missed');

  const lines: Line[] = [];
  const untracked = daySlots.filter((s) => !tracked(s));
  const judged = daySlots.length - untracked.length;
  const missed = daySlots.filter((s) => state(s) === 'missed');
  const exempted = daySlots.filter((s) => state(s) === 'exempt');

  // Runs of consecutive misses: exempt, untracked and recorded slots each end a run. A run counts if it reaches into the day.
  let longest: number[] = [];
  let run: number[] = [];
  for (const s of [...before, ...daySlots]) {
    if (state(s) === 'missed') run.push(s);
    else run = [];
    if (run.length > longest.length && run.at(-1)! >= dayStart) longest = [...run];
  }

  if (!judged) {
    lines.push({
      rule: 'missed sweeps',
      verdict: 'pass',
      text: `${daySlots.length} expected slots, all not yet tracked (${trackStart === null ? 'no heartbeat row yet' : `tracking starts ${new Date(trackStart).toISOString()}`})`,
    });
  } else {
    const fail = longest.length >= CONSECUTIVE_FAIL || missed.length > DAY_MISSED_MAX;
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
    lines.push({ rule: 'missed sweeps', verdict: fail ? 'fail' : missed.length || exempted.length ? 'report' : 'pass', text: `${parts.join('; ')} — ${why}` });
  }

  const inDay = rows.filter((r) => r.scheduled_ms >= dayStart && r.scheduled_ms < dayEnd);
  const unfinished = inDay.filter((r) => r.finished_at === null);
  lines.push({
    rule: 'unfinished sweeps',
    verdict: unfinished.length > UNFINISHED_MAX ? 'fail' : unfinished.length ? 'report' : 'pass',
    text: `${unfinished.length} of ${inDay.length} recorded sweeps started but did not finish${unfinished.length ? ` (${unfinished.map((r) => hhmm(r.scheduled_ms)).join(', ')})` : ''} — fails above ${UNFINISHED_MAX}`,
  });

  // Report only: how late the sweeps started, and rows on no expected slot (a cron change, or a manual trigger).
  const expected = new Set(daySlots);
  const delays = inDay.map((r) => Date.parse(r.started_at) - r.scheduled_ms).filter(Number.isFinite);
  const off = inDay.filter((r) => !expected.has(r.scheduled_ms));
  if (inDay.length)
    lines.push({
      rule: 'start delay',
      verdict: 'pass',
      text: `largest start after its slot ${delays.length ? `${(Math.max(...delays) / 1000).toFixed(1)} s` : 'unknown'}${off.length ? `; ${off.length} row(s) on no expected slot` : ''} (reported only)`,
    });
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

// Order 11 (override 1): the usage-level alarm, to the operator instead of a guild's review channel. Pure, so the
// Workers-pool tests run it (test/worker/usage.test.ts); scripts/usage/run.ts acts on it.
//
// The alarm (ORDER-RULES order 8's rule):
//   who:   GitHub's failed-run mail to the repository owner, from the production run of the usage job only (the
//          figures are account-wide, so the dev run would repeat it; it never fails on this);
//   state: per metric, 'over' when a day's figure is at least 10% of its Free limit (src/limits.ts), else 'under'.
//          Today's state is yesterday's figure; the previous state is the day before it, read from usage_daily
//          (no stored state, and never the usage.alert rows). Separate from the job's stale/GraphQL alarm;
//   how often: only a metric whose newest day is yesterday is judged, so each day's change is judged once: crossing
//          up fails the run (at most once a day per metric); staying over passes; dropping back under is reported in
//          the summary and passes. A metric with no earlier day counts as previously under.
import { alarmOutcome } from '../ci/alarm-outcome.ts';
import { FREE_LIMITS, USAGE_TARGET_SHARE, type Metric } from '../../src/limits.ts';

export interface DayFigure {
  metric: string;
  day: string;
  value: number;
}

export interface LevelChange {
  metric: Metric;
  day: string;
  value: number;
  outcome: 'notify' | 'quiet' | 'pass' | 'recovered';
}

/** Which run of the job judges the level: production's only (the dev run never fails on it). */
export const judgesLevel = (copy: string) => copy === 'production';

const over = (m: Metric, v: number) => v / FREE_LIMITS[m].limit >= USAGE_TARGET_SHARE;
const pct = (m: Metric, v: number) => `${((v / FREE_LIMITS[m].limit) * 100).toFixed(1)}%`;

/** Each metric whose newest figure is for `yesterday`, with what the alarm does about it. */
export function levelChanges(rows: DayFigure[], yesterday: string): LevelChange[] {
  const out: LevelChange[] = [];
  for (const m of Object.keys(FREE_LIMITS) as Metric[]) {
    const days = rows.filter((r) => r.metric === m).sort((a, b) => a.day.localeCompare(b.day));
    const now = days.at(-1);
    if (!now || now.day !== yesterday) continue;
    const before = days.at(-2);
    // scheduled: true, so staying over is quiet on a dispatch too: only crossing up fails (order 11).
    out.push({ metric: m, day: now.day, value: now.value, outcome: alarmOutcome(over(m, now.value), before ? over(m, before.value) : false, true) });
  }
  return out;
}

/** The one-line summary: the run fails when any metric crossed up. */
export function levelSummary(changes: LevelChange[]): { failed: boolean; line: string } {
  const up = changes.filter((c) => c.outcome === 'notify');
  const down = changes.filter((c) => c.outcome === 'recovered');
  const still = changes.filter((c) => c.outcome === 'quiet');
  const name = (c: LevelChange) => `${FREE_LIMITS[c.metric].label} ${pct(c.metric, c.value)} on ${c.day}`;
  const bits = [
    up.length ? `over the ${USAGE_TARGET_SHARE * 100}% target: ${up.map(name).join(', ')}` : null,
    down.length ? `back under ${USAGE_TARGET_SHARE * 100}%: ${down.map(name).join(', ')}` : null,
    still.length ? `still over (already reported): ${still.map(name).join(', ')}` : null,
  ].filter(Boolean);
  return { failed: up.length > 0, line: `usage level: ${bits.length ? bits.join('; ') : `every metric under ${USAGE_TARGET_SHARE * 100}%`}` };
}

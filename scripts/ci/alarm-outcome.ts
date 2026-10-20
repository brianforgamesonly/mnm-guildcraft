// The alarm rule's decision, pure so the Workers-pool tests can run it (order 9). scripts/ci/alarm.ts acts on it.

/** What a run does with the alarm: notify (fail the run), quiet (already failing), pass, or recovered. */
export function alarmOutcome(failed: boolean, previousFailing: boolean | null, scheduled: boolean): 'notify' | 'quiet' | 'pass' | 'recovered' {
  if (!failed) return previousFailing ? 'recovered' : 'pass';
  return previousFailing === true && scheduled ? 'quiet' : 'notify';
}

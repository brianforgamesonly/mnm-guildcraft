// The alarm rule (ORDER-RULES, order 8): "Every alarm states who is notified, how often, and what counts as its
// state. It re-notifies only when the state changes, at most once a day."
//
// A nightly job's alarm is its failed run: GitHub mails "the user who last modified the cron syntax in the workflow
// file" (docs.github.com, events that trigger workflows). Each job runs once a day, so it can notify at most once a
// day. Its state is failing or passing, read from the job's own record (backup_status, usage_daily's age). Order 20: the
// timings job no longer alarms (report only), and the health job's alarm fails on every breached day instead of once
// (scripts/health/run.ts, an explicit override of this rule for that alarm only). A failure while the state was already failing does not fail the run again: it prints an
// ::error annotation and a FAILED summary, and /guildcraft status keeps showing it (stale after 36 hours).
import { appendFileSync } from 'node:fs';
import { alarmOutcome } from './alarm-outcome.ts';

export interface AlarmInput {
  job: string;
  failed: boolean;
  reason: string;
  /** Whether the job's previous scheduled run left the state failing; null when unknown (counts as a change). */
  previousFailing: boolean | null;
}

export function summary(text: string) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${text}\n`);
  console.log(text);
}

/** Sets the exit code: 1 only when this run turns the state to failing. */
export function alarm({ job, failed, reason, previousFailing }: AlarmInput): void {
  const outcome = alarmOutcome(failed, previousFailing, process.env.GITHUB_EVENT_NAME === 'schedule');
  if (outcome === 'pass' || outcome === 'recovered') {
    summary(`${job}: passed${outcome === 'recovered' ? ' (recovered from a failing state)' : ''}`);
    return;
  }
  if (outcome === 'quiet') {
    console.log(`::error::${job} FAILED: ${reason} (state unchanged: already failing, so not re-notified)`);
    summary(`**${job} FAILED** — ${reason}. Already failing before this run, so this run does not notify again (order 8 alarm rule).`);
    return;
  }
  summary(`**${job} FAILED** — ${reason}`);
  process.exitCode = 1;
}

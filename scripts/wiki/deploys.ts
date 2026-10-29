// Order 28b, ITEM 1: the wiki snapshot never starts while a deploy of either copy's Worker is queued or running.
//   node scripts/wiki/deploys.ts wait                      waits until no deploy.yml run is queued or in progress
//   node scripts/wiki/deploys.ts overlap --since <iso>     lists the deploy.yml runs whose time overlapped the snapshot
// Not a shared concurrency group: GitHub keeps at most one running and one pending job per group, and a newer arrival
// cancels the pending one ("any existing pending job or workflow in the same concurrency group will be canceled",
// docs.github.com, "Control the concurrency of workflows and jobs"), which would cancel deploys or snapshots.
// Reads the Actions API with the job's GITHUB_TOKEN (actions: read). Writes to stdout and, when set, the job summary.
import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** deploy.yml deploys both copies (one job per copy), so its runs are the deploys to wait for. */
export const DEPLOY_WORKFLOW = 'deploy.yml';
export const POLL_MS = 15_000;
export const WAIT_LIMIT_MS = 10 * 60_000;

export interface Run {
  id: number;
  status: string;
  created_at: string;
  updated_at: string;
  html_url?: string;
}
export type ListRuns = () => Promise<Run[]>;

/** Queued, waiting, pending, requested and in progress all count: anything not completed. */
export const busy = (runs: Run[]) => runs.filter((r) => r.status !== 'completed');

export class DeployStillRunning extends Error {}

/**
 * Polls every POLL_MS until no deploy run is busy, for at most WAIT_LIMIT_MS; after that the attempt fails with "a
 * deploy was still running". Returns how long it waited and what it saw, for the run's record.
 */
export async function waitForDeploys(list: ListRuns, sleep: (ms: number) => Promise<void>, now: () => number, log: (s: string) => void): Promise<{ waitedMs: number; polls: number }> {
  const start = now();
  for (let polls = 1; ; polls++) {
    const b = busy(await list());
    if (!b.length) return { waitedMs: now() - start, polls };
    if (now() - start >= WAIT_LIMIT_MS) throw new DeployStillRunning(`a deploy was still running after ${WAIT_LIMIT_MS / 60_000} minutes: run ${b.map((r) => r.id).join(', ')}`);
    log(`deploy run ${b.map((r) => `${r.id} (${r.status})`).join(', ')}: waiting ${POLL_MS / 1000} s`);
    await sleep(POLL_MS);
  }
}

/** The deploy runs whose time overlapped [since, until]: created by `until`, and not completed before `since`. */
export const overlapping = (runs: Run[], since: string, until: string) =>
  runs.filter((r) => r.created_at <= until && (r.status !== 'completed' || r.updated_at >= since));

function githubList(): ListRuns {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repo || !token) throw new Error('GITHUB_REPOSITORY and GITHUB_TOKEN are required');
  return async () => {
    const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/${DEPLOY_WORKFLOW}/runs?per_page=30`, {
      headers: { 'User-Agent': 'mnm-guildcraft-wiki-snapshot', Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`GitHub API, ${DEPLOY_WORKFLOW} runs: HTTP ${res.status}`);
    return ((await res.json()) as { workflow_runs: Run[] }).workflow_runs;
  };
}

if (import.meta.main) {
  const { values: args, positionals } = parseArgs({ allowPositionals: true, options: { since: { type: 'string' }, until: { type: 'string' } } });
  const summary = (s: string) => {
    console.log(s);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, s + '\n');
  };
  const list = githubList();
  if (positionals[0] === 'wait') {
    try {
      const w = await waitForDeploys(list, (ms) => new Promise((r) => setTimeout(r, ms)), Date.now, console.log);
      summary(`Deploys: none queued or running after ${Math.round(w.waitedMs / 1000)} s (${w.polls} check${w.polls === 1 ? '' : 's'}).`);
    } catch (e) {
      if (!(e instanceof DeployStillRunning)) throw e;
      summary(`Deploys: ${e.message}. This attempt fails.`);
      console.log(`::error::${e.message}`);
      process.exit(1);
    }
  } else if (positionals[0] === 'overlap') {
    if (!args.since) throw new Error('--since is required');
    const until = args.until ?? new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const o = overlapping(await list(), args.since, until);
    summary(`Deploy runs overlapping the snapshot (${args.since} to ${until}): ${o.length ? o.map((r) => `${r.id} (${r.status}, ${r.created_at} to ${r.status === 'completed' ? r.updated_at : 'still running'})`).join('; ') : 'none'}.`);
  } else throw new Error('usage: deploys.ts wait | overlap --since <iso> [--until <iso>]');
}

// Order 20 (ITEM 2): the daily health check, for one copy (GUILDCRAFT_COPY), judged on the bot's own D1 records for one
// UTC day (default: the previous one) by scripts/health/judge.ts. Reads only: D1 through the SELECT-only guard
// (scripts/import/db.ts remoteReadD1), GitHub's workflow runs through the job's GITHUB_TOKEN (actions: read).
// Exit 1 when any rule fails (the alarm: GitHub mails the owner), and when the check cannot run (an API error, or no
// heartbeat table). --report-only never fails on a rule (the pull request's dry run, before the migration exists).
// --evidence FROM TO also prints, per 15-minute slot in [FROM, TO), how many timestamps each of the bot's tables holds
// (columns *_at and *_until, derived from the schema): counts only, as this repository's logs are public.
//
// Usage: node scripts/health/run.ts [--day YYYY-MM-DD] [--report-only] [--evidence FROM TO]
//   Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GUILDCRAFT_COPY; GITHUB_TOKEN, GITHUB_REPOSITORY.
import { summary } from '../ci/alarm.ts';
import { currentCopy } from '../copies.ts';
import { remoteReadD1 } from '../import/db.ts';
import { ALARM_IMPORT, FINISHED_IMPORT } from '../../src/import-status.ts';
import { CONSECUTIVE_FAIL, DAY_MS, failed, judgeCommands, judgeNightly, judgeSweeps, previousUtcDay, type Line, type SweepRow, type Window } from './judge.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const reportOnly = args.includes('--report-only');
const dayArg = opt('--day');
const dayStart = dayArg ? Date.parse(`${dayArg}T00:00:00Z`) : previousUtcDay(Date.now());
if (!Number.isFinite(dayStart)) throw new Error(`--day ${dayArg}: expected YYYY-MM-DD`);
const dayEnd = dayStart + DAY_MS;
const day = new Date(dayStart).toISOString().slice(0, 10);
const iso = (ms: number) => new Date(ms).toISOString();

const COPY = currentCopy();
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
if (!accountId || !apiToken) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
const db = remoteReadD1({ accountId, apiToken, databaseId: COPY.databaseId() });

// Every D1 read goes through here, so the run's rows read are D1's own count (order 20, spend measured).
let rowsRead = 0;
let queries = 0;
async function select<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  const r = (await db.prepare(sql).bind(...params).all()) as unknown as { results: T[]; meta: { rows_read: number } };
  rowsRead += r.meta.rows_read;
  queries++;
  return r.results;
}

// ---------------------------------------------------------------- GitHub: failed runs and deploy windows
const repo = process.env.GITHUB_REPOSITORY;
const ghToken = process.env.GITHUB_TOKEN;
/** Conclusions GitHub counts as a failed run (each mails the owner). */
const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
interface Run { id: number; created_at: string; conclusion: string | null }
async function gh<T>(path: string): Promise<T> {
  if (!repo || !ghToken) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY must be set to read workflow runs');
  const res = await fetch(`https://api.github.com/repos/${repo}${path}`, { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'guildcraft-health' } });
  if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}
/** A workflow's runs created in [from, to) (ms); GitHub's date filter is widened a day each side, then cut exactly. */
async function runs(file: string, from: number, to: number): Promise<Run[]> {
  const d = (ms: number) => iso(ms).slice(0, 10);
  const out: Run[] = [];
  for (let page = 1; page <= 10; page++) {
    const r = await gh<{ workflow_runs: Run[] }>(`/actions/workflows/${file}/runs?created=${d(from - DAY_MS)}..${d(to + DAY_MS)}&per_page=100&page=${page}`);
    out.push(...r.workflow_runs);
    if (r.workflow_runs.length < 100) break;
  }
  return out.filter((x) => Date.parse(x.created_at) >= from && Date.parse(x.created_at) < to);
}
interface Step { name: string; started_at: string | null; completed_at: string | null }
interface Job { name: string; started_at: string | null; completed_at: string | null; steps?: Step[] }
/** This copy's deploys (deploy.yml's job for the copy, its "Deploy the Worker" step) from the day before through the day. */
async function deployWindows(): Promise<Window[]> {
  const out: Window[] = [];
  for (const run of await runs('deploy.yml', dayStart - DAY_MS, dayEnd)) {
    const { jobs } = await gh<{ jobs: Job[] }>(`/actions/runs/${run.id}/jobs?per_page=100`);
    // The matrix job's name is "deploy (<copy>, <prefix>)" (deploy.yml, one job per copy).
    for (const j of jobs.filter((x) => new RegExp(`^deploy \\(${COPY.name}\\b`).test(x.name))) {
      const s = j.steps?.find((x) => x.name === 'Deploy the Worker' && x.started_at) ?? j;
      if (!s.started_at) continue;
      out.push({ start: Date.parse(s.started_at), end: s.completed_at ? Date.parse(s.completed_at) : Date.now() });
    }
  }
  return out;
}
const failedRunsOf = async (file: string): Promise<number | null> => {
  try {
    return (await runs(file, dayStart, dayEnd)).filter((r) => r.conclusion && FAILED.has(r.conclusion)).length;
  } catch (e) {
    console.log(`${file} runs unread: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
};

// ---------------------------------------------------------------- the day's records
console.log(`copy: ${COPY.name} (Worker ${COPY.worker}); judging ${day} (UTC); crons from wrangler.jsonc: ${JSON.stringify(COPY.crons)}`);
const lines: Line[] = [];

const [{ n: hasTable }] = await select<{ n: number }>("SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'sweep_run'");
if (!hasTable) {
  lines.push({ rule: 'missed sweeps', verdict: reportOnly ? 'report' : 'fail', text: 'no sweep_run table: migration 0016 is not applied to this copy, so nothing can be judged' });
} else {
  const [{ first }] = await select<{ first: number | null }>('SELECT min(scheduled_ms) AS first FROM sweep_run');
  // The day, and the slots before it that a run of misses across midnight needs (judge.ts judgeSweeps).
  const sweepRows = await select<SweepRow>('SELECT scheduled_ms, started_at, finished_at FROM sweep_run WHERE scheduled_ms >= ? AND scheduled_ms < ? ORDER BY scheduled_ms', dayStart - (CONSECUTIVE_FAIL + 1) * 60 * 60_000, dayEnd);
  const deploys = await deployWindows();
  if (deploys.length) console.log(`deploys of ${COPY.name} considered: ${deploys.map((d) => `${iso(d.start).slice(0, 19)}→${iso(d.end).slice(11, 19)}`).join(', ')}`);
  lines.push(...judgeSweeps({ crons: COPY.crons, dayStart, rows: sweepRows, trackStart: first, deploys }));
}

// Commands: no exact error record exists (a failed command writes no audit row and no error row; its error is only a
// Workers Logs line, src/index.ts runDeferred), so the rule is not measurable (order 20) and no record is added.
lines.push(judgeCommands(null));

// The nightly jobs, by their own rows started (or measured) on the day.
const [from, to] = [iso(dayStart), iso(dayEnd)];
const imports = await select<{ status: string; finished: number }>(
  `SELECT status, (${FINISHED_IMPORT}) AS finished FROM data_import WHERE started_at >= ? AND started_at < ? AND ${ALARM_IMPORT} ORDER BY id`, from, to);
lines.push(judgeNightly({ job: 'import', rows: imports.map((r) => ({ ok: !!r.finished, status: r.status })), failedRuns: imports.length ? 0 : await failedRunsOf('import.yml') }));
const backups = await select<{ result: string }>('SELECT result FROM backup_status WHERE started_at >= ? AND started_at < ? ORDER BY id', from, to);
lines.push(judgeNightly({ job: 'backup', rows: backups.map((r) => ({ ok: r.result === 'ok', status: r.result })), failedRuns: backups.length ? 0 : await failedRunsOf('backup.yml') }));
const [{ n: measured }] = await select<{ n: number }>('SELECT count(*) AS n FROM usage_daily WHERE measured_at >= ? AND measured_at < ?', from, to);
lines.push(judgeNightly({ job: 'usage', rows: measured ? [{ ok: true, status: `${measured} metric row(s) measured` }] : [], failedRuns: measured ? 0 : await failedRunsOf('usage.yml') }));

// ---------------------------------------------------------------- ITEM 4's evidence, on request
const evFrom = opt('--evidence');
if (evFrom) {
  const evTo = args[args.indexOf('--evidence') + 2];
  const a = Date.parse(evFrom);
  const b = Date.parse(evTo);
  if (!(a < b)) throw new Error('--evidence FROM TO: two ISO times, FROM before TO');
  const cols = await select<{ t: string; c: string }>(
    "SELECT m.name AS t, p.name AS c FROM sqlite_master m, pragma_table_info(m.name) p WHERE m.type = 'table' AND m.name NOT LIKE 'sqlite_%' AND m.name NOT LIKE '_cf_%' AND m.name <> 'd1_migrations' AND (p.name LIKE '%\\_at' ESCAPE '\\' OR p.name LIKE '%\\_until' ESCAPE '\\') ORDER BY 1, 2",
  );
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const bySlot = new Map<string, string[]>();
  for (const { t, c } of cols) {
    // A lease is "<expiry ISO>#<random>": its first 16 characters are the minute either way.
    const hits = await select<{ minute: string; n: number }>(`SELECT substr(${q(c)}, 1, 16) AS minute, count(*) AS n FROM ${q(t)} WHERE ${q(c)} >= ? AND ${q(c)} < ? GROUP BY 1`, iso(a), iso(b));
    for (const h of hits) {
      const ms = Date.parse(`${h.minute}:00Z`);
      const slot = iso(Math.floor(ms / 900_000) * 900_000).slice(0, 16);
      bySlot.set(slot, [...(bySlot.get(slot) ?? []), `${t}.${c} ×${h.n} (${h.minute.slice(11)})`]);
    }
  }
  // System audit rows (the cron's own: departures, usage alerts) by action; actions are code names, not guild data.
  const system = await select<{ minute: string; action: string; n: number }>("SELECT substr(created_at, 1, 16) AS minute, action, count(*) AS n FROM audit_log WHERE actor = 'system' AND created_at >= ? AND created_at < ? GROUP BY 1, 2", iso(a), iso(b));
  summary(`\n### Evidence ${iso(a)} → ${iso(b)}: the bot's own timestamps per 15-minute slot (${cols.length} columns: ${cols.map((x) => `${x.t}.${x.c}`).join(', ')})`);
  for (let s = Math.floor(a / 900_000) * 900_000; s < b; s += 900_000) {
    const k = iso(s).slice(0, 16);
    summary(`- ${k.slice(11)}Z: ${(bySlot.get(k) ?? []).join(', ') || 'nothing'}`);
  }
  summary(`- system audit rows in the window: ${system.length ? system.map((x) => `${x.minute.slice(11)} ${x.action} ×${x.n}`).join(', ') : 'none'}`);
}

// ---------------------------------------------------------------- the summary and the verdict
const mark = { pass: '✅', report: '⚠️', fail: '❌' } as const;
summary(`\n### Health — ${COPY.name}, ${day} (UTC)`);
for (const l of lines) summary(`- ${mark[l.verdict]} **${l.rule}**: ${l.text}`);
summary(`- D1 for this check: ${queries} queries, ${rowsRead} rows read, 0 written`);
const bad = failed(lines);
summary(`\n**health (${COPY.name}) ${day}: ${bad ? (reportOnly ? 'WOULD FAIL (report-only)' : 'FAILED') : 'PASSED'}** — ${bad ? lines.filter((l) => l.verdict === 'fail').map((l) => l.rule).join(', ') : 'no rule breached'}`);
if (bad && !reportOnly) process.exitCode = 1;

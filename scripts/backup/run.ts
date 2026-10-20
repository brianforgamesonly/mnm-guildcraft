// Nightly database backup (order 8, ITEM 1; PRD: "the nightly job exports the database to a separate private GitHub
// repository"). .github/workflows/backup.yml runs it.
//   node scripts/backup/run.ts [--dry-run]
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, BACKUP_REPO_TOKEN (may be unset: the run then fails and
// says so), RUNNER_TEMP. The export and every working file stay under RUNNER_TEMP; nothing is uploaded as an artifact.
//
//  1. No virtual tables ("Export is not supported for virtual tables", D1 docs).
//  2. Count every table (remote, read-only), export (wrangler d1 export --remote; "A running export will block other
//     database requests", so its duration is measured), count again.
//  3. Load the export into a scratch local D1 and count it: each table's count must lie between the two remote counts.
//  4. Push backups/<date>.sql and backups/<date>.json (the manifest) to the private backup repository, after
//     confirming it is private; prune to the last 30 dailies plus the first of each month.
//  5. Read the token's expiry (GitHub-Authentication-Token-Expiration; 'unknown' when absent).
//  6. Write one backup_status row (a permitted remote write; --dry-run prints it instead).
// Its alarm: the failed run (scripts/ci/alarm.ts). The token-expiry warning is a separate final workflow step,
// after the push, so a warning never stops a backup.
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseArgs } from 'node:util';
import { alarm, summary } from '../ci/alarm.ts';
import { devDatabaseId, remoteDb } from '../import/db.ts';
import { BACKUP_REPO, checkBounds, countsOf, countSql, DATABASE, git, loadAndCount, prune, REPO_URL, sha256, TABLES_SQL, VIRTUAL_SQL, wrangler, type Manifest } from './lib.ts';

const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const dryRun = args['dry-run'];
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
const tmp = join(process.env.RUNNER_TEMP ?? process.cwd(), 'backup-work');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const db = remoteDb({ accountId: account, apiToken: token, databaseId: devDatabaseId() });
const startedAt = new Date().toISOString();
const date = startedAt.slice(0, 10);
const file = `backups/${date}.sql`;
const problems: string[] = [];
const out: { size_bytes: number | null; export_ms: number | null; commit_sha: string | null; token_expires: string } = { size_bytes: null, export_ms: null, commit_sha: null, token_expires: 'unknown' };
let previous: { result: string; token_expires: string | null; finished_at: string } | undefined;
let previousRead = false;
/** Whether this run read the expiry header; if not, the last known expiry carries forward. */
let expiryRead = false;
const step = (name: string) => console.log(`\n== ${name}`);
const MAX_FILE_BYTES = 50_000_000;

const counts = async (): Promise<Record<string, number>> => {
  const tables = (await db.all<{ name: string }>(TABLES_SQL)).map((r) => r.name);
  return countsOf(await db.all<Record<string, number>>(countSql(tables)));
};

let manifest: Manifest | null = null;
const dump = join(tmp, 'export.sql');
try {
  [previous] = await db.all<{ result: string; token_expires: string | null; finished_at: string }>('SELECT result, token_expires, finished_at FROM backup_status ORDER BY id DESC LIMIT 1');
  previousRead = true;
  step('1. virtual tables');
  const [{ n: virtual }] = await db.all<{ n: number }>(VIRTUAL_SQL);
  console.log(`virtual tables: ${virtual}`);
  if (virtual) throw new Error(`${virtual} virtual table(s): D1 cannot export them`);

  step('2. count, export, count');
  const before = await counts();
  const t0 = Date.now();
  wrangler(['d1', 'export', DATABASE, '--remote', '--env', 'dev', '--output', dump]);
  out.export_ms = Date.now() - t0;
  const after = await counts();
  out.size_bytes = statSync(dump).size;
  const gz = gzipSync(readFileSync(dump)).length;
  console.log(JSON.stringify({ export_ms: out.export_ms, bytes: out.size_bytes, gzip_bytes: gz, tables: Object.keys(before).length }));
  // GitHub blocks a file over 100 MB; stop well before (the history choice is in backup.yml's header).
  if (out.size_bytes > MAX_FILE_BYTES) throw new Error(`the export is ${out.size_bytes} bytes, over the ${MAX_FILE_BYTES}-byte limit this job keeps under GitHub's 100 MB file limit`);

  step('3. load into a scratch local D1 and check against the remote counts');
  const exported = loadAndCount(join(tmp, 'scratch-d1'), dump);
  console.log('table\tbefore\texported\tafter');
  for (const t of Object.keys({ ...before, ...after }).sort()) console.log([t, before[t], exported[t], after[t]].join('\t'));
  const bad = checkBounds(before, after, exported);
  if (bad.length) throw new Error(`integrity: ${bad.join('; ')}`);

  const [src] = await db.all<{ v: string | null }>("SELECT (SELECT source_version FROM data_import WHERE status = 'ok' ORDER BY id DESC LIMIT 1) AS v");
  const [mig] = await db.all<{ name: string | null }>('SELECT max(name) AS name FROM d1_migrations');
  manifest = {
    date, file, created_at: startedAt, bytes: out.size_bytes, sha256: sha256(dump), tables: exported,
    source_version: src?.v ?? null, last_migration: mig?.name ?? null, code_sha: process.env.GITHUB_SHA ?? null,
  };
  console.log(JSON.stringify({ manifest: { ...manifest, tables: `${Object.keys(exported).length} tables, ${Object.values(exported).reduce((s, n) => s + n, 0)} rows` } }));

  step('4. push to the private backup repository');
  if (dryRun) console.log('DRY RUN: not pushed');
  else if (!process.env.BACKUP_REPO_TOKEN) throw new Error('BACKUP_REPO_TOKEN is not set (setup step for order 8): nothing pushed');
  else {
    // The repository must exist and be private before anything is pushed; the same call carries the expiry header.
    const res = await fetch(`https://api.github.com/repos/${BACKUP_REPO}`, {
      headers: { Authorization: `Bearer ${process.env.BACKUP_REPO_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mnm-guildcraft-backup' },
    });
    const header = res.headers.get('github-authentication-token-expiration');
    expiryRead = res.ok;
    // e.g. "2027-01-20 06:00:00 UTC" (2021 changelog); absent → unknown, never "never".
    out.token_expires = header && Number.isFinite(Date.parse(header.replace(' UTC', 'Z').replace(' ', 'T'))) ? new Date(Date.parse(header.replace(' UTC', 'Z').replace(' ', 'T'))).toISOString() : 'unknown';
    console.log(`backup repository: HTTP ${res.status}; expiry header ${header ? 'present' : 'absent'}; token_expires ${out.token_expires}`);
    const repo = (await res.json().catch(() => ({}))) as { private?: boolean };
    if (!res.ok) throw new Error(`backup repository unreadable: HTTP ${res.status}`);
    if (repo.private !== true) throw new Error('the backup repository is not private: nothing pushed');

    const work = join(tmp, 'repo');
    mkdirSync(work);
    git(work, ['init', '-q', '-b', 'main']);
    git(work, ['remote', 'add', 'origin', REPO_URL]);
    const heads = git(work, ['ls-remote', '--heads', 'origin', 'main']).trim();
    // An empty repository has no main to check out: the first run starts it.
    if (heads) {
      git(work, ['fetch', '-q', '--depth=1', 'origin', 'main']);
      git(work, ['checkout', '-q', '-B', 'main', 'FETCH_HEAD']);
    }
    mkdirSync(join(work, 'backups'), { recursive: true });
    copyFileSync(dump, join(work, file));
    writeFileSync(join(work, `backups/${date}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
    const dates = readdirSync(join(work, 'backups')).filter((f) => /^\d{4}-\d{2}-\d{2}\.sql$/.test(f)).map((f) => f.slice(0, 10));
    const gone = prune(dates);
    for (const d of gone) for (const ext of ['sql', 'json']) if (existsSync(join(work, `backups/${d}.${ext}`))) rmSync(join(work, `backups/${d}.${ext}`));
    git(work, ['add', '-A', 'backups']);
    git(work, ['-c', 'user.name=mnm-guildcraft backup', '-c', 'user.email=backup@users.noreply.github.com', 'commit', '-q', '-m', `Backup ${date}`]);
    git(work, ['push', '-q', 'origin', 'main']);
    out.commit_sha = git(work, ['rev-parse', 'HEAD']).trim();
    console.log(JSON.stringify({ pushed: file, commit: out.commit_sha.slice(0, 7), kept_files: dates.length - gone.length, pruned: gone.length }));
  }
} catch (e) {
  problems.push(e instanceof Error ? e.message : String(e));
}

// A run that did not read the header (a dry run, a failure before the push) keeps the last known expiry.
if (!expiryRead && previous?.token_expires) out.token_expires = previous.token_expires;
step('5. backup_status');
const finishedAt = new Date().toISOString();
const lit = (v: string | number | null) => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${v.replace(/'/g, "''")}'`);
const row = `INSERT INTO backup_status (started_at, finished_at, result, error, file, size_bytes, export_ms, commit_sha, token_expires) VALUES (${[
  startedAt, finishedAt, problems.length ? 'failed' : 'ok', problems.length ? problems.join('; ').slice(0, 500) : null, manifest && !dryRun && !problems.length ? file : null,
  out.size_bytes, out.export_ms, out.commit_sha, out.token_expires,
].map(lit).join(', ')})`;
if (dryRun) console.log(`DRY RUN: would write one backup_status row; nothing written:\n${row}`);
else {
  try {
    await db.run([row]);
    console.log('wrote 1 backup_status row');
  } catch (e) {
    problems.push(`backup_status not written: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// The expiry warning's state: inside 30 days of expiry. It alarms (in the workflow's last step) only on entering that
// window, or on passing the expiry itself.
const DAY = 86_400_000;
const windowOf = (iso: string | null | undefined, at: number) => (!iso || iso === 'unknown' ? 'unknown' : Date.parse(iso) <= at ? 'expired' : Date.parse(iso) - at <= 30 * DAY ? 'soon' : 'ok');
const nowState = windowOf(out.token_expires, Date.now());
const prevState = previous ? windowOf(previous.token_expires, Date.parse(previous.finished_at)) : 'unknown';
const expiryAlarm = (nowState === 'soon' || nowState === 'expired') && nowState !== prevState;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `expiry_alarm=${expiryAlarm ? '1' : '0'}\ntoken_expires=${out.token_expires}\n`);
console.log(JSON.stringify({ token_expires: out.token_expires, expiry_state: nowState, previous_expiry_state: prevState, expiry_alarm: expiryAlarm }));

alarm({ job: 'backup', failed: problems.length > 0, reason: problems.join('; '), previousFailing: previousRead && previous ? previous.result !== 'ok' : null });
if (!problems.length) summary(`backup: ${dryRun ? 'dry run, not pushed' : `pushed ${file}`} · ${out.size_bytes} bytes · export ${out.export_ms} ms · token expires ${out.token_expires}`);

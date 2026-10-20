// Shared by the nightly backup (run.ts) and the restore test (restore.ts), order 8 ITEM 1.
// Privacy: the code repository and its Actions logs are public. Nothing here prints a row, a statement or a
// credential: only table names, counts, sizes and hashes.
import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const BACKUP_REPO = 'brianforgamesonly/mnm-guildcraft-backup';
export const DATABASE = 'mnm-guildcraft-dev';

export interface Manifest {
  /** The UTC date the backup was made, and its file in the backup repository. */
  date: string;
  file: string;
  created_at: string;
  bytes: number;
  sha256: string;
  /** Rows per table, read back from the export itself (loaded into a scratch local D1). */
  tables: Record<string, number>;
  /** What the data is: the last completed import's source version, the last migration, and the code commit. */
  source_version: string | null;
  last_migration: string | null;
  code_sha: string | null;
}

/**
 * Runs a command, returns stdout. On failure it throws with the command's name and, unless `quiet`, the first lines
 * of its stderr. `quiet` is for every call that reads the dump: wrangler can quote a failing statement, which would
 * put guild data in the public log, so only the exit status is kept.
 */
export function run(cmd: string, args: string[], opts: ExecFileSyncOptions & { quiet?: boolean } = {}): string {
  const { quiet, ...exec } = opts;
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, ...exec }) as string;
  } catch (e: any) {
    const err = quiet ? `exit status ${e?.status ?? 'unknown'} (output withheld: it may quote backup rows)` : String(e?.stderr ?? e?.message ?? e).split('\n').slice(0, 4).join(' | ').replace(/\d{15,}/g, '<id>').slice(0, 400);
    throw new Error(`${cmd === process.execPath ? 'wrangler' : cmd} ${args.find((a) => !a.includes('/') && !a.includes('\\')) ?? ''} failed: ${err}`);
  }
}

/** wrangler through node itself: no shell, so no quoting of SQL arguments on any platform. */
const WRANGLER = fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js', import.meta.url));
export const wrangler = (args: string[], quiet = false) => run(process.execPath, [WRANGLER, ...args], { quiet });

export const sha256 =(file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** SQL counting every row of every table, one row per table. Names come from the database's own sqlite_master. */
export const countSql = (tables: string[]) => tables.map((t) => `SELECT '${t.replace(/'/g, "''")}' AS t, count(*) AS n FROM "${t.replace(/"/g, '""')}"`).join(' UNION ALL ');
export const TABLES_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY name";
export const VIRTUAL_SQL = "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND upper(sql) LIKE 'CREATE VIRTUAL TABLE%'";

/** A query against a scratch local D1 (persisted under `dir`, never the remote). Returns the result rows. */
export function localQuery<T>(dir: string, sql: string): T[] {
  const out = wrangler(['d1', 'execute', DATABASE, '--local', '--env', 'dev', '--persist-to', dir, '--json', '--command', sql], true);
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results: T[] }[];
  return parsed[0]?.results ?? [];
}

/** Loads a dump into an empty scratch local D1 and counts each table it created. */
export function loadAndCount(dir: string, file: string): Record<string, number> {
  wrangler(['d1', 'execute', DATABASE, '--local', '--env', 'dev', '--persist-to', dir, '--yes', '--file', file], true);
  const tables = localQuery<{ name: string }>(dir, TABLES_SQL).map((r) => r.name);
  if (!tables.length) return {};
  return Object.fromEntries(localQuery<{ t: string; n: number }>(dir, countSql(tables)).map((r) => [r.t, r.n]));
}

/**
 * git with BACKUP_REPO_TOKEN supplied by a credential helper that reads it from the environment: the token is
 * never in a URL, an argument or the log.
 */
export function git(cwd: string, args: string[]): string {
  const helper = '!f() { test "$1" = get || exit 0; echo username=x-access-token; echo "password=$BACKUP_REPO_TOKEN"; }; f';
  return run('git', ['-c', 'credential.helper=', '-c', `credential.helper=${helper}`, '-c', 'core.askPass=', ...args], { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}
export const REPO_URL = `https://github.com/${BACKUP_REPO}.git`;

/**
 * Keeps the last `keep` daily files and the first file of each month; returns the dates to delete.
 * Dates are the files' own names (YYYY-MM-DD), sorted.
 */
export function prune(dates: string[], keep = 30): string[] {
  const sorted = [...new Set(dates)].sort();
  const recent = new Set(sorted.slice(-keep));
  const firstOfMonth = new Set<string>();
  const seen = new Set<string>();
  for (const d of sorted) if (!seen.has(d.slice(0, 7))) (seen.add(d.slice(0, 7)), firstOfMonth.add(d));
  return sorted.filter((d) => !recent.has(d) && !firstOfMonth.has(d));
}

/** Each exported count must lie between the counts read just before and just after the export (live writes race it). */
export function checkBounds(before: Record<string, number>, after: Record<string, number>, exported: Record<string, number>): string[] {
  const problems: string[] = [];
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const t of names) {
    const lo = Math.min(before[t] ?? 0, after[t] ?? 0);
    const hi = Math.max(before[t] ?? 0, after[t] ?? 0);
    const n = exported[t];
    if (n === undefined) problems.push(`table ${t} missing from the export`);
    else if (n < lo || n > hi) problems.push(`table ${t}: exported ${n}, outside ${lo}..${hi}`);
  }
  const total = Object.values(exported).reduce((s, n) => s + n, 0);
  if (!names.length || total === 0) problems.push('the export holds no rows');
  return problems;
}

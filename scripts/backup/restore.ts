// Restore test (order 8, ITEM 1): the latest backup in the private backup repository, loaded into a scratch local
// D1 and compared with its own manifest: the file's hash, and every table's row count. Never the live database:
// this script holds no Cloudflare credential and writes nothing remote. .github/workflows/backup.yml (restore_test).
//   node scripts/backup/restore.ts      Environment: BACKUP_REPO_TOKEN, RUNNER_TEMP.
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { summary } from '../ci/alarm.ts';
import { git, loadAndCount, REPO_URL, sha256, type Manifest } from './lib.ts';

if (!process.env.BACKUP_REPO_TOKEN) throw new Error('BACKUP_REPO_TOKEN is not set: no backup to restore');
const tmp = join(process.env.RUNNER_TEMP ?? process.cwd(), 'restore-work');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const work = join(tmp, 'repo');
mkdirSync(work);
git(work, ['init', '-q', '-b', 'main']);
git(work, ['remote', 'add', 'origin', REPO_URL]);
git(work, ['fetch', '-q', '--depth=1', 'origin', 'main']);
git(work, ['checkout', '-q', '-B', 'main', 'FETCH_HEAD']);

const latest = readdirSync(join(work, 'backups')).filter((f) => /^\d{4}-\d{2}-\d{2}\.sql$/.test(f)).sort().at(-1);
if (!latest) throw new Error('the backup repository holds no backups/*.sql');
const file = join(work, 'backups', latest);
const manifest = JSON.parse(readFileSync(file.replace(/\.sql$/, '.json'), 'utf8')) as Manifest;
const problems: string[] = [];
if (sha256(file) !== manifest.sha256) problems.push('the file does not match its manifest hash');
const restored = loadAndCount(join(tmp, 'scratch-d1'), file);
console.log('table\tmanifest\trestored');
for (const t of [...new Set([...Object.keys(manifest.tables), ...Object.keys(restored)])].sort()) {
  console.log([t, manifest.tables[t], restored[t]].join('\t'));
  if (manifest.tables[t] !== restored[t]) problems.push(`table ${t}: manifest ${manifest.tables[t]}, restored ${restored[t]}`);
}
const rows = Object.values(restored).reduce((s, n) => s + n, 0);
if (!rows) problems.push('the restore holds no rows');
summary(`restore test of ${manifest.file} (${manifest.date}, source ${manifest.source_version ?? 'unknown'}): ${problems.length ? `FAILED — ${problems.join('; ')}` : `${Object.keys(restored).length} tables, ${rows} rows, all match the manifest`}`);
if (problems.length) process.exitCode = 1;

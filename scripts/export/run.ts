// One guild's export, for the continuity promise (order 10, ITEM 1.2; docs/SELF-HOSTING.md). .github/workflows/export.yml
// runs it by dispatch only.
//   node scripts/export/run.ts [--dry-run]
// Environment: EXPORT_GUILD_ID (never printed), CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, BACKUP_REPO_TOKEN, RUNNER_TEMP.
//
//  1. Export the whole database (wrangler d1 export --remote: read-only; "a running export will block other database
//     requests", so its duration is printed).
//  2. Keep only the guild's rows (scripts/export/dump.ts; the rules are derived from the schema, scripts/export/lib.ts),
//     check no key dangles and the copy loads back with the same counts.
//  3. Push guild-exports/<guild>/<date>.sql and its manifest to the private backup repository, after confirming it is
//     private. --dry-run pushes nothing.
// Privacy: this repository and its logs are public. The log shows table names, rules and counts only: never a row,
// never the guild id (the workflow masks it too). The files go only to the private repository.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { summary } from '../ci/alarm.ts';
import { commitToBackupRepo, confirmPrivate, DATABASE, wrangler } from '../backup/lib.ts';
import { IMPORT_WRITES } from '../import/core.ts';
import { guildDump } from './dump.ts';

const { values: args } = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false } } });
const guildId = process.env.EXPORT_GUILD_ID ?? '';
if (!/^\d{17,25}$/.test(guildId)) throw new Error('EXPORT_GUILD_ID must be a Discord server ID (digits only)');
const tmp = join(process.env.RUNNER_TEMP ?? process.cwd(), 'export-work');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

const full = join(tmp, 'full.sql');
const t0 = Date.now();
wrangler(['d1', 'export', DATABASE, '--remote', '--env', 'dev', '--output', full]);
console.log(JSON.stringify({ database: DATABASE, export_ms: Date.now() - t0 }));

const out = guildDump(readFileSync(full, 'utf8'), guildId, IMPORT_WRITES);
rmSync(full);
console.log('table\trule\trows');
for (const p of [...out.plan].sort((a, b) => a.table.localeCompare(b.table))) console.log([p.table, p.scope, out.counts[p.table] ?? 0].join('\t'));

const date = new Date().toISOString().slice(0, 10);
const dir = `guild-exports/${guildId}`;
const sha256 = createHash('sha256').update(out.sql).digest('hex');
const manifest = {
  date,
  database: DATABASE,
  created_at: new Date().toISOString(),
  bytes: Buffer.byteLength(out.sql),
  sha256,
  tables: out.counts,
  rules: Object.fromEntries(out.plan.map((p) => [p.table, p.scope])),
  code_sha: process.env.GITHUB_SHA ?? null,
  load: 'Into an empty D1 database: wrangler d1 execute <database> --remote --file <this .sql> (docs/SELF-HOSTING.md)',
};
console.log(JSON.stringify({ bytes: manifest.bytes, sha256, tables: Object.keys(out.counts).length, rows: Object.values(out.counts).reduce((s, n) => s + n, 0) }));

if (args['dry-run']) console.log('DRY RUN: not pushed');
else {
  await confirmPrivate();
  const commit = commitToBackupRepo(join(tmp, 'repo'), ['guild-exports'], `Guild export ${date}`, (work) => {
    mkdirSync(join(work, dir), { recursive: true });
    writeFileSync(join(work, dir, `${date}.sql`), out.sql);
    writeFileSync(join(work, dir, `${date}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  });
  console.log(JSON.stringify({ pushed: `guild-exports/<guild>/${date}.sql`, commit: commit.slice(0, 7) }));
}
summary(`guild export: ${args['dry-run'] ? 'dry run, not pushed' : 'pushed'} · ${Object.values(out.counts).reduce((s, n) => s + n, 0)} rows in ${Object.keys(out.counts).length} tables`);

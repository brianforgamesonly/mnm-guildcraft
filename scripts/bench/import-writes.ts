// Rows written by a migration and the import, measured on the local D1 before any remote run (order 13, section D).
// Start from a local database in the state the remote copy holds (the previous code's migrations and import), then:
//   node scripts/bench/import-writes.ts --file wiki.json --sha <sha> [--ceiling 40000] [--runs 2]
// It applies each pending migration statement by statement, reading D1's rows_written (index writes included) for each,
// records the migration in d1_migrations as wrangler does, then runs the import --runs times and prints what each wrote.
// Local only: it never reads a credential.

import { readdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { runImport } from '../import/core.ts';
import { localDb } from '../import/db.ts';

const { values: args } = parseArgs({
  options: { file: { type: 'string' }, sha: { type: 'string', default: 'local-file' }, ceiling: { type: 'string' }, runs: { type: 'string', default: '2' } },
});
if (!args.file) throw new Error('--file is required');

const { db, dispose } = await localDb();
try {
  const applied = new Set((await db.all<{ name: string }>('SELECT name FROM d1_migrations')).map((r) => r.name));
  const dir = new URL('../../migrations/', import.meta.url);
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (applied.has(name)) continue;
    const sql = readFileSync(new URL(name, dir), 'utf8').replace(/--.*$/gm, '');
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
    let total = 0;
    for (const s of statements) {
      const [m] = await db.run([s]);
      total += m.rows_written;
      console.log(`migration ${name}: ${m.rows_written} rows written · ${s.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
    const [rec] = await db.run([`INSERT INTO d1_migrations (name) VALUES ('${name.replaceAll("'", "''")}')`]);
    console.log(`migration ${name}: ${total} rows written in all (+${rec.rows_written} for its d1_migrations row)`);
  }
  const raw = JSON.parse(readFileSync(args.file, 'utf8')) as unknown;
  for (let i = 1; i <= Number(args.runs); i++) {
    const res = await runImport(db, raw, {
      sourceSha: args.sha!,
      now: () => new Date().toISOString(),
      writeCeiling: args.ceiling ? Number(args.ceiling) : undefined,
    });
    console.log(
      `import run ${i}: ${res.status} · rows written ${res.rowsWritten} of ceiling ${res.ceiling}` +
        (res.error ? ` · ${res.error}` : '') +
        ` · per table ${JSON.stringify(Object.fromEntries(Object.entries(res.written ?? {}).map(([t, w]) => [t, w.rows_written])))}`,
    );
    if (i === 1) {
      console.log(`predicted: ${JSON.stringify(res.predicted)}`);
      console.log(`gear: ${JSON.stringify(res.gear)}`);
      for (const w of res.warnings ?? []) if (w.kind !== 'scroll' && w.kind !== 'unmatched_component_names') console.log(`warning: ${JSON.stringify(w)}`);
    }
  }
} finally {
  await dispose();
}

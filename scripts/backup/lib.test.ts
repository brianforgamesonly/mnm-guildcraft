// Order 8, ITEM 1: retention, the before/after integrity bounds, and a real load into a scratch local D1.
//   node --test scripts/backup/lib.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { copies } from '../copies.ts';
import { IMPORT_TABLES } from '../import/core.ts';
import { backupDir, checkBounds, countSql, expiryAlarms, expiryState, loadAndCount, MUST_HOLD_ROWS, prune, TABLES_SQL, VIRTUAL_SQL } from './lib.ts';

test('prune keeps the last 30 dailies and the first file of each month', () => {
  const dates: string[] = [];
  for (let t = Date.parse('2026-08-15'); t <= Date.parse('2026-10-20'); t += 86_400_000) dates.push(new Date(t).toISOString().slice(0, 10));
  const gone = new Set(prune(dates));
  const kept = dates.filter((d) => !gone.has(d));
  assert.deepEqual(kept.slice(0, 3), ['2026-08-15', '2026-09-01', '2026-09-21']);
  assert.equal(kept.length, 2 + 30);
  assert.ok(kept.includes('2026-10-01') && kept.includes('2026-10-20'));
  assert.deepEqual(prune(['2026-10-01', '2026-10-02']), []);
});

test('an exported count must lie between the counts before and after the export', () => {
  assert.deepEqual(checkBounds({ a: 10, b: 5 }, { a: 12, b: 5 }, { a: 11, b: 5 }, []), []);
  assert.deepEqual(checkBounds({ a: 10 }, { a: 12 }, { a: 13 }, []), ['table a: exported 13, outside 10..12']);
  assert.deepEqual(checkBounds({ a: 10, b: 1 }, { a: 10, b: 1 }, { a: 10 }, []), ['table b missing from the export']);
  // A backup that "succeeds" with 0 rows is a failure (order 8, row 13).
  assert.deepEqual(checkBounds({ a: 0 }, { a: 0 }, { a: 0 }), ['the export holds no rows']);
  assert.deepEqual(checkBounds({}, {}, {}), ['the export holds no rows']);
  // Order 9: an empty recipe or item table is a failure even when the remote agrees.
  assert.deepEqual(checkBounds({ item: 5, recipe: 0 }, { item: 5, recipe: 0 }, { item: 5, recipe: 0 }, ['item', 'recipe']), ['table recipe exported 0 rows']);
  // ...and a renamed or dropped game-data table fails rather than skipping the check (order 9 review).
  assert.deepEqual(checkBounds({ item: 5 }, { item: 5 }, { item: 5 }, ['item', 'recipe']), ['table recipe is not in the export']);
});

test('order 10: MUST_HOLD_ROWS is the import\'s own table list, and every one of those tables is in the schema', () => {
  assert.deepEqual([...MUST_HOLD_ROWS], [...IMPORT_TABLES]);
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');
  const schema = readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
  for (const t of MUST_HOLD_ROWS) assert.match(schema, new RegExp(`CREATE TABLE ${t} \\(`), t);
  const full = Object.fromEntries(MUST_HOLD_ROWS.map((t) => [t, 3]));
  assert.deepEqual(checkBounds(full, full, full), []);
  assert.deepEqual(checkBounds(full, full, { ...full, game_class: 0 }, undefined).filter((p) => p.includes('game_class')).length, 2);
});

test('order 10: the copies are wrangler.jsonc environments; each marks itself and names its own Worker and database', () => {
  const all = copies(fileURLToPath(new URL('../../wrangler.jsonc', import.meta.url)));
  // The names order 10 gave each copy (a fork that deletes the production block keeps only dev).
  const named: Record<string, [string, string]> = { dev: ['mnm-guildcraft-dev', 'mnm-guildcraft-dev'], production: ['mnm-guildcraft', 'mnm-guildcraft-prod'] };
  assert.ok(all.some((c) => c.name === 'dev'));
  for (const c of all) if (named[c.name]) assert.deepEqual([c.worker, c.database], named[c.name], c.name);
  // A trailing comma left by deleting a block still parses.
  const dir = mkdtempSync(join(tmpdir(), 'copies-'));
  writeFileSync(join(dir, 'w.jsonc'), '{ "env": { "dev": { "name": "w", "vars": { "GUILDCRAFT_COPY": "dev" }, "d1_databases": [{ "binding": "DB", "database_name": "d", "database_id": "x" }] }, } }');
  assert.deepEqual(copies(join(dir, 'w.jsonc')).map((c) => c.name), ['dev']);
  rmSync(dir, { recursive: true, force: true });
  assert.equal(new Set(all.map((c) => c.database)).size, all.length, 'no two copies share a database');
  assert.equal(new Set(all.map((c) => c.worker)).size, all.length, 'no two copies share a Worker');
  // Every copy is provisioned (the merge deploys each one), and no two share a database id.
  for (const c of all) assert.match(c.databaseId(), /^[0-9a-f-]{36}$/, c.name);
  assert.equal(new Set(all.map((c) => c.databaseId())).size, all.length);
  assert.equal(backupDir('production'), 'backups/production');
});

test('order 10: the token-expiry warning never fires for the owner\'s "no expiry" note', () => {
  const at = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(expiryState('unknown', at), 'none');
  assert.equal(expiryState(null, at), 'none');
  assert.equal(expiryState('unknown', at, 'unset'), 'unknown');
  assert.equal(expiryState('2026-11-01T00:00:00Z', at), 'soon');
  assert.equal(expiryState('2027-11-01T00:00:00Z', at), 'ok');
  assert.equal(expiryState('2026-10-01T00:00:00Z', at), 'expired');
  for (const prev of ['ok', 'none', 'unknown', 'soon'] as const) assert.equal(expiryAlarms('none', prev), false);
  assert.equal(expiryAlarms('soon', 'none'), true);
  assert.equal(expiryAlarms('soon', 'soon'), false);
});

test('order 9: no compound SELECT anywhere in scripts/backup/ (remote D1 refused 17 UNION ALL terms)', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const compound = /\b(UNION|INTERSECT|EXCEPT)\b/i;
  // Code only: comments may name the refused form.
  const code = (f: string) => readFileSync(join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const files = readdirSync(dir).filter((f) => /\.(ts|mjs|js)$/.test(f) && f !== 'lib.test.ts');
  assert.ok(files.includes('lib.ts') && files.includes('run.ts'), 'the scan reached the backup scripts');
  for (const f of files) assert.doesNotMatch(code(f), compound, f);
  const names = Array.from({ length: 200 }, (_, i) => `t${i}`);
  for (const sql of [countSql(names), TABLES_SQL, VIRTUAL_SQL]) {
    assert.doesNotMatch(sql, compound);
    assert.equal(sql.match(/^\s*SELECT\b/gi)?.length, 1);
  }
});

test('the counts are one row of one column per table, read back by name', { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-count-'));
  try {
    const file = join(dir, 'dump.sql');
    const names = Array.from({ length: 20 }, (_, i) => `t${i}`).concat([`it's "odd"`]);
    writeFileSync(file, names.map((t, i) => `CREATE TABLE "${t.replace(/"/g, '""')}" (id INTEGER);${i % 3 ? '' : ` INSERT INTO "${t.replace(/"/g, '""')}" VALUES (1),(2);`}`).join('\n'));
    const counts = loadAndCount(join(dir, 'd1'), file);
    assert.equal(Object.keys(counts).length, 21);
    assert.equal(counts.t0, 2);
    assert.equal(counts.t1, 0);
    assert.equal(counts[`it's "odd"`], 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a dump in D1 export form loads into a scratch local D1 and is counted per table', { timeout: 120_000 }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'gc-restore-'));
  try {
    const file = join(dir, 'dump.sql');
    writeFileSync(
      file,
      [
        'PRAGMA defer_foreign_keys=TRUE;',
        'CREATE TABLE t1 (id INTEGER PRIMARY KEY, name TEXT);',
        `INSERT INTO "t1" ("id","name") VALUES(1,'a;b'),(2,'it''s');`,
        `INSERT INTO "t1" ("id","name") VALUES(3,'line
break');`,
        'CREATE TABLE t2 (k TEXT);',
      ].join('\n'),
    );
    assert.deepEqual(loadAndCount(join(dir, 'd1'), file), { t1: 3, t2: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

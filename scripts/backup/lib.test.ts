// Order 8, ITEM 1: retention, the before/after integrity bounds, and a real load into a scratch local D1.
//   node --test scripts/backup/lib.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBounds, loadAndCount, prune } from './lib.ts';

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
  assert.deepEqual(checkBounds({ a: 10, b: 5 }, { a: 12, b: 5 }, { a: 11, b: 5 }), []);
  assert.deepEqual(checkBounds({ a: 10 }, { a: 12 }, { a: 13 }), ['table a: exported 13, outside 10..12']);
  assert.deepEqual(checkBounds({ a: 10, b: 1 }, { a: 10, b: 1 }, { a: 10 }), ['table b missing from the export']);
  // A backup that "succeeds" with 0 rows is a failure (order 8, row 13).
  assert.deepEqual(checkBounds({ a: 0 }, { a: 0 }, { a: 0 }), ['the export holds no rows']);
  assert.deepEqual(checkBounds({}, {}, {}), ['the export holds no rows']);
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

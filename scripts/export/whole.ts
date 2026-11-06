// The tables the per-guild export keeps whole (scripts/export/lib.ts): the game data the import writes, and the tables the
// migrations seed (order 37, PR B), read from this checkout's migrations/ directory, never typed.
import { readdirSync, readFileSync } from 'node:fs';
import { IMPORT_WRITES } from '../import/core.ts';
import { seededTables } from './lib.ts';

const MIGRATIONS = new URL('../../migrations/', import.meta.url);

export function wholeTables(): string[] {
  const sqls = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => readFileSync(new URL(f, MIGRATIONS), 'utf8'));
  return [...IMPORT_WRITES, ...seededTables(sqls)];
}

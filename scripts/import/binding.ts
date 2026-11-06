import type { Db, StatementMeta } from './core.ts';

// Structural subset of the Workers D1 binding, so this file type-checks under Node and Workers alike.
export interface D1Like {
  prepare(sql: string): unknown;
  batch(statements: never[]): Promise<{ results?: unknown[]; meta: { rows_written?: number; rows_read?: number; changes?: number } }[]>;
}

const BATCH = 100;

/** Order 35: D1's own rows_read, summed over every statement a Db sent (the import bench's read cost). */
export interface ReadTally {
  rowsRead: number;
}

/** A Db over a D1 binding: local (wrangler getPlatformProxy) or the Workers test pool. */
export function bindingDb(d1: D1Like, tally?: ReadTally): Db {
  const prep = (sql: string) => d1.prepare(sql) as never;
  const count = (r: { meta: { rows_read?: number } }) => {
    if (tally) tally.rowsRead += r.meta.rows_read ?? 0;
  };
  return {
    async all<T>(sql: string) {
      const [r] = await d1.batch([prep(sql)]);
      count(r);
      return (r.results ?? []) as T[];
    },
    async run(statements) {
      const out: StatementMeta[] = [];
      for (let i = 0; i < statements.length; i += BATCH) {
        const res = await d1.batch(statements.slice(i, i + BATCH).map(prep));
        for (const r of res) {
          count(r);
          out.push({ rows_written: r.meta.rows_written ?? 0, changes: r.meta.changes ?? 0 });
        }
      }
      return out;
    },
  };
}

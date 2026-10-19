import type { Db, StatementMeta } from './core.ts';

// Structural subset of the Workers D1 binding, so this file type-checks under Node and Workers alike.
export interface D1Like {
  prepare(sql: string): unknown;
  batch(statements: never[]): Promise<{ results?: unknown[]; meta: { rows_written?: number; changes?: number } }[]>;
}

const BATCH = 100;

/** A Db over a D1 binding: local (wrangler getPlatformProxy) or the Workers test pool. */
export function bindingDb(d1: D1Like): Db {
  const prep = (sql: string) => d1.prepare(sql) as never;
  return {
    async all<T>(sql: string) {
      const [r] = await d1.batch([prep(sql)]);
      return (r.results ?? []) as T[];
    },
    async run(statements) {
      const out: StatementMeta[] = [];
      for (let i = 0; i < statements.length; i += BATCH) {
        const res = await d1.batch(statements.slice(i, i + BATCH).map(prep));
        for (const r of res) out.push({ rows_written: r.meta.rows_written ?? 0, changes: r.meta.changes ?? 0 });
      }
      return out;
    },
  };
}

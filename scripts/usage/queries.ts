// Order 26: D1's per-query figures (GraphQL d1QueriesAdaptiveGroups), made safe for a public log. Pure, so the
// Workers-pool tests run it (test/worker/usage.test.ts); scripts/usage/insights.ts and scripts/usage/run.ts read the
// figures and print what these return.
// Public logs (order 26, section D; run.ts's header): a database is named only dev, production or other, and a query
// is printed with every literal value replaced by ?.

export type DbLabel = 'dev' | 'production' | 'other';

/** dev / production by the copies' database ids (wrangler.jsonc, scripts/copies.ts); anything else is other. */
export function dbLabel(databaseId: string, copies: { name: string; databaseId: string }[]): DbLabel {
  const c = copies.find((x) => x.databaseId === databaseId);
  return c?.name === 'dev' || c?.name === 'production' ? c.name : 'other';
}

/**
 * A statement's shape: string, blob and number literals become ?, a list of placeholders becomes one (?, …), and
 * repeated VALUES tuples become one tuple and …; whitespace collapses. Statements that differ only in their values
 * share a shape.
 */
export function queryShape(sql: string): string {
  return sql
    .replace(/[xX]'[0-9a-fA-F]*'/g, '?')
    .replace(/'(?:[^']|'')*'/g, '?')
    .replace(/(?<![\w$.?:@"])-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?(?![\w"])/g, '?')
    .replace(/\?\d+/g, '?')
    .replace(/\s+/g, ' ')
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?, …)')
    .replace(/(\((?:\?|\?, …)\))(?:\s*,\s*\((?:\?|\?, …)\))+/g, '$1, …')
    .trim();
}

export interface QueryFigure {
  day: string;
  db: DbLabel;
  shape: string;
  rowsRead: number;
  rowsWritten: number;
  /** Executions, as the dataset counts them. */
  count: number;
}

/** Figures merged by day, database and shape. */
export function byShape(rows: QueryFigure[]): QueryFigure[] {
  const m = new Map<string, QueryFigure>();
  for (const r of rows) {
    const k = `${r.day}|${r.db}|${r.shape}`;
    const o = m.get(k);
    if (o) {
      o.rowsRead += r.rowsRead;
      o.rowsWritten += r.rowsWritten;
      o.count += r.count;
    } else m.set(k, { ...r });
  }
  return [...m.values()];
}

/** The top n shapes by a metric, largest first (ties by shape, so the order is stable). */
export function topBy(rows: QueryFigure[], metric: 'rowsRead' | 'rowsWritten', n: number): QueryFigure[] {
  return rows
    .filter((r) => r[metric] > 0)
    .sort((a, b) => b[metric] - a[metric] || a.shape.localeCompare(b.shape))
    .slice(0, n);
}

/** One line for a log: rows, executions and rows per execution, then the shape (cut at `width`). */
export function figureLine(r: QueryFigure, metric: 'rowsRead' | 'rowsWritten', width = 240): string {
  const per = r.count ? Math.round(r[metric] / r.count) : 0;
  const shape = r.shape.length > width ? `${r.shape.slice(0, width - 1)}…` : r.shape;
  return `${r[metric].toLocaleString('en-US')} rows ${metric === 'rowsRead' ? 'read' : 'written'} · ${r.count.toLocaleString('en-US')} runs · ${per.toLocaleString('en-US')}/run · ${shape}`;
}

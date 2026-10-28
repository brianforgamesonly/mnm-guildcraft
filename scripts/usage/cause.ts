// Order 26 (ITEM 3; override 1 of order 11's alarm output): what caused a failing usage-level alarm, per day judged.
// Pure, so the Workers-pool tests run it (test/worker/usage.test.ts); scripts/usage/run.ts reads the figures and prints
// what these return as an ::error annotation and in the job summary. The log is public: databases are dev, production
// or other, and statements carry ? for every literal (scripts/usage/queries.ts).
import { FREE_LIMITS, type Metric } from '../../src/limits.ts';
import type { DbFigure } from './insights.ts';
import { figureLine, type QueryFigure } from './queries.ts';

/** The D1 metrics with per-database and per-statement figures, and their field in the GraphQL datasets. */
export const D1_FIELD: Partial<Record<Metric, 'rowsRead' | 'rowsWritten'>> = { d1_rows_read: 'rowsRead', d1_rows_written: 'rowsWritten' };

export interface RunInfo {
  name: string;
  event: string;
  /** ISO time the run was created. */
  createdAt: string;
}

const n = (x: number) => x.toLocaleString('en-US');
const hm = (iso: string) => iso.slice(11, 16);

/** One crossing's cause. A part that could not be read is a string saying why; the alarm's outcome never depends on it. */
export function causeLines(
  c: { metric: Metric; day: string; value: number },
  perDb: DbFigure[] | string,
  top: QueryFigure[] | string,
  runs: RunInfo[] | string,
): string[] {
  const field = D1_FIELD[c.metric];
  const out = [`${FREE_LIMITS[c.metric].label} ${((c.value / FREE_LIMITS[c.metric].limit) * 100).toFixed(1)}% on UTC day ${c.day}; this mail arrives the morning after.`];
  if (!field) out.push('Per-database and per-statement figures exist for D1 rows read and written only.');
  else {
    if (typeof perDb === 'string') out.push(`By database: not read (${perDb}).`);
    else {
      const mine = perDb.filter((r) => r.at === c.day && r[field] > 0).sort((a, b) => b[field] - a[field]);
      const all = mine.reduce((s, r) => s + r[field], 0);
      out.push(`By database: ${mine.length ? mine.map((r) => `${r.db} ${n(r[field])} (${((r[field] / all) * 100).toFixed(1)}%)`).join(' · ') : 'none recorded'}.`);
    }
    if (typeof top === 'string') out.push(`Top statements: not read (${top}).`);
    else {
      out.push(`Top ${Math.min(3, top.length)} statements:`);
      top.slice(0, 3).forEach((f, i) => out.push(`  ${i + 1}. ${f.db}: ${figureLine(f, field, 160)}`));
    }
  }
  if (typeof runs === 'string') out.push(`Workflow runs that UTC day: not read (${runs}).`);
  else {
    const mine = runs.filter((r) => r.createdAt.startsWith(c.day));
    const by = new Map<string, RunInfo[]>();
    for (const r of mine) by.set(r.name, [...(by.get(r.name) ?? []), r]);
    const parts = [...by.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([name, rs]) => {
        const t = rs.map((r) => r.createdAt).sort();
        const events = [...new Set(rs.map((r) => r.event))].sort().join(', ');
        return `${name} ×${rs.length} (${events}; ${hm(t[0])}${t.length > 1 ? `–${hm(t.at(-1)!)}` : ''})`;
      });
    out.push(`Workflow runs that UTC day (${mine.length}): ${parts.join(' · ') || 'none'}.`);
  }
  return out;
}

/** A GitHub ::error workflow command carrying several lines (the runner's escaping: %, CR and LF). */
export function errorAnnotation(title: string, lines: string[]): string {
  const esc = (s: string) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::error title=${esc(title).replace(/:/g, '%3A').replace(/,/g, '%2C')}::${esc(lines.join('\n'))}`;
}

// Per-request timing (order 3, ITEM 3.1): one structured log line per interaction, with the number of
// D1 round trips and the milliseconds spent waiting on each.
//
// Limitation: in Workers, Date.now() advances only across I/O, so these figures measure D1 and network
// waits. CPU spent after the last I/O is not in them; the platform's own per-invocation wallTime and
// cpuTime (Workers Logs / tail events) cover the whole request.

export interface D1Call {
  /** first | all | run | raw | batch | exec */
  op: string;
  /** Statements sent in this round trip (a batch sends several). */
  statements: number;
  ms: number;
  /** From D1's result meta when present (remote only): where the query ran, and SQL time without network. */
  region?: string;
  primary?: boolean;
  sql_ms?: number;
}

type Meta = { served_by_region?: string; served_by_primary?: boolean; timings?: { sql_duration_ms?: number } };
const metaOf = (r: unknown): Meta | undefined => {
  const one = Array.isArray(r) ? r[0] : r;
  return one && typeof one === 'object' && 'meta' in one ? ((one as { meta?: Meta }).meta ?? undefined) : undefined;
};

const QUERY_METHODS = new Set(['first', 'all', 'run', 'raw']);

/** Wraps a D1 binding so every round trip is recorded in `calls`. The wrapped binding behaves as the original. */
export function countD1(db: D1Database): { db: D1Database; calls: D1Call[] } {
  const calls: D1Call[] = [];
  const originals = new WeakMap<object, D1PreparedStatement>();
  const timed = async <T>(op: string, statements: number, run: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    const call: D1Call = { op, statements, ms: 0 };
    try {
      const r = await run();
      const m = metaOf(r);
      if (m?.served_by_region) call.region = m.served_by_region;
      if (typeof m?.served_by_primary === 'boolean') call.primary = m.served_by_primary;
      if (typeof m?.timings?.sql_duration_ms === 'number') call.sql_ms = m.timings.sql_duration_ms;
      return r;
    } finally {
      call.ms = Date.now() - t;
      calls.push(call);
    }
  };
  const wrapStatement = (s: D1PreparedStatement): D1PreparedStatement => {
    const p = new Proxy(s, {
      get(target, prop) {
        if (prop === 'bind') return (...args: unknown[]) => wrapStatement(target.bind(...args));
        if (typeof prop === 'string' && QUERY_METHODS.has(prop))
          return (...args: unknown[]) => timed(prop, 1, () => (Reflect.get(target, prop) as (...a: unknown[]) => Promise<unknown>).apply(target, args));
        const v = Reflect.get(target, prop, target);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    originals.set(p, s);
    return p;
  };
  const wrapped = new Proxy(db, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql));
      if (prop === 'batch')
        return (stmts: D1PreparedStatement[]) => timed('batch', stmts.length, () => target.batch(stmts.map((s) => originals.get(s) ?? s)));
      if (prop === 'exec') return (sql: string) => timed('exec', 1, () => target.exec(sql));
      const v = Reflect.get(target, prop, target);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  return { db: wrapped, calls };
}

/** What the log line names: the interaction type, and the command (+ focused option) or the component id's prefix. */
export function describeInteraction(i: { type: number; data?: { name?: string; options?: { name: string; options?: { name: string; focused?: boolean }[] }[]; custom_id?: string } }): { kind: string; cmd?: string } {
  const kinds: Record<number, string> = { 1: 'ping', 2: 'command', 3: 'component', 4: 'autocomplete', 5: 'modal' };
  const kind = kinds[i.type] ?? `type${i.type}`;
  if (i.type === 2 || i.type === 4) {
    const sub = i.data?.options?.[0];
    const focus = sub?.options?.find((o) => o.focused)?.name;
    return { kind, cmd: [i.data?.name, sub?.name].filter(Boolean).join(' ') + (focus ? ` :${focus}` : '') };
  }
  if (i.type === 3 || i.type === 5) return { kind, cmd: (i.data?.custom_id ?? '').split(':')[0] };
  return { kind };
}

/** The one structured line per interaction. Read back from Workers Logs (see .github/workflows/timings.yml). */
export function timingLine(i: Parameters<typeof describeInteraction>[0], calls: D1Call[], colo: string | undefined, totalMs: number): string {
  return JSON.stringify({
    gc: 'interaction',
    ...describeInteraction(i),
    q: calls.length,
    d1_ms: calls.map((c) => c.ms),
    sql_ms: calls.map((c) => c.sql_ms ?? null),
    d1_region: [...new Set(calls.map((c) => c.region).filter(Boolean))].join(',') || null,
    d1_primary: calls.some((c) => c.primary === false) ? false : calls.some((c) => c.primary) ? true : null,
    colo: colo ?? null,
    io_ms: totalMs,
  });
}

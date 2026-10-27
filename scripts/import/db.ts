import { fileURLToPath } from 'node:url';
import { currentCopy } from '../copies.ts';
import { bindingDb, type D1Like } from './binding.ts';
import type { Db, StatementMeta } from './core.ts';

/** The local D1 that `wrangler d1 migrations apply --local --env dev` writes to. */
export async function localDb(): Promise<{ db: Db; dispose: () => Promise<void> }> {
  const { getPlatformProxy } = await import('wrangler');
  // Order 24: this checkout's own config and local state, from the script's location, never the working directory's
  // (order 23's bench run from another directory read that directory's config and left .wrangler/state there).
  const root = new URL('../../', import.meta.url);
  const proxy = await getPlatformProxy<{ DB: D1Like }>({
    environment: 'dev',
    configPath: fileURLToPath(new URL('wrangler.jsonc', root)),
    persist: { path: fileURLToPath(new URL('.wrangler/state/v3', root)) },
  });
  return { db: bindingDb(proxy.env.DB), dispose: () => proxy.dispose() };
}

/** database_id of the copy GUILDCRAFT_COPY names (default dev), read from wrangler.jsonc (committed; not secret). */
export const copyDatabaseId = () => currentCopy().databaseId();

interface D1HttpResult {
  results?: unknown[];
  success: boolean;
  meta?: { rows_written?: number; changes?: number };
}

const MAX_SQL_CHARS = 90_000;

/** A remote D1 over Cloudflare's D1 HTTP query API. Credentials come from the environment only. */
export function remoteDb(opts: { accountId: string; apiToken: string; databaseId: string }): Db {
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`;
  async function query(sql: string): Promise<D1HttpResult[]> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql }),
    });
    const body = (await res.json()) as { success: boolean; errors?: { code: number; message: string }[]; result?: D1HttpResult[] };
    if (!res.ok || !body.success || !body.result)
      throw new Error(`D1 HTTP ${res.status}: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
    return body.result;
  }
  return {
    async all<T>(sql: string) {
      const [r] = await query(sql);
      return (r.results ?? []) as T[];
    },
    async run(statements) {
      const out: StatementMeta[] = [];
      let batch: string[] = [];
      let size = 0;
      const flush = async () => {
        if (!batch.length) return;
        const res = await query(batch.join(';\n'));
        if (res.length !== batch.length) throw new Error(`D1 HTTP returned ${res.length} results for ${batch.length} statements`);
        for (const r of res) out.push({ rows_written: r.meta?.rows_written ?? 0, changes: r.meta?.changes ?? 0 });
        batch = [];
        size = 0;
      };
      for (const s of statements) {
        if (size + s.length > MAX_SQL_CHARS) await flush();
        batch.push(s);
        size += s.length + 2;
      }
      await flush();
      return out;
    },
  };
}

/**
 * Order 17b: a read-only D1Database over the same HTTP query API, for rendering the Worker's own replies from a remote
 * copy (scripts/bench/zone-cards.ts --remote). prepare/bind/all/first and batch (run one by one); anything but a single
 * SELECT is refused before it is sent. A guard against mistakes, not a boundary: the token itself can write. meta.rows_read
 * is D1's own count.
 */
export function remoteReadD1(opts: { accountId: string; apiToken: string; databaseId: string }): D1Database {
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/d1/database/${opts.databaseId}/query`;
  async function query(sql: string, params: unknown[]) {
    // One statement, a SELECT: D1's /query runs every statement in the string, so a ";" before the end is refused too.
    if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error(`read-only: refused ${sql.slice(0, 40)}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${opts.apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    });
    const body = (await res.json()) as { success: boolean; errors?: { code: number; message: string }[]; result?: { results?: unknown[]; meta?: { rows_read?: number } }[] };
    if (!res.ok || !body.success || !body.result?.[0])
      throw new Error(`D1 HTTP ${res.status}: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
    return { results: body.result[0].results ?? [], success: true, meta: { rows_read: body.result[0].meta?.rows_read ?? 0 } };
  }
  const statement = (sql: string, params: unknown[] = []) => ({
    bind: (...p: unknown[]) => statement(sql, p),
    all: () => query(sql, params),
    first: async (col?: string) => {
      const row = ((await query(sql, params)).results[0] ?? null) as Record<string, unknown> | null;
      return col && row ? row[col] : row;
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { all: () => Promise<unknown> }[]) => {
      const out = [];
      for (const s of stmts) out.push(await s.all());
      return out;
    },
  } as unknown as D1Database;
}

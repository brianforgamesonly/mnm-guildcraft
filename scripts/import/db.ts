import { currentCopy } from '../copies.ts';
import { bindingDb, type D1Like } from './binding.ts';
import type { Db, StatementMeta } from './core.ts';

/** The local D1 that `wrangler d1 migrations apply --local --env dev` writes to. */
export async function localDb(): Promise<{ db: Db; dispose: () => Promise<void> }> {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Like }>({ environment: 'dev' });
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

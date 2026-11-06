// Order 37, ITEM 3: delete a temporary Worker (the wiki relay, or the probe) and confirm it is gone.
//   node scripts/wiki/cleanup.ts --config <the wrangler config the Worker was deployed with>
//   Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (the token the deploy used; no new right).
//
// Why not `wrangler delete`: wrangler 4.151.2 deletes the script first, then looks for a Workers Sites KV namespace to
// delete too (packages/wrangler/src/delete.ts, deleteSiteNamespaceIfExisting, at tag wrangler@4.151.2). Listing KV
// namespaces needs a right this token doesn't have and the relay doesn't use (it has no Sites and no KV); wrangler forgives
// only an HTTP 403 there and re-throws anything else, so on every run it printed "Authentication error [code: 10000]" for
// /storage/kv/namespaces and exited 1 after the relay was already deleted (import run 42187910971, job 127792550175).
// This calls Cloudflare's own endpoint instead, DELETE /accounts/{account_id}/workers/scripts/{script_name}, which needs
// Workers Scripts Write: the right the deploy itself uses.
//
// - The name is read from the same config the deploy used (its "name"), and a name without TEMP_WORKER_PREFIX is refused
//   before any request, so this can never delete GuildCraft's own Workers (their names are in wrangler.jsonc; the test
//   checks every one).
// - Then it confirms: GET of the script, up to CHECK_ATTEMPTS times with backoff. 404 = gone (exit 0, no warning). Only a
//   200 on every attempt, the Worker confirmed still there, fails (exit 1, with a clear error). Anything else (a 5xx, a
//   network error, another status) leaves it unconfirmed: a warning, never a failure.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

/** The temporary Workers' names start with this (scripts/wiki/wrangler.jsonc, scripts/probe/wrangler.jsonc). */
export const TEMP_WORKER_PREFIX = 'guildcraft-wiki-';
export const CHECK_ATTEMPTS = 3;
/** Waits before the 2nd and 3rd check (ms). */
export const BACKOFF_MS = [2_000, 5_000];
/** Each API call's limit: 4 calls stay well inside the probe job's 8 minutes. */
export const CALL_TIMEOUT_MS = 15_000;

export type Fetch = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ status: number }>;
export interface Outcome {
  /** 'gone': confirmed deleted; 'there': confirmed still there (the job fails); 'unknown': not confirmed (a warning). */
  verdict: 'gone' | 'there' | 'unknown';
  /** What the delete answered: 'deleted' (2xx), 'already gone' (404), or the status or error. */
  deleted: string;
  /** Each check's answer, in order. */
  checks: string[];
}

/** The Worker's name, from a JSONC wrangler config (line comments and trailing commas allowed, as scripts/copies.ts reads). */
export function workerName(configText: string): string {
  const text = configText.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1');
  const name = (JSON.parse(text) as { name?: unknown }).name;
  if (typeof name !== 'string' || !name) throw new Error('the config has no "name"');
  return name;
}

export function refuseUnlessTemporary(name: string): void {
  if (!name.startsWith(TEMP_WORKER_PREFIX)) throw new Error(`refused: "${name}" is not a temporary Worker (its name must start with ${TEMP_WORKER_PREFIX}); nothing was deleted`);
}

export async function cleanup(opts: { name: string; accountId: string; apiToken: string; fetch: Fetch; sleep: (ms: number) => Promise<void> }): Promise<Outcome> {
  refuseUnlessTemporary(opts.name);
  const url = `https://api.cloudflare.com/client/v4/accounts/${opts.accountId}/workers/scripts/${encodeURIComponent(opts.name)}`;
  const headers = { Authorization: `Bearer ${opts.apiToken}` };
  const call = async (method: string): Promise<number | string> => {
    try {
      return (await opts.fetch(url, { method, headers })).status;
    } catch (e) {
      return `network error (${e instanceof Error ? e.message : String(e)})`;
    }
  };
  const del = await call('DELETE');
  const deleted = typeof del === 'string' ? del : del >= 200 && del < 300 ? 'deleted' : del === 404 ? 'already gone' : `HTTP ${del}`;
  const checks: string[] = [];
  let there = 0;
  for (let i = 0; i < CHECK_ATTEMPTS; i++) {
    if (i > 0) await opts.sleep(BACKOFF_MS[i - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
    const s = await call('GET');
    checks.push(typeof s === 'number' ? `HTTP ${s}` : s);
    if (s === 404) return { verdict: 'gone', deleted, checks };
    if (s === 200) there++;
  }
  return { verdict: there === CHECK_ATTEMPTS ? 'there' : 'unknown', deleted, checks };
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { config: { type: 'string' } } });
  if (!values.config) throw new Error('--config <the wrangler config the Worker was deployed with> is required');
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !apiToken) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
  const name = workerName(readFileSync(values.config, 'utf8'));
  // Review fix: each call gives up after CALL_TIMEOUT_MS (Node's fetch would wait 300 s), which reads as unconfirmed.
  const o = await cleanup({ name, accountId, apiToken, fetch: (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  console.log(`${name}: delete ${o.deleted}; checks ${o.checks.join(', ')} (404 = gone)`);
  if (o.verdict === 'there') {
    console.log(`::error::${name} is still deployed after the delete (the Cloudflare API answered 200 on ${CHECK_ATTEMPTS} checks): delete it in the dashboard (Workers & Pages) and re-run`);
    process.exitCode = 1;
  } else if (o.verdict === 'unknown') console.log(`::warning::${name}: the delete could not be confirmed (${o.checks.join(', ')}); the next run's deploy replaces it, and its own check confirms the delete`);
}

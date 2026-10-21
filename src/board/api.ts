// The board's calls to Discord's bot API (order 5, PRD FR-5), under two limits:
//
// 1. The invocation budget. A Free-plan Worker may make 50 subrequests per invocation, and D1 calls count
//    (developers.cloudflare.com/workers/platform/limits). Every board run stops at BOARD_CALL_CAP calls,
//    D1 and Discord together; whatever is left stays dirty for the next sweep.
// 2. Discord's per-route rate limits (docs.discord.com/developers/topics/rate-limits). After each response
//    the route's X-RateLimit-Remaining / X-RateLimit-Reset-After are kept; a route at 0 waits for its reset,
//    and a 429 waits its retry_after once. A wait that would pass the run's deadline is not taken: the call
//    is skipped and its post stays dirty.
import { DISCORD_API } from '../respond.ts';

/** About 40 external calls per invocation, under the Free plan's 50 subrequests (order 5, ITEM 1.1). */
export const BOARD_CALL_CAP = 40;
const CALL_TIMEOUT_MS = 10_000;
/** The longest single rate-limit wait worth taking; longer ones leave the post for the next sweep. */
const MAX_WAIT_MS = 5_000;

export type ApiResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; code?: number; error: string; skipped?: 'budget' | 'deadline' | 'rate' };

/** One call, as the run's log line records it (no ids: routes are templated). */
export interface ApiLogEntry {
  route: string;
  status: number;
  code?: number;
  waited_ms?: number;
  /**
   * Order 16: Discord's rate-limit headers on Modify Channel (thread renames), and retry_after on any 429, so the rename
   * limit is measured from Discord's answers rather than assumed. Discord does not document it, and its sub-limit may not
   * show in the headers (discord-api-docs #1900): a 429's retry_after is then the measurement.
   */
  limit?: string;
  remaining?: string;
  reset_after?: string;
  bucket?: string;
  retry_after?: number;
  scope?: string;
}

const isModifyChannel = (route: string) => /^PATCH \/channels\/\d+$/.test(route);

export interface BoardBudget {
  /** D1 calls made so far in this invocation (the counted binding's call list, src/telemetry.ts). */
  d1: () => number;
  discord: number;
  cap: number;
  /** Epoch ms after which no new call starts. */
  deadline: number;
}

export const budgetLeft = (b: BoardBudget) => b.cap - b.d1() - b.discord;

/** "/channels/{id}/messages/{id}": the route a rate limit applies to (the first id is its major parameter). */
export function routeOf(method: string, path: string): string {
  let first = true;
  return `${method} ${path.replace(/\d{5,}/g, (m) => {
    if (first) {
      first = false;
      return m;
    }
    return '{id}';
  })}`;
}
const logRoute = (route: string) => route.replace(/\d{5,}/g, '{id}');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BotApi {
  call<T = unknown>(method: string, path: string, body?: unknown): Promise<ApiResult<T>>;
  budget: BoardBudget;
  log: ApiLogEntry[];
}

export function botApi(token: string, budget: BoardBudget, fetcher: typeof fetch = (...a) => fetch(...a)): BotApi {
  const blockedUntil = new Map<string, number>();
  const log: ApiLogEntry[] = [];

  async function waitFor(route: string): Promise<number | 'deadline' | 'rate'> {
    const until = blockedUntil.get(route) ?? 0;
    const ms = until - Date.now();
    if (ms <= 0) return 0;
    if (ms > MAX_WAIT_MS) return 'rate';
    if (Date.now() + ms > budget.deadline) return 'deadline';
    await sleep(ms);
    return ms;
  }

  async function once(method: string, path: string, body: unknown, route: string): Promise<{ res?: Response; error?: string }> {
    budget.discord++;
    try {
      const res = await fetcher(`${DISCORD_API}${path}`, {
        method,
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      const remaining = res.headers.get('X-RateLimit-Remaining');
      const resetAfter = Number(res.headers.get('X-RateLimit-Reset-After'));
      if (remaining === '0' && Number.isFinite(resetAfter)) blockedUntil.set(route, Date.now() + resetAfter * 1000);
      return { res };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
    const route = routeOf(method, path);
    let waited = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (budgetLeft(budget) < 1) return { ok: false, status: 0, error: 'call budget spent', skipped: 'budget' };
      if (Date.now() >= budget.deadline) return { ok: false, status: 0, error: 'deadline passed', skipped: 'deadline' };
      const w = await waitFor(route);
      if (w === 'rate' || w === 'deadline') return { ok: false, status: 0, error: `rate limited on ${logRoute(route)}`, skipped: w };
      waited += w;
      const { res, error } = await once(method, path, body, route);
      if (!res) {
        log.push({ route: logRoute(route), status: 0 });
        return { ok: false, status: 0, error: error ?? 'fetch failed' };
      }
      const text = await res.text().catch(() => '');
      const json = (() => {
        try {
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      })() as { code?: number; message?: string; retry_after?: number } | null;
      const h = (name: string) => res.headers.get(name) ?? undefined;
      log.push({
        route: logRoute(route), status: res.status, ...(json?.code ? { code: json.code } : {}), ...(waited ? { waited_ms: waited } : {}),
        ...(isModifyChannel(route) ? { limit: h('X-RateLimit-Limit'), remaining: h('X-RateLimit-Remaining'), reset_after: h('X-RateLimit-Reset-After'), bucket: h('X-RateLimit-Bucket') } : {}),
        ...(res.status === 429 ? { retry_after: Number(json?.retry_after ?? h('Retry-After')), scope: h('X-RateLimit-Scope') } : {}),
      });
      if (res.status === 429 && attempt === 0) {
        const retry = Number(json?.retry_after ?? res.headers.get('Retry-After'));
        blockedUntil.set(route, Date.now() + (Number.isFinite(retry) ? retry * 1000 : MAX_WAIT_MS + 1));
        continue;
      }
      if (res.ok) return { ok: true, status: res.status, body: json as T };
      return { ok: false, status: res.status, code: json?.code, error: (json?.message ?? text).slice(0, 300) };
    }
    return { ok: false, status: 429, error: `rate limited twice on ${logRoute(route)}`, skipped: 'rate' };
  }

  return { call, budget, log };
}

// Discord JSON error codes the board acts on (docs.discord.com/developers/topics/opcodes-and-status-codes).
export const UNKNOWN_CHANNEL = 10003;
export const UNKNOWN_MESSAGE = 10008;
/** "Thread is archived": an edit reached an archived thread (its state changed since the active-threads read). */
export const THREAD_ARCHIVED = 50083;

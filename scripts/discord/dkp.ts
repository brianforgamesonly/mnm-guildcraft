// Order 27 (override 4): after the copy's commands are registered, /dkp is upserted, one server at a time, on every
// server whose DKP is on (dkp_guild, read from this copy's D1), so a definition change reaches them. It is never sent in
// the bulk PUT: in dev the PUT is guild-scoped and "overwrit[es] the existing command list for this application for the
// targeted guild", so /dkp is upserted after it, which leaves it registered there (scripts/discord/dkp.test.ts).
// Create Guild Application Command is an upsert: "Returns 201 if a command with the same name does not already exist, or
// a 200 if it does" (docs.discord.com/developers/interactions/application-commands, read 2026-10-29).
import { DKP_COMMAND } from '../../src/dkp/definition.ts';
import { DKP_ON_SQL, GUARD_PATH, signGuard, type EnsureResult, type GuardResult } from '../../src/dkp/guard.ts';

export { DKP_ON_SQL };

export type Call = (method: string, path: string, body?: unknown) => Promise<{ status: number; text: string }>;

/** Upserts /dkp on each server; returns one line per server for the log (no server ids: they are pseudonymised by index). */
export async function upsertDkp(call: Call, appId: string, guildIds: string[]): Promise<{ lines: string[]; failed: number }> {
  const lines: string[] = [];
  let failed = 0;
  for (const [n, g] of guildIds.entries()) {
    const r = await call('POST', `/applications/${appId}/guilds/${g}/commands`, DKP_COMMAND);
    const ok = r.status === 200 || r.status === 201;
    if (!ok) failed++;
    lines.push(`/dkp on DKP server ${n + 1} of ${guildIds.length}: HTTP ${r.status}${ok ? '' : ` ${r.text.slice(0, 200)}`}`);
  }
  return { lines, failed };
}

/** The copy's live Worker address (workers.dev), from Cloudflare. */
export async function workerUrl(worker: string, accountId: string, apiToken: string): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`, { headers: { Authorization: `Bearer ${apiToken}` } });
  const body = (await res.json()) as { success: boolean; result?: { subdomain?: string }; errors?: { code: number; message: string }[] };
  const sub = body.result?.subdomain;
  if (!body.success || !sub) throw new Error(`workers.dev subdomain lookup failed: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
  return `https://${worker}.${sub}.workers.dev/`;
}

/**
 * Order 30 (ITEM 4): a runner cannot reach a Durable Object, so this asks the live Worker to run ensureDecay on every
 * DKP-on guild, a page at a time. Returns the totals, or `status` when the Worker refused (a Worker that isn't deployed
 * yet answers 404: registration runs from the reviewed branch before the merge deploys; order 18).
 */
export async function callDecayGuard(url: string, botToken: string, dry: boolean, fetcher: typeof fetch = fetch): Promise<GuardResult | { status: number }> {
  const totals: GuardResult = { guilds: 0, checked: 0, counts: { kept: 0, added: 0, 'would-add': 0, off: 0, failed: 0 } };
  let offset: number | null = 0;
  while (offset !== null) {
    const time = Math.floor(Date.now() / 1000);
    const res = await fetcher(`${url.replace(/\/$/, '')}${GUARD_PATH}?dry=${dry ? 1 : 0}&offset=${offset}`, {
      method: 'POST',
      headers: { 'X-Guard-Time': String(time), 'X-Guard-Signature': await signGuard(botToken, time, dry, offset) },
    });
    if (res.status !== 200) return { status: res.status };
    const page = (await res.json()) as GuardResult & { next: number | null };
    totals.guilds = page.guilds;
    totals.checked += page.checked;
    for (const k of Object.keys(totals.counts) as EnsureResult[]) totals.counts[k] += page.counts[k];
    offset = page.next;
  }
  return totals;
}

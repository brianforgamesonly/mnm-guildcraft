// Order 27 (override 4): after the copy's commands are registered, /dkp is upserted, one server at a time, on every
// server whose DKP is on (dkp_guild, read from this copy's D1), so a definition change reaches them. It is never sent in
// the bulk PUT: in dev the PUT is guild-scoped and "overwrit[es] the existing command list for this application for the
// targeted guild", so /dkp is upserted after it, which leaves it registered there (scripts/discord/dkp.test.ts).
// Create Guild Application Command is an upsert: "Returns 201 if a command with the same name does not already exist, or
// a 200 if it does" (docs.discord.com/developers/interactions/application-commands, read 2026-10-29).
import { DKP_COMMAND } from '../../src/dkp/definition.ts';

export const DKP_ON_SQL = 'SELECT guild_id FROM dkp_guild WHERE enabled = 1 ORDER BY guild_id';

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

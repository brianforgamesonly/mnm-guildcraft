// Registers the slash commands guild-scoped to the test server, points the application's
// interactions endpoint at the dev Worker, then reads both back from Discord.
// Env: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_TEST_GUILD_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
// Prints names, IDs and the endpoint URL; never a credential or the guild ID.

import { COMMANDS } from '../../src/commands/definitions.ts';

const WORKER_NAME = 'mnm-guildcraft-dev';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const botToken = need('DISCORD_BOT_TOKEN');
const appId = need('DISCORD_APPLICATION_ID');
const guildId = need('DISCORD_TEST_GUILD_ID');

async function discord(method: string, path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Discord ${method} ${path.replace(guildId, '<guild>')}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function workerUrl(): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${need('CLOUDFLARE_ACCOUNT_ID')}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${need('CLOUDFLARE_API_TOKEN')}` },
  });
  const body = (await res.json()) as { success: boolean; result?: { subdomain?: string }; errors?: { code: number; message: string }[] };
  const sub = body.result?.subdomain;
  if (!body.success || !sub) throw new Error(`workers.dev subdomain lookup failed: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
  return `https://${WORKER_NAME}.${sub}.workers.dev/`;
}

type Command = { id: string; name: string; options?: { name: string }[] };
const describe = (cmds: Command[]) => cmds.map((c) => ({ id: c.id, name: c.name, subcommands: (c.options ?? []).map((o) => o.name) }));

const registered = (await discord('PUT', `/applications/${appId}/guilds/${guildId}/commands`, COMMANDS)) as Command[];
console.log('registered (guild-scoped):', JSON.stringify(describe(registered)));

const url = await workerUrl();
console.log('setting interactions_endpoint_url:', url);
await discord('PATCH', '/applications/@me', { interactions_endpoint_url: url });

const me = (await discord('GET', '/applications/@me')) as { id: string; interactions_endpoint_url?: string };
console.log('read back GET /applications/@me:', JSON.stringify({ id: me.id, interactions_endpoint_url: me.interactions_endpoint_url }));
const readBack = (await discord('GET', `/applications/${appId}/guilds/${guildId}/commands`)) as Command[];
console.log('read back guild commands:', JSON.stringify(describe(readBack)));
if (me.interactions_endpoint_url !== url) process.exitCode = 1;

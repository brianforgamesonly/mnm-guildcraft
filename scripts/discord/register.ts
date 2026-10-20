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

type Command = { id: string; name: string; options?: { name: string; description?: string; options?: { name: string; description?: string }[] }[] };
const describe = (cmds: Command[]) => cmds.map((c) => ({ id: c.id, name: c.name, subcommands: (c.options ?? []).map((o) => o.name) }));
/** Each subcommand's description and its options' descriptions, as Discord stored them. */
const descriptions = (cmds: Command[]) =>
  cmds.flatMap((c) => (c.options ?? []).map((o) => ({ cmd: `/${c.name} ${o.name}`, description: o.description, options: (o.options ?? []).map((p) => `${p.name}: ${p.description}`) })));

type Opt = { name: string; type: number; required?: boolean; choices?: unknown[]; autocomplete?: boolean; min_length?: number; max_length?: number; options?: Opt[] };
/** Every leaf option's validation fields: what the Discord client checks a typed value against. */
const shapes = (cmds: { name: string; options?: readonly Opt[] }[]) =>
  cmds.flatMap((c) =>
    (c.options ?? []).flatMap((s) =>
      (s.options ?? []).map((o) => ({
        at: `/${c.name} ${s.name} ${o.name}`,
        type: o.type,
        required: o.required ?? false,
        choices: o.choices?.length ?? 0,
        autocomplete: o.autocomplete ?? false,
        min_length: o.min_length ?? null,
        max_length: o.max_length ?? null,
      })),
    ),
  );

// Order 10, ITEM 0: READ_ONLY=1 reads the registered definitions back (guild and global) and compares each option's
// validation fields with the code. It writes nothing to Discord.
if (process.env.READ_ONLY === '1') {
  const guild = (await discord('GET', `/applications/${appId}/guilds/${guildId}/commands`)) as (Command & { options?: Opt[] })[];
  const global = (await discord('GET', `/applications/${appId}/commands`)) as Command[];
  console.log('registered global commands:', JSON.stringify(describe(global)));
  const live = new Map(shapes(guild).map((s) => [s.at, s]));
  for (const s of shapes(guild)) console.log('registered option:', JSON.stringify(s));
  const code = shapes(COMMANDS as unknown as { name: string; options?: Opt[] }[]);
  const differ = code.filter((s) => JSON.stringify(s) !== JSON.stringify(live.get(s.at)));
  for (const s of differ) console.log('differs from the code:', JSON.stringify({ code: s, registered: live.get(s.at) ?? null }));
  console.log(`read-only: ${live.size} registered options, ${code.length} in the code, ${differ.length} differ`);
  process.exit(0);
}

// The live Worker must reject bad signatures before Discord is pointed at it: Discord sends invalid
// signatures on save and afterwards, and removes the URL if one is accepted.
const url = await workerUrl();
for (const [label, headers] of [
  ['invalid signature', { 'X-Signature-Ed25519': '00'.repeat(64), 'X-Signature-Timestamp': String(Math.floor(Date.now() / 1000)) }],
  ['no signature headers', {}],
] as const) {
  const probe = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{"type":1}' });
  console.log(`live check ${url} (${label}): HTTP ${probe.status}`);
  if (probe.status !== 401) throw new Error(`live Worker returned ${probe.status} for ${label}, expected 401; not registering`);
}

const registered = (await discord('PUT', `/applications/${appId}/guilds/${guildId}/commands`, COMMANDS)) as Command[];
console.log('registered (guild-scoped):', JSON.stringify(describe(registered)));

console.log('setting interactions_endpoint_url:', url);
await discord('PATCH', '/applications/@me', { interactions_endpoint_url: url });

const me = (await discord('GET', '/applications/@me')) as { id: string; interactions_endpoint_url?: string };
console.log('read back GET /applications/@me:', JSON.stringify({ id: me.id, interactions_endpoint_url: me.interactions_endpoint_url }));
const readBack = (await discord('GET', `/applications/${appId}/guilds/${guildId}/commands`)) as Command[];
console.log('read back guild commands:', JSON.stringify(describe(readBack)));
for (const d of descriptions(readBack)) console.log('read back:', JSON.stringify(d));
if (me.interactions_endpoint_url !== url) process.exitCode = 1;

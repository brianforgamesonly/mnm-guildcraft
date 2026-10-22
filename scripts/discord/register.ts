// Registers the slash commands and points the application's interactions endpoint at its Worker, then reads both back.
// Order 10: per copy (GUILDCRAFT_COPY, scripts/copies.ts).
//   dev:        guild-scoped to the test server (DISCORD_TEST_GUILD_ID); the Dev app; the endpoint is the dev Worker.
//   production: global ("Global commands are available for every guild that adds your app"); the MNM-Guildcraft app;
//               the endpoint is the production Worker, and the app gets a plain generated icon so its commands are
//               easy to tell from the Dev app's.
// Env: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID (the copy's app), DISCORD_TEST_GUILD_ID (dev), CLOUDFLARE_API_TOKEN,
// CLOUDFLARE_ACCOUNT_ID. Prints names, IDs, statuses and the endpoint URL; never a credential or the guild ID.

import { deflateSync } from 'node:zlib';
import { commandLimitProblems, commandsWith } from '../../src/commands/definitions.ts';
import { currentCopy } from '../copies.ts';
import { copyDatabaseId, remoteDb } from '../import/db.ts';

const COPY = currentCopy();
const GLOBAL = COPY.name === 'production';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

// Order 13: /gear find's class choices are this copy's game_class codes, read now (a read; nothing is written to D1).
const db = remoteDb({ accountId: need('CLOUDFLARE_ACCOUNT_ID'), apiToken: need('CLOUDFLARE_API_TOKEN'), databaseId: copyDatabaseId() });
const classes = (await db.all<{ code: string }>('SELECT code FROM game_class WHERE item_count > 0 ORDER BY code')).map((r) => r.code);
if (!classes.length) throw new Error('game_class holds no classes: run the import first; not registering');
const COMMANDS = commandsWith(classes);
const problems = commandLimitProblems(COMMANDS);
if (problems.length) throw new Error(`the definitions break Discord's limits, not registering: ${problems.join('; ')}`);
console.log(`/gear class choices: Any + ${classes.length} from game_class (${classes.join(' ')})`);

const botToken = need('DISCORD_BOT_TOKEN');
const appId = need('DISCORD_APPLICATION_ID');
const guildId = GLOBAL ? '' : need('DISCORD_TEST_GUILD_ID');
const commandsPath = GLOBAL ? `/applications/${appId}/commands` : `/applications/${appId}/guilds/${guildId}/commands`;
console.log(`copy: ${COPY.name} · Worker ${COPY.worker} · commands ${GLOBAL ? 'global' : 'guild-scoped (test server)'}`);
// Order 10, ITEM 3: the production app ID goes into the public install link, so it is not a credential; it is stored
// as an Actions secret, which masks it in logs. Printed in groups so the operator can read the link from the log.
if (GLOBAL) console.log(`production application id, in groups of 6 (join them): ${appId.match(/.{1,6}/g)!.join(' ')}`);

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}
const hide = (path: string) => (guildId ? path.replace(guildId, '<guild>') : path);
async function discord(method: string, path: string, body?: unknown): Promise<unknown> {
  const { status, text } = await call(method, path, body);
  if (status < 200 || status > 299) throw new Error(`Discord ${method} ${hide(path)}: HTTP ${status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function workerUrl(): Promise<string> {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${need('CLOUDFLARE_ACCOUNT_ID')}/workers/subdomain`, {
    headers: { Authorization: `Bearer ${need('CLOUDFLARE_API_TOKEN')}` },
  });
  const body = (await res.json()) as { success: boolean; result?: { subdomain?: string }; errors?: { code: number; message: string }[] };
  const sub = body.result?.subdomain;
  if (!body.success || !sub) throw new Error(`workers.dev subdomain lookup failed: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
  return `https://${COPY.worker}.${sub}.workers.dev/`;
}

/** A plain square PNG of one colour, as a data URI (Discord's "image data"). No file, no tool: zlib and a CRC. */
function plainIcon(size = 256, rgb: [number, number, number] = [0x2e, 0x7d, 0x32]): string {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: size }, () => row)))), chunk('IEND', Buffer.alloc(0))]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

type Opt = { name: string; type: number; description?: string; required?: boolean; choices?: unknown[]; autocomplete?: boolean; min_length?: number; max_length?: number; options?: Opt[] };
type Command = { id: string; name: string; description?: string; default_member_permissions?: string | null; options?: Opt[] };
/** Option types SUB_COMMAND and SUB_COMMAND_GROUP. */
const isSub = (o: Opt) => o.type === 1 || o.type === 2;
/** Order 18: a command's subcommands, or the command itself (/me, /item, /zone ...) when its options are plain. */
const entries = (c: { name: string; description?: string; options?: readonly Opt[] }) => {
  const subs = (c.options ?? []).filter(isSub);
  return subs.length ? subs.map((s) => ({ at: `/${c.name} ${s.name}`, description: s.description, options: s.options ?? [] })) : [{ at: `/${c.name}`, description: c.description, options: c.options ?? [] }];
};
const describe = (cmds: Command[]) =>
  cmds.map((c) => ({ id: c.id, name: c.name, default_member_permissions: c.default_member_permissions ?? null, subcommands: (c.options ?? []).filter(isSub).map((o) => o.name) }));
/** Each command's (or subcommand's) description and its options' descriptions, as Discord stored them. */
const descriptions = (cmds: Command[]) => cmds.flatMap((c) => entries(c).map((e) => ({ cmd: e.at, description: e.description, options: e.options.map((p) => `${p.name}: ${p.description}`) })));

/** Every leaf option's validation fields: what the Discord client checks a typed value against. */
const shapes = (cmds: readonly { name: string; description?: string; options?: readonly Opt[] }[]) =>
  cmds.flatMap((c) =>
    entries(c).flatMap((e) =>
      e.options.map((o) => ({
        at: `${e.at} ${o.name}`,
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
  const registered = (await discord('GET', commandsPath)) as (Command & { options?: Opt[] })[];
  const global = GLOBAL ? registered : ((await discord('GET', `/applications/${appId}/commands`)) as Command[]);
  console.log('registered global commands:', JSON.stringify(describe(global)));
  const live = new Map(shapes(registered).map((s) => [s.at, s]));
  for (const s of shapes(registered)) console.log('registered option:', JSON.stringify(s));
  const code = shapes(COMMANDS as unknown as { name: string; options?: Opt[] }[]);
  // Order 18: the registered names against the code's (a stale list shows up here).
  const names = (l: { name: string }[]) => l.map((c) => c.name).sort().join(' ');
  console.log(`registered names: ${names(registered)} · in the code: ${names(COMMANDS as unknown as { name: string }[])}`);
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

const registered = (await discord('PUT', commandsPath, COMMANDS)) as Command[];
console.log(`registered (${GLOBAL ? 'global' : 'guild-scoped'}):`, JSON.stringify(describe(registered)));

// Discord sends the Worker a PING to validate the URL; the Worker answers it with this copy's public key.
console.log('setting interactions_endpoint_url:', url);
const patch = await call('PATCH', '/applications/@me', { interactions_endpoint_url: url });
console.log(`PATCH /applications/@me (interactions_endpoint_url): HTTP ${patch.status}`);
if (patch.status !== 200) throw new Error(`PATCH /applications/@me refused: HTTP ${patch.status}`);
// The icon separately, after the endpoint: a refused icon never leaves the endpoint unset; it only warns.
if (GLOBAL) {
  const icon = await call('PATCH', '/applications/@me', { icon: plainIcon() });
  console.log(`PATCH /applications/@me (icon): HTTP ${icon.status}`);
  if (icon.status !== 200) console.log(`::warning::the production app's icon was not set (HTTP ${icon.status})`);
}

const me = (await discord('GET', '/applications/@me')) as { id: string; interactions_endpoint_url?: string; icon?: string | null };
console.log('read back GET /applications/@me:', JSON.stringify({ id: me.id, interactions_endpoint_url: me.interactions_endpoint_url, icon_set: Boolean(me.icon) }));
const readBack = (await discord('GET', commandsPath)) as Command[];
console.log(`read back ${GLOBAL ? 'global' : 'guild'} commands:`, JSON.stringify(describe(readBack)));
for (const d of descriptions(readBack)) console.log('read back:', JSON.stringify(d));
if (me.interactions_endpoint_url !== url) process.exitCode = 1;

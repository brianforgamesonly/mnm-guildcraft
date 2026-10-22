// Signed Discord interactions against the Worker (src/index.ts), as Discord would send them.
// Deferred replies (order 4) arrive through the interaction webhook: a fetch spy records those calls,
// answers them as Discord would, and send() rebuilds the reply the member ends up seeing.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { vi } from 'vitest';
import app from '../src/index.ts';

/** Discord's API base (also src/respond.ts DISCORD_API; kept literal so this harness runs against older code). */
const DISCORD_API = 'https://discord.com/api/v10';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

export const APP_ID = '800000000000000001';
export interface WebhookCall {
  method: string;
  url: string;
  token: string;
  body: any;
}
/** Every interaction-webhook call the Worker made, in order. */
export const webhookCalls: WebhookCall[] = [];
/** How the fake Discord answers a webhook call (default: accepted). Tests may replace it; reset() restores. */
export const webhook = { status: (_c: WebhookCall) => 200, reset() { this.status = () => 200; } };
/** The fake Discord's GET /guilds/{id} (the guild-name lookup): set `respond` to answer it; `calls` records the URLs. */
export const guildLookup = {
  calls: [] as string[],
  respond: null as null | (() => Response),
  reset() {
    this.calls = [];
    this.respond = null;
  },
};

/** The fake Discord's bot API (order 5: the roster board). Set `handle` to answer bot-token calls; reset() clears it. */
export const botApi = {
  handle: null as null | ((method: string, path: string, body: any) => Response | Promise<Response>),
  reset() {
    this.handle = null;
  },
};

/** Discord's attachment CDN, faked (order 9: /item image downloads the member's attachment). */
export const CDN = 'https://cdn.discordapp.com/';
export const cdn = {
  handle: null as null | ((url: string) => Response | Promise<Response>),
  reset() {
    this.handle = null;
  },
};

export function spyOnFetch() {
  if (vi.isMockFunction(globalThis.fetch)) return;
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === `${DISCORD_API}/guilds/${GUILD}` && guildLookup.respond) {
      guildLookup.calls.push(url);
      return guildLookup.respond();
    }
    const prefix = `${DISCORD_API}/webhooks/`;
    // Order 9: a multipart upload's body arrives as its FormData (payload_json and files[n]); a fake CDN serves attachments.
    if (!url.startsWith(prefix) && url.startsWith(DISCORD_API) && botApi.handle)
      return botApi.handle(init?.method ?? 'GET', url.slice(DISCORD_API.length), init?.body instanceof FormData ? init.body : init?.body ? JSON.parse(String(init.body)) : undefined);
    if (url.startsWith(CDN) && cdn.handle) return cdn.handle(url);
    if (!url.startsWith(prefix)) return real(input, init);
    const call = { method: init?.method ?? 'GET', url, token: url.slice(prefix.length).split('/')[1], body: init?.body ? JSON.parse(String(init.body)) : undefined };
    webhookCalls.push(call);
    const status = webhook.status(call);
    if (status === 204) return new Response(null, { status });
    return new Response(JSON.stringify(status < 300 ? { id: '1' } : { code: 50035, message: 'Invalid Form Body' }), { status });
  });
}

let seq = 0;
let lastToken = '';

let keys: Promise<{ pair: CryptoKeyPair; publicKeyHex: string }> | undefined;
const getKeys = () =>
  (keys ??= (async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    return { pair, publicKeyHex: hex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
  })());

export async function post(body: unknown, opts: { tamper?: boolean; noHeaders?: boolean; env?: Record<string, unknown> } = {}): Promise<Response> {
  spyOnFetch();
  const { pair, publicKeyHex } = await getKeys();
  // Discord sends an application id and a fresh interaction token with every interaction.
  lastToken = `token-${++seq}`;
  const full = body && typeof body === 'object' ? { application_id: APP_ID, token: lastToken, ...body } : body;
  const text = JSON.stringify(full);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(timestamp + text)));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.noHeaders) {
    headers['X-Signature-Ed25519'] = opts.tamper ? sig.replace(/^./, sig[0] === '0' ? '1' : '0') : sig;
    headers['X-Signature-Timestamp'] = timestamp;
  }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request('https://worker.test/', { method: 'POST', headers, body: text }), { ...env, DISCORD_PUBLIC_KEY: publicKeyHex, ...opts.env }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export interface Reply {
  type: number;
  data: {
    content?: string;
    flags?: number;
    embeds?: { title?: string; description?: string; footer?: { text: string }; fields?: { name: string; value: string }[] }[];
    components?: any[];
    choices?: { name: string; value: string }[];
    custom_id?: string;
    title?: string;
  };
}

/** The immediate answer (an ack for deferred interactions) and the webhook calls that followed it. */
export async function exchange(body: unknown, opts: { env?: Record<string, unknown> } = {}): Promise<{ ack: Reply; calls: WebhookCall[] }> {
  if (body && typeof body === 'object' && '__legacy' in body) body = await fromLegacy((body as { __legacy: Legacy }).__legacy, opts);
  const res = await post(body, opts);
  const token = lastToken;
  const ack = (await res.json()) as Reply;
  return { ack, calls: webhookCalls.filter((c) => c.token === token) };
}

/** What the member ends up seeing: the immediate reply, or the deferred one rebuilt from the webhook calls. */
export function seen(ack: Reply, calls: WebhookCall[]): Reply {
  if (ack.type !== 5 && ack.type !== 6) return ack;
  const last = calls.filter((c) => c.method !== 'DELETE').at(-1);
  if (!last) throw new Error(`deferred (type ${ack.type}) but nothing was delivered`);
  if (last.method === 'POST') return { type: 4, data: last.body };
  // An edit of a type 5 message keeps the defer's flags; an edit after a type 6 updates the component's message.
  return ack.type === 5 ? { type: 4, data: { ...last.body, ...(ack.data?.flags ? { flags: ack.data.flags } : {}) } } : { type: 7, data: last.body };
}

export const send = async (body: unknown, opts: { env?: Record<string, unknown> } = {}): Promise<Reply> => {
  const { ack, calls } = await exchange(body, opts);
  return seen(ack, calls);
};

/** A button press on a message component. */
export const press = (m: Member, custom_id: string) => ({ type: 3, guild_id: GUILD, member: m, data: { custom_id, component_type: 2 } });

export const GUILD = '900000000000000001';
export const ADMIN = String(1 << 3);
export const MANAGE_GUILD = String(1 << 5);
export const NO_PERMS = '0';

export function as(id: string, o: { roles?: string[]; permissions?: string; nick?: string | null; global_name?: string | null; username?: string } = {}) {
  return {
    user: { id, username: o.username ?? `user${id}`, global_name: o.global_name === undefined ? `Global ${id}` : o.global_name },
    nick: o.nick ?? null,
    roles: o.roles ?? [],
    permissions: o.permissions ?? NO_PERMS,
  };
}
export type Member = ReturnType<typeof as>;

const optType = (v: unknown) => (typeof v === 'number' ? 4 : typeof v === 'boolean' ? 5 : 3);
const toOptions = (o: Record<string, unknown>, focus?: string) =>
  Object.entries(o).map(([name, value]) => ({ type: optType(value), name, value, ...(name === focus ? { focused: true } : {}) }));

/** An APPLICATION_COMMAND interaction for /name sub, exactly as Discord sends it (no translation; see `cmd`). */
export const rawCmd = (m: Member, name: string, sub: string | undefined, options: Record<string, unknown> = {}, type = 2, focus?: string) => ({
  type,
  guild_id: GUILD,
  member: m,
  data: { name, options: sub === undefined ? toOptions(options, focus) : [{ type: 1, name: sub, options: toOptions(options, focus) }] },
});
/** A command without subcommands (/me, /skills, /item, /gear, /request, /zone, /help): its options at the top. */
export const top = (m: Member, name: string, options: Record<string, unknown> = {}) => rawCmd(m, name, undefined, options);

// ---------------------------------------------------------------- order 18: the old names, as the new entry points
// Work order 18 removed /character, /craft, /item image, /gear find, /recipe and /guildcraft remove-member as commands.
// The fixtures written for them keep their calls: `cmd` sends each old name the way a member now does the same thing
// (a new command, or /me's form or select, or a card's button), through the Worker. The old names themselves answer
// "not available" (test/worker/next-commands.test.ts sends them raw).

/** Old name → a new command with the same options (renamed where the new one names them differently). */
const RENAMED: Record<string, (o: Record<string, unknown>) => [string, string | undefined, Record<string, unknown>]> = {
  'craft update': (o) => ['skills', undefined, o],
  'craft me': (o) => ['me', undefined, o],
  'craft find': ({ item, ...o }) => ['item', undefined, { name: item, ...o }],
  'craft request': (o) => ['request', undefined, o],
  'craft help': () => ['help', undefined, {}],
  'item image': ({ item, image }) => ['item', undefined, { name: item, screenshot: image }],
  'gear find': (o) => ['gear', undefined, o],
  'recipe source': (o) => ['officer', 'recipe-source', o],
  'recipe override': (o) => ['officer', 'recipe-fix', o],
  'guildcraft remove-member': ({ user }) => ['officer', 'remove-member', { member: user }],
};
/** Old names that become a form, a select or a button: resolved when sent (fromLegacy), as they need the rows. */
const VIA_PANEL = new Set(['character add', 'character edit', 'character remove', 'craft know', 'craft forget', 'craft report', 'craft notify', 'craft requests']);

interface Legacy {
  m: Member;
  key: string;
  options: Record<string, unknown>;
}

/** An interaction for /name sub: the new command for an old name (above), or exactly as given for a current one. */
export function cmd(m: Member, name: string, sub: string, options: Record<string, unknown> = {}) {
  const key = `${name} ${sub}`;
  // /craft set member: (an officer for someone else) goes through that member's Update skills form.
  if (VIA_PANEL.has(key) || (key === 'craft set' && options.member !== undefined)) return { ...rawCmd(m, name, sub, options), __legacy: { m, key, options } as Legacy };
  if (key === 'craft set') return top(m, 'skills', options);
  const r = RENAMED[key];
  if (r) {
    const [n, s, o] = r(options);
    return rawCmd(m, n, s, o);
  }
  return rawCmd(m, name, sub, options);
}

/** Old autocomplete keys → the new command and option offering the same list. */
const AUTO_RENAMED: Record<string, [string, string | undefined, string]> = {
  'craft find item': ['request', undefined, 'item'],
  'craft request item': ['request', undefined, 'item'],
  'craft set skill': ['skills', undefined, 'skill'],
  'craft set character': ['skills', undefined, 'character'],
  'craft update character': ['skills', undefined, 'character'],
  'craft me character': ['me', undefined, 'character'],
  'craft know recipe': ['officer', 'recipe-source', 'item'],
  'gear find zone': ['gear', undefined, 'zone'],
  'recipe source item': ['officer', 'recipe-source', 'item'],
  'recipe source faction': ['officer', 'recipe-source', 'faction'],
  'recipe override item': ['officer', 'recipe-fix', 'item'],
};

/** An APPLICATION_COMMAND_AUTOCOMPLETE interaction with `focus` as the focused option. */
export const auto = (m: Member, name: string, sub: string | undefined, options: Record<string, unknown>, focus: string) => {
  const r = sub === undefined ? undefined : AUTO_RENAMED[`${name} ${sub} ${focus}`];
  if (!r) return rawCmd(m, name, sub, options, 4, focus);
  const [n, s, f] = r;
  const { [focus]: value, ...rest } = options;
  return rawCmd(m, n, s, { ...rest, [f]: value }, 4, f);
};

const row1 = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<T>()) ?? null;
/** The named character (or the main) of `owner`, live, or any when `removed`. */
const characterOf = (owner: string, name: unknown, removed = false) =>
  name === undefined
    ? row1<{ id: number; name: string; class: string | null; level: number | null }>(`SELECT id, name, class, level FROM character WHERE guild_id = ? AND owner_user_id = ? AND deleted_at IS NULL ORDER BY is_main DESC, created_at, id LIMIT 1`, GUILD, owner)
    : row1<{ id: number; name: string; class: string | null; level: number | null }>(`SELECT id, name, class, level FROM character WHERE guild_id = ? AND owner_user_id = ? AND name_key = lower(trim(?))${removed ? '' : ' AND deleted_at IS NULL'}`, GUILD, owner, String(name));
/** A recipe option ("#<id>", or an item name with one recipe) → its id and its item's id. */
const recipeOf = async (raw: unknown) => {
  const s = String(raw ?? '');
  const by = /^#(\d+)$/.exec(s);
  return by
    ? row1<{ id: number; item: number }>('SELECT id, result_item_id AS item FROM recipe WHERE id = ?', Number(by[1]))
    : row1<{ id: number; item: number }>('SELECT r.id, r.result_item_id AS item FROM recipe r JOIN item i ON i.id = r.result_item_id WHERE i.name_key = lower(trim(?)) AND r.active = 1', s);
};

async function fromLegacy({ m, key, options: o }: Legacy, opts: { env?: Record<string, unknown> }): Promise<unknown> {
  const me = m.user.id;
  switch (key) {
    case 'character add': {
      // /me first, as a member does: its command creates (or reactivates) the member row, which a form never does.
      await post(top(m, 'me'), opts);
      return submit(m, `meam:${me}`, {
        name: String(o.name ?? ''),
        ...(o.class !== undefined ? { class: String(o.class) } : {}),
        ...(o.level !== undefined ? { level: String(o.level) } : {}),
        ...(o.main === true ? { main: 'yes' } : {}),
      });
    }
    case 'character edit': {
      const owner = (o.member as string | undefined) ?? me;
      const ch = await characterOf(owner, o.name, owner !== me);
      return submit(m, `meem:${ch?.id ?? 0}`, {
        name: String(o.new_name ?? ch?.name ?? o.name ?? ''),
        class: String(o.class ?? ch?.class ?? ''),
        level: o.level !== undefined ? String(o.level) : '',
        main: o.main === true ? 'yes' : o.main === false ? 'no' : '',
      });
    }
    case 'character remove': {
      const owner = (o.member as string | undefined) ?? me;
      const ch = await characterOf(owner, o.name);
      return select(m, `mers:${owner}`, [String(ch?.id ?? 0)]);
    }
    case 'craft set': {
      const owner = o.member as string;
      const ch = await characterOf(owner, o.character);
      const skill = await row1<{ id: number }>('SELECT id FROM tradeskill WHERE name = ? COLLATE NOCASE', String(o.skill ?? ''));
      return submit(m, `updm:${ch?.id ?? 0}`, { [`lvl:${skill?.id ?? 0}`]: String(o.level ?? '') });
    }
    case 'craft know': {
      const [ch, r] = await Promise.all([characterOf(me, o.character), recipeOf(o.recipe)]);
      return select(m, `knows:${r?.item ?? 0}`, [`${ch?.id ?? 0}:${r?.id ?? 0}`]);
    }
    case 'craft forget': {
      const [ch, r] = await Promise.all([characterOf(me, o.character), recipeOf(o.recipe)]);
      return select(m, 'mefs:', [`${ch?.id ?? 0}:${r?.id ?? 0}`]);
    }
    case 'craft report': {
      const item = await row1<{ id: number }>('SELECT id FROM item WHERE name_key = lower(trim(?))', String(o.item ?? ''));
      return submit(m, `rptm:${item?.id ?? 0}`, { issue: String(o.issue ?? ''), ...(o.details !== undefined ? { details: String(o.details) } : {}) });
    }
    case 'craft notify': {
      // /me's Notices: one select per group of up to 25 tradeskills (the fixtures hold fewer: group 0).
      const { results: skills } = await env.DB.prepare('SELECT id, name FROM tradeskill ORDER BY name COLLATE NOCASE').all<{ id: number; name: string }>();
      const { results: on } = await env.DB.prepare('SELECT tradeskill_id AS id FROM craft_notify WHERE guild_id = ? AND discord_user_id = ?').bind(GUILD, me).all<{ id: number }>();
      const typed = String(o.tradeskill ?? '').toLowerCase();
      const these = skills.filter((s) => typed === 'all' || s.name.toLowerCase() === typed).map((s) => s.id);
      const now = new Set(on.map((r) => r.id));
      for (const id of these) o.on ? now.add(id) : now.delete(id);
      return select(m, 'mens:0', [...now].map(String));
    }
    case 'craft requests':
      // A member's own: /me's Cancel a request. An officer's all: /officer requests.
      return o.__officer ? rawCmd(m, 'officer', 'requests') : press(m, `mec:${me}`);
  }
  throw new Error(`no translation for /${key}`);
}

export const select = (m: Member, custom_id: string, values: string[]) => ({
  type: 3,
  guild_id: GUILD,
  member: m,
  data: { custom_id, component_type: 3, values },
});

/** A MODAL_SUBMIT with Label components, as Discord sends them. */
export const submit = (m: Member, custom_id: string, inputs: Record<string, string>) => ({
  type: 5,
  guild_id: GUILD,
  member: m,
  data: { custom_id, components: Object.entries(inputs).map(([id, value], i) => ({ type: 18, id: i + 1, component: { type: 4, id: i + 10, custom_id: id, value } })) },
});

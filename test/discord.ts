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
    embeds?: { title?: string; description?: string }[];
    components?: any[];
    choices?: { name: string; value: string }[];
    custom_id?: string;
    title?: string;
  };
}

/** The immediate answer (an ack for deferred interactions) and the webhook calls that followed it. */
export async function exchange(body: unknown, opts: { env?: Record<string, unknown> } = {}): Promise<{ ack: Reply; calls: WebhookCall[] }> {
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

/** An APPLICATION_COMMAND interaction for /name sub. */
export const cmd = (m: Member, name: string, sub: string, options: Record<string, unknown> = {}) => ({
  type: 2,
  guild_id: GUILD,
  member: m,
  data: { name, options: [{ type: 1, name: sub, options: toOptions(options) }] },
});

/** An APPLICATION_COMMAND_AUTOCOMPLETE interaction with `focus` as the focused option. */
export const auto = (m: Member, name: string, sub: string, options: Record<string, unknown>, focus: string) => ({
  type: 4,
  guild_id: GUILD,
  member: m,
  data: { name, options: [{ type: 1, name: sub, options: toOptions(options, focus) }] },
});

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

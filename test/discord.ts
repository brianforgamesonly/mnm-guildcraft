// Signed Discord interactions against the Worker (src/index.ts), as Discord would send them.
import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import app from '../src/index.ts';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

let keys: Promise<{ pair: CryptoKeyPair; publicKeyHex: string }> | undefined;
const getKeys = () =>
  (keys ??= (async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    return { pair, publicKeyHex: hex((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer) };
  })());

export async function post(body: unknown, opts: { tamper?: boolean; noHeaders?: boolean; env?: Record<string, unknown> } = {}): Promise<Response> {
  const { pair, publicKeyHex } = await getKeys();
  const text = JSON.stringify(body);
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

export const send = async (body: unknown, opts: { env?: Record<string, unknown> } = {}): Promise<Reply> => (await (await post(body, opts)).json()) as Reply;

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

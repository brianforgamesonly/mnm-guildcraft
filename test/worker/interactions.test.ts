import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import prd from '../../docs/PRD.md?raw';
import { HELP_FOOTER, HELP_TEXT } from '../../src/commands/help.ts';
import app from '../../src/index.ts';

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');

let keys: CryptoKeyPair;
let publicKeyHex: string;

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  publicKeyHex = hex((await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer);
});

async function post(body: unknown, opts: { tamper?: boolean; noHeaders?: boolean } = {}) {
  const text = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(timestamp + text)));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!opts.noHeaders) {
    headers['X-Signature-Ed25519'] = opts.tamper ? sig.replace(/^./, sig[0] === '0' ? '1' : '0') : sig;
    headers['X-Signature-Timestamp'] = timestamp;
  }
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request('https://worker.test/', { method: 'POST', headers, body: text }), { ...env, DISCORD_PUBLIC_KEY: publicKeyHex }, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

const helpCommand = { type: 2, data: { name: 'craft', options: [{ type: 1, name: 'help' }] } };

describe('Discord interactions endpoint', () => {
  it('a valid signature returns 200', async () => {
    expect((await post({ type: 1 })).status).toBe(200);
  });

  it('an invalid signature returns 401', async () => {
    expect((await post({ type: 1 }, { tamper: true })).status).toBe(401);
    expect((await post({ type: 1 }, { noHeaders: true })).status).toBe(401);
  });

  it('PING returns PONG', async () => {
    expect(await (await post({ type: 1 })).json()).toEqual({ type: 1 });
  });

  it('/craft help returns type 4 with flag 64', async () => {
    const res = await post(helpCommand);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: number; data: { content: string; flags: number } };
    expect(body.type).toBe(4);
    expect(body.data.flags).toBe(64);
    expect(body.data.content).toBe(HELP_TEXT);
  });

  it('an unknown command returns a polite ephemeral error, never a 500', async () => {
    for (const payload of [
      { type: 2, data: { name: 'roster', options: [{ type: 1, name: 'top' }] } },
      { type: 2, data: { name: 'nonsense' } },
      { type: 3, data: {} },
      { type: 2 },
    ]) {
      const res = await post(payload);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: number; data: { content: string; flags: number } };
      expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
      expect(body.data.content).toMatch(/^Sorry/);
    }
  });
});

describe('/craft help copy', () => {
  // Commands are derived from docs/PRD.md, not typed by hand. Two prose matches are not commands:
  // "/auction channel" (an example channel name) and "/character and" (the delivery plan's wording).
  const NOT_COMMANDS = new Set(['/auction channel', '/character and']);
  const prdCommands = [...new Set([...prd.matchAll(/(?:^|[ |(])(\/[a-z]+ [a-z][a-z-]*)/gm)].map((m) => m[1]))].filter((c) => !NOT_COMMANDS.has(c));

  it('lists every command in the PRD', () => {
    expect(prdCommands.length).toBe(23);
    for (const c of prdCommands) expect(HELP_TEXT, c).toContain(c);
  });

  it('fits one Discord message and carries the draft footer', () => {
    expect(HELP_TEXT.length).toBeLessThanOrEqual(2000);
    expect(HELP_TEXT).toContain(HELP_FOOTER);
  });
});

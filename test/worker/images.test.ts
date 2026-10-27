// Order 9, ITEM 3 (FR-6 layer 2) and order 24 (the owner, 2026-10-27: member screenshots turned off). Nothing is submitted
// any more and no card offers Stat image; what messages already sent still use keeps answering (order 18): Approve and
// Reject on an old vault message, Stat image on an old card with a fresh link from re-reading the vault message, and a
// vault message deleted by hand. Old rows are seeded as order 9's upload left them. Discord is mocked: never a live post.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { linkExpiry, SCREENSHOTS_OFF } from '../../src/commands/images.ts';
import { COMMANDS } from '../../src/commands/definitions.ts';
import { count, markImported, one, reset } from '../db.ts';
import { ADMIN, as, botApi, CDN, cmd, press, send, top } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
const officer = as('100000000000000009', { permissions: ADMIN });
const VAULT = '600000000000000020';
const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const at = '2026-10-19T00:00:00Z';
/** A link that expires `inMs` from now, as Discord signs them (ex = hex seconds). */
const signed = (name: string, inMs: number) => `${CDN}attachments/${VAULT}/1/${name}?ex=${Math.floor((Date.now() + inMs) / 1000).toString(16)}&is=0&hm=abc`;

let swordId: number;
let imageId: number;
let calls: { method: string; path: string }[];
let vaultMessage: { status: number; body: unknown };

beforeEach(async () => {
  await env.DB.batch(['recipe_correction_component', 'recipe_correction', 'item_image', 'recipe_component', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await reset(['Blacksmithing']);
  swordId = (await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Copper Sword', 'copper sword', 'wiki', ?)").bind(at).run()).meta.last_row_id;
  await markImported();
  await send(cmd(ann, 'character', 'add', { name: 'Annsmith' }), TOKEN);
  await env.DB.prepare('UPDATE guild SET vault_channel_id = ?').bind(VAULT).run();
  calls = [];
  vaultMessage = { status: 200, body: { id: '777000000000000001', attachments: [{ id: '888000000000000001', url: signed('fresh.png', 86_400_000) }] } };
  botApi.handle = async (method, path) => {
    calls.push({ method, path: path.replace(/\d{15,}/g, '{id}') });
    if (method === 'GET' && path === `/channels/${VAULT}/messages/777000000000000001`) return new Response(JSON.stringify(vaultMessage.body), { status: vaultMessage.status });
    if (method === 'DELETE' && path === `/channels/${VAULT}/messages/777000000000000001`) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ message: 'not faked', code: 0 }), { status: 404 });
  };
});
afterEach(() => botApi.reset());

/** A screenshot waiting in an old vault, as order 9's upload recorded it. */
const oldPending = async () =>
  (imageId = (
    await env.DB.prepare(
      "INSERT INTO item_image (guild_id, item_id, vault_channel_id, vault_message_id, attachment_id, cached_url, cached_url_expires_at, submitted_by, status, created_at) SELECT id, ?, ?, '777000000000000001', '888000000000000001', ?, ?, ?, 'pending', ? FROM guild",
    )
      .bind(swordId, VAULT, signed('item.png', 86_400_000), new Date(Date.now() + 86_400_000).toISOString(), ANN, at)
      .run()
  ).meta.last_row_id);

describe('order 24: screenshots are turned off', () => {
  it('/item has no screenshot: option and /guildcraft setup no vault: option', () => {
    type Opt = { name: string; options?: readonly Opt[] };
    const item = COMMANDS.find((c) => c.name === 'item') as unknown as Opt;
    expect(item.options!.map((o) => o.name)).toEqual(['name']);
    const setup = (COMMANDS.find((c) => c.name === 'guildcraft') as unknown as Opt).options!.find((o) => o.name === 'setup')!;
    expect(setup.options!.map((o) => o.name)).not.toContain('vault');
  });

  it('a client still sending screenshot: is told they are off; nothing is stored or posted', async () => {
    const i = top(ann, 'item', { name: 'Copper Sword', screenshot: '999000000000000001' }) as any;
    i.data.options[1].type = 11;
    expect((await send(i, TOKEN)).data.content).toBe(SCREENSHOTS_OFF);
    expect(await count('item_image')).toBe(0);
    // Only the guild-name lookup every first request makes; nothing is posted.
    expect(calls.filter((c) => c.path !== '/guilds/{id}')).toEqual([]);
  });

  it('status lists no screenshots while none wait in an old vault', async () => {
    expect((await send(cmd(officer, 'guildcraft', 'status'), TOKEN)).data.content).toContain('**Waiting for officers:** 0 open reports\n');
  });
});

describe('old messages keep working (order 18): Approve, Reject and Stat image', () => {
  it('Approve on an old vault message: officers only; edits it (approved by whom) and removes the buttons', async () => {
    await oldPending();
    expect((await send(press(ann, `ima:${imageId}`), TOKEN)).data.content).toBe('Only officers can do that.');
    const r = await send(press(officer, `ima:${imageId}`), TOKEN);
    expect(r.type).toBe(7);
    expect(r.data.content).toMatch(/^Screenshot of \*\*Copper Sword\*\* · approved by <@100000000000000009> · <t:\d+:f>$/);
    expect(r.data.components).toEqual([]);
    expect((await one<{ status: string }>('SELECT status FROM item_image')).status).toBe('approved');
    // A second press writes no audit row (order 9 review).
    const audits = await count('audit_log', "action LIKE 'image.%'");
    expect((await send(press(officer, `ima:${imageId}`), TOKEN)).data.content).toBe('That screenshot was already approved.');
    expect(await count('audit_log', "action LIKE 'image.%'")).toBe(audits);
  });

  it('Reject on an old vault message: marks it rejected and deletes the message', async () => {
    await oldPending();
    const r = await send(press(officer, `imr:${imageId}`), TOKEN);
    expect(r.data.content).toBe('Rejected the screenshot of **Copper Sword** and deleted it from the vault.');
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([{ method: 'DELETE', path: '/channels/{id}/messages/{id}' }]);
  });

  it('Stat image on an old card: none says screenshots are off; an approved one shows, its expiring link refreshed from the vault', async () => {
    expect((await send(press(ann, `img:${swordId}`), TOKEN)).data.content).toBe(SCREENSHOTS_OFF);
    await oldPending();
    await send(press(officer, `ima:${imageId}`), TOKEN);
    const cached = await send(press(ann, `img:${swordId}`), TOKEN);
    expect(cached.data.flags).toBe(64);
    expect((cached.data.embeds![0] as any).image.url).toContain('/item.png');
    await env.DB.prepare('UPDATE item_image SET cached_url_expires_at = ?').bind(new Date(Date.now() + 5 * 60_000).toISOString()).run();
    const fresh = await send(press(ann, `img:${swordId}`), TOKEN);
    expect((fresh.data.embeds![0] as any).image.url).toContain('/fresh.png');
  });

  it('a vault message deleted by hand: the row is marked gone, and the reply says screenshots are off', async () => {
    await oldPending();
    await send(press(officer, `ima:${imageId}`), TOKEN);
    await env.DB.prepare('UPDATE item_image SET cached_url_expires_at = ?').bind(at).run();
    vaultMessage = { status: 404, body: { message: 'Unknown Message', code: 10008 } };
    const r = await send(press(ann, `img:${swordId}`), TOKEN);
    expect(r.data.content).toBe(SCREENSHOTS_OFF);
    expect((await one<{ g: string | null }>('SELECT gone_at AS g FROM item_image')).g).not.toBeNull();
  });

  it('status still counts screenshots left pending in an old vault', async () => {
    await oldPending();
    expect((await send(cmd(officer, 'guildcraft', 'status'), TOKEN)).data.content).toContain(`0 open reports · 1 pending screenshot in <#${VAULT}>`);
  });
});

it('linkExpiry reads the ex parameter', () => {
  expect(linkExpiry(`${CDN}x.png?ex=6a0b1c00&is=0&hm=1`)).toBe(new Date(0x6a0b1c00 * 1000).toISOString());
  expect(linkExpiry(`${CDN}x.png`)).toBeNull();
});

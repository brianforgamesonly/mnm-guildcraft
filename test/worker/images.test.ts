// Order 9, ITEM 3 (FR-6 layer 2): /guildcraft setup vault:, /item image (magic bytes, limits, the multipart re-upload),
// Approve and Reject, Stat image with a fresh link from re-reading the vault message, and a vault message deleted by
// hand. Discord and its CDN are mocked: never a live post.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { imageType, linkExpiry } from '../../src/commands/images.ts';
import { all, count, markImported, one, reset } from '../db.ts';
import { ADMIN, as, botApi, CDN, cdn, cmd, GUILD, press, send } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
const officer = as('100000000000000009', { permissions: ADMIN });
const VAULT = '600000000000000020';
const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const at = '2026-10-19T00:00:00Z';
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A link that expires `inMs` from now, as Discord signs them (ex = hex seconds). */
const signed = (name: string, inMs: number) => `${CDN}attachments/${VAULT}/1/${name}?ex=${Math.floor((Date.now() + inMs) / 1000).toString(16)}&is=0&hm=abc`;

let swordId: number;
let calls: { method: string; path: string }[];
let uploads: { payload: any; file: File }[];
let vaultMessage: { status: number; body: unknown };
let cdnCalls = 0;
const cdnHits = () => cdnCalls;

beforeEach(async () => {
  await env.DB.batch(['recipe_correction_component', 'recipe_correction', 'item_image', 'recipe_component', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await reset(['Blacksmithing']);
  swordId = (await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Copper Sword', 'copper sword', 'wiki', ?)").bind(at).run()).meta.last_row_id;
  await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, source, imported_at) VALUES ('k1', (SELECT id FROM tradeskill), ?, 20, 'wiki', ?)").bind(swordId, at).run();
  await markImported();
  await send(cmd(ann, 'character', 'add', { name: 'Annsmith' }), TOKEN);
  calls = [];
  uploads = [];
  vaultMessage = { status: 200, body: { id: '777000000000000001', attachments: [{ id: '888000000000000001', url: signed('fresh.png', 86_400_000) }] } };
  botApi.handle = async (method, path, body) => {
    calls.push({ method, path: path.replace(/\d{15,}/g, '{id}') });
    if (method === 'POST' && path === `/channels/${VAULT}/messages` && body instanceof FormData) {
      uploads.push({ payload: JSON.parse(String(body.get('payload_json'))), file: body.get('files[0]') as File });
      return new Response(JSON.stringify({ id: '777000000000000001', attachments: [{ id: '888000000000000001', url: signed('item.png', 86_400_000) }] }), { status: 200 });
    }
    if (method === 'GET' && path === `/channels/${VAULT}/messages/777000000000000001`) return new Response(JSON.stringify(vaultMessage.body), { status: vaultMessage.status });
    if (method === 'DELETE' && path === `/channels/${VAULT}/messages/777000000000000001`) return new Response(null, { status: 204 });
    if (method === 'GET' && path === `/channels/${VAULT}`) return new Response(JSON.stringify({ permission_overwrites: [{ id: GUILD, type: 0, allow: '0', deny: String(1 << 10) }] }), { status: 200 });
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return new Response(JSON.stringify([{ id: GUILD, permissions: String(1 << 10) }]), { status: 200 });
    return new Response(JSON.stringify({ message: 'not faked', code: 0 }), { status: 404 });
  };
  cdnCalls = 0;
  cdn.handle = (url) => {
    cdnCalls++;
    return url.includes('/member/') ? new Response(new Uint8Array([...PNG, ...new Array(2000).fill(7)]), { status: 200 }) : new Response(new TextEncoder().encode('just text, not an image'), { status: 200 });
  };
});
afterEach(() => {
  botApi.reset();
  cdn.reset();
});

const VAULT_BITS = String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 15) | (1 << 16));
function setupVault(app_permissions = VAULT_BITS) {
  const i = cmd(officer, 'guildcraft', 'setup', { vault: VAULT }) as any;
  i.data.resolved = { channels: { [VAULT]: { id: VAULT, name: 'guildcraft-vault', type: 0, permissions: ADMIN, app_permissions } } };
  return send(i, TOKEN);
}
function upload(o: { file?: string; size?: number; m?: typeof ann } = {}) {
  const i = cmd(o.m ?? ann, 'item', 'image', { item: 'Copper Sword', image: '999000000000000001' }) as any;
  i.data.options[0].options[1].type = 11;
  i.data.resolved = { attachments: { '999000000000000001': { id: '999000000000000001', filename: 'shot.png', size: o.size ?? 2008, content_type: 'image/png', url: `${CDN}attachments/1/${o.file ?? 'member'}/shot.png?ex=0` } } };
  return send(i, TOKEN);
}

describe('/guildcraft setup vault:', () => {
  it('refuses, naming the missing permission', async () => {
    const r = await setupVault(String((1 << 10) | (1 << 11) | (1 << 14) | (1 << 16)));
    expect(r.data.content).toBe(`Nothing was changed. In <#${VAULT}> GuildCraft is missing: **Attach Files**.\nGive the GuildCraft role these in the channel's settings (Permissions), then run this again.`);
    expect((await one<{ v: string | null }>('SELECT vault_channel_id AS v FROM guild')).v).toBeNull();
  });
  it('saves it; a private channel gets no warning, an open one is warned, not refused', async () => {
    const r = await setupVault();
    expect(r.data.content).toMatch(/^Saved\./);
    expect(r.data.content).toContain(`Vault channel: <#${VAULT}>`);
    expect(r.data.content).not.toContain('everyone in the server can see');
    expect((await one<{ v: string }>('SELECT vault_channel_id AS v FROM guild')).v).toBe(VAULT);
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'GET' && p === `/channels/${VAULT}` ? new Response(JSON.stringify({ permission_overwrites: [] }), { status: 200 }) : handle(m, p, b));
    expect((await setupVault()).data.content).toContain(`**Note:** everyone in the server can see <#${VAULT}>`);
  });
});

describe('/item image', () => {
  it('without a vault: refused, an admin needs to run setup vault', async () => {
    expect((await upload()).data.content).toBe('Screenshots need a vault channel first: a server admin runs `/guildcraft setup vault:` with a private channel for officers. Nothing was saved.');
    expect(cdnHits()).toBe(0);
  });

  it('re-uploads the bytes to the vault (multipart), stores the ids, and never the member\'s link', async () => {
    await setupVault();
    const r = await upload();
    expect(r.data.content).toBe('Thanks: your screenshot of **Copper Sword** is waiting for an officer to approve it. Once approved, it shows under **Stat image** on `/craft find`.');
    expect(uploads).toHaveLength(1);
    expect(uploads[0].payload.content).toBe('Screenshot of **Copper Sword** from <@100000000000000001> · waiting for an officer');
    expect(uploads[0].payload.components[0].components.map((b: any) => b.label)).toEqual(['Approve', 'Reject']);
    expect(uploads[0].file.type).toBe('image/png');
    expect(uploads[0].file.size).toBe(2008);
    const row = await one<Record<string, unknown>>('SELECT status, vault_channel_id, vault_message_id, attachment_id, cached_url FROM item_image');
    expect(row).toMatchObject({ status: 'pending', vault_channel_id: VAULT, vault_message_id: '777000000000000001', attachment_id: '888000000000000001' });
    expect(String(row.cached_url)).toContain('/item.png');
    expect(String(row.cached_url)).not.toContain('/member/');
  });

  it('checks the magic bytes, not the claimed content type; and the limits', async () => {
    await setupVault();
    expect((await upload({ file: 'text' })).data.content).toBe('That file is not a PNG, JPEG or WebP image. Nothing was saved.');
    expect((await upload({ size: 9 * 1024 * 1024 })).data.content).toMatch(/the limit is 8 MB/);
    expect(await count('item_image')).toBe(0);
    await upload();
    expect((await upload()).data.content).toMatch(/still waiting for an officer/); // one pending per item
    expect(uploads).toHaveLength(1);
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0]))).toEqual({ mime: 'image/jpeg', ext: 'jpg' });
    expect(imageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toEqual({ mime: 'image/webp', ext: 'webp' });
  });
});

describe('Approve, Reject and Stat image', () => {
  const approveId = () => uploads[0].payload.components[0].components[0].custom_id as string;
  const rejectId = () => uploads[0].payload.components[0].components[1].custom_id as string;

  it('Approve: officers only; edits the vault message (approved by whom) and removes the buttons', async () => {
    await setupVault();
    await upload();
    expect((await send(press(ann, approveId()), TOKEN)).data.content).toBe('Only officers can do that.');
    const r = await send(press(officer, approveId()), TOKEN);
    expect(r.type).toBe(7);
    expect(r.data.content).toMatch(/^Screenshot of \*\*Copper Sword\*\* · approved by <@100000000000000009> · <t:\d+:f>$/);
    expect(r.data.components).toEqual([]);
    expect((await one<{ status: string }>('SELECT status FROM item_image')).status).toBe('approved');
  });

  it('Reject: marks it rejected and deletes the vault message', async () => {
    await setupVault();
    await upload();
    const r = await send(press(officer, rejectId()), TOKEN);
    expect(r.data.content).toBe('Rejected the screenshot of **Copper Sword** and deleted it from the vault.');
    expect(calls.filter((c) => c.method === 'DELETE')).toEqual([{ method: 'DELETE', path: '/channels/{id}/messages/{id}' }]);
    expect((await one<{ status: string }>('SELECT status FROM item_image')).status).toBe('rejected');
  });

  it('Stat image: none yet invites /item image; then the cached link; an expiring one is refreshed by re-reading the vault message', async () => {
    expect((await send(press(ann, `img:${swordId}`), TOKEN)).data.content).toBe('No screenshot of **Copper Sword** yet. Have one? Send it with `/item image`: an officer approves it, then it shows here.');
    await setupVault();
    await upload();
    await send(press(officer, approveId()), TOKEN);
    const cached = await send(press(ann, `img:${swordId}`), TOKEN);
    expect(cached.data.flags).toBe(64);
    expect((cached.data.embeds![0] as any).image.url).toContain('/item.png');
    expect(calls.filter((c) => c.method === 'GET' && c.path.includes('/messages/'))).toEqual([]);
    // The cached link now expires in 5 minutes: the vault message is read back for a freshly signed one.
    await env.DB.prepare('UPDATE item_image SET cached_url_expires_at = ?').bind(new Date(Date.now() + 5 * 60_000).toISOString()).run();
    const fresh = await send(press(ann, `img:${swordId}`), TOKEN);
    expect((fresh.data.embeds![0] as any).image.url).toContain('/fresh.png');
    expect(calls.filter((c) => c.method === 'GET' && c.path.includes('/messages/'))).toHaveLength(1);
    expect(Date.parse((await one<{ e: string }>('SELECT cached_url_expires_at AS e FROM item_image')).e)).toBeGreaterThan(Date.now() + 3_600_000);
  });

  it('a vault message deleted by hand: the row is marked, and the reply says no screenshot exists', async () => {
    await setupVault();
    await upload();
    await send(press(officer, approveId()), TOKEN);
    await env.DB.prepare('UPDATE item_image SET cached_url_expires_at = ?').bind(at).run();
    vaultMessage = { status: 404, body: { message: 'Unknown Message', code: 10008 } };
    const r = await send(press(ann, `img:${swordId}`), TOKEN);
    expect(r.data.content).toMatch(/^No screenshot of \*\*Copper Sword\*\* yet/);
    expect(r.data.embeds ?? []).toEqual([]);
    expect((await one<{ g: string | null }>('SELECT gone_at AS g FROM item_image')).g).not.toBeNull();
  });

  it('order 9 review: an upload that throws leaves nothing pending, so the member can send again', async () => {
    await setupVault();
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (b instanceof FormData ? Promise.reject(new Error('timed out')) : handle(m, p, b));
    expect((await upload()).data.content).toBe("Sorry, I couldn't post that screenshot to the vault. Nothing is waiting for review.");
    expect(await all('SELECT status, reviewed_by FROM item_image')).toEqual([{ status: 'rejected', reviewed_by: 'upload-failed' }]);
    botApi.handle = handle;
    expect((await upload()).data.content).toMatch(/^Thanks: your screenshot/);
  });

  it('order 9 review: a pending vault message deleted by hand no longer blocks a new screenshot', async () => {
    await setupVault();
    await upload();
    vaultMessage = { status: 404, body: { message: 'Unknown Message', code: 10008 } };
    expect((await upload()).data.content).toMatch(/^Thanks: your screenshot/);
    expect(await all('SELECT status, gone_at IS NOT NULL AS gone FROM item_image ORDER BY id')).toEqual([{ status: 'pending', gone: 1 }, { status: 'pending', gone: 0 }]);
  });

  it('order 9 review: a second press on a reviewed screenshot writes no audit row', async () => {
    await setupVault();
    await upload();
    await send(press(officer, approveId()), TOKEN);
    const audits = await count('audit_log', "action LIKE 'image.%'");
    expect((await send(press(officer, approveId()), TOKEN)).data.content).toBe('That screenshot was already approved.');
    expect(await count('audit_log', "action LIKE 'image.%'")).toBe(audits);
  });

  it('status counts pending screenshots', async () => {
    await setupVault();
    await upload();
    expect((await send(cmd(officer, 'guildcraft', 'status'), TOKEN)).data.content).toContain(`0 open reports · 1 pending screenshot in <#${VAULT}>`);
  });
});

it('linkExpiry reads the ex parameter', () => {
  expect(linkExpiry(`${CDN}x.png?ex=6a0b1c00&is=0&hm=1`)).toBe(new Date(0x6a0b1c00 * 1000).toISOString());
  expect(linkExpiry(`${CDN}x.png`)).toBeNull();
});

void all;

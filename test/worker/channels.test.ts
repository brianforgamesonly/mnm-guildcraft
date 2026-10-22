// Work order 19, ITEM 4: /guildcraft setup's Create GuildCraft channels, in workerd against a mocked Discord that keeps
// the channels it is asked to create (so a second press sees the first one's work). Nothing reaches a real server.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATEGORY_NAME, CHANNELS_COPY, FORUM_SORT_CREATION, OFFICER_ALLOW, storedName } from '../../src/commands/channels.ts';
import { CREATE_CHANNELS_LABEL, CREATE_CHANNELS_PREFIX } from '../../src/commands/setup.ts';
import { ADMIN_ONLY } from '../../src/interactions.ts';
import { ATTACH_FILES, CREATE_PRIVATE_THREADS, EMBED_LINKS, GUILD_CATEGORY, GUILD_FORUM, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_THREADS, READ_MESSAGE_HISTORY, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, cmd, GUILD, press, send } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const admin = as('100000000000000001', { permissions: ADMIN });
const BOT_ROLE = '600000000000000001';
const OFFICER = '600000000000000002';

interface FakeChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  permission_overwrites: { id: string; type: number; allow: string; deny: string }[];
  default_sort_order: number | null;
}
const fake = {
  channels: [] as FakeChannel[],
  features: ['COMMUNITY'] as string[],
  botPerms: INSTALL_PERMISSIONS,
  calls: [] as { method: string; path: string; body: any }[],
  next: 1,
};
const creates = () => fake.calls.filter((c) => c.method === 'POST' && c.path === `/guilds/${GUILD}/channels`);

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  Object.assign(fake, { channels: [], features: ['COMMUNITY'], botPerms: INSTALL_PERMISSIONS, calls: [], next: 1 });
  botApi.handle = (method, path, body) => {
    fake.calls.push({ method, path, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild', features: fake.features });
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(fake.botPerms) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      // Discord's own naming of text and forum channels, as the order describes it (a category keeps its capitals).
      const ch: FakeChannel = {
        id: `70000000000000${String(fake.next++).padStart(4, '0')}`,
        name: body.type === GUILD_CATEGORY ? body.name : storedName(body.name),
        type: body.type,
        parent_id: body.parent_id ?? null,
        permission_overwrites: body.permission_overwrites ?? [],
        default_sort_order: body.default_sort_order ?? null,
      };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    const put = path.match(/^\/channels\/(\d+)\/permissions\/(\d+)$/);
    if (method === 'PUT' && put) {
      const ch = fake.channels.find((c) => c.id === put[1])!;
      ch.permission_overwrites = [...ch.permission_overwrites.filter((o) => o.id !== put[2]), { id: put[2], ...body }];
      return new Response(null, { status: 204 });
    }
    const patch = path.match(/^\/channels\/(\d+)$/);
    if (method === 'PATCH' && patch && body?.default_sort_order !== undefined) {
      const ch = fake.channels.find((c) => c.id === patch[1])!;
      ch.default_sort_order = body.default_sort_order;
      return json(ch);
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
});

const setup = (opts: Record<string, unknown> = {}) => send(cmd(admin, 'guildcraft', 'setup', opts), TOKEN);
const pressCreate = (m = admin) => send(press(m, CREATE_CHANNELS_PREFIX), TOKEN);
const saved = () => one<Record<string, string | null>>('SELECT board_channel_id, review_channel_id, vault_channel_id, request_channel_id, officer_role_id FROM guild');
const byName = (name: string) => fake.channels.find((c) => c.name === storedName(name))!;
const ow = (ch: FakeChannel, id: string) => ch.permission_overwrites.find((o) => o.id === id);
const bits = (...b: bigint[]) => String(b.reduce((x, y) => x | y, 0n));

describe('Create GuildCraft channels', () => {
  it('the button is on /guildcraft setup, and on a save that leaves a channel unset', async () => {
    const r = await setup();
    expect(r.data.components![0].components[0]).toMatchObject({ custom_id: CREATE_CHANNELS_PREFIX, label: CREATE_CHANNELS_LABEL });
    const saveRoles = await setup({ officer_role: OFFICER });
    expect(saveRoles.data.components![0].components[0].custom_id).toBe(CREATE_CHANNELS_PREFIX);
  });

  it('the created layout: a GuildCraft category and four channels, each with the bot\'s own allow; saved; the forum sorted by creation', async () => {
    await setup({ officer_role: OFFICER });
    const r = await pressCreate();
    // One category, then the four channels, in that order.
    expect(creates().map((c) => [c.body.name, c.body.type])).toEqual([
      [CATEGORY_NAME, GUILD_CATEGORY],
      ['GC-Crafting Roster', GUILD_FORUM],
      ['GC-Officer Review', GUILD_TEXT],
      ['GC-Item Vault', GUILD_TEXT],
      ['GC-Craft Requests', GUILD_TEXT],
    ]);
    const cat = fake.channels.find((c) => c.type === GUILD_CATEGORY)!;
    expect(cat.name).toBe('GuildCraft');
    for (const c of creates().slice(1)) expect(c.body.parent_id).toBe(cat.id);

    const roster = byName('GC-Crafting Roster');
    expect(roster.name).toBe('gc-crafting-roster');
    expect(roster.default_sort_order).toBe(FORUM_SORT_CREATION);
    expect(ow(roster, GUILD)).toEqual({ id: GUILD, type: 0, allow: bits(VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS), deny: bits(SEND_MESSAGES) });
    expect(ow(roster, APP_ID)).toEqual({ id: APP_ID, type: 1, allow: bits(VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS, READ_MESSAGE_HISTORY, MANAGE_THREADS, SEND_MESSAGES_IN_THREADS), deny: '0' });

    const review = byName('GC-Officer Review');
    expect(ow(review, GUILD)).toEqual({ id: GUILD, type: 0, allow: '0', deny: bits(VIEW_CHANNEL) });
    expect(ow(review, OFFICER)).toEqual({ id: OFFICER, type: 0, allow: String(OFFICER_ALLOW), deny: '0' });
    expect(ow(review, APP_ID)).toEqual({ id: APP_ID, type: 1, allow: bits(VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS), deny: '0' });

    const vault = byName('GC-Item Vault');
    expect(ow(vault, GUILD)!.deny).toBe(bits(VIEW_CHANNEL));
    expect(ow(vault, APP_ID)!.allow).toBe(bits(VIEW_CHANNEL, SEND_MESSAGES, ATTACH_FILES, READ_MESSAGE_HISTORY));

    const requests = byName('GC-Craft Requests');
    // Members reply in the bot's private threads; they neither send in the channel nor open private threads of their own.
    expect(ow(requests, GUILD)).toEqual({ id: GUILD, type: 0, allow: bits(VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS), deny: bits(SEND_MESSAGES, CREATE_PRIVATE_THREADS) });
    expect(ow(requests, APP_ID)!.allow).toBe(bits(VIEW_CHANNEL, READ_MESSAGE_HISTORY, MANAGE_THREADS, CREATE_PRIVATE_THREADS, SEND_MESSAGES_IN_THREADS));

    // Every channel that denies @everyone something lets the bot's own member back in.
    for (const ch of fake.channels.filter((c) => c.type !== GUILD_CATEGORY)) {
      expect(BigInt(ow(ch, GUILD)!.deny), ch.name).not.toBe(0n);
      expect(BigInt(ow(ch, APP_ID)!.allow) & VIEW_CHANNEL, ch.name).toBe(VIEW_CHANNEL);
    }
    expect(await saved()).toEqual({ board_channel_id: roster.id, review_channel_id: review.id, vault_channel_id: vault.id, request_channel_id: requests.id, officer_role_id: OFFICER });
    expect(r.data.content).toContain(CHANNELS_COPY.created(roster.id, 'forum'));
    expect(r.data.content).toContain(CHANNELS_COPY.created(review.id, 'private text channel'));
    expect(r.data.content).toMatch(/Building the board now/);
    expect(await one("SELECT count(*) AS n FROM audit_log WHERE action = 'guild.setup'")).toEqual({ n: 2 });
    // The lease is released.
    expect(await one('SELECT channel_setup_lock_until AS l FROM guild')).toEqual({ l: null });
  });

  it('pressing it twice never duplicates anything', async () => {
    await setup({ officer_role: OFFICER });
    await pressCreate();
    const after1 = fake.channels.length;
    const before = await saved();
    fake.calls = [];
    const r = await pressCreate();
    expect(fake.channels).toHaveLength(after1);
    expect(creates()).toEqual([]);
    expect(await saved()).toEqual(before);
    expect(r.data.content).toContain(CHANNELS_COPY.nothing);
    expect(r.data.content!.match(/^Kept/gm)).toHaveLength(4);
  });

  it('a channel in the GuildCraft category by name (as Discord stores it) is reused; a saved channel is kept; one elsewhere is not adopted', async () => {
    fake.channels.push({ id: '700000000000009000', name: 'GuildCraft', type: GUILD_CATEGORY, parent_id: null, permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009001', name: 'gc-item-vault', type: GUILD_TEXT, parent_id: '700000000000009000', permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009002', name: 'my-own-review', type: GUILD_TEXT, parent_id: null, permission_overwrites: [], default_sort_order: null });
    // An unrelated public channel with the request channel's name, outside the category: setup's options are the way to pick it.
    fake.channels.push({ id: '700000000000009004', name: 'gc-craft-requests', type: GUILD_TEXT, parent_id: null, permission_overwrites: [], default_sort_order: null });
    await setup();
    await env.DB.prepare('UPDATE guild SET review_channel_id = ?').bind('700000000000009002').run();
    const r = await pressCreate();
    expect(creates().map((c) => [c.body.name, c.body.parent_id])).toEqual([['GC-Crafting Roster', '700000000000009000'], ['GC-Craft Requests', '700000000000009000']]);
    const s = await saved();
    expect(s).toMatchObject({ vault_channel_id: '700000000000009001', review_channel_id: '700000000000009002' });
    expect(s.request_channel_id).not.toBe('700000000000009004');
    // No private channel was created by this press, so no admins-only warning about channels it did not make.
    expect(r.data.content).not.toContain(CHANNELS_COPY.noOfficer);
  });

  it('without Community: the other three are created, and setup says Community is needed for the roster board', async () => {
    fake.features = [];
    await setup({ officer_role: OFFICER });
    const r = await pressCreate();
    expect(creates().map((c) => c.body.name)).toEqual([CATEGORY_NAME, 'GC-Officer Review', 'GC-Item Vault', 'GC-Craft Requests']);
    expect(r.data.content).toContain(CHANNELS_COPY.noCommunity('GC-Crafting Roster'));
    expect((await saved()).board_channel_id).toBeNull();
    // Community turned on later: the next press adds the forum only.
    fake.features = ['COMMUNITY'];
    fake.calls = [];
    await pressCreate();
    expect(creates().map((c) => c.body.name)).toEqual(['GC-Crafting Roster']);
  });

  it('without an officer role the private channels are admins-only; set it and press again to add it', async () => {
    await setup();
    const r = await pressCreate();
    expect(r.data.content).toContain(CHANNELS_COPY.noOfficer);
    expect(ow(byName('GC-Officer Review'), OFFICER)).toBeUndefined();
    // Every channel is saved now, and the officer role's save still offers the button the warning points to.
    const officerSaved = await setup({ officer_role: OFFICER });
    expect(officerSaved.data.components![0].components[0].custom_id).toBe(CREATE_CHANNELS_PREFIX);
    fake.calls = [];
    const again = await pressCreate();
    expect(fake.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual([
      `/channels/${byName('GC-Officer Review').id}/permissions/${OFFICER}`,
      `/channels/${byName('GC-Item Vault').id}/permissions/${OFFICER}`,
    ]);
    expect(ow(byName('GC-Item Vault'), OFFICER)).toEqual({ id: OFFICER, type: 0, allow: String(OFFICER_ALLOW), deny: '0' });
    expect(again.data.content).toContain(CHANNELS_COPY.officerAdded(byName('GC-Officer Review').id));
    expect(again.data.content).not.toContain(CHANNELS_COPY.nothing);
    expect(creates()).toEqual([]);
  });

  it('a server that installed before the button (no Manage Channels or Manage Permissions) is told how to grant them; nothing is created', async () => {
    fake.botPerms = INSTALL_PERMISSIONS & ~MANAGE_CHANNELS & ~MANAGE_ROLES;
    await setup();
    const r = await pressCreate();
    expect(r.data.content).toBe(CHANNELS_COPY.missing(['Manage Channels', 'Manage Permissions (Manage Roles)']));
    expect(creates()).toEqual([]);
  });

  it('a second press while the first holds the lease is refused politely, and makes no call', async () => {
    await setup();
    await env.DB.prepare('UPDATE guild SET channel_setup_lock_until = ?').bind(`${new Date(Date.now() + 30_000).toISOString()}#busy0000`).run();
    fake.calls = [];
    const r = await pressCreate();
    expect(r.data.content).toBe(CHANNELS_COPY.busy);
    expect(fake.calls).toEqual([]);
    // An expired lease does not block.
    await env.DB.prepare('UPDATE guild SET channel_setup_lock_until = ?').bind(`${new Date(Date.now() - 1000).toISOString()}#old00000`).run();
    expect((await pressCreate()).data.content).not.toBe(CHANNELS_COPY.busy);
  });

  it('only admins can press it', async () => {
    await setup();
    const r = await pressCreate(as('100000000000000002'));
    expect(r.data.content).toBe(ADMIN_ONLY);
    expect(creates()).toEqual([]);
  });

  it('a saved forum not sorted by creation time is set to it', async () => {
    fake.channels.push({ id: '700000000000009003', name: 'our-board', type: GUILD_FORUM, parent_id: null, permission_overwrites: [], default_sort_order: 0 });
    await setup();
    await env.DB.prepare('UPDATE guild SET board_channel_id = ?').bind('700000000000009003').run();
    await pressCreate();
    expect(fake.channels.find((c) => c.id === '700000000000009003')!.default_sort_order).toBe(FORUM_SORT_CREATION);
  });
});

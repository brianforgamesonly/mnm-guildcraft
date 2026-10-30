// Work order 19, ITEM 4 (order 24, ITEMs 3-4: the new layout and the emoji): /guildcraft setup's Create GuildCraft
// channels, in workerd against a mocked Discord that keeps the channels and emoji it is asked to create (so a second press
// sees the first one's work). Nothing reaches a real server.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { FACTIONS, TRADESKILLS } from '../../src/board/kinds.ts';
import { CALL_CAP, CATEGORY_NAME, CHANNELS_COPY, FORUM_SORT_CREATION, LAYOUT, OFFICER_ALLOW, storedName } from '../../src/commands/channels.ts';
import { CREATE_CHANNELS_LABEL, CREATE_CHANNELS_PREFIX, setupButtons } from '../../src/commands/setup.ts';
import { ADMIN_ONLY } from '../../src/interactions.ts';
import {
  CREATE_GUILD_EXPRESSIONS, CREATE_PRIVATE_THREADS, EMBED_LINKS, GUILD_CATEGORY, GUILD_FORUM, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_THREADS, READ_MESSAGE_HISTORY,
  SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL,
} from '../../src/discord.ts';
import { EMOJI_NAME, MAX_EMOJIS } from '../../src/emoji.ts';
import { EMOJI_IMAGE } from '../../src/emoji-image.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, cmd, GUILD, press, send } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const admin = as('100000000000000001', { permissions: ADMIN });
const BOT_ROLE = '600000000000000001';
const OFFICER = '600000000000000002';
const EMOJI_ID = '800000000000000001';

type Reaction = { emoji_id: string | null; emoji_name: string | null } | null;
interface FakeChannel {
  id: string;
  name: string;
  type: number;
  parent_id: string | null;
  permission_overwrites: { id: string; type: number; allow: string; deny: string }[];
  default_sort_order: number | null;
  default_reaction_emoji?: Reaction;
}
const fake = {
  channels: [] as FakeChannel[],
  emojis: [] as { id: string; name: string }[],
  features: ['COMMUNITY'] as string[],
  botPerms: INSTALL_PERMISSIONS,
  emojiFull: false,
  calls: [] as { method: string; path: string; body: any }[],
  next: 1,
};
const creates = () => fake.calls.filter((c) => c.method === 'POST' && c.path === `/guilds/${GUILD}/channels`);
const emojiCreates = () => fake.calls.filter((c) => c.method === 'POST' && c.path === `/guilds/${GUILD}/emojis`);

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  Object.assign(fake, { channels: [], emojis: [], features: ['COMMUNITY'], botPerms: INSTALL_PERMISSIONS, emojiFull: false, calls: [], next: 1 });
  botApi.handle = (method, path, body) => {
    fake.calls.push({ method, path, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild', features: fake.features });
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(fake.botPerms) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    if (method === 'GET' && path === `/guilds/${GUILD}/emojis`) return json(fake.emojis);
    if (method === 'POST' && path === `/guilds/${GUILD}/emojis`) {
      // Discord's own answers: Missing Permissions without Create Expressions; Maximum number of emojis reached.
      if ((fake.botPerms & CREATE_GUILD_EXPRESSIONS) !== CREATE_GUILD_EXPRESSIONS) return json({ code: 50013, message: 'Missing Permissions' }, 403);
      if (fake.emojiFull) return json({ code: MAX_EMOJIS, message: 'Maximum number of emojis reached (50)' }, 400);
      const e = { id: EMOJI_ID, name: body.name };
      fake.emojis.push(e);
      return json(e, 201);
    }
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      // Discord's own naming of text and forum channels, as the order describes it (a category keeps its capitals).
      const ch: FakeChannel = {
        id: `70000000000000${String(fake.next++).padStart(4, '0')}`,
        name: body.type === GUILD_CATEGORY ? body.name : storedName(body.name),
        type: body.type,
        parent_id: body.parent_id ?? null,
        permission_overwrites: body.permission_overwrites ?? [],
        default_sort_order: body.default_sort_order ?? null,
        default_reaction_emoji: body.default_reaction_emoji ?? null,
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
    if (method === 'PATCH' && patch) {
      const ch = fake.channels.find((c) => c.id === patch[1])!;
      if (body.default_sort_order !== undefined) ch.default_sort_order = body.default_sort_order;
      if (body.default_reaction_emoji !== undefined) ch.default_reaction_emoji = body.default_reaction_emoji;
      return json(ch);
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
});

const setup = (opts: Record<string, unknown> = {}) => send(cmd(admin, 'guildcraft', 'setup', opts), TOKEN);
const pressCreate = (m = admin) => send(press(m, CREATE_CHANNELS_PREFIX), TOKEN);
const saved = () => one<Record<string, string | null>>('SELECT board_channel_id, faction_board_channel_id, review_channel_id, vault_channel_id, request_channel_id, officer_role_id FROM guild');
const byName = (name: string) => fake.channels.find((c) => c.name === storedName(name))!;
const ow = (ch: FakeChannel, id: string) => ch.permission_overwrites.find((o) => o.id === id);
const bits = (...b: bigint[]) => String(b.reduce((x, y) => x | y, 0n));
const ours = { emoji_id: EMOJI_ID, emoji_name: null };

describe('order 30: forum defaults', () => {
  it('a press on kept forums never sends guidelines, so an officer who changed or cleared them keeps that', async () => {
    await setup();
    fake.channels.push({ id: '700000000000009000', name: 'GuildCraft', type: GUILD_CATEGORY, parent_id: null, permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009001', name: 'gc-tradeskills', type: GUILD_FORUM, parent_id: '700000000000009000', permission_overwrites: [], default_sort_order: 0, default_reaction_emoji: ours });
    await pressCreate();
    expect(fake.calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toEqual([{ default_sort_order: FORUM_SORT_CREATION }]);
  });
});

describe('Create GuildCraft channels', () => {
  it('the button is on /guildcraft setup, and on a save that leaves a channel unset; it is offered for exactly the layout\'s channels', async () => {
    const r = await setup();
    expect(r.data.components![0].components[0]).toMatchObject({ custom_id: CREATE_CHANNELS_PREFIX, label: CREATE_CHANNELS_LABEL });
    const saveRoles = await setup({ officer_role: OFFICER });
    expect(saveRoles.data.components![0].components[0].custom_id).toBe(CREATE_CHANNELS_PREFIX);
    // setup.ts's list of the button's channels is the layout's (it cannot import it: channels.ts imports setup.ts).
    const all = Object.fromEntries(LAYOUT.map((p) => [p.key, 'x']));
    expect(setupButtons(all as never)).toEqual({});
    for (const p of LAYOUT) expect(setupButtons({ ...all, [p.key]: null } as never).components, p.key).toBeDefined();
  });

  it('order 24: the layout is two forums and two text channels, GC- plus what each holds; each with the bot\'s own allow; saved; both forums sorted by creation with the emoji', async () => {
    await setup({ officer_role: OFFICER });
    const r = await pressCreate();
    expect(emojiCreates().map((c) => c.body)).toEqual([{ name: EMOJI_NAME, image: EMOJI_IMAGE, roles: [] }]);
    expect(creates().map((c) => [c.body.name, c.body.type])).toEqual([
      [CATEGORY_NAME, GUILD_CATEGORY],
      ['GC-Tradeskills', GUILD_FORUM],
      ['GC-Factions', GUILD_FORUM],
      ['GC-Craft Requests', GUILD_TEXT],
      ['GC-Officer Review', GUILD_TEXT],
    ]);
    const cat = fake.channels.find((c) => c.type === GUILD_CATEGORY)!;
    expect(cat.name).toBe('GuildCraft');
    for (const c of creates().slice(1)) expect(c.body.parent_id).toBe(cat.id);

    const forumAllow = bits(VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS, READ_MESSAGE_HISTORY, MANAGE_THREADS, SEND_MESSAGES_IN_THREADS);
    for (const name of ['GC-Tradeskills', 'GC-Factions']) {
      const f = byName(name);
      expect(f.default_sort_order, name).toBe(FORUM_SORT_CREATION);
      expect(f.default_reaction_emoji, name).toEqual(ours);
      expect(ow(f, GUILD)).toEqual({ id: GUILD, type: 0, allow: bits(VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS), deny: bits(SEND_MESSAGES) });
      expect(ow(f, APP_ID)).toEqual({ id: APP_ID, type: 1, allow: forumAllow, deny: '0' });
    }
    const review = byName('GC-Officer Review');
    expect(ow(review, GUILD)).toEqual({ id: GUILD, type: 0, allow: '0', deny: bits(VIEW_CHANNEL) });
    expect(ow(review, OFFICER)).toEqual({ id: OFFICER, type: 0, allow: String(OFFICER_ALLOW), deny: '0' });
    expect(ow(review, APP_ID)).toEqual({ id: APP_ID, type: 1, allow: bits(VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS), deny: '0' });
    const requests = byName('GC-Craft Requests');
    expect(ow(requests, GUILD)).toEqual({ id: GUILD, type: 0, allow: bits(VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS), deny: bits(SEND_MESSAGES, CREATE_PRIVATE_THREADS) });
    expect(ow(requests, APP_ID)!.allow).toBe(bits(VIEW_CHANNEL, READ_MESSAGE_HISTORY, MANAGE_THREADS, CREATE_PRIVATE_THREADS, SEND_MESSAGES_IN_THREADS));
    // No vault is created any more (order 24, explicit override 2).
    expect(fake.channels.some((c) => /vault/.test(c.name))).toBe(false);
    // Order 30: each forum's post guidelines go in its create; a text channel carries none, and no extra call is made.
    expect(creates().filter((c) => c.body.topic).map((c) => [c.body.name, c.body.topic])).toEqual([['GC-Tradeskills', TRADESKILLS.guidelines], ['GC-Factions', FACTIONS.guidelines]]);
    expect(fake.calls.filter((c) => c.method === 'PATCH').length).toBe(0);
    for (const b of [TRADESKILLS, FACTIONS]) {
      expect(b.guidelines.length).toBeLessThanOrEqual(1024); // Create Guild Channel: "channel topic (0-1024 characters)"
      expect(b.guidelines).toContain(LAYOUT.find((p) => p.key === 'request_channel_id')!.name);
    }

    for (const ch of fake.channels.filter((c) => c.type !== GUILD_CATEGORY)) {
      expect(BigInt(ow(ch, GUILD)!.deny), ch.name).not.toBe(0n);
      expect(BigInt(ow(ch, APP_ID)!.allow) & VIEW_CHANNEL, ch.name).toBe(VIEW_CHANNEL);
    }
    expect(await saved()).toEqual({
      board_channel_id: byName('GC-Tradeskills').id, faction_board_channel_id: byName('GC-Factions').id, review_channel_id: review.id, vault_channel_id: null,
      request_channel_id: requests.id, officer_role_id: OFFICER,
    });
    // The reply: one line per channel with its purpose, the emoji, and both boards building.
    for (const p of LAYOUT) expect(r.data.content).toContain(CHANNELS_COPY.created(byName(p.name).id, p.purpose));
    expect(r.data.content).toContain(CHANNELS_COPY.emojiCreated);
    expect(r.data.content).toMatch(/Building the board now/);
    // No faction data in this test database: the factions board has nothing to build yet.
    expect(r.data.content).toContain('The factions board already has every faction post; refreshing it now.');
    expect(await one('SELECT channel_setup_lock_until AS l FROM guild')).toEqual({ l: null });
    expect(fake.calls.filter((c) => !c.path.includes('/threads') && !c.path.includes('/messages')).length).toBeLessThanOrEqual(CALL_CAP);
  });

  it('pressing it twice creates nothing new and makes no call past its reads', async () => {
    await setup({ officer_role: OFFICER });
    await pressCreate();
    const after1 = fake.channels.length;
    const before = await saved();
    fake.calls = [];
    const r = await pressCreate();
    expect(fake.channels).toHaveLength(after1);
    expect(creates()).toEqual([]);
    expect(emojiCreates()).toEqual([]);
    expect(fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(await saved()).toEqual(before);
    expect(r.data.content).toContain(CHANNELS_COPY.nothing);
    expect(r.data.content!.match(/^Kept/gm)).toHaveLength(LAYOUT.length);
  });

  it('a server with a tradeskills forum already set gets only GC-Factions; its forum keeps its name and gets the reaction once; a reaction a server chose is left alone', async () => {
    fake.channels.push({ id: '700000000000009003', name: 'gc-crafting-roster', type: GUILD_FORUM, parent_id: null, permission_overwrites: [], default_sort_order: 1, default_reaction_emoji: null });
    fake.channels.push({ id: '700000000000009005', name: 'officers', type: GUILD_TEXT, parent_id: null, permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009006', name: 'requests', type: GUILD_TEXT, parent_id: null, permission_overwrites: [], default_sort_order: null });
    await setup();
    await env.DB.prepare('UPDATE guild SET board_channel_id = ?, review_channel_id = ?, request_channel_id = ?').bind('700000000000009003', '700000000000009005', '700000000000009006').run();
    const r = await pressCreate();
    expect(creates().map((c) => c.body.name)).toEqual([CATEGORY_NAME, 'GC-Factions']);
    const old = fake.channels.find((c) => c.id === '700000000000009003')!;
    expect(old.name).toBe('gc-crafting-roster');
    expect(old.default_reaction_emoji).toEqual(ours);
    expect(r.data.content).toContain(CHANNELS_COPY.reaction(old.id));
    // A server's own reaction stays.
    old.default_reaction_emoji = { emoji_id: null, emoji_name: '🔨' };
    fake.calls = [];
    await pressCreate();
    expect(old.default_reaction_emoji).toEqual({ emoji_id: null, emoji_name: '🔨' });
    expect(fake.calls.filter((c) => c.method === 'PATCH')).toEqual([]);
  });

  it('the emoji is reused when the server has one named guildcraft; never a second', async () => {
    fake.emojis.push({ id: '800000000000000099', name: EMOJI_NAME });
    await setup();
    await pressCreate();
    expect(emojiCreates()).toEqual([]);
    expect(byName('GC-Factions').default_reaction_emoji).toEqual({ emoji_id: '800000000000000099', emoji_name: null });
  });

  it('without Create Expressions (older installs) or with no free emoji slot: the channels are made, the forums keep their reaction, and the reply says why', async () => {
    fake.botPerms = INSTALL_PERMISSIONS & ~CREATE_GUILD_EXPRESSIONS;
    await setup();
    let r = await pressCreate();
    expect(emojiCreates()).toEqual([]);
    expect(byName('GC-Tradeskills').default_reaction_emoji).toBeNull();
    expect(r.data.content).toContain(CHANNELS_COPY.emojiSkipped({ skipped: 'permission' }));
    expect(creates()).toHaveLength(1 + LAYOUT.length);
    fake.botPerms = INSTALL_PERMISSIONS;
    fake.emojiFull = true;
    r = await pressCreate();
    expect(r.data.content).toContain(CHANNELS_COPY.emojiSkipped({ skipped: 'slots' }));
    expect(byName('GC-Tradeskills').default_reaction_emoji).toBeNull();
    // A slot freed: the next press sets both forums.
    fake.emojiFull = false;
    r = await pressCreate();
    for (const n of ['GC-Tradeskills', 'GC-Factions']) expect(byName(n).default_reaction_emoji).toEqual(ours);
  });

  it('a channel in the GuildCraft category by name (as Discord stores it) is reused; a saved channel is kept; one elsewhere is not adopted', async () => {
    fake.channels.push({ id: '700000000000009000', name: 'GuildCraft', type: GUILD_CATEGORY, parent_id: null, permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009001', name: 'gc-factions', type: GUILD_FORUM, parent_id: '700000000000009000', permission_overwrites: [], default_sort_order: 1, default_reaction_emoji: ours });
    fake.channels.push({ id: '700000000000009002', name: 'my-own-review', type: GUILD_TEXT, parent_id: null, permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009004', name: 'gc-craft-requests', type: GUILD_TEXT, parent_id: null, permission_overwrites: [], default_sort_order: null });
    await setup();
    await env.DB.prepare('UPDATE guild SET review_channel_id = ?').bind('700000000000009002').run();
    const r = await pressCreate();
    expect(creates().map((c) => [c.body.name, c.body.parent_id])).toEqual([['GC-Tradeskills', '700000000000009000'], ['GC-Craft Requests', '700000000000009000']]);
    const s = await saved();
    expect(s).toMatchObject({ faction_board_channel_id: '700000000000009001', review_channel_id: '700000000000009002' });
    expect(s.request_channel_id).not.toBe('700000000000009004');
    expect(r.data.content).not.toContain(CHANNELS_COPY.noOfficer);
  });

  it('without Community: the two text channels are created, and setup says Community is needed for the forums', async () => {
    fake.features = [];
    await setup({ officer_role: OFFICER });
    const r = await pressCreate();
    expect(creates().map((c) => c.body.name)).toEqual([CATEGORY_NAME, 'GC-Craft Requests', 'GC-Officer Review']);
    expect(emojiCreates()).toEqual([]);
    expect(r.data.content).toContain(CHANNELS_COPY.noCommunity('GC-Tradeskills'));
    expect(r.data.content).toContain(CHANNELS_COPY.noCommunity('GC-Factions'));
    expect((await saved()).board_channel_id).toBeNull();
    fake.features = ['COMMUNITY'];
    fake.calls = [];
    await pressCreate();
    expect(creates().map((c) => c.body.name)).toEqual(['GC-Tradeskills', 'GC-Factions']);
  });

  it('without an officer role the officer review channel is admins-only; set it and press again to add it', async () => {
    await setup();
    const r = await pressCreate();
    expect(r.data.content).toContain(CHANNELS_COPY.noOfficer);
    expect(ow(byName('GC-Officer Review'), OFFICER)).toBeUndefined();
    const officerSaved = await setup({ officer_role: OFFICER });
    expect(officerSaved.data.components![0].components[0].custom_id).toBe(CREATE_CHANNELS_PREFIX);
    fake.calls = [];
    const again = await pressCreate();
    expect(fake.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toEqual([`/channels/${byName('GC-Officer Review').id}/permissions/${OFFICER}`]);
    expect(again.data.content).toContain(CHANNELS_COPY.officerAdded(byName('GC-Officer Review').id));
    expect(again.data.content).not.toContain(CHANNELS_COPY.nothing);
    expect(creates()).toEqual([]);
  });

  it('review of PR B: a vault the order-19 button made still gets the officer role on a later press; none is created', async () => {
    fake.channels.push({ id: '700000000000009000', name: 'GuildCraft', type: GUILD_CATEGORY, parent_id: null, permission_overwrites: [], default_sort_order: null });
    fake.channels.push({ id: '700000000000009007', name: 'gc-item-vault', type: GUILD_TEXT, parent_id: '700000000000009000', permission_overwrites: [], default_sort_order: null });
    await setup({ officer_role: OFFICER });
    await env.DB.prepare('UPDATE guild SET vault_channel_id = ?').bind('700000000000009007').run();
    const r = await pressCreate();
    expect(fake.calls.filter((c) => c.method === 'PUT').map((c) => c.path)).toContain(`/channels/700000000000009007/permissions/${OFFICER}`);
    expect(r.data.content).toContain(CHANNELS_COPY.officerAdded('700000000000009007'));
    expect(creates().map((c) => c.body.name)).not.toContain('GC-Item Vault');
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
    await env.DB.prepare('UPDATE guild SET channel_setup_lock_until = ?').bind(`${new Date(Date.now() - 1000).toISOString()}#old00000`).run();
    expect((await pressCreate()).data.content).not.toBe(CHANNELS_COPY.busy);
  });

  it('only admins can press it', async () => {
    await setup();
    const r = await pressCreate(as('100000000000000002'));
    expect(r.data.content).toBe(ADMIN_ONLY);
    expect(creates()).toEqual([]);
  });

  it('a saved forum not sorted by creation time is set to it, with the reaction, in one call', async () => {
    fake.channels.push({ id: '700000000000009003', name: 'our-board', type: GUILD_FORUM, parent_id: null, permission_overwrites: [], default_sort_order: 0 });
    await setup();
    await env.DB.prepare('UPDATE guild SET board_channel_id = ?').bind('700000000000009003').run();
    await pressCreate();
    const ch = fake.channels.find((c) => c.id === '700000000000009003')!;
    expect(ch.default_sort_order).toBe(FORUM_SORT_CREATION);
    expect(ch.default_reaction_emoji).toEqual(ours);
    expect(fake.calls.filter((c) => c.method === 'PATCH' && c.path === '/channels/700000000000009003')).toHaveLength(1);
  });
});

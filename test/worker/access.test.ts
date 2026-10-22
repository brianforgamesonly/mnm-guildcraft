// ITEM 1.2 (guild, member and access) and 1.5 (first-use welcome).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WELCOME } from '../../src/commands/welcome.ts';
import { ADMIN_ONLY } from '../../src/interactions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, as, auto, cmd, GUILD, guildLookup, MANAGE_GUILD, select, send, submit, top } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const MEMBER_ROLE = '700000000000000001';
const OFFICER_ROLE = '700000000000000002';

beforeEach(() => reset());
afterEach(() => {
  vi.restoreAllMocks();
  guildLookup.reset();
});

const hasWelcome = (r: { data: { embeds?: { title?: string }[] } }) => (r.data.embeds ?? []).some((e) => e.title === WELCOME.title);

describe('guild row', () => {
  it('the first command creates it with the defaults; without a bot token the name is the guild id', async () => {
    await send(cmd(as(ANN), 'craft', 'help'));
    expect(await one('SELECT id, name, member_role_id, officer_role_id, skill_cap, stale_days FROM guild')).toEqual({
      id: GUILD, name: GUILD, member_role_id: null, officer_role_id: null, skill_cap: 300, stale_days: 60,
    });
  });

  // The fake Discord (test/discord.ts) answers the lookup; the reply itself arrives by webhook (order 4).
  it('guild.name comes from one bot-token GET /guilds/{id} when the row is created', async () => {
    guildLookup.respond = () => Response.json({ id: GUILD, name: 'The Test Guild' });
    await send(cmd(as(ANN), 'craft', 'help'), { env: { DISCORD_BOT_TOKEN: 'test-token' } });
    expect(guildLookup.calls).toEqual([`https://discord.com/api/v10/guilds/${GUILD}`]);
    expect(await one('SELECT name FROM guild')).toEqual({ name: 'The Test Guild' });
    await send(cmd(as(ANN), 'craft', 'help'), { env: { DISCORD_BOT_TOKEN: 'test-token' } });
    expect(guildLookup.calls).toHaveLength(1); // only on creation
  });

  it('a failed lookup stores the id as the name; a later command refreshes it', async () => {
    guildLookup.respond = () => new Response('nope', { status: 500 });
    const first = await send(cmd(as(ANN), 'craft', 'help'), { env: { DISCORD_BOT_TOKEN: 'test-token' } });
    expect(first.data.embeds![0].title).toMatch(/^GuildCraft help/); // the reply is not held up (order 18: /help's first page)
    expect(await one('SELECT name FROM guild')).toEqual({ name: GUILD });
    guildLookup.respond = () => Response.json({ id: GUILD, name: 'Renamed Later' });
    await send(cmd(as(ANN), 'craft', 'help'), { env: { DISCORD_BOT_TOKEN: 'test-token' } });
    expect(await one('SELECT name FROM guild')).toEqual({ name: 'Renamed Later' });
  });
});

describe('/guildcraft setup', () => {
  it('is refused without Administrator or Manage Server, and changes nothing', async () => {
    const r = await send(cmd(as(BO, { roles: [OFFICER_ROLE] }), 'guildcraft', 'setup', { member_role: MEMBER_ROLE }));
    expect(r.data.content).toBe(ADMIN_ONLY);
    expect(await one('SELECT member_role_id FROM guild')).toEqual({ member_role_id: null });
    expect(await count('audit_log')).toBe(0);
  });

  it('Administrator sets both roles; Manage Server alone is enough; each write is audited', async () => {
    const r = await send(cmd(as(ANN, { permissions: ADMIN }), 'guildcraft', 'setup', { member_role: MEMBER_ROLE, officer_role: OFFICER_ROLE }));
    expect(r.data.content).toContain(`<@&${MEMBER_ROLE}>`);
    expect(r.data.flags).toBe(64);
    await send(cmd(as(BO, { permissions: MANAGE_GUILD }), 'guildcraft', 'setup', { officer_role: '700000000000000009' }));
    expect(await one('SELECT member_role_id, officer_role_id FROM guild')).toEqual({ member_role_id: MEMBER_ROLE, officer_role_id: '700000000000000009' });
    const rows = await all<{ actor: string; action: string; detail_json: string }>('SELECT actor, action, detail_json FROM audit_log ORDER BY id');
    expect(rows.map((x) => [x.actor, x.action])).toEqual([[ANN, 'guild.setup'], [BO, 'guild.setup']]);
    expect(JSON.parse(rows[1].detail_json)).toEqual({
      before: { member_role_id: MEMBER_ROLE, officer_role_id: OFFICER_ROLE, board_channel_id: null, review_channel_id: null, vault_channel_id: null, request_channel_id: null },
      after: { member_role_id: MEMBER_ROLE, officer_role_id: '700000000000000009', board_channel_id: null, review_channel_id: null, vault_channel_id: null, request_channel_id: null },
    });
  });

  it('with no options it shows the current settings', async () => {
    const r = await send(cmd(as(ANN, { permissions: ADMIN }), 'guildcraft', 'setup'));
    expect(r.data.content).toMatch(/^Current settings:\nMember role: none/);
  });
});

describe('access', () => {
  const gate = () => send(cmd(as(ANN, { permissions: ADMIN }), 'guildcraft', 'setup', { member_role: MEMBER_ROLE, officer_role: OFFICER_ROLE }));

  it('member role set: a caller without it is refused, gets no member row and no welcome', async () => {
    await gate();
    const r = await send(cmd(as(BO), 'character', 'add', { name: 'Bochar' }));
    expect(r.data.content).toContain(`<@&${MEMBER_ROLE}>`);
    expect(hasWelcome(r)).toBe(false);
    expect(await count('member', 'discord_user_id = ?', BO)).toBe(0);
    expect(await count('character')).toBe(0);
  });

  it('member role set: a caller with it passes', async () => {
    await gate();
    const r = await send(cmd(as(BO, { roles: [MEMBER_ROLE] }), 'character', 'add', { name: 'Bochar' }));
    expect(r.data.content).toMatch(/^Added \*\*Bochar\*\*/);
  });

  it('no member role: anyone in the server passes', async () => {
    const r = await send(cmd(as(BO), 'character', 'add', { name: 'Bochar' }));
    expect(r.data.content).toMatch(/^Added/);
  });

  it('/craft help answers a caller the gate refuses, without creating a member row', async () => {
    await gate();
    const r = await send(cmd(as(BO), 'craft', 'help'));
    expect(r.data.embeds![0].title).toMatch(/^GuildCraft help/);
    expect(await count('member', 'discord_user_id = ?', BO)).toBe(0);
  });

  it('officer rights: the officer role, Administrator or Manage Server; a plain member is refused', async () => {
    await gate();
    await send(cmd(as(BO, { roles: [MEMBER_ROLE] }), 'character', 'add', { name: 'Bochar' }));
    const edit = (m: ReturnType<typeof as>, level: number) => send(cmd(m, 'character', 'edit', { name: 'Bochar', level, member: BO }));
    const plain = '100000000000000003';
    expect((await edit(as(plain, { roles: [MEMBER_ROLE] }), 5)).data.content).toBe('Only officers can do that.');
    expect((await edit(as('100000000000000004', { roles: [MEMBER_ROLE, OFFICER_ROLE] }), 6)).data.content).toMatch(/^Updated/);
    expect((await edit(as('100000000000000005', { roles: [MEMBER_ROLE], permissions: ADMIN }), 7)).data.content).toMatch(/^Updated/);
    expect((await edit(as('100000000000000006', { roles: [MEMBER_ROLE], permissions: MANAGE_GUILD }), 8)).data.content).toMatch(/^Updated/);
    expect(await one('SELECT level FROM character')).toEqual({ level: 8 });
  });
});

describe('member row', () => {
  it('created on the first command only; autocomplete, select and modal submit never create it', async () => {
    await send(auto(as(BO), 'character', 'add', { class: 's' }, 'class'));
    await send(select(as(BO), 'upd:1:0', ['1']));
    await send(submit(as(BO), 'updm:1', { 'lvl:1': '5' }));
    expect(await count('member')).toBe(0);
    expect(await count('guild')).toBe(0);
    const r = await send(cmd(as(BO), 'craft', 'me'));
    expect(hasWelcome(r)).toBe(true);
    expect(await count('member')).toBe(1);
  });

  it('display_name is nick, else global_name, else username, refreshed on every command', async () => {
    const name = async () => (await one<{ display_name: string }>('SELECT display_name FROM member WHERE discord_user_id = ?', ANN)).display_name;
    await send(cmd(as(ANN, { nick: 'Nicky' }), 'craft', 'me'));
    expect(await name()).toBe('Nicky');
    await send(cmd(as(ANN, { nick: null }), 'craft', 'me'));
    expect(await name()).toBe(`Global ${ANN}`);
    await send(cmd(as(ANN, { nick: null, global_name: null, username: 'plainuser' }), 'craft', 'me'));
    expect(await name()).toBe('plainuser');
    expect(await count('member')).toBe(1);
  });
});

describe('first-use welcome (FR-9)', () => {
  it('shows once, privately, with the first command reply and never again', async () => {
    // Order 18: a new member's first command is /me (Add character is its button), so the welcome comes with /me.
    const first = await send(top(as(ANN), 'me'));
    expect(first.data.flags).toBe(64);
    expect(first.data.embeds!.filter((e) => e.title === WELCOME.title)).toHaveLength(1);
    const added = await send(cmd(as(ANN), 'character', 'add', { name: 'Testchar' }));
    expect(added.data.content).toMatch(/^Added \*\*Testchar\*\*\. It is your main/);
    expect(hasWelcome(added)).toBe(false);
    const second = await send(top(as(ANN), 'me'));
    expect(hasWelcome(second)).toBe(false);
  });

  it('the three steps name the new commands (order 18): /me and Add character, /skills, /item', () => {
    expect(WELCOME.description).toMatch(/\*\*1\.\*\* `\/me`: press \*\*Add character\*\*/);
    expect(WELCOME.description).toMatch(/\*\*2\.\*\* `\/skills`: press Enter.*\nOr press \*\*Update skills\*\* on your `\/me`/);
    expect(WELCOME.description).toMatch(/\*\*3\.\*\* `\/item`: look up any item/);
    expect(WELCOME.description).not.toMatch(/coming soon/);
  });
});

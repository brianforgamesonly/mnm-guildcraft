// Work order 27, PR A: the DKP add-on's switch (Add DKP, Remove DKP), the ledger, settings, adjustments, approval cards
// and their lapse on the guild's timer object, in workerd against a mocked Discord that keeps what it is asked to create.
// Nothing reaches a real server.
import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CATEGORY_NAME, CHANNELS_COPY, storedName } from '../../src/commands/channels.ts';
import { APPROVE_PREFIX, FULL_PAGE_PREFIX } from '../../src/dkp/commands.ts';
import { DKP_COPY } from '../../src/dkp/copy.ts';
import { DKP_COMMAND } from '../../src/dkp/definition.ts';
import { HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { payStatement, POOL_GUILD, readdStatement, reverseStatement } from '../../src/dkp/ledger.ts';
import { FULL_STANDINGS_PREFIX, STANDINGS_TOP } from '../../src/dkp/messages.ts';
import { SETTINGS, settingsOf } from '../../src/dkp/settings.ts';
import { ADD_DKP_PREFIX, DKP_CHANNEL_NAME, REMOVE_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { ADMIN_ONLY, DKP_PREFIX, OPENS_MODAL, planFor } from '../../src/interactions.ts';
import { CREATE_PRIVATE_THREADS, EMBED_LINKS, GUILD_CATEGORY, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, READ_MESSAGE_HISTORY, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, dkpTriggerNames, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, send, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const BOT_ROLE = '600000000000000001';
const admin = as('100000000000000001', { permissions: ADMIN });
const officerA = as('100000000000000002', { roles: [OFFICER_ROLE] });
const officerB = as('100000000000000003', { roles: [OFFICER_ROLE] });
const memberX = as('100000000000000004');
const X = memberX.user.id;

interface Msg { id: string; channel: string; body: any }
const fake = {
  channels: [] as { id: string; name: string; type: number; parent_id: string | null; permission_overwrites: any[] }[],
  messages: [] as Msg[],
  commands: [] as { id: string; name: string }[],
  botPerms: INSTALL_PERMISSIONS,
  calls: [] as { method: string; path: string; body: any }[],
  next: 1,
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM zone'),
    env.DB.prepare("INSERT INTO zone (key, name) VALUES ('the ruins', 'The Ruins'), ('deep hollow', 'Deep Hollow')"),
  ]);
  Object.assign(fake, { channels: [], messages: [], commands: [], botPerms: INSTALL_PERMISSIONS, calls: [], next: 1 });
  botApi.handle = (method, path, body) => {
    fake.calls.push({ method, path, body });
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(fake.botPerms) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === GUILD_CATEGORY ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null, permission_overwrites: body.permission_overwrites ?? [] };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) {
      // An upsert: the same name keeps its id (201 new, 200 existing).
      const had = fake.commands.find((c) => c.name === body.name);
      if (had) return json(had, 200);
      const c = { id: id(), name: body.name };
      fake.commands.push(c);
      return json(c, 201);
    }
    if (method === 'GET' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) return json(fake.commands);
    const del = path.match(new RegExp(`^/applications/${APP_ID}/guilds/${GUILD}/commands/(\\d+)$`));
    if (method === 'DELETE' && del) {
      fake.commands = fake.commands.filter((c) => c.id !== del[1]);
      return new Response(null, { status: 204 });
    }
    const post = path.match(/^\/channels\/(\d+)\/messages$/);
    if (method === 'POST' && post) {
      const m = { id: id(), channel: post[1], body };
      fake.messages.push(m);
      return json({ id: m.id });
    }
    const patch = path.match(/^\/channels\/(\d+)\/messages\/(\d+)$/);
    if (method === 'PATCH' && patch) {
      const m = fake.messages.find((x) => x.id === patch[2]);
      if (!m) return json({ code: 10008, message: 'Unknown Message' }, 404);
      m.body = { ...m.body, ...body };
      return json({ id: m.id });
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
});

const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
/** Waits (up to 2 s) for a condition an alarm brings about. */
const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 40 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50));
};
const dkp = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'dkp', sub, opts), TOKEN);
const addDkp = () => pressAs(admin, ADD_DKP_PREFIX);
const dkpChannel = () => fake.channels.find((c) => c.name === storedName(DKP_CHANNEL_NAME));
const ledger = () => all<{ member_id: string; pool: string; amount: number; cut: number; balance_after: number; kind: string; id: number; actor: string }>('SELECT * FROM dkp_ledger ORDER BY id');

describe('Add DKP and Remove DKP (ITEM 1)', () => {
  it('/guildcraft setup offers Add DKP while off, Remove DKP while on', async () => {
    const ids = async () => (await send(rawCmd(admin, 'guildcraft', 'setup'), TOKEN)).data.components!.flatMap((r: any) => r.components.map((b: any) => b.custom_id));
    expect(await ids()).toContain(ADD_DKP_PREFIX);
    await addDkp();
    expect(await ids()).toContain(REMOVE_DKP_PREFIX);
  });

  it('creates the category and GC-DKP with the text-channel overwrites, upserts /dkp, posts the guild standings; a second press duplicates nothing', async () => {
    const r = await addDkp();
    const ch = dkpChannel()!;
    expect(r.data.content).toContain(DKP_COPY.added(ch.id));
    expect(fake.channels.find((c) => c.type === GUILD_CATEGORY)!.name).toBe(CATEGORY_NAME);
    expect(ch).toMatchObject({ type: GUILD_TEXT, parent_id: fake.channels[0].id });
    const ow = (id: string) => ch.permission_overwrites.find((o) => o.id === id);
    expect(ow(GUILD)).toEqual({ id: GUILD, type: 0, allow: String(VIEW_CHANNEL | SEND_MESSAGES_IN_THREADS), deny: String(SEND_MESSAGES | CREATE_PRIVATE_THREADS) });
    expect(ow(APP_ID)).toEqual({ id: APP_ID, type: 1, allow: String(VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | READ_MESSAGE_HISTORY), deny: '0' });
    const upserts = () => fake.calls.filter((c) => c.method === 'POST' && c.path.startsWith(`/applications/${APP_ID}/guilds/${GUILD}/commands`));
    expect(upserts().map((c) => c.body)).toEqual([DKP_COMMAND]);
    expect(fake.messages.map((m) => m.body.embeds[0].title)).toEqual([DKP_COPY.standingsTitle(DKP_COPY.guildPool)]);
    expect(await one('SELECT enabled, channel_id, command_id FROM dkp_guild')).toEqual({ enabled: 1, channel_id: ch.id, command_id: fake.commands[0].id });

    const again = await addDkp();
    expect(again.data.content).toContain(DKP_COPY.kept(ch.id));
    expect(fake.channels.length).toBe(2);
    expect(fake.commands.length).toBe(1);
    expect(upserts().length).toBe(2);
    expect(fake.messages.length).toBe(1); // the standings message is edited, not posted again
  });

  it('refuses without Manage Channels or Manage Roles, with Create GuildCraft channels\' own text; nothing is created', async () => {
    for (const lacking of [MANAGE_CHANNELS, MANAGE_ROLES]) {
      fake.botPerms = INSTALL_PERMISSIONS & ~lacking;
      const r = await addDkp();
      expect(r.data.content).toBe(CHANNELS_COPY.missing([lacking === MANAGE_CHANNELS ? 'Manage Channels' : 'Manage Permissions (Manage Roles)']));
    }
    expect(fake.channels).toEqual([]);
    expect(fake.commands).toEqual([]);
  });

  it('is for admins only, as Create GuildCraft channels is', async () => {
    expect((await pressAs(officerA, ADD_DKP_PREFIX)).data.content).toBe(ADMIN_ONLY);
    expect((await pressAs(officerA, REMOVE_DKP_PREFIX)).data.content).toBe(ADMIN_ONLY);
  });

  it('Remove DKP deletes /dkp and marks DKP off; GC-DKP and every row stay; Add DKP later resumes the same history', async () => {
    await addDkp();
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 5, reason: 'raid prep' });
    const ch = dkpChannel()!;
    const r = await pressAs(admin, REMOVE_DKP_PREFIX);
    expect(r.data.content).toBe(DKP_COPY.removed(ch.id));
    expect(fake.commands).toEqual([]);
    expect(await one('SELECT enabled FROM dkp_guild')).toEqual({ enabled: 0 });
    expect(await count('dkp_ledger')).toBe(1);
    // Every DKP control answers "off" now; /dkp too.
    for (const id of [`${APPROVE_PREFIX}1`, `${FULL_STANDINGS_PREFIX}${POOL_GUILD}:0`, `${FULL_PAGE_PREFIX}${POOL_GUILD}:1`]) expect((await pressAs(memberX, id)).data.content, id).toBe(DKP_COPY.off);
    expect((await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 5, reason: 'x' })).data.content).toBe(DKP_COPY.off);
    await addDkp();
    expect(fake.channels.filter((c) => c.name === storedName(DKP_CHANNEL_NAME)).length).toBe(1);
    expect(fake.commands.length).toBe(1);
    expect(await one('SELECT balance_after FROM dkp_ledger')).toEqual({ balance_after: 5 });
  });

  it('routes each new custom_id prefix (order 23), none opens a modal, and every DKP prefix shares one stem', () => {
    for (const p of [ADD_DKP_PREFIX, REMOVE_DKP_PREFIX, APPROVE_PREFIX, FULL_STANDINGS_PREFIX, FULL_PAGE_PREFIX]) {
      expect(p.startsWith(DKP_PREFIX), p).toBe(true);
      expect(OPENS_MODAL.some((m) => p.startsWith(m)), p).toBe(false);
      expect(planFor(press(memberX, `${p}x`) as never), p).toMatchObject({ defer: true });
    }
  });
});

describe('the ledger (ITEM 2)', () => {
  beforeEach(async () => {
    await addDkp();
  });

  it('nobody changes their own points; an adjustment needs a reason and posts publicly, pinging nobody', async () => {
    expect((await dkp(officerA, 'adjust', { member: officerA.user.id, pool: POOL_GUILD, points: 5, reason: 'mine' })).data.content).toBe(DKP_COPY.own);
    expect((await dkp(memberX, 'adjust', { member: officerA.user.id, pool: POOL_GUILD, points: 5, reason: 'x' })).data.content).toBe(DKP_COPY.notRunner);
    expect((await dkp(officerA, 'adjust', { member: X, pool: 'Nowhere', points: 5, reason: 'x' })).data.content).toBe(DKP_COPY.unknownPool('Nowhere'));
    const r = await dkp(officerA, 'adjust', { member: X, pool: 'The Ruins', points: 7, reason: 'late invite' });
    expect(r.data.content).toBe(DKP_COPY.adjustDone(true));
    expect((await ledger()).map((l) => [l.member_id, l.pool, l.amount, l.balance_after, l.kind, l.actor])).toEqual([[X, 'the ruins', 7, 7, 'adjust', officerA.user.id]]);
    const notice = fake.messages.find((m) => m.body.content?.includes('late invite'))!;
    expect(notice.body.allowed_mentions).toEqual({ parse: [] });
    // The Ruins got its own standings message.
    expect(fake.messages.some((m) => m.body.embeds?.[0].title === DKP_COPY.standingsTitle('The Ruins'))).toBe(true);
    for (const c of fake.calls.filter((c) => /\/messages/.test(c.path) && c.method !== 'GET')) expect(c.body.allowed_mentions, c.path).toEqual({ parse: [] });
  });

  it('caps a positive amount against the pool cap (order 29: 200 by default) and keeps the cut; a negative one is never cut', async () => {
    await env.DB.prepare("INSERT INTO dkp_setting (guild_id, key, value, set_at, set_by) VALUES (?, 'second_officer_over', '1000', 'x', 'x')").bind(GUILD).run();
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 250, reason: 'big' });
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: -230, reason: 'oops' });
    expect((await ledger()).map((l) => [l.amount, l.cut, l.balance_after])).toEqual([[200, 50, 200], [-230, 0, -30]]);
  });

  it('over the threshold: an approval card; the asker and the member cannot approve; another officer can, once; it lapses on its timer', async () => {
    const r = await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 25, reason: 'carry' });
    expect(r.data.content).toBe(DKP_COPY.approvalPosted(20));
    expect(await count('dkp_ledger')).toBe(0);
    const p = await one<{ id: number }>('SELECT id FROM dkp_pending');
    expect((await pressAs(officerA, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.asked);
    expect((await pressAs(memberX, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.notRunner);
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.approvedReply);
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.notOpen);
    expect((await ledger()).map((l) => [l.amount, l.actor])).toEqual([[25, officerB.user.id]]);
    // The member themself, made an officer, still cannot approve a change to their own points.
    await dkp(officerA, 'adjust', { member: officerB.user.id, pool: POOL_GUILD, points: 30, reason: 'x' });
    const q = await one<{ id: number }>('SELECT max(id) AS id FROM dkp_pending');
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${q.id}`)).data.content).toBe(DKP_COPY.own);
    // Its lapse was set on the guild's timer object at the due time.
    const list = await timersOf(env, GUILD).list();
    const due = Date.parse((await one<{ due_at: string }>('SELECT due_at FROM dkp_pending WHERE id = ?', q.id)).due_at);
    expect(list[`lapse:${q.id}`]).toBe(due);
  });

  it('review of PR A: two officers approving at once pay once; Remove DKP lapses open approvals and finds /dkp by name', async () => {
    const officerC = as('100000000000000006', { roles: [OFFICER_ROLE] });
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 25, reason: 'carry' });
    const p = await one<{ id: number }>('SELECT id FROM dkp_pending');
    // (The harness reads back one reply per send by the latest token, so concurrent sends are judged from D1, not replies.)
    await Promise.all([pressAs(officerB, `${APPROVE_PREFIX}${p.id}`), pressAs(officerC, `${APPROVE_PREFIX}${p.id}`)]);
    expect(await count('dkp_ledger')).toBe(1);
    expect(await count('audit_log', "action = 'dkp.approve'")).toBe(1);
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 30, reason: 'x' });
    // A registration recreated /dkp with a new id (dev's bulk PUT, then the upsert): the saved id is stale.
    fake.commands = [{ id: '799999999999999999', name: 'dkp' }];
    await pressAs(admin, REMOVE_DKP_PREFIX);
    expect(fake.commands).toEqual([]);
    expect(await all('SELECT status FROM dkp_pending ORDER BY id')).toEqual([{ status: 'approved' }, { status: 'lapsed' }]);
  });

  it('every balance_after equals the running sum of its member\'s amounts in that pool (override 8)', async () => {
    const at = '2026-10-29T00:00:00Z';
    const members = Array.from({ length: 6 }, (_, i) => `2000000000000000${i}`);
    for (let k = 0; k < 15; k++)
      await env.DB.batch([
        payStatement(env.DB, { guildId: GUILD, pool: k % 2 ? POOL_GUILD : 'the ruins', members: members.slice(k % 3), asked: 10 + k, cap: 100, kind: 'kill', actor: 'bot', at }),
        payStatement(env.DB, { guildId: GUILD, pool: 'the ruins', members: [members[k % 6]], asked: -7, cap: 100, kind: 'adjust', actor: 'x', at }),
      ]);
    const rows = await ledger();
    const sums = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.pool}|${r.member_id}`;
      sums.set(k, (sums.get(k) ?? 0) + r.amount);
      expect(r.balance_after, `row ${r.id}`).toBe(sums.get(k));
      // asked = amount + cut: -7 for each adjustment, the kill's 10 + k for each payout (review of PR A: a real check).
      if (r.kind === 'adjust') expect(r.amount + r.cut).toBe(-7);
      else expect(r.amount + r.cut).toBeGreaterThanOrEqual(10);
      expect(r.cut).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...rows.map((r) => r.balance_after))).toBe(100);
  });

  it('a reversal returns what was actually paid; a re-add is capped against the cap now; bot rows carry actor bot', async () => {
    const at = '2026-10-29T00:00:00Z';
    const raid = await one<{ id: number }>("INSERT INTO dkp_raid (guild_id, pool, mode, opened_by, opened_at, closes_at) VALUES (?, 'the ruins', 'named', 'x', ?, ?) RETURNING id", GUILD, at, at);
    const kill = await one<{ id: number }>("INSERT INTO dkp_kill (raid_id, name, points, guild_points, at, by) VALUES (?, 'Kestrel', 10, 2, ?, 'x') RETURNING id", raid.id, at);
    const [a, b] = ['30000000000000001', '30000000000000002'];
    await env.DB.batch([payStatement(env.DB, { guildId: GUILD, pool: 'the ruins', members: [b], asked: 95, cap: 100, kind: 'adjust', actor: 'x', at })]);
    await env.DB.batch([payStatement(env.DB, { guildId: GUILD, pool: 'the ruins', members: [a, b], asked: 10, cap: 100, kind: 'kill', killId: kill.id, raidId: raid.id, actor: 'bot', at })]);
    await env.DB.batch([reverseStatement(env.DB, { guildId: GUILD, pool: 'the ruins', killId: kill.id, members: [a, b, '30000000000000009'], reason: 'not there', actor: 'bot', at })]);
    // b was paid 5 (capped from 10): the reversal returns 5, with the mirrored cut.
    const rev = await all<{ member_id: string; amount: number; cut: number; balance_after: number; corrects: number }>("SELECT member_id, amount, cut, balance_after, corrects FROM dkp_ledger WHERE kind = 'correction' ORDER BY member_id");
    expect(rev.map((r) => [r.member_id, r.amount, r.cut, r.balance_after])).toEqual([[a, -10, 0, 0], [b, -5, -5, 95]]);
    expect(rev.every((r) => r.corrects > 0)).toBe(true);
    // Re-added: a gets 10; b, at 95, gets 5 (the cap now).
    await env.DB.batch([readdStatement(env.DB, { guildId: GUILD, pool: 'the ruins', killId: kill.id, asked: 10, cap: 100, members: [a, b], reason: 'was there', actor: 'y', at })]);
    const readd = await all<{ amount: number; cut: number; balance_after: number }>("SELECT amount, cut, balance_after FROM dkp_ledger WHERE kind = 'correction' AND amount > 0 ORDER BY member_id");
    expect(readd.map((r) => [r.amount, r.cut, r.balance_after])).toEqual([[10, 0, 10], [5, 5, 100]]);
    expect((await ledger()).filter((l) => l.kind === 'kill').every((l) => l.actor === 'bot')).toBe(true);
  });

  it('is append-only: the database refuses an UPDATE or DELETE of a ledger row', async () => {
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 3, reason: 'x' });
    await expect(env.DB.prepare('UPDATE dkp_ledger SET amount = 99').run()).rejects.toThrow(/append-only/);
    await expect(env.DB.prepare('DELETE FROM dkp_ledger').run()).rejects.toThrow(/append-only/);
    expect(dkpTriggerNames()).toEqual(['dkp_ledger_no_update', 'dkp_ledger_no_delete']);
  });

  it('settings: admins only; each change posted publicly; the runner role, once named, decides who runs DKP', async () => {
    expect((await dkp(officerA, 'settings', { setting: 'cap', value: 50 })).data.content).toBe(ADMIN_ONLY);
    expect((await dkp(admin, 'settings', { setting: 'cap', value: 0 })).data.content).toBe(DKP_COPY.settingRange('Pool cap', 1, 100000));
    expect((await dkp(admin, 'settings', { setting: 'cap', value: 50 })).data.content).toBe(DKP_COPY.settingSaved);
    expect(fake.messages.some((m) => m.body.content?.startsWith('**DKP setting changed:** Pool cap is now 50 points'))).toBe(true);
    const shown = (await dkp(admin, 'settings')).data.content!;
    expect(shown).toContain('Pool cap: **50** points (default 200)');
    const RAID_LEAD = '600000000000000009';
    await dkp(admin, 'settings', { runner_role: RAID_LEAD });
    expect((await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 3, reason: 'x' })).data.content).toBe(DKP_COPY.notRunner);
    expect((await dkp(as('100000000000000007', { roles: [RAID_LEAD] }), 'adjust', { member: X, pool: POOL_GUILD, points: 3, reason: 'x' })).data.content).toBe(DKP_COPY.adjustDone(true));
    // Every setting reads its default when no row holds it.
    expect(settingsOf(null)).toEqual({ ...Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])), runner_role: null });
  });

  it('named-value: officers set a named\'s points in a zone, posted publicly', async () => {
    expect((await dkp(officerA, 'named-value', { zone: 'The Ruins', named: 'Kestrel the Old', points: 15 })).data.content).toBe(DKP_COPY.settingSaved);
    expect(await one('SELECT zone_key, name, points FROM dkp_named_value')).toEqual({ zone_key: 'the ruins', name: 'Kestrel the Old', points: 15 });
    expect(fake.messages.some((m) => m.body.content === DKP_COPY.namedValue('Kestrel the Old', 'The Ruins', 15, `<@${officerA.user.id}> (Global ${officerA.user.id})`))).toBe(true);
  });

  it('Full standings answers privately and pages; the standings message names the top members only', async () => {
    const at = '2026-10-29T00:00:00Z';
    const ids = Array.from({ length: 30 }, (_, i) => `4000000000000${String(i).padStart(4, '0')}`);
    await env.DB.batch(ids.map((id, i) => env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, ?, ?)").bind(GUILD, id, `M${i}`, i === 0 ? 'left' : 'active', at)));
    for (const [i, id] of ids.entries()) await env.DB.batch([payStatement(env.DB, { guildId: GUILD, pool: POOL_GUILD, members: [id], asked: i + 1, cap: 100, kind: 'adjust', actor: 'x', at })]);
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 1, reason: 'x' });
    const msg = fake.messages.find((m) => m.body.embeds?.[0].title === DKP_COPY.standingsTitle(DKP_COPY.guildPool))!;
    expect(msg.body.embeds[0].description.split('\n').filter((l: string) => /^\d+\./.test(l)).length).toBe(STANDINGS_TOP);
    const full = await pressAs(memberX, `${FULL_STANDINGS_PREFIX}${POOL_GUILD}:0`);
    expect(full.data.flags).toBe(64);
    expect(full.data.embeds![0].footer!.text).toBe(DKP_COPY.page(1, 2));
    const next = await pressAs(memberX, `${FULL_PAGE_PREFIX}${POOL_GUILD}:1`);
    expect(next.type).toBe(7);
    // The frozen member ('left') is marked, last with 1 point.
    expect(next.data.embeds![0].description).toContain(`<@${ids[0]}> (M0): **1**${DKP_COPY.frozen}`);
  });
});

describe('timers (ITEM 3): one object per guild, its alarm at the earliest due item', () => {
  it('sets the alarm to the earliest item, coalesces an item to its earlier time, runs only what is due, then re-arms', async () => {
    const stub = timersOf(env, GUILD);
    const t = Date.now();
    await stub.schedule(GUILD, [{ key: 'lapse:1', due: t + 60_000 }, { key: 'lapse:2', due: t + 5_000 }]);
    await stub.schedule(GUILD, [{ key: 'lapse:2', due: t + 9_000 }]); // later: ignored
    expect(await runInDurableObject(stub, (_o, s) => s.storage.getAlarm())).toBe(t + 5_000);
    await stub.schedule(GUILD, [{ key: 'lapse:2', due: t - 1 }]); // earlier: taken
    // An alarm already due may be run by workerd itself before the helper does: either way, the due item runs once.
    await runDurableObjectAlarm(stub);
    await until(async () => JSON.stringify(await stub.list()) === JSON.stringify({ 'lapse:1': t + 60_000 }));
    expect(await stub.list()).toEqual({ 'lapse:1': t + 60_000 });
    expect(await runInDurableObject(stub, (_o, s) => s.storage.getAlarm())).toBe(t + 60_000);
    await stub.cancel();
    expect(await stub.list()).toEqual({});
    expect(await runInDurableObject(stub, (_o, s) => s.storage.getAlarm())).toBe(null);
  });

  it('a lapse is idempotent: run twice, it lapses the approval once and edits its card once', async () => {
    await addDkp();
    await dkp(officerA, 'adjust', { member: X, pool: POOL_GUILD, points: 40, reason: 'x' });
    const p = await one<{ id: number; message_id: string }>('SELECT id, message_id FROM dkp_pending');
    await env.DB.prepare("UPDATE dkp_pending SET due_at = '2000-01-01T00:00:00Z'").run();
    const withToken = { ...env, DISCORD_BOT_TOKEN: 'test-bot-token' } as never;
    const edits = () => fake.calls.filter((c) => c.method === 'PATCH' && c.path.endsWith(`/messages/${p.message_id}`)).length;
    await HANDLERS.lapse(withToken, GUILD, String(p.id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    await HANDLERS.lapse(withToken, GUILD, String(p.id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    expect(await one('SELECT status FROM dkp_pending')).toEqual({ status: 'lapsed' });
    expect(edits()).toBe(1);
    expect(fake.messages.find((m) => m.id === p.message_id)!.body).toMatchObject({ content: DKP_COPY.lapsed, components: [], allowed_mentions: { parse: [] } });
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.notOpen);
    // Through the object's own alarm as well: the item is gone after it runs.
    const stub = timersOf(env, GUILD);
    await stub.schedule(GUILD, [{ key: `lapse:${p.id}`, due: Date.now() - 1 }]);
    await runDurableObjectAlarm(stub);
    await until(async () => Object.keys(await stub.list()).length === 0);
    expect(await stub.list()).toEqual({});
  });
});

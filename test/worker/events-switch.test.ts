// Work order 32, PR A: the Events module's switch, per-module timer removal, re-arming on Add, and settings, in workerd
// against a mocked Discord. Nothing reaches a real server.
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CHANNELS_COPY, storedName } from '../../src/commands/channels.ts';
import { pagesFor } from '../../src/commands/help.ts';
import { DECAY_KEY, DKP_HANDLERS, HANDLERS } from '../../src/dkp/due.ts';
import { ADD_DKP_PREFIX, REMOVE_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { isEventsItem, timersOf } from '../../src/dkp/timers.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { EVENT_COMMAND } from '../../src/events/definition.ts';
import { EVENT_HANDLERS } from '../../src/events/due.ts';
import { eventSettingsOf, validTimeZone } from '../../src/events/settings.ts';
import { ADD_EVENTS_PREFIX, EVENTS_CHANNEL_NAME, REMOVE_EVENTS_PREFIX } from '../../src/events/setup.ts';
import { ADMIN_ONLY, EVENT_PREFIX } from '../../src/interactions.ts';
import { CREATE_PRIVATE_THREADS, GUILD_TEXT, MANAGE_CHANNELS, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL } from '../../src/discord.ts';
import { channelBits, INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, send, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const BOT_ROLE = '600000000000000001';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE] });
const member = as('100000000000000004');

const fake = { channels: [] as any[], messages: [] as { id: string; body: any }[], commands: [] as { id: string; name: string }[], botPerms: INSTALL_PERMISSIONS, next: 1 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(async () => {
  await reset(['Blacksmithing'], [['CLR', 10]]);
  Object.assign(fake, { channels: [], messages: [], commands: [], botPerms: INSTALL_PERMISSIONS, next: 1 });
  await timersOf(env, GUILD).cancel();
  await timersOf(env, GUILD).cancelEvents();
  botApi.handle = (method, path, body) => {
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(fake.botPerms) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === 4 ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null, permission_overwrites: body.permission_overwrites ?? [] };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) {
      const had = fake.commands.find((c) => c.name === body.name);
      if (had) return json(had, 200);
      const c = { id: id(), name: body.name };
      fake.commands.push(c);
      return json(c, 201);
    }
    if (method === 'GET' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) return json(fake.commands);
    const del = path.match(/\/commands\/(\d+)$/);
    if (method === 'DELETE' && del) {
      fake.commands = fake.commands.filter((c) => c.id !== del[1]);
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) {
      const m = { id: id(), body };
      fake.messages.push(m);
      return json({ id: m.id });
    }
    if (method === 'PATCH') return json({ id: '1' });
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
});

const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const addEvents = () => pressAs(admin, ADD_EVENTS_PREFIX);
const removeEvents = () => pressAs(admin, REMOVE_EVENTS_PREFIX);
const channel = () => fake.channels.find((c) => c.name === storedName(EVENTS_CHANNEL_NAME));
const eventCmd = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'event', sub, opts), TOKEN);
const items = () => timersOf(env, GUILD).list();
const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 40 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50));
};
const insertEvent = async (closesAt: string, lockAt: string | null) =>
  (await one<{ id: number }>(
    "INSERT INTO event (guild_id, type, title, start_at, duration_minutes, lock_at, closes_at, status, posted_by, created_at) VALUES (?, 'social', 'Party', ?, 120, ?, ?, 'open', 'u', 'x') RETURNING id",
    GUILD, new Date(Date.now() + 3_600_000).toISOString(), lockAt, closesAt,
  )).id;

describe('Add and Remove Events module (ITEM 1)', () => {
  it('creates the category and GC-Events (everyone reads; only GuildCraft posts) and upserts /event; a second press duplicates nothing', async () => {
    const r = await addEvents();
    const ch = channel();
    expect(r.data.content).toContain(EVENT_COPY.added(ch.id));
    expect(ch).toMatchObject({ type: GUILD_TEXT });
    const ow = (id: string) => ch.permission_overwrites.find((o: any) => o.id === id);
    expect(ow(GUILD)).toEqual({ id: GUILD, type: 0, allow: String(VIEW_CHANNEL | SEND_MESSAGES_IN_THREADS), deny: String(SEND_MESSAGES | CREATE_PRIVATE_THREADS) });
    expect(ow(APP_ID)).toEqual({ id: APP_ID, type: 1, allow: String(channelBits('events')), deny: '0' });
    expect(fake.commands.map((c) => c.name)).toEqual([EVENT_COMMAND.name]);
    expect(await one('SELECT enabled, channel_id, command_id FROM event_guild')).toEqual({ enabled: 1, channel_id: ch.id, command_id: fake.commands[0].id });
    const again = await addEvents();
    expect(again.data.content).toContain(EVENT_COPY.kept(ch.id));
    expect(fake.channels.length).toBe(2);
    expect(fake.commands.length).toBe(1);
  });

  it('shares the GuildCraft category with GC-DKP, and adding no new bit keeps the install link', async () => {
    await pressAs(admin, ADD_DKP_PREFIX);
    await addEvents();
    expect(fake.channels.filter((c) => c.type === 4).length).toBe(1);
    expect(channel().parent_id).toBe(fake.channels.find((c) => c.type === 4).id);
    expect(INSTALL_PERMISSIONS).toBe(9157138795536n);
  });

  it('refuses without Manage Channels, in the same words as Create GuildCraft channels; nothing is created', async () => {
    fake.botPerms = INSTALL_PERMISSIONS & ~MANAGE_CHANNELS;
    expect((await addEvents()).data.content).toBe(CHANNELS_COPY.missing(['Manage Channels']));
    expect(fake.channels).toEqual([]);
  });

  it('is for admins only', async () => {
    expect((await pressAs(officer, ADD_EVENTS_PREFIX)).data.content).toBe(ADMIN_ONLY);
    expect((await pressAs(officer, REMOVE_EVENTS_PREFIX)).data.content).toBe(ADMIN_ONLY);
  });

  it('Remove deletes /event; the channel and every row stay; old cards and /event answer "off"; Add resumes them', async () => {
    await addEvents();
    const id = await insertEvent(new Date(Date.now() + 9e6).toISOString(), null);
    await removeEvents();
    expect(fake.commands).toEqual([]);
    expect(await one('SELECT enabled FROM event_guild')).toEqual({ enabled: 0 });
    expect(await count('event')).toBe(1);
    expect((await pressAs(member, `${EVENT_PREFIX}s:${id}:signed_up`)).data.content).toBe(EVENT_COPY.off);
    expect((await eventCmd(admin, 'settings')).data.content).toBe(EVENT_COPY.off);
    expect((await removeEvents()).data.content).toBe(EVENT_COPY.alreadyOff);
    await addEvents();
    expect(fake.channels.filter((c) => c.name === storedName(EVENTS_CHANNEL_NAME)).length).toBe(1);
    expect(await count('event')).toBe(1);
  });
});

describe('per-module timers (order 32, override 2)', () => {
  it('every Events kind starts "ev", and no DKP kind does', () => {
    expect(Object.keys(EVENT_HANDLERS).filter((k) => !isEventsItem(k))).toEqual([]);
    expect(Object.keys(DKP_HANDLERS).filter(isEventsItem)).toEqual([]);
    expect(Object.keys(HANDLERS).length).toBe(Object.keys(DKP_HANDLERS).length + Object.keys(EVENT_HANDLERS).length);
  });

  it('Remove DKP module leaves an Events lock item in place, and still clears every DKP item', async () => {
    const far = Date.now() + 86_400_000;
    await pressAs(admin, ADD_DKP_PREFIX);
    await timersOf(env, GUILD).schedule(GUILD, [{ key: 'evlock:7', due: far }, { key: 'evcard:7', due: far }, { key: 'lapse:1', due: far }, { key: 'render:2', due: far }, { key: 'auction:3', due: far }]);
    await until(async () => DECAY_KEY in (await items()));
    await pressAs(admin, REMOVE_DKP_PREFIX);
    await until(async () => !('lapse:1' in (await items())));
    expect(Object.keys(await items()).sort()).toEqual(['evcard:7', 'evlock:7']);
    // The alarm stands for what is left.
    await timersOf(env, GUILD).list();
  });

  it('Remove Events module leaves decay:week and DKP items in place, and clears every Events item', async () => {
    const far = Date.now() + 86_400_000;
    await pressAs(admin, ADD_DKP_PREFIX);
    await addEvents();
    await timersOf(env, GUILD).schedule(GUILD, [{ key: 'evlock:7', due: far }, { key: 'evclose:7', due: far }, { key: 'evcard:7', due: far }, { key: 'lapse:1', due: far }, { key: 'render:2', due: far }]);
    await until(async () => DECAY_KEY in (await items()));
    await removeEvents();
    await until(async () => !('evlock:7' in (await items())));
    expect(Object.keys(await items()).sort()).toEqual([DECAY_KEY, 'lapse:1', 'render:2'].sort());
  });

  it('the object re-arms to what is left, so a kept item still runs; a card pace goes with its module', async () => {
    const stub = timersOf(env, GUILD);
    await stub.schedule(GUILD, [{ key: 'lapse:1', due: Date.now() + 1000 }, { key: 'evclose:9', due: Date.now() + 500_000 }]);
    await stub.cancel();
    expect(Object.keys(await stub.list())).toEqual(['evclose:9']);
    await stub.cancel(['evclose:9']);
    expect(await stub.list()).toEqual({});
    expect(await runDurableObjectAlarm(stub)).toBe(false); // no items, no alarm
  });
});

describe('re-arming on Add (section E)', () => {
  it('re-arms each open event\'s lock and close once, however often Add is pressed; a passed close closes at once', async () => {
    await addEvents();
    const later = Date.now() + 7_200_000;
    const open = await insertEvent(new Date(later).toISOString(), new Date(later - 3_600_000).toISOString());
    const done = await insertEvent(new Date(Date.now() - 1000).toISOString(), null);
    const cancelled = await insertEvent(new Date(later).toISOString(), null);
    await env.DB.prepare("UPDATE event SET status = 'cancelled' WHERE id = ?").bind(cancelled).run();
    await removeEvents();
    await addEvents();
    const first = await items();
    expect(first[`evlock:${open}`]).toBe(later - 3_600_000);
    expect(first[`evclose:${open}`]).toBe(later);
    expect(first[`evclose:${cancelled}`]).toBeUndefined();
    await addEvents();
    expect(await items()).toEqual(expect.objectContaining({ [`evclose:${open}`]: later }));
    await until(async () => (await one<{ status: string }>('SELECT status FROM event WHERE id = ?', done)).status === 'closed');
    expect(await one('SELECT status FROM event WHERE id = ?', done)).toEqual({ status: 'closed' });
    expect(await one('SELECT status FROM event WHERE id = ?', open)).toEqual({ status: 'open' });
  });
});

describe('evclose (review of PR A)', () => {
  const run = (id: number, db: D1Database = env.DB) => EVENT_HANDLERS.evclose({ ...env, DB: db } as never, GUILD, String(id), 0, Date.now(), null);

  it('a second run still asks for the card: the first may have died before it could', async () => {
    await addEvents();
    const id = await insertEvent(new Date(Date.now() - 1000).toISOString(), null);
    expect(await run(id)).toMatchObject({ schedule: [{ key: `evcard:${id}` }] });
    expect(await run(id)).toMatchObject({ schedule: [{ key: `evcard:${id}` }] });
  });

  it('a failed run tries again within the hour rather than being dropped', async () => {
    const before = Date.now();
    const r = await run(1, { prepare: () => { throw new Error('D1 down'); } } as unknown as D1Database);
    expect(r!.again).toBeGreaterThanOrEqual(before + 3_600_000);
  });
});

describe('/event settings and the switch\'s help page', () => {
  it('defaults, as section E states them', () => {
    expect(eventSettingsOf(null)).toEqual({
      present_check: 'flag', lock_minutes: 30, close_hours: 8, reminder_minutes: 30, time_zone: 'America/New_York', events_role: null, signup_role: null, support_on: true,
      role_labels: { tank: 'Tank', healer: 'Healer', dps: 'DPS', support: 'Support' }, type_labels: { raid: 'Raid', group: 'Group', social: 'Social', other: 'Other' },
    });
  });

  it('workerd knows IANA zones; an unknown one is refused', async () => {
    expect(validTimeZone('America/New_York')).toBe(true);
    expect(validTimeZone('Mars/Olympus')).toBe(false);
    await addEvents();
    expect((await eventCmd(admin, 'settings', { time_zone: 'Mars/Olympus' })).data.content).toBe(EVENT_COPY.badTimeZone('Mars/Olympus'));
  });

  it('admins only; each change is a row and is posted publicly, pinging nobody; a default is a row\'s absence', async () => {
    await addEvents();
    expect((await eventCmd(officer, 'settings', { lock_minutes: 10 })).data.content).toBe(ADMIN_ONLY);
    const r = await eventCmd(admin, 'settings', { lock_minutes: 10, time_zone: 'Europe/London', role_support: 'Bard', support: false, class: 'CLR', role: 'healer', events_role: OFFICER_ROLE });
    expect(r.data.content).toBe(EVENT_COPY.saved);
    expect(await one("SELECT value FROM event_setting WHERE key = 'lock_minutes'")).toEqual({ value: '10' });
    expect(await one('SELECT class_code, role FROM event_class_role')).toEqual({ class_code: 'CLR', role: 'healer' });
    const m = fake.messages.at(-1)!;
    expect(m.body.allowed_mentions).toEqual({ parse: [] });
    expect(m.body.content).toContain('Europe/London');
    const shown = (await eventCmd(admin, 'settings')).data.content!;
    expect(shown).toContain('Bard');
    expect(shown).toContain('CLR Healer');
    await eventCmd(admin, 'settings', { clear: 'events_role', class: 'CLR', role: 'none' });
    expect(await count('event_setting', "key = 'events_role'")).toBe(0);
    expect(await count('event_class_role')).toBe(0);
  });

  it('class: without role: is refused, and so is a class the game does not have; a class is stored as the game spells it', async () => {
    await addEvents();
    expect((await eventCmd(admin, 'settings', { class: 'CLR' })).data.content).toBe(EVENT_COPY.classNeedsRole);
    expect((await eventCmd(admin, 'settings', { class: 'Nonsense', role: 'tank' })).data.content).toBe(EVENT_COPY.unknownClass('Nonsense'));
    expect(await count('event_class_role')).toBe(0);
    await eventCmd(admin, 'settings', { class: 'clr', role: 'tank' });
    expect(await one('SELECT class_code FROM event_class_role')).toEqual({ class_code: 'CLR' });
  });

  it('an audit row keeps the value before', async () => {
    await addEvents();
    await eventCmd(admin, 'settings', { lock_minutes: 10 });
    const row = await one<{ detail_json: string }>("SELECT detail_json FROM audit_log WHERE action = 'event.setting'");
    expect(JSON.parse(row.detail_json)).toEqual({ before: { value: 30 }, after: { value: '10' } });
  });

  it('a refused upsert on a second Add leaves a running module on', async () => {
    await addEvents();
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'POST' && p.endsWith('/commands') ? json({ message: 'no', code: 0 }, 500) : handle(m, p, b));
    expect((await addEvents()).data.content).toContain(EVENT_COPY.commandFailed(500));
    expect(await one('SELECT enabled FROM event_guild')).toEqual({ enabled: 1 });
  });

  it('the Events help page shows only where the module is on', () => {
    expect(pagesFor(false, false).some((p) => p.key === 'events')).toBe(false);
    expect(pagesFor(false, true).at(-1)!.key).toBe('events');
  });
});

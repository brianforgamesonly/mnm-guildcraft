// Work order 33, PR B: direct messages and reminders (ITEM 2) and Add to calendar (ITEM 3), in workerd against a mocked
// Discord. Nothing reaches a real server.
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import { REMINDERS_PREFIX } from '../../src/commands/me.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { googleLink, icsText, LINK_MAX, type CalendarEvent } from '../../src/events/calendar.ts';
import { CALENDAR_PREFIX } from '../../src/events/card.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { EVENT_COMMAND } from '../../src/events/definition.ts';
import { CALLS_PER_DM, chunkSize, CHUNK_OVERHEAD, LOOKUP_CALLS } from '../../src/events/dm.ts';
import { EVENT_HANDLERS } from '../../src/events/due.ts';
import { POST_PREFIX } from '../../src/events/manage.ts';
import { NO_REMINDERS_PREFIX } from '../../src/events/press.ts';
import { ADD_EVENTS_PREFIX, REMOVE_EVENTS_PREFIX } from '../../src/events/setup.ts';
import { TIMER_CALL_CAP, timerApi } from '../../src/dkp/due.ts';
import { SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, send, webhook, webhookCalls, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const BOT_ROLE = '600000000000000001';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE] });
const member = as('100000000000000004');
const MIN = 60_000;

const fake = {
  channels: [] as any[], messages: [] as { id: string; body: any }[], next: 1,
  dms: [] as { to: string; content: string; body: any }[],
  gone: new Set<string>(), blocked: new Set<string>(), lookups: [] as string[], calls: 0,
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const event = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'event', sub, opts), TOKEN);
const items = () => timersOf(env, GUILD).list();
const inObject = runInDurableObject as unknown as <T>(s: unknown, f: (o: any, st: DurableObjectState) => Promise<T> | T) => Promise<T>;
const stored = (key: string) => inObject<any>(timersOf(env, GUILD), (_o, st) => st.storage.get(key));
const store = (key: string, v: unknown) => inObject(timersOf(env, GUILD), (_o, st) => st.storage.put(key, v));
const alarm = () => inObject(timersOf(env, GUILD), (o) => o.alarm());
const settled = async (key: string) => {
  for (let i = 0; i < 200 && (await stored(key)); i++) await new Promise((r) => setTimeout(r, 50));
  expect(await stored(key)).toBeUndefined();
};
/** The item, due now, through the object, and its later chunks by the object's own alarm. */
const run = async (key: string) => {
  await store(key, { due: Date.now() - 1 });
  await alarm();
  await settled(key);
};
const dmsTo = (who: string) => fake.dms.filter((d) => d.to === who);
const dmRecipients = () => [...new Set(fake.dms.map((d) => d.to))].sort();
const until = async (ok: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50));
};

beforeEach(async () => {
  await reset(['Blacksmithing'], [['CLR', 10]]);
  await env.DB.batch([env.DB.prepare('DELETE FROM zone'), env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow')")]);
  Object.assign(fake, { channels: [], messages: [], next: 1, dms: [], gone: new Set(), blocked: new Set(), lookups: [], calls: 0 });
  await timersOf(env, GUILD).cancel();
  await timersOf(env, GUILD).cancelEvents();
  botApi.handle = (method, path, body) => {
    fake.calls++;
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    const looked = path.match(/\/guilds\/\d+\/members\/(\d+)$/);
    if (method === 'GET' && looked) {
      fake.lookups.push(looked[1]);
      return fake.gone.has(looked[1]) ? json({ message: 'Unknown Member', code: 10007 }, 404) : json({ roles: [] });
    }
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === 4 ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path.endsWith('/commands')) return json({ id: id(), name: body.name }, 201);
    if (method === 'GET' && path.endsWith('/commands')) return json([]);
    if (method === 'POST' && path === '/users/@me/channels') return json({ id: `9${body.recipient_id}` });
    const dm = path.match(/^\/channels\/9(\d{18})\/messages$/);
    if (method === 'POST' && dm) {
      if (fake.blocked.has(dm[1])) return json({ message: 'Cannot send messages to this user', code: 50007 }, 403);
      fake.dms.push({ to: dm[1], content: body.content, body });
      return json({ id: id() });
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
  await pressAs(admin, ADD_EVENTS_PREFIX);
  await inObject(timersOf(env, GUILD), (o) => {
    o.env = { ...o.env, ...TOKEN.env };
  });
  await store('!guild', GUILD); // schedule() sets it; these tests put items in directly
});

const channelId = () => fake.channels.find((c) => c.name === storedName('GC-Events')).id;
/** An open event with a card, starting `startIn` ms from now. */
const openEvent = async (startIn: number, o: { type?: string; lockAt?: number | null; title?: string; capacity?: number } = {}) => {
  const start = new Date(Date.now() + startIn).toISOString();
  const lock = o.lockAt ? new Date(o.lockAt).toISOString() : null;
  const r = await one<{ id: number }>(
    "INSERT INTO event (guild_id, type, title, start_at, duration_minutes, lock_at, closes_at, status, message_id, posted_by, created_at, capacity) VALUES (?, ?, ?, ?, 120, ?, ?, 'open', '7000', 'u', 'x', ?) RETURNING id",
    GUILD, o.type ?? 'raid', o.title ?? 'Test raid', start, lock, new Date(Date.now() + startIn + 8 * 3_600_000).toISOString(), o.capacity ?? null,
  );
  return r.id;
};
const signup = (id: number, m: string, status: string, o: { role?: string | null; char?: string | null; queued?: string } = {}) =>
  env.DB.prepare('INSERT INTO event_signup (event_id, guild_id, member_id, status, role, char_name, char_class, char_level, queued_at, updated_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, GUILD, m, status, o.role === undefined ? 'tank' : o.role, o.char === undefined ? `Char${m.slice(-2)}` : o.char, 'CLR', 30, o.queued ?? null, '2026-10-30T00:00:00.000Z', m)
    .run();
const uid = (n: number) => `1000000000000${String(n).padStart(5, '0')}`;
/** A time in the server's zone, as /event edit takes it. */
const typed = (ms: number) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/New_York' }).slice(0, 16);
const postedRaid = async (start: string) => {
  const r = await event(officer, 'create', { type: 'raid', title: 'Reminder test', zone: 'Glinting Hollow', start });
  const post = r.data.components![0].components[0].custom_id as string;
  await pressAs(officer, post);
  return Number(post.slice(POST_PREFIX.length));
};

describe('ITEM 2: who gets which message', () => {
  it('a reminder goes to Signed up, Tentative and Bench, and to nobody else', async () => {
    const id = await openEvent(20 * MIN);
    for (const [n, s] of [[1, 'signed_up'], [2, 'tentative'], [3, 'bench'], [4, 'waitlist'], [5, 'declined'], [6, 'left'], [7, 'removed']] as const) await signup(id, uid(n), s);
    await run(`evremind:${id}`);
    expect(dmRecipients()).toEqual([uid(1), uid(2), uid(3)]);
    expect(fake.dms[0].content).toContain(`<t:${Math.floor(Date.parse((await one<{ start_at: string }>('SELECT start_at FROM event')).start_at) / 1000)}:F>`);
    expect(fake.dms[0].content).toMatch(/<t:\d+:R>/);
    expect(fake.dms[0].content).toContain(`https://discord.com/channels/${GUILD}/${channelId()}/7000`);
  });

  it('a reminder names the member\'s own character and role, and only theirs; it pings nobody and has no button', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up', { char: 'Aria', role: 'healer' });
    await signup(id, uid(2), 'signed_up', { char: 'Bram', role: 'tank' });
    await run(`evremind:${id}`);
    expect(dmsTo(uid(1))[0].content).toContain("You're down as Aria, Healer.");
    expect(dmsTo(uid(1))[0].content).not.toContain('Bram');
    expect(fake.dms[0].body.allowed_mentions).toEqual({ parse: [] });
    expect(fake.dms[0].body.components).toBeUndefined();
  });

  it('a Social reminder leaves the character and role out', async () => {
    const id = await openEvent(20 * MIN, { type: 'social' });
    await signup(id, uid(1), 'signed_up', { char: null, role: null });
    await run(`evremind:${id}`);
    expect(dmsTo(uid(1))[0].content).not.toContain("You're down as");
  });

  it('a time change goes to everyone on the roster, Waitlist included; the reminder moves with it', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    for (const [n, s] of [[1, 'signed_up'], [2, 'tentative'], [3, 'bench'], [4, 'waitlist'], [5, 'declined'], [6, 'left']] as const) await signup(id, uid(n), s);
    const next = Date.now() + 4 * 3_600_000;
    await event(officer, 'edit', { event: String(id), start: typed(next) });
    const moved = () => fake.dms.filter((d) => d.content.includes('has a new time')).map((d) => d.to).sort();
    await until(() => moved().length === 4);
    expect(moved()).toEqual([uid(1), uid(2), uid(3), uid(4)]);
    const start = Date.parse((await one<{ start_at: string }>('SELECT start_at FROM event')).start_at);
    expect((await items())[`evremind:${id}`]).toBe(start - 30 * MIN);
  });

  it('an edit that leaves the start alone tells nobody', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    await signup(id, uid(1), 'signed_up');
    await event(officer, 'edit', { event: String(id), title: 'New name' });
    expect((await items())[`evmoved:${id}`]).toBeUndefined();
  });

  it('a cancellation goes to the whole roster with its reason, and removes the reminder', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    await signup(id, uid(1), 'signed_up');
    await signup(id, uid(4), 'waitlist');
    expect((await items())[`evremind:${id}`]).toBeDefined();
    await event(officer, 'cancel', { event: String(id), reason: 'test' });
    await until(() => fake.dms.length === 2);
    expect(dmRecipients()).toEqual([uid(1), uid(4)]);
    expect(fake.dms[0].content).toContain('Reason: test');
    expect((await items())[`evremind:${id}`]).toBeUndefined();
  });

  it('a member moved up gets a message, when another member\'s press freed the place; after the lock too', async () => {
    const id = await openEvent(3 * 3_600_000, { capacity: 1, lockAt: Date.now() - MIN });
    await signup(id, member.user.id, 'signed_up');
    await signup(id, uid(14), 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    await pressAs(member, `evs:${id}:declined`);
    await until(() => fake.dms.length === 1);
    expect(dmsTo(uid(14))[0].content).toContain('moved up from the Waitlist');
    expect(dmsTo(member.user.id)).toEqual([]);
  });

  it('a member moved up by their own press gets no message: the private reply says so', async () => {
    const id = await openEvent(3 * 3_600_000);
    await env.DB.prepare('UPDATE event SET limit_tank = 0, limit_healer = 1 WHERE id = ?').bind(id).run();
    await signup(id, member.user.id, 'waitlist', { queued: '2026-10-30T00:00:00.000Z', role: 'tank' });
    const done = await send({ ...press(member, `evrs:${id}`), data: { custom_id: `evrs:${id}`, component_type: 3, values: ['healer'] } } as never, TOKEN);
    expect(done.data.content).toContain('moved up');
    expect(Object.keys(await items()).filter((k) => k.startsWith('evpromo'))).toEqual([]);
  });

  it('a member who moved up but gave the place back hears nothing', async () => {
    const id = await openEvent(3 * 3_600_000);
    await signup(id, uid(1), 'declined');
    await run(`evpromo:${id}.${uid(1)}`);
    expect(fake.dms).toEqual([]);
  });
});

describe('ITEM 2: No reminders stops reminders only', () => {
  it('it stops the reminder, and nothing else reaches past it', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up');
    await signup(id, uid(2), 'signed_up');
    await env.DB.prepare('INSERT INTO event_member (guild_id, member_id, reminders_off) VALUES (?, ?, 1)').bind(GUILD, uid(1)).run();
    await run(`evremind:${id}`);
    expect(dmRecipients()).toEqual([uid(2)]);
    fake.dms = [];
    await run(`evmoved:${id}`);
    await run(`evpromo:${id}.${uid(1)}`);
    await env.DB.prepare("UPDATE event SET status = 'cancelled', cancel_reason = 'x' WHERE id = ?").bind(id).run();
    await run(`evgone:${id}`);
    expect(dmsTo(uid(1)).length).toBe(3);
  });

  it('the first sign-up in the server says so once, with the button; the second doesn\'t', async () => {
    const a = await openEvent(3 * 3_600_000, { type: 'social' });
    const b = await openEvent(3 * 3_600_000, { type: 'social' });
    const first = await pressAs(member, `evs:${a}:signed_up`);
    expect(first.data.content).toContain(EVENT_COPY.reminderNote);
    expect(first.data.components![0].components[0].custom_id).toBe(NO_REMINDERS_PREFIX);
    const second = await pressAs(member, `evs:${b}:signed_up`);
    expect(second.data.content).not.toContain(EVENT_COPY.reminderNote);
  });

  it('Can\'t make it is not a first sign-up', async () => {
    const a = await openEvent(3 * 3_600_000, { type: 'social' });
    const r = await pressAs(member, `evs:${a}:declined`);
    expect(r.data.content).not.toContain(EVENT_COPY.reminderNote);
    expect(await count('event_member')).toBe(0);
  });

  it('with reminders off on the server, the note isn\'t shown', async () => {
    await event(admin, 'settings', { reminder_minutes: 0 });
    const a = await openEvent(3 * 3_600_000, { type: 'social' });
    expect((await pressAs(member, `evs:${a}:signed_up`)).data.content).not.toContain(EVENT_COPY.reminderNote);
  });

  it('No reminders is stored per member, per server, and says what still comes', async () => {
    const r = await pressAs(member, NO_REMINDERS_PREFIX);
    expect(r.data.content).toBe(EVENT_COPY.remindersOff);
    expect(await one('SELECT guild_id, member_id, reminders_off FROM event_member')).toEqual({ guild_id: GUILD, member_id: member.user.id, reminders_off: 1 });
  });

  it('/me has the toggle beside Notices, only while the module is on, and only on one\'s own panel', async () => {
    const labels = async () => (await send(rawCmd(member, 'me', undefined), TOKEN)).data.components!.flatMap((x: any) => x.components.map((b: any) => b.label));
    expect(await labels()).toContain('Reminders: on');
    await pressAs(member, `${REMINDERS_PREFIX}${member.user.id}`);
    expect(await labels()).toContain('Reminders: off');
    expect(await one('SELECT reminders_off FROM event_member')).toEqual({ reminders_off: 1 });
    await pressAs(member, `${REMINDERS_PREFIX}${member.user.id}`);
    expect(await one('SELECT reminders_off FROM event_member')).toEqual({ reminders_off: 0 });
    await pressAs(admin, `${REMINDERS_PREFIX}${member.user.id}`);
    expect(await one('SELECT reminders_off FROM event_member')).toEqual({ reminders_off: 0 });
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    expect((await labels()).filter((l: string) => l.startsWith('Reminders'))).toEqual([]);
  });
});

describe('ITEM 2: chunks', () => {
  it('per-chunk is derived from the alarm\'s cap', () => {
    expect(chunkSize(true)).toBe(Math.floor((TIMER_CALL_CAP - CHUNK_OVERHEAD) / (CALLS_PER_DM + LOOKUP_CALLS)));
    expect(chunkSize(false)).toBe(Math.floor((TIMER_CALL_CAP - CHUNK_OVERHEAD) / CALLS_PER_DM));
    expect(chunkSize(true)).toBe(10);
    expect(chunkSize(false)).toBe(15);
  });

  it('45 recipients take ⌈45 ÷ per-chunk⌉ chunks, in user-id order, and nobody gets two', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 45; n >= 1; n--) await signup(id, uid(n), 'signed_up');
    await run(`evremind:${id}`);
    expect(fake.dms.map((d) => d.to)).toEqual(Array.from({ length: 45 }, (_, i) => uid(i + 1)));
    expect(await count('audit_log', "action = 'event.dm'")).toBe(Math.ceil(45 / chunkSize(true)));
    expect(fake.lookups.length).toBe(45);
  }, 30_000);

  it('a batch of 40 costs 120 Discord calls in 4 chunks: 1 lookup and 2 calls per recipient', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 40; n++) await signup(id, uid(n), 'signed_up');
    fake.calls = 0;
    await run(`evremind:${id}`);
    expect(fake.calls).toBe(120);
    expect(await count('audit_log', "action = 'event.dm'")).toBe(4);
  }, 30_000);

  it('a run that dies part-way carries on after the last message: the cursor is the item\'s', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 12; n++) await signup(id, uid(n), 'signed_up');
    const start = (await one<{ start_at: string }>('SELECT start_at FROM event')).start_at;
    await env.DB.prepare('UPDATE event SET reminded_start = ?').bind(start).run();
    await store(`evremind:${id}`, { due: Date.now() - 1, cursor: `${start}|${uid(5)}` });
    await alarm();
    await settled(`evremind:${id}`);
    expect(fake.dms.map((d) => d.to)).toEqual(Array.from({ length: 7 }, (_, i) => uid(i + 6)));
  }, 30_000);

  it('a transient failure keeps the cursor; the member is tried again, and nobody is skipped', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 3; n++) await signup(id, uid(n), 'signed_up');
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'POST' && p === `/channels/9${uid(2)}/messages` ? json({ message: 'down', code: 0 }, 503) : handle(m, p, b));
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.dms.map((d) => d.to)).toEqual([uid(1)]);
    expect((await stored(`evremind:${id}`)).cursor).toMatch(new RegExp(`\\|${uid(1)}$`));
  });

  it('a refused message is skipped silently and counted', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up');
    await signup(id, uid(2), 'signed_up');
    fake.blocked.add(uid(1));
    await run(`evremind:${id}`);
    expect(dmRecipients()).toEqual([uid(2)]);
    expect(fake.messages.length).toBe(0);
    const a = await one<{ detail_json: string }>("SELECT detail_json FROM audit_log WHERE action = 'event.dm'");
    expect(JSON.parse(a.detail_json).after).toEqual({ kind: 'reminder', sent: 1, refused: 1, failed: 0 });
  });
});

describe('ITEM 2: timing', () => {
  it('a reminder whose time has passed when it is armed is not set: at Post', async () => {
    const id = await postedRaid(typed(Date.now() + 20 * MIN));
    expect((await items())[`evremind:${id}`]).toBeUndefined();
    expect((await items())[`evclose:${id}`]).toBeDefined();
  });

  it('…at an edit, which the time-changed message covers', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    expect((await items())[`evremind:${id}`]).toBeDefined();
    await event(officer, 'edit', { event: String(id), start: typed(Date.now() + 20 * MIN) });
    await until(async () => !(`evremind:${id}` in (await items())));
    expect((await items())[`evremind:${id}`]).toBeUndefined();
  });

  it('…at a settings change: every open event re-arms, and a passed one goes', async () => {
    const soon = await openEvent(20 * MIN);
    const later = await openEvent(3 * 3_600_000);
    await timersOf(env, GUILD).schedule(GUILD, [{ key: `evremind:${soon}`, due: Date.now() + 3_600_000 }]);
    await event(admin, 'settings', { reminder_minutes: 45 });
    await until(async () => !(`evremind:${soon}` in (await items())));
    const start = Date.parse((await one<{ start_at: string }>('SELECT start_at FROM event WHERE id = ?', later)).start_at);
    expect((await items())[`evremind:${later}`]).toBe(start - 45 * MIN);
    expect((await items())[`evremind:${soon}`]).toBeUndefined();
  });

  it('0 removes the reminders; a running handler sends nothing', async () => {
    const id = await openEvent(3 * 3_600_000);
    await signup(id, uid(1), 'signed_up');
    await timersOf(env, GUILD).schedule(GUILD, [{ key: `evremind:${id}`, due: Date.now() + 3_600_000 }]);
    await event(admin, 'settings', { reminder_minutes: 0 });
    await until(async () => !(`evremind:${id}` in (await items())));
    await run(`evremind:${id}`);
    expect(fake.dms).toEqual([]);
  });

  it('at most once per start: a second run sends nothing, a new start gets its own', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up');
    await run(`evremind:${id}`);
    await run(`evremind:${id}`);
    expect(fake.dms.length).toBe(1);
    await env.DB.prepare('UPDATE event SET start_at = ? WHERE id = ?').bind(new Date(Date.now() + 25 * MIN).toISOString(), id).run();
    await run(`evremind:${id}`);
    expect(fake.dms.length).toBe(2);
  });

  it('a start moved later while the item waited runs again at the new time', async () => {
    const id = await openEvent(3 * 3_600_000);
    await signup(id, uid(1), 'signed_up');
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.dms).toEqual([]);
    const start = Date.parse((await one<{ start_at: string }>('SELECT start_at FROM event')).start_at);
    expect((await stored(`evremind:${id}`)).due).toBe(start - 30 * MIN);
  });

  it('Remove Events module leaves no Events items; Add re-arms the reminder', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    await until(async () => Object.keys(await items()).filter((k) => k.startsWith('ev')).length === 0);
    expect(Object.keys(await items()).filter((k) => k.startsWith('ev'))).toEqual([]);
    await pressAs(admin, ADD_EVENTS_PREFIX);
    expect((await items())[`evremind:${id}`]).toBeDefined();
  });

  it('every new kind starts "ev"', () => {
    expect(Object.keys(EVENT_HANDLERS).filter((k) => !k.startsWith('ev'))).toEqual([]);
  });
});

describe('ITEM 2: Left at reminder time', () => {
  it('a recipient who left is marked Left, gets nothing, and the waitlist promotes: that member gets both messages', async () => {
    const id = await openEvent(20 * MIN, { capacity: 1 });
    await signup(id, uid(5), 'signed_up');
    await signup(id, uid(2), 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    fake.gone.add(uid(5));
    await run(`evremind:${id}`);
    await until(async () => dmsTo(uid(2)).length === 2);
    expect(await one('SELECT status FROM event_signup WHERE member_id = ?', uid(5))).toEqual({ status: 'left' });
    expect(await one('SELECT status FROM event_signup WHERE member_id = ?', uid(2))).toEqual({ status: 'signed_up' });
    expect(dmsTo(uid(5))).toEqual([]);
    expect(dmsTo(uid(2)).map((d) => (d.content.startsWith('Reminder') ? 'reminder' : 'promoted')).sort()).toEqual(['promoted', 'reminder']);
    expect(fake.messages.at(-1)!.body.content).toContain('Found by the check at the reminder');
    expect(fake.messages.at(-1)!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('lock and reminder due together: the lock goes first, the reminder makes no second lookup, and a promoted member gets both', async () => {
    const lockAt = Date.now() - 1000;
    const id = await openEvent(30 * MIN - 500, { capacity: 1, lockAt });
    await signup(id, uid(5), 'signed_up');
    await signup(id, uid(6), 'signed_up');
    await signup(id, uid(2), 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    await env.DB.prepare("UPDATE event_signup SET status = 'tentative' WHERE member_id = ?").bind(uid(6)).run();
    fake.gone.add(uid(5));
    const due = Date.now() - 1;
    await store(`evlock:${id}`, { due });
    await store(`evremind:${id}`, { due });
    await alarm();
    await until(async () => !(await stored(`evremind:${id}`)) && dmsTo(uid(2)).length === 2);
    expect(fake.lookups.filter((m) => m === uid(5)).length).toBe(1);
    expect(fake.lookups.filter((m) => m === uid(6)).length).toBe(1);
    expect(dmsTo(uid(2)).length).toBe(2);
    expect(dmsTo(uid(5))).toEqual([]);
    expect(dmsTo(uid(6)).length).toBe(1);
  });

  it('a lock still working holds the reminder back', async () => {
    const id = await openEvent(20 * MIN, { lockAt: Date.now() - 1000 });
    await signup(id, uid(1), 'signed_up');
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.dms).toEqual([]);
    expect((await stored(`evremind:${id}`)).due).toBeGreaterThan(Date.now());
  });
});

describe('ITEM 3: the Google link', () => {
  const base: CalendarEvent = { id: 7, guildId: GUILD, title: 'Test raid', startMs: Date.UTC(2026, 10, 1, 0), durationMinutes: 180, location: 'Glinting Hollow', description: 'Bring food', cardUrl: `https://discord.com/channels/${GUILD}/1234567890123456789/1234567890123456789` };
  const parts = (url: string) => new URL(url).searchParams;

  it('carries the title, start, end, zone and the card', () => {
    const q = parts(googleLink(base));
    expect(q.get('action')).toBe('TEMPLATE');
    expect(q.get('text')).toBe('Test raid');
    expect(q.get('dates')).toBe('20261101T000000Z/20261101T030000Z');
    expect(q.get('location')).toBe('Glinting Hollow');
    expect(q.get('details')).toContain(base.cardUrl);
  });

  it('stays within 512 characters after encoding: a 100-character title and description', () => {
    const url = googleLink({ ...base, title: 'T'.repeat(100), description: 'D'.repeat(100) });
    expect(url.length).toBeLessThanOrEqual(LINK_MAX);
    expect(parts(url).get('text')).toBe('T'.repeat(100));
  });

  it('shortens the description first, then the title, and always keeps the card', () => {
    const long = googleLink({ ...base, title: 'T'.repeat(100), description: 'D'.repeat(1000) });
    expect(long.length).toBeLessThanOrEqual(LINK_MAX);
    expect(parts(long).get('text')).toBe('T'.repeat(100));
    expect(parts(long).get('details')).toContain(base.cardUrl);
    expect(parts(long).get('details')).toContain('…');
    const worst = googleLink({ ...base, title: '日'.repeat(100), description: '語'.repeat(1000) });
    expect(worst.length).toBeLessThanOrEqual(LINK_MAX);
    expect(parts(worst).get('details')).toContain(base.cardUrl);
    expect(parts(worst).get('text')!.length).toBeLessThan(100);
    expect(parts(worst).get('text')!.endsWith('…')).toBe(true);
  });

  it('never splits a character: emoji in a long title still encode', () => {
    const url = googleLink({ ...base, title: '🎉'.repeat(100), description: '🎉'.repeat(500) });
    expect(url.length).toBeLessThanOrEqual(LINK_MAX);
  });

  it('leaves out what an event doesn\'t have', () => {
    const q = parts(googleLink({ ...base, location: null, description: null, cardUrl: null }));
    expect(q.has('location')).toBe(false);
    expect(q.has('details')).toBe(false);
  });
});

describe('ITEM 3: the .ics file (RFC 5545)', () => {
  const base: CalendarEvent = { id: 7, guildId: GUILD, title: 'Test raid', startMs: Date.UTC(2026, 10, 1, 0), durationMinutes: 180, location: 'Glinting Hollow', description: null, cardUrl: 'https://discord.com/channels/1/2/3' };
  const now = Date.UTC(2026, 9, 30, 12);
  const unfold = (s: string) => s.replace(/\r\n[ \t]/g, '');
  const props = (s: string) => unfold(s).split('\r\n').filter(Boolean);

  it('holds every required property, once, in order, with CRLF line endings', () => {
    const text = icsText(base, now);
    expect(text.endsWith('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    const p = props(text);
    expect(p[0]).toBe('BEGIN:VCALENDAR');
    expect(p.at(-1)).toBe('END:VCALENDAR');
    for (const required of ['VERSION:2.0', 'METHOD:PUBLISH', `UID:ev-7-${GUILD}@guildcraft`, 'DTSTAMP:20261030T120000Z', 'DTSTART:20261101T000000Z', 'DTEND:20261101T030000Z', 'SUMMARY:Test raid', 'LOCATION:Glinting Hollow', 'URL:https://discord.com/channels/1/2/3', 'BEGIN:VEVENT', 'END:VEVENT']) {
      expect(p.filter((l) => l === required).length, required).toBe(1);
    }
    expect(p.filter((l) => l.startsWith('PRODID:')).length).toBe(1);
  });

  it('escapes backslash, semicolon, comma and newline', () => {
    const p = props(icsText({ ...base, title: 'A, B; C\\D\nE' }, now));
    expect(p).toContain('SUMMARY:A\\, B\\; C\\\\D\\nE');
  });

  it('folds at 75 octets, counting bytes, and never inside a character', () => {
    const title = '語'.repeat(100);
    const text = icsText({ ...base, title }, now);
    const bytes = new TextEncoder();
    for (const line of text.split('\r\n')) expect(bytes.encode(line).length, line).toBeLessThanOrEqual(75);
    expect(text).not.toContain('\uFFFD');
    expect(props(text)).toContain(`SUMMARY:${title}`);
  });

  it('times are UTC, across the daylight-saving week', () => {
    const before = Date.UTC(2026, 10, 1, 0); // 20:00 EDT on 31 October
    const after = Date.UTC(2026, 10, 2, 1); // 20:00 EST on 1 November
    expect(props(icsText({ ...base, startMs: before }, now))).toContain('DTSTART:20261101T000000Z');
    expect(props(icsText({ ...base, startMs: after }, now))).toContain('DTSTART:20261102T010000Z');
    expect(props(icsText({ ...base, startMs: after }, now))).toContain('DTEND:20261102T040000Z');
    const crossing = Date.UTC(2026, 10, 1, 5); // an event running through the change
    expect(props(icsText({ ...base, startMs: crossing }, now))).toContain('DTEND:20261101T080000Z');
  });
});

describe('ITEM 3: the button', () => {
  it('every card has it, and any member\'s press answers privately, with the link button and the file', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    const labels = fake.messages[0].body.components.flatMap((r: any) => r.components.map((b: any) => b.label));
    expect(labels).toContain(EVENT_COPY.addToCalendar);
    webhookCalls.length = 0;
    const r = await pressAs(member, `${CALENDAR_PREFIX}${id}`);
    expect(r.data.flags).toBe(64);
    const link = r.data.components![0].components[0];
    expect(link).toMatchObject({ style: 5, label: EVENT_COPY.googleCalendar });
    expect(link.url.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE')).toBe(true);
    const call = webhookCalls.at(-1)!;
    expect(call.body.flags).toBe(64);
    expect(call.body.attachments).toEqual([{ id: 0, filename: `event-${id}.ics` }]);
    expect(call.body.uploaded[0]).toMatchObject({ name: `event-${id}.ics` });
    expect(call.body.uploaded[0].type).toContain('text/calendar');
    expect(call.body.uploaded[0].text).toContain('LOCATION:Glinting Hollow');
    expect(call.body.noFiles).toBeUndefined();
    expect(fake.messages.length).toBe(1); // nothing public
  });

  it('if Discord refuses the file, the private reply still goes, with the link and without the file', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    webhookCalls.length = 0;
    webhook.status = (c) => (c.body?.uploaded ? 403 : 200);
    const r = await pressAs(member, `${CALENDAR_PREFIX}${id}`);
    webhook.reset();
    expect(webhookCalls.length).toBe(2);
    const last = webhookCalls.at(-1)!;
    expect(last.body.uploaded).toBeUndefined();
    expect(last.body.flags).toBe(64);
    expect(last.body.content).toContain("couldn't attach");
    expect(last.body.components[0].components[0].style).toBe(5);
    expect(r.data.flags).toBe(64);
  });

  it('a card closed or cancelled since answers so', async () => {
    const id = await openEvent(3 * 3_600_000);
    await env.DB.prepare("UPDATE event SET status = 'cancelled' WHERE id = ?").bind(id).run();
    expect((await pressAs(member, `${CALENDAR_PREFIX}${id}`)).data.content).toBe(EVENT_COPY.isCancelled);
  });

  it('the setting is registered, with its zero stated', () => {
    const settings = EVENT_COMMAND.options.find((o) => o.name === 'settings')! as unknown as { options: { name: string; description: string }[] };
    expect(settings.options.find((o) => o.name === 'reminder_minutes')!.description).toContain('0: off');
    expect(settings.options.length).toBeLessThanOrEqual(25);
  });

  it('the reply itself shows no UTC: only the file and the link\'s dates carry it', async () => {
    const id = await postedRaid(typed(Date.now() + 3 * 3_600_000));
    expect((await pressAs(member, `${CALENDAR_PREFIX}${id}`)).data.content).not.toContain('UTC');
  });
});

describe('review of PR B: what lands during a run', () => {
  /** Runs `during` at the moment a direct message is sent, on the object itself, as a press landing mid-run would. */
  const whileSending = async (key: string, during: (o: any) => Promise<void>) => {
    const handle = botApi.handle!;
    let done = false;
    await store(key, { due: Date.now() - 1 });
    await inObject(timersOf(env, GUILD), async (o) => {
      botApi.handle = async (m, p, b) => {
        if (!done && m === 'POST' && /^\/channels\/9/.test(p)) {
          done = true;
          await during(o);
        }
        return handle(m, p, b);
      };
      await o.alarm();
    });
    botApi.handle = handle;
  };

  it('a new start landing during the last chunk keeps its reminder item', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up');
    const key = `evremind:${id}`;
    const far = Date.now() + 3_600_000;
    await whileSending(key, (o) => o.schedule(GUILD, [{ key, due: far, later: true }]));
    expect((await stored(key)).due).toBeGreaterThanOrEqual(far);
    expect((await stored(key)).cursor).toBeUndefined();
  });

  it('a second move during a time-changed walk still tells the roster', async () => {
    const id = await openEvent(3 * 3_600_000);
    await signup(id, uid(1), 'signed_up');
    const key = `evmoved:${id}`;
    const soon = Date.now() + 50;
    await whileSending(key, (o) => o.schedule(GUILD, [{ key, due: soon, later: true }]));
    await settled(key);
    expect(dmsTo(uid(1)).length).toBe(2);
  });

  it('a cancel landing during a run stays cancelled: the item doesn\'t come back', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 12; n++) await signup(id, uid(n), 'signed_up');
    const key = `evremind:${id}`;
    await whileSending(key, (o) => o.cancel([key]));
    expect(await stored(key)).toBeUndefined();
  });

  it('a change to the reminder setting leaves a walk in progress to finish', async () => {
    const id = await openEvent(20 * MIN);
    const start = (await one<{ start_at: string }>('SELECT start_at FROM event')).start_at;
    await env.DB.prepare('UPDATE event SET reminded_start = ?').bind(start).run();
    const far = Date.now() + 3_600_000;
    await store(`evremind:${id}`, { due: far, cursor: `${start}|${uid(5)}` });
    await event(admin, 'settings', { reminder_minutes: 25 });
    await new Promise((r) => setTimeout(r, 100));
    expect((await stored(`evremind:${id}`)).cursor).toContain(uid(5));
  });

  it('a run that died after the cursor and before the claim claims now, and still sends', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up');
    const start = (await one<{ start_at: string }>('SELECT start_at FROM event')).start_at;
    await store(`evremind:${id}`, { due: Date.now() - 1, cursor: `${start}|` });
    await alarm();
    expect(dmRecipients()).toEqual([uid(1)]);
    expect(await one('SELECT reminded_start FROM event')).toEqual({ reminded_start: start });
  });

  it('a lock that never finishes holds the reminder only so long', async () => {
    const id = await openEvent(20 * MIN, { lockAt: Date.now() - 3 * MIN });
    await signup(id, uid(1), 'signed_up');
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(dmRecipients()).toEqual([uid(1)]);
    expect(fake.lookups).toEqual([uid(1)]);
  });

  it('a lookup Discord won\'t answer costs nobody their reminder, and marks nobody Left', async () => {
    const id = await openEvent(20 * MIN);
    await signup(id, uid(1), 'signed_up');
    await signup(id, uid(2), 'signed_up');
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'GET' && p.endsWith(`/members/${uid(1)}`) ? json({ message: 'no', code: 0 }, 500) : handle(m, p, b));
    await run(`evremind:${id}`);
    expect(dmRecipients()).toEqual([uid(1), uid(2)]);
    expect(await one("SELECT count(*) AS n FROM event_signup WHERE status = 'left'")).toEqual({ n: 0 });
  });

  it('what a Left commit owes is asked for at once, not with the run\'s result', async () => {
    const id = await openEvent(20 * MIN, { capacity: 1 });
    await signup(id, uid(5), 'signed_up');
    await signup(id, uid(2), 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    fake.gone.add(uid(5));
    const asked: string[] = [];
    const e = { ...env, ...TOKEN.env };
    const api = timerApi(e as never, Date.now(), () => 0);
    await expect(EVENT_HANDLERS.evremind(e as never, GUILD, String(id), 0, Date.now(), api, { save: async () => {}, schedule: async (i) => void asked.push(...i.map((x) => x.key)) })).resolves.toBeDefined();
    expect(asked).toEqual([`evcard:${id}`, `evpromo:${id}.${uid(2)}`]);
  });

  it('an officer moved up by their own /event roster gets the message: its reply doesn\'t say so', async () => {
    const id = await openEvent(3 * 3_600_000, { capacity: 1 });
    await signup(id, uid(1), 'signed_up');
    await signup(id, officer.user.id, 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    await event(officer, 'roster', { event: String(id), action: 'remove', member: uid(1), reason: 'test' });
    await until(() => dmsTo(officer.user.id).length === 1);
    expect(dmsTo(officer.user.id)[0].content).toContain('moved up');
  });

  it('a chunk that shares its alarm shrinks, and the rest follow', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 3; n++) await signup(id, uid(n), 'signed_up');
    const e = { ...env, ...TOKEN.env };
    const api = timerApi(e as never, Date.now(), () => 0)!;
    api.budget.discord = TIMER_CALL_CAP - 11; // room for 2 recipients after the chunk's tail
    const r = await EVENT_HANDLERS.evremind(e as never, GUILD, String(id), 0, Date.now(), api, { save: async () => {} });
    expect(fake.dms.length).toBe(2);
    expect(r!.again).toBeDefined();
  });
});

// Work order 34, PR A: the link between a raid and an event (ITEM 1), the Present check and the Bench (ITEM 2), and order 33's
// three gaps (ITEM 4), in workerd against a mocked Discord. Nothing reaches a real server.
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import { autocomplete } from '../../src/commands/autocomplete.ts';
import { APPROVE_PREFIX } from '../../src/dkp/commands.ts';
import { RAID_COPY } from '../../src/dkp/copy.ts';
import { HANDLERS, TIMER_CALL_CAP, timerApi } from '../../src/dkp/due.ts';
import { CLOSE_PREFIX, LEAVING_PREFIX, PRESENT_PREFIX, STANDBY_PREFIX, WHO_HERE_PREFIX } from '../../src/dkp/raid.ts';
import { ADD_DKP_PREFIX, REMOVE_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { sweepStale } from '../../src/dkp/stale.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { CALLS_PER_DM, chunkSize, CHUNK_OVERHEAD, LOOKUP_CALLS, RECHECK_CALLS } from '../../src/events/dm.ts';
import { onRoster, presentVerdict } from '../../src/events/eligible.ts';
import { matchEvents } from '../../src/events/link.ts';
import { ADD_EVENTS_PREFIX, REMOVE_EVENTS_PREFIX } from '../../src/events/setup.ts';
import { SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, send, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const withToken = { ...env, DISCORD_BOT_TOKEN: 'test-bot-token' } as never;
const OFFICER_ROLE = '600000000000000002';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE], global_name: 'Officer' });
const officerB = as('100000000000000003', { roles: [OFFICER_ROLE], global_name: 'OfficerB' });
const kestrel = as('100000000000000004', { global_name: 'Kestrel' });
const pip = as('100000000000000005', { global_name: 'Pip' });
const MIN = 60_000;
const ZONE = 'glinting hollow';

interface Msg { id: string; channel: string; body: any }
const fake = { channels: [] as any[], messages: [] as Msg[], dms: [] as { to: string; content: string }[], calls: [] as { method: string; path: string }[], next: 1, refuse: null as null | ((m: string, p: string) => Response | null) };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });

const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const dkp = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'dkp', sub, opts), TOKEN);
const event = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'event', sub, opts), TOKEN);
const inObject = runInDurableObject as unknown as <T>(s: unknown, f: (o: any, st: DurableObjectState) => Promise<T> | T) => Promise<T>;
const stored = (key: string) => inObject<any>(timersOf(env, GUILD), (_o, st) => st.storage.get(key));
const store = (key: string, v: unknown) => inObject(timersOf(env, GUILD), (_o, st) => st.storage.put(key, v));
const alarm = () => inObject(timersOf(env, GUILD), (o) => o.alarm());
const items = () => timersOf(env, GUILD).list();
const uid = (n: number) => `1000000000000${String(n).padStart(5, '0')}`;

beforeEach(async () => {
  await reset(['Blacksmithing'], [['CLR', 10]]);
  await env.DB.batch([env.DB.prepare('DELETE FROM zone'), env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow'), ('the ruins', 'The Ruins')")]);
  Object.assign(fake, { channels: [], messages: [], dms: [], calls: [], next: 1, refuse: null });
  await timersOf(env, GUILD).cancel();
  await timersOf(env, GUILD).cancelEvents();
  botApi.handle = (method, path, body) => {
    fake.calls.push({ method, path });
    const refused = fake.refuse?.(method, path);
    if (refused) return refused;
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: 'botrole', permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: ['botrole'] });
    if (method === 'GET' && /\/guilds\/\d+\/members\/\d+$/.test(path)) return json({ roles: [] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === 4 ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path.endsWith('/commands')) return json({ id: id(), name: body.name }, 201);
    if (method === 'GET' && path.endsWith('/commands')) return json([]);
    if (method === 'DELETE' && path.includes('/commands/')) return new Response(null, { status: 204 });
    if (method === 'POST' && path === '/users/@me/channels') return json({ id: `9${body.recipient_id}` });
    const dm = path.match(/^\/channels\/9(\d{18})\/messages$/);
    if (method === 'POST' && dm) {
      fake.dms.push({ to: dm[1], content: body.content });
      return json({ id: id() });
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
      return new Response(JSON.stringify({ id: m.id }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '4', 'X-RateLimit-Reset-After': '5.000' } });
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
  await pressAs(admin, ADD_DKP_PREFIX);
  await pressAs(admin, ADD_EVENTS_PREFIX);
  await inObject(timersOf(env, GUILD), (o) => {
    o.env = { ...o.env, ...TOKEN.env };
  });
  await store('!guild', GUILD);
});

const eventsChannel = () => fake.channels.find((c) => c.name === storedName('GC-Events')).id as string;
const raidRow = () => one<{ id: number; message_id: string; event_id: number | null }>('SELECT id, message_id, event_id FROM dkp_raid ORDER BY id DESC LIMIT 1');
/** An open event with a card in the fake channel. */
const openEvent = async (startIn: number, o: { type?: string; title?: string; zone?: string | null } = {}) => {
  const body = { embeds: [{ title: 'card' }] };
  const m = { id: `8000${String(fake.next++).padStart(14, '0')}`, channel: eventsChannel(), body };
  fake.messages.push(m);
  const r = await one<{ id: number }>(
    "INSERT INTO event (guild_id, type, title, start_at, duration_minutes, zone_key, closes_at, status, message_id, posted_by, created_at) VALUES (?, ?, ?, ?, 120, ?, ?, 'open', ?, 'u', 'x') RETURNING id",
    GUILD, o.type ?? 'raid', o.title ?? 'Test raid', new Date(Date.now() + startIn).toISOString(), o.zone === undefined ? ZONE : o.zone, new Date(Date.now() + startIn + 8 * 3_600_000).toISOString(), m.id,
  );
  return r.id;
};
const signup = (id: number, m: string, status: string, o: { queued?: string } = {}) =>
  env.DB.prepare('INSERT INTO event_signup (event_id, guild_id, member_id, status, role, char_name, char_class, char_level, queued_at, updated_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, GUILD, m, status, 'tank', `Char${m.slice(-2)}`, 'CLR', 30, o.queued ?? null, '2026-10-30T00:00:00.000Z', m)
    .run();
const addCharacter = async (m: Member) => {
  const at = '2026-10-30T00:00:00.000Z';
  await env.DB.batch([
    env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, 'M', 'active', ?) ON CONFLICT DO NOTHING").bind(GUILD, m.user.id, at),
    env.DB.prepare('INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').bind(GUILD, m.user.id, 'Aelin', 'aelin', 'CLR', 30, at, at),
  ]);
};
const openRaid = (opts: Record<string, unknown> = {}) => dkp(officer, 'raid', { zone: 'Glinting Hollow', ...opts });
const raidCard = async () => {
  const r = await raidRow();
  await HANDLERS.render(withToken, GUILD, String(r.id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
  return fake.messages.find((m) => m.id === r.message_id)!.body.embeds[0].description as string;
};
const setCheck = (v: string) => event(admin, 'settings', { present_check: v });
const eventCard = async (id: number) => {
  await HANDLERS.evcard(withToken, GUILD, String(id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
  const { message_id } = await one<{ message_id: string }>('SELECT message_id FROM event WHERE id = ?', id);
  return fake.messages.find((m) => m.id === message_id)!.body;
};

describe('ITEM 1: linking', () => {
  it('one event in the window links, and the reply and the card name it', async () => {
    const id = await openEvent(30 * MIN);
    const r = await openRaid();
    expect((await raidRow()).event_id).toBe(id);
    expect(r.data.content).toContain('Linked to **Test raid**');
    expect(r.data.content).toMatch(/<t:\d+:t>/);
    expect(await raidCard()).toContain(`Event: [Test raid](https://discord.com/channels/${GUILD}/${eventsChannel()}/`);
  });

  it('none in the window: it opens unlinked, and says why', async () => {
    await openEvent(90 * MIN);
    const r = await openRaid();
    expect((await raidRow()).event_id).toBeNull();
    expect(r.data.content).toContain(RAID_COPY.notLinkedNone);
    expect(await raidCard()).not.toContain('Event:');
  });

  it('two fit: it opens unlinked without the option; the option picks one', async () => {
    const a = await openEvent(10 * MIN, { title: 'A' });
    await openEvent(20 * MIN, { title: 'B' });
    const r = await openRaid();
    expect((await raidRow()).event_id).toBeNull();
    expect(r.data.content).toContain(RAID_COPY.notLinkedSeveral(2));
    const { id } = await raidRow();
    await pressAs(officer, `${CLOSE_PREFIX}${id}`);
    await openRaid({ event: String(a) });
    expect((await raidRow()).event_id).toBe(a);
  });

  it('the option overrides the match: another zone, or outside the window, is linked when picked', async () => {
    await openEvent(10 * MIN, { title: 'Here' });
    const far = await openEvent(5 * 3_600_000, { title: 'Far', zone: 'the ruins' });
    await openRaid({ event: String(far) });
    expect((await raidRow()).event_id).toBe(far);
  });

  it('a raid card Discord refuses leaves the event linkable by the next /dkp raid', async () => {
    const id = await openEvent(10 * MIN);
    fake.refuse = (m, p) => (m === 'POST' && /^\/channels\/\d+\/messages$/.test(p) ? json({ message: 'down', code: 0 }, 500) : null);
    expect((await openRaid()).data.content).toBe(RAID_COPY.cannotPost);
    expect((await raidRow()).event_id).toBeNull();
    fake.refuse = null;
    expect((await openRaid()).data.content).toContain('Linked to');
    expect((await raidRow()).event_id).toBe(id);
  });

  it('an event still being posted has no card yet, and is not linked', async () => {
    const id = await openEvent(10 * MIN);
    await env.DB.prepare('UPDATE event SET message_id = NULL WHERE id = ?').bind(id).run();
    await openRaid();
    expect((await raidRow()).event_id).toBeNull();
  });

  it('a raid outliving its cancelled event leaves the event card alone at close', async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    const { id: raid } = await raidRow();
    await event(officer, 'cancel', { event: String(id), reason: 'nope' });
    await timersOf(env, GUILD).cancel([`evcard:${id}`, `evgone:${id}`]);
    await pressAs(officer, `${CLOSE_PREFIX}${raid}`);
    expect((await items())[`evcard:${id}`]).toBeUndefined();
    expect(await count('card_stale')).toBe(0);
    expect(await one('SELECT status FROM event WHERE id = ?', id)).toEqual({ status: 'cancelled' });
  });

  it('an option naming nothing linkable opens no raid', async () => {
    const r = await openRaid({ event: 'not an event' });
    expect(r.data.content).toBe(RAID_COPY.notLinkable);
    expect(await count('dkp_raid')).toBe(0);
  });

  it('a Group event and another zone never match; an event with no zone does', async () => {
    await openEvent(10 * MIN, { type: 'group' });
    await openEvent(10 * MIN, { zone: 'the ruins' });
    await openRaid();
    expect((await raidRow()).event_id).toBeNull();
    const { id } = await raidRow();
    await pressAs(officer, `${CLOSE_PREFIX}${id}`);
    const none = await openEvent(10 * MIN, { zone: null });
    await openRaid();
    expect((await raidRow()).event_id).toBe(none);
  });

  it('an event created after its raid opened is not linked to it', async () => {
    await openRaid();
    await openEvent(10 * MIN);
    await pressAs(kestrel, `${PRESENT_PREFIX}${(await raidRow()).id}`);
    expect((await raidRow()).event_id).toBeNull();
  });

  it('the window holds at both edges, across midnight and across the autumn clock change, compared in UTC', async () => {
    const at = async (iso: string, id: number) => env.DB.prepare('UPDATE event SET start_at = ? WHERE id = ?').bind(iso, id).run();
    const id = await openEvent(0);
    const fits = async (now: string) => (await matchEvents(env.DB, GUILD, ZONE, Date.parse(now))).map((e) => e.id);
    await at('2026-10-31T20:00:00.000Z', id);
    expect(await fits('2026-10-31T19:00:00.000Z')).toEqual([id]);
    expect(await fits('2026-10-31T21:00:00.000Z')).toEqual([id]);
    expect(await fits('2026-10-31T18:59:59.000Z')).toEqual([]);
    expect(await fits('2026-10-31T21:00:01.000Z')).toEqual([]);
    // Across midnight in New York: 23:50 on the 30th, and 00:30 on the 31st.
    await at('2026-10-31T03:50:00.000Z', id);
    expect(await fits('2026-10-31T04:30:00.000Z')).toEqual([id]);
    // Clocks go back at 2:00 EDT on 2026-11-01 (06:00 UTC). 1:30 EDT is 05:30 UTC; 1:20 EST, 50 minutes on, is 06:20 UTC.
    await at('2026-11-01T05:30:00.000Z', id);
    expect(await fits('2026-11-01T06:20:00.000Z')).toEqual([id]);
    // 12:30 EDT, by the wall clock 50 minutes before 1:20 EST, is really 110 minutes before it.
    await at('2026-11-01T04:30:00.000Z', id);
    expect(await fits('2026-11-01T06:20:00.000Z')).toEqual([]);
  });

  it('cancelling the event unlinks it: the raid carries on, the card says so, and nobody is checked', async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    const { id: raid } = await raidRow();
    await setCheck('require');
    await event(officer, 'cancel', { event: String(id), reason: 'nope' });
    expect((await items())[`render:${raid}`]).toBeDefined();
    expect(await raidCard()).toContain(RAID_COPY.eventCancelled('Test raid'));
    const r = await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    expect(r.data.content).toBe(RAID_COPY.youPresent);
    expect(await raidCard()).not.toContain(RAID_COPY.notSignedUp);
  });

  it('closing the raid closes the event, and asks for its card', async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    await pressAs(officer, `${CLOSE_PREFIX}${(await raidRow()).id}`);
    expect(await one('SELECT status FROM event WHERE id = ?', id)).toEqual({ status: 'closed' });
    expect((await items())[`evcard:${id}`]).toBeDefined();
    expect((await eventCard(id)).components).toEqual([]);
  });

  it('the auto-close closes the event too', async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    const { id: raid } = await raidRow();
    await env.DB.prepare('UPDATE dkp_raid SET closes_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), raid).run();
    const r = await HANDLERS.close(withToken, GUILD, String(raid), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    expect(r?.schedule?.[0].key).toBe(`evcard:${id}`);
    expect(await one('SELECT status FROM event WHERE id = ?', id)).toEqual({ status: 'closed' });
  });

  it('removing the DKP module closes the raid, so the event closes too', async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    await pressAs(admin, REMOVE_DKP_PREFIX);
    expect(await one('SELECT status FROM event WHERE id = ?', id)).toEqual({ status: 'closed' });
    expect((await items())[`evcard:${id}`]).toBeDefined();
  });

  it('a raid with no link and an event that closed first: closing changes nothing else', async () => {
    const id = await openEvent(10 * MIN);
    await env.DB.prepare("UPDATE event SET status = 'closed' WHERE id = ?").bind(id).run();
    await openRaid();
    expect((await raidRow()).event_id).toBeNull();
    await pressAs(officer, `${CLOSE_PREFIX}${(await raidRow()).id}`);
    expect(await count('card_stale')).toBe(0);
  });

  it('a raid opened before either module was on behaves as today: no line, no check, no reply about events', async () => {
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    await openEvent(10 * MIN);
    const r = await openRaid();
    expect(r.data.content).not.toContain('event');
    expect(r.data.content).not.toContain('Event');
    const { id, event_id } = await raidRow();
    expect(event_id).toBeNull();
    const before = fake.calls.length;
    const tap = await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    expect(tap.data.content).toBe(RAID_COPY.youPresent);
    expect(fake.calls.length).toBe(before);
    expect(await raidCard()).not.toContain('Event:');
  });

  it('an event: option with the Events module off is refused', async () => {
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    expect((await openRaid({ event: '1' })).data.content).toBe(EVENT_COPY.off);
    expect(await count('dkp_raid')).toBe(0);
  });

  it('Events removed while a raid is linked: the raid goes on unchecked; its close closes the event, and Add brings the card back', async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    const { id: raid } = await raidRow();
    await setCheck('require');
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.youPresent);
    const card = await raidCard();
    expect(card).not.toContain('Event:');
    expect(card).not.toContain(RAID_COPY.notSignedUp);
    await pressAs(officer, `${CLOSE_PREFIX}${raid}`);
    expect(await one('SELECT status FROM event WHERE id = ?', id)).toEqual({ status: 'closed' });
    // The flag waits: while the module is off the sweep doesn't see it, and after Add it does.
    expect(await all('SELECT item FROM card_stale')).toEqual([{ item: `evcard:${id}` }]);
    const asked: string[] = [];
    const seen = async () => {
      asked.length = 0;
      await sweepStale(env, (ids) => {
        asked.push(...ids);
        return [];
      });
      return asked;
    };
    expect(await seen()).toEqual([]);
    await pressAs(admin, ADD_EVENTS_PREFIX);
    expect(await seen()).toEqual([GUILD]);
  });

  it('the event list offers open Raid events not already linked, in the server time zone, at most 25', async () => {
    const linked = await openEvent(10 * MIN, { title: 'Taken' });
    await openRaid();
    expect((await raidRow()).event_id).toBe(linked);
    await openEvent(120 * MIN, { title: 'Free' });
    await openEvent(120 * MIN, { title: 'A group', type: 'group' });
    for (let n = 0; n < 30; n++) await openEvent(180 * MIN, { title: `Later ${n}` });
    const list = await autocomplete(env.DB, {
      guild_id: GUILD, member: officer, data: { name: 'dkp', options: [{ type: 1, name: 'raid', options: [{ type: 3, name: 'event', value: '', focused: true }] }] },
    } as never);
    expect(list.length).toBe(25);
    expect(list[0].name).toMatch(/^Free · .* (EDT|EST)$/);
    expect(list.map((c) => c.name).join()).not.toMatch(/Taken|A group/);
  });
});

describe('ITEM 2: the Present check', () => {
  const linkedRaid = async () => {
    const id = await openEvent(10 * MIN);
    await openRaid();
    return { event: id, raid: (await raidRow()).id };
  };

  it('Flag, the default: the tap counts, the card and Who\'s here mark the member, and they are told', async () => {
    const { raid } = await linkedRaid();
    const r = await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    expect(r.data.content).toContain(RAID_COPY.youPresent);
    expect(r.data.content).toContain(RAID_COPY.tapFlagged('Test raid'));
    expect(await one('SELECT state FROM dkp_attendance WHERE member_id = ?', kestrel.user.id)).toEqual({ state: 'present' });
    expect(await raidCard()).toContain(`Kestrel${RAID_COPY.notSignedUp}`);
    expect((await pressAs(officer, `${WHO_HERE_PREFIX}${raid}`)).data.content).toContain(RAID_COPY.notSignedUp);
  });

  it('Require: a tap from someone not on the roster is refused, officers included; Leaving never is', async () => {
    const { raid } = await linkedRaid();
    await setCheck('require');
    for (const prefix of [PRESENT_PREFIX, STANDBY_PREFIX]) expect((await pressAs(kestrel, `${prefix}${raid}`)).data.content).toBe(RAID_COPY.tapRefused('Test raid'));
    expect((await pressAs(officer, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.tapRefused('Test raid'));
    expect(await count('dkp_attendance')).toBe(0);
    expect((await pressAs(kestrel, `${LEAVING_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.youLeft);
  });

  it('Off: no check and no mark', async () => {
    const { raid } = await linkedRaid();
    await setCheck('off');
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.youPresent);
    expect(await raidCard()).not.toContain(RAID_COPY.notSignedUp);
  });

  it.each([
    ['signed_up', true], ['tentative', true], ['bench', true], ['waitlist', true], ['declined', false], ['left', false], ['removed', false],
  ])('status %s: on the roster is %s', async (status, on) => {
    expect(onRoster(status as never)).toBe(on);
    const { event: id, raid } = await linkedRaid();
    await setCheck('require');
    await signup(id, kestrel.user.id, status);
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(on ? RAID_COPY.youPresent : RAID_COPY.tapRefused('Test raid'));
  });

  it('no sign-up at all is not on the roster', () => {
    expect(presentVerdict({ check: 'require', status: null, eventOpen: true, leaving: false })).toBe('refused');
  });

  it('a closed event refuses nobody: no officer could add them, so they are only marked', () => {
    expect(presentVerdict({ check: 'require', status: null, eventOpen: false, leaving: false })).toBe('flag');
  });

  it('a late sign-up is picked up at the next tap, and the mark goes', async () => {
    const { event: id, raid } = await linkedRaid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    expect(await raidCard()).toContain(RAID_COPY.notSignedUp);
    await signup(id, kestrel.user.id, 'signed_up');
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.youPresent);
    expect(await raidCard()).not.toContain(RAID_COPY.notSignedUp);
  });

  it("an officer's /event roster addition is picked up at once", async () => {
    const { event: id, raid } = await linkedRaid();
    await setCheck('require');
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.tapRefused('Test raid'));
    await addCharacter(kestrel);
    const i = rawCmd(officer, 'event', 'roster', { event: String(id), action: 'add', member: kestrel.user.id, role: 'tank', reason: 'late' });
    const added = await send({ ...i, data: { ...i.data, resolved: { users: { [kestrel.user.id]: kestrel.user }, members: { [kestrel.user.id]: { nick: null, roles: [] } } } } } as never, TOKEN);
    expect(added.data.content).toBe(EVENT_COPY.rosterDone);
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`)).data.content).toBe(RAID_COPY.youPresent);
  });

  it('Bench members show as not confirmed, earn nothing, and move to Standby only by their own tap', async () => {
    const { event: id, raid } = await linkedRaid();
    await signup(id, pip.user.id, 'bench');
    await env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, 'Pip', 'active', 'x') ON CONFLICT DO NOTHING").bind(GUILD, pip.user.id).run();
    expect(await raidCard()).toContain(RAID_COPY.benchLine('Pip'));
    expect(await raidCard()).toContain('**Standby** (0)');
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    expect(await count('dkp_kill_member')).toBe(0);
    await pressAs(pip, `${STANDBY_PREFIX}${raid}`);
    const card = await raidCard();
    expect(card).toContain('**Standby** (1)');
    expect(card).not.toContain('bench, not confirmed');
  });

  it('an unlinked raid is unaffected: no read beyond today\'s, and no marks', async () => {
    await openRaid();
    const { id } = await raidRow();
    await setCheck('require');
    const r = await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    expect(r.data.content).toBe(RAID_COPY.youPresent);
    expect(await raidCard()).not.toContain(RAID_COPY.notSignedUp);
  });
});

describe('ITEM 4: order 33\'s three gaps', () => {
  it('a refused approval-card edit is flagged, and the sweep redraws it', async () => {
    await dkp(officer, 'adjust', { member: kestrel.user.id, pool: 'guild', points: 50, reason: 'big' });
    const { id, message_id } = await one<{ id: number; message_id: string }>('SELECT id, message_id FROM dkp_pending');
    fake.refuse = (m, p) => (m === 'PATCH' && p.endsWith(message_id) ? json({ message: 'down', code: 0 }, 500) : null);
    await pressAs(officerB, `${APPROVE_PREFIX}${id}`);
    const card = () => fake.messages.find((m) => m.id === message_id)!.body;
    expect(card().components.length).toBe(1);
    expect(await all('SELECT item FROM card_stale')).toEqual([{ item: `pcard:${id}` }]);
    fake.refuse = null;
    await sweepStale(env, (ids) => ids);
    await inObject(timersOf(env, GUILD), async (o, st) => {
      const key = `pcard:${id}`;
      await st.storage.put(key, { ...(await st.storage.get<object>(key)), due: Date.now() - 1 });
      await o.alarm();
    });
    expect(card().content).toContain('Approved by');
    expect(card().components).toEqual([]);
    expect(await count('card_stale')).toBe(0);
  });

  it('a lapse the card refused is put right too', async () => {
    await dkp(officer, 'adjust', { member: kestrel.user.id, pool: 'guild', points: 50, reason: 'big' });
    const { id, message_id } = await one<{ id: number; message_id: string }>('SELECT id, message_id FROM dkp_pending');
    await env.DB.prepare('UPDATE dkp_pending SET due_at = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
    fake.refuse = (m, p) => (m === 'PATCH' && p.endsWith(message_id) ? json({ message: 'down', code: 0 }, 500) : null);
    await HANDLERS.lapse(withToken, GUILD, String(id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    expect(await count('card_stale')).toBe(1);
    fake.refuse = null;
    await HANDLERS.pcard(withToken, GUILD, String(id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    expect(fake.messages.find((m) => m.id === message_id)!.body.content).toContain('Lapsed');
  });

  const startOf = async () => (await one<{ start_at: string }>('SELECT start_at FROM event')).start_at;
  const dmsTo = (who: string) => fake.dms.filter((d) => d.to === who);

  it('a member promoted behind the cursor stays in it through a transient failure, and still gets the reminder', async () => {
    const id = await openEvent(20 * MIN);
    await env.DB.prepare('UPDATE event SET capacity = 2').run();
    const start = await startOf();
    await env.DB.prepare('UPDATE event SET reminded_start = ?').bind(start).run();
    await signup(id, uid(1), 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    await signup(id, uid(5), 'signed_up');
    await signup(id, uid(6), 'signed_up');
    // uid(5) has left, so uid(1), behind the cursor at uid(4), moves up. Sending to them fails once.
    let failed = false;
    fake.refuse = (m, p) => {
      if (m === 'GET' && p.endsWith(`/members/${uid(5)}`)) return json({ message: 'Unknown Member', code: 10007 }, 404);
      if (m === 'POST' && p === `/channels/9${uid(1)}/messages` && dmsTo(uid(1)).length === 0 && !failed && (fake.dms.length === 0)) {
        failed = true;
        return json({ message: 'down', code: 0 }, 503);
      }
      return null;
    };
    await store(`evremind:${id}`, { due: Date.now() - 1, cursor: `${start}|${uid(4)}` });
    await alarm();
    expect(failed).toBe(true);
    expect(dmsTo(uid(1))).toEqual([]);
    const held = await stored(`evremind:${id}`);
    expect(held.cursor).toContain(`|${uid(1)}`);
    await store(`evremind:${id}`, { ...held, due: Date.now() - 1 });
    await alarm();
    expect(dmsTo(uid(1)).filter((d) => d.content.startsWith('Reminder')).length).toBe(1);
    expect(dmsTo(uid(6)).length).toBe(1);
    expect(dmsTo(uid(5))).toEqual([]);
  }, 30_000);

  it('a member promoted ahead of the cursor gets one reminder, even when the chunk stops after them', async () => {
    const id = await openEvent(20 * MIN);
    await env.DB.prepare('UPDATE event SET capacity = 2').run();
    await signup(id, uid(1), 'signed_up');
    await signup(id, uid(2), 'signed_up');
    await signup(id, uid(9), 'waitlist', { queued: '2026-10-30T00:00:00.000Z' });
    // uid(1) has left, so uid(9), past the end of the walk, moves up and joins in id order. uid(2)'s send fails once, before uid(9)'s.
    let failed = false;
    fake.refuse = (m, p) => {
      if (m === 'GET' && p.endsWith(`/members/${uid(1)}`)) return json({ message: 'Unknown Member', code: 10007 }, 404);
      if (m === 'POST' && p === `/channels/9${uid(2)}/messages` && !failed) {
        failed = true;
        return json({ message: 'down', code: 0 }, 503);
      }
      return null;
    };
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(failed).toBe(true);
    const held = await stored(`evremind:${id}`);
    await store(`evremind:${id}`, { ...held, due: Date.now() - 1 });
    await alarm();
    expect(dmsTo(uid(2)).length).toBe(1);
    expect(dmsTo(uid(9)).filter((d) => d.content.startsWith('Reminder')).length).toBe(1);
  }, 30_000);

  it('a cancel landing mid-send stops the remaining reminders', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 3; n++) await signup(id, uid(n), 'signed_up');
    const handle = botApi.handle!;
    botApi.handle = async (m, p, b) => {
      const r = await handle(m, p, b);
      if (fake.dms.length === 1) await env.DB.prepare("UPDATE event SET status = 'cancelled'").run();
      return r;
    };
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.dms.map((d) => d.to)).toEqual([uid(1)]);
  });

  it('a time change landing mid-send stops them, and the rescheduled reminder still fires at the new start', async () => {
    const id = await openEvent(20 * MIN);
    for (let n = 1; n <= 3; n++) await signup(id, uid(n), 'signed_up');
    const handle = botApi.handle!;
    const moved = new Date(Date.now() + 25 * MIN).toISOString();
    let edited = false;
    botApi.handle = async (m, p, b) => {
      const r = await handle(m, p, b);
      if (fake.dms.length === 1 && !edited) {
        edited = true;
        await env.DB.prepare('UPDATE event SET start_at = ?').bind(moved).run();
      }
      return r;
    };
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.dms.map((d) => d.to)).toEqual([uid(1)]);
    // /event edit re-arms the item (`later`); here it comes due straight away.
    await timersOf(env, GUILD).schedule(GUILD, [{ key: `evremind:${id}`, due: Date.now() - 1, later: true }]);
    await store(`evremind:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.dms.map((d) => d.to)).toEqual([uid(1), uid(1), uid(2), uid(3)]);
    expect(await one('SELECT reminded_start FROM event')).toEqual({ reminded_start: moved });
  });

  it('a reminder chunk is derived from the alarm\'s cap, the re-check included', () => {
    expect(chunkSize(true, true)).toBe(Math.floor((TIMER_CALL_CAP - CHUNK_OVERHEAD) / (CALLS_PER_DM + LOOKUP_CALLS + RECHECK_CALLS)));
    expect(chunkSize(false, true)).toBe(Math.floor((TIMER_CALL_CAP - CHUNK_OVERHEAD) / (CALLS_PER_DM + RECHECK_CALLS)));
  });
});

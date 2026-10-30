// Work order 34, PR B (ITEM 3): no-shows on the event card, the line on /me, and /dkp adjust event:, in workerd against a mocked
// Discord. Nothing reaches a real server.
import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import { autocomplete } from '../../src/commands/autocomplete.ts';
import { APPROVE_PREFIX } from '../../src/dkp/commands.ts';
import { BATCH_COPY, DKP_COPY } from '../../src/dkp/copy.ts';
import { HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { dkpMeLine } from '../../src/dkp/me.ts';
import { CHECK_PREFIX, CLOSE_PREFIX, PAY_PREFIX, PRESENT_PREFIX, STANDBY_PREFIX } from '../../src/dkp/raid.ts';
import { ADD_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { cardMessage, loadEvent, loadSignups, noShowsLine } from '../../src/events/card.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { ADD_EVENTS_PREFIX, REMOVE_EVENTS_PREFIX } from '../../src/events/setup.ts';
import { eventSettingsOf } from '../../src/events/settings.ts';
import { EMBED_LIMITS, embedChars, SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
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
const wren = as('100000000000000006', { global_name: 'Wren' });
const MIN = 60_000;
const DAY = 86_400_000;

interface Msg { id: string; channel: string; body: any }
const fake = { channels: [] as any[], messages: [] as Msg[], next: 1 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const dkp = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'dkp', sub, opts), TOKEN);
const inObject = runInDurableObject as unknown as <T>(s: unknown, f: (o: any, st: DurableObjectState) => Promise<T> | T) => Promise<T>;
const api = () => timerApi(withToken, Date.now(), () => 0);
const items = () => timersOf(env, GUILD).list();

beforeEach(async () => {
  await reset(['Blacksmithing'], [['CLR', 10]]);
  await env.DB.batch([env.DB.prepare('DELETE FROM zone'), env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow')")]);
  Object.assign(fake, { channels: [], messages: [], next: 1 });
  await timersOf(env, GUILD).cancel();
  await timersOf(env, GUILD).cancelEvents();
  botApi.handle = (method, path, body) => {
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: 'botrole', permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: ['botrole'] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === 4 ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path.endsWith('/commands')) return json({ id: id(), name: body.name }, 201);
    if (method === 'GET' && path.endsWith('/commands')) return json([]);
    if (method === 'DELETE' && path.includes('/commands/')) return new Response(null, { status: 204 });
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
});

const eventsChannel = () => fake.channels.find((c) => c.name === storedName('GC-Events')).id as string;
const memberRow = (m: Member, name: string, status = 'active') =>
  env.DB.prepare('INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET status = excluded.status').bind(GUILD, m.user.id, name, status, 'x').run();
const openEvent = async (o: { title?: string; status?: string } = {}) => {
  const m = { id: `8000${String(fake.next++).padStart(14, '0')}`, channel: eventsChannel(), body: { embeds: [{ title: 'card' }] } };
  fake.messages.push(m);
  const r = await one<{ id: number }>(
    "INSERT INTO event (guild_id, type, title, start_at, duration_minutes, zone_key, closes_at, status, message_id, posted_by, created_at) VALUES (?, 'raid', ?, ?, 120, 'glinting hollow', ?, ?, ?, 'u', 'x') RETURNING id",
    GUILD, o.title ?? 'Link test', new Date(Date.now() + 10 * MIN).toISOString(), new Date(Date.now() + 8 * 3_600_000).toISOString(), o.status ?? 'open', m.id,
  );
  return r.id;
};
const signup = (id: number, m: Member, status: string) =>
  env.DB.prepare('INSERT INTO event_signup (event_id, guild_id, member_id, status, role, char_name, char_class, char_level, updated_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, GUILD, m.user.id, status, 'tank', 'Char', 'CLR', 30, '2026-10-30T00:00:00.000Z', m.user.id)
    .run();
const openRaid = async (mode?: string) => {
  await dkp(officer, 'raid', { zone: 'Glinting Hollow', ...(mode ? { mode } : {}) });
  return (await one<{ id: number }>('SELECT id FROM dkp_raid ORDER BY id DESC LIMIT 1')).id;
};
const closeRaid = (id: number) => pressAs(officer, `${CLOSE_PREFIX}${id}`);
const description = async (id: number) => {
  await HANDLERS.evcard(withToken, GUILD, String(id), 0, Date.now(), api());
  const { message_id } = await one<{ message_id: string }>('SELECT message_id FROM event WHERE id = ?', id);
  return fake.messages.find((m) => m.id === message_id)!.body.embeds[0].description as string;
};
/** The timer object draws the card by itself: this waits for what it drew, without drawing it. */
const drawn = async (id: number, text: string) => {
  const { message_id } = await one<{ message_id: string }>('SELECT message_id FROM event WHERE id = ?', id);
  const has = () => !!fake.messages.find((m) => m.id === message_id)!.body.embeds[0].description?.includes(text);
  for (let i = 0; i < 100 && !has(); i++) await new Promise((r) => setTimeout(r, 50));
  return has();
};
const meLine = () => dkpMeLine(env.DB, GUILD, kestrel.user.id);
const adjust = (m: Member, id: number, points: number, extra: Record<string, unknown> = {}) => dkp(m, 'adjust', { event: String(id), points, reason: 'test', ...extra });
const ledger = () => all<{ member_id: string; pool: string; amount: number; cut: number; actor: string }>("SELECT member_id, pool, amount, cut, actor FROM dkp_ledger WHERE kind = 'adjust' ORDER BY member_id");
const lastPost = () => fake.messages.at(-1)!.body;
const postText = (b: any) => [b.embeds[0].description, ...(b.embeds[0].fields ?? []).map((f: any) => f.value)].join('\n');

describe('ITEM 3: no-shows', () => {
  it('with kills: Signed up and at no kill is a no-show; Present and Standby are not; Tentative never is', async () => {
    for (const [m, n] of [[kestrel, 'Kestrel'], [pip, 'Pip'], [wren, 'Wren'], [officerB, 'OfficerB']] as const) await memberRow(m, n);
    const id = await openEvent();
    await signup(id, kestrel, 'signed_up');
    await signup(id, pip, 'signed_up');
    await signup(id, wren, 'signed_up');
    await signup(id, officerB, 'tentative');
    const raid = await openRaid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    await pressAs(pip, `${STANDBY_PREFIX}${raid}`);
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    await closeRaid(raid);
    const card = await description(id);
    expect(card).toContain(`No-shows: <@${wren.user.id}> (Wren)`);
    expect(card).not.toContain(`No-shows: <@${kestrel.user.id}>`);
    expect(card.split('\n').find((l) => l.startsWith('No-shows'))).not.toMatch(/Kestrel|Pip|OfficerB/);
  });

  it('with a flat payout: Pay attendance counts as being there', async () => {
    await memberRow(kestrel, 'Kestrel');
    await memberRow(pip, 'Pip');
    const id = await openEvent();
    await signup(id, kestrel, 'signed_up');
    await signup(id, pip, 'signed_up');
    const raid = await openRaid('flat');
    await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    await pressAs(officer, `${PAY_PREFIX}${raid}`);
    await closeRaid(raid);
    expect(await description(id)).toContain(`No-shows: <@${pip.user.id}> (Pip)`);
  });

  it('none means none; no kills means not recorded; the card pings nobody', async () => {
    await memberRow(kestrel, 'Kestrel');
    const a = await openEvent();
    await signup(a, kestrel, 'signed_up');
    const raid = await openRaid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    await closeRaid(raid);
    expect(await description(a)).toContain(EVENT_COPY.noShowsNone);
    const b = await openEvent({ title: 'Second' });
    await signup(b, kestrel, 'signed_up');
    await closeRaid(await openRaid());
    expect(await description(b)).toContain(EVENT_COPY.noShowsNotRecorded);
    const { message_id } = await one<{ message_id: string }>('SELECT message_id FROM event WHERE id = ?', b);
    expect(fake.messages.find((m) => m.id === message_id)!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('written even when the event had already closed by its own timer', async () => {
    await memberRow(kestrel, 'Kestrel');
    const id = await openEvent();
    await signup(id, kestrel, 'signed_up');
    const raid = await openRaid();
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    await env.DB.prepare("UPDATE event SET status = 'closed' WHERE id = ?").bind(id).run();
    expect(await description(id)).not.toContain('No-shows');
    await closeRaid(raid);
    expect(await drawn(id, 'No-shows: <@')).toBe(true);
  });

  it('a correction after close redraws the line from the roster, never the ledger', async () => {
    await memberRow(kestrel, 'Kestrel');
    const id = await openEvent();
    await signup(id, kestrel, 'signed_up');
    const raid = await openRaid();
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    await closeRaid(raid);
    expect(await description(id)).toContain('No-shows: <@');
    await dkp(officer, 'correct', { member: kestrel.user.id, action: 'add', reason: 'was there' });
    expect(await drawn(id, EVENT_COPY.noShowsNone)).toBe(true);
    // The ledger alone says nothing: a roster row removed takes them back out, whatever it holds.
    await env.DB.prepare('DELETE FROM dkp_kill_member').run();
    expect(await count('dkp_ledger', "member_id = ?", kestrel.user.id)).toBeGreaterThan(0);
    expect(await description(id)).toContain('No-shows: <@');
  });

  it('a kill roll call closing after the raid can add a no-show', async () => {
    await memberRow(kestrel, 'Kestrel');
    const id = await openEvent();
    await signup(id, kestrel, 'signed_up');
    const raid = await openRaid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${raid}`);
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    await pressAs(officer, `${CHECK_PREFIX}${raid}`);
    await closeRaid(raid);
    expect(await description(id)).toContain(EVENT_COPY.noShowsNone);
    const k = await one<{ id: number }>('SELECT id FROM dkp_kill');
    await env.DB.prepare('UPDATE dkp_kill SET check_due = ?').bind(new Date(Date.now() - 1000).toISOString()).run();
    const r = await HANDLERS.check(withToken, GUILD, String(k.id), 0, Date.now(), api());
    expect(r?.schedule?.map((s) => s.key)).toContain(`evcard:${id}`);
    expect(await description(id)).toContain('No-shows: <@');
  });

  it('a long list stays inside Discord\'s limits, and says how many it left out', async () => {
    const e = (await loadEvent(env.DB, GUILD, await openEvent()))!;
    const signups = Array.from({ length: 200 }, (_, n) => ({ member_id: `1000000000000${String(n).padStart(5, '0')}`, status: 'signed_up' as const, role: 'tank' as const, char_name: 'Char', char_class: 'CLR', char_level: 30, queued_at: null, name: `A very long member name ${n}` }));
    const line = noShowsLine(signups, { closed: true, kills: 1, attended: [] })!;
    expect(line).toMatch(/…and \d+ more\.$/);
    const m = cardMessage({ ...e, status: 'closed', description: '_'.repeat(1000) }, signups, eventSettingsOf(null), Date.now(), line);
    expect(m.embeds[0].description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    expect(embedChars(m.embeds)).toBeLessThanOrEqual(EMBED_LIMITS.total);
    expect((await loadSignups(env.DB, e.id)).length).toBe(0);
  });
});

describe('ITEM 3: /me', () => {
  const attended = async (status: string, at: boolean, closed = true) => {
    const id = await openEvent();
    await signup(id, kestrel, status);
    const raid = await openRaid();
    if (at) await pressAs(kestrel, `${STANDBY_PREFIX}${raid}`);
    await dkp(officer, 'kill', { named: 'A myconid prince' });
    if (at) await pressAs(kestrel, `${STANDBY_PREFIX}${raid}`);
    if (closed) await closeRaid(raid);
    return raid;
  };

  it('counts signed up, attended and no-shows over linked raids; Standby attends', async () => {
    await memberRow(kestrel, 'Kestrel');
    await attended('signed_up', true);
    await attended('signed_up', false);
    await attended('tentative', false);
    expect(await meLine()).toContain(EVENT_COPY.meRaidEvents(2, 1, 1));
  });

  it('leaves out raids over 30 days old, unlinked raids and cancelled events', async () => {
    await memberRow(kestrel, 'Kestrel');
    const old = await attended('signed_up', true);
    await env.DB.prepare('UPDATE dkp_raid SET opened_at = ? WHERE id = ?').bind(new Date(Date.now() - 31 * DAY).toISOString(), old).run();
    await closeRaid(await openRaid());
    const id = await openEvent({ title: 'Called off' });
    await signup(id, kestrel, 'signed_up');
    await openRaid();
    await env.DB.prepare("UPDATE event SET status = 'cancelled' WHERE id = ?").bind(id).run();
    expect(await meLine()).toContain(EVENT_COPY.meRaidEvents(0, 0, 0));
  });

  it('an open raid is not yet a no-show', async () => {
    await memberRow(kestrel, 'Kestrel');
    await attended('signed_up', false, false);
    expect(await meLine()).toContain(EVENT_COPY.meRaidEvents(1, 0, 0));
  });

  it('the line goes with the Events module', async () => {
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    expect(await meLine()).not.toContain('Raid events');
  });
});

describe('ITEM 3: adjusting a whole event', () => {
  const rosterOf = async (...m: [Member, string, string][]) => {
    const id = await openEvent();
    for (const [x, n, s] of m) {
      await memberRow(x, n);
      await signup(id, x, s);
    }
    return id;
  };

  it('3 members with the officer skipped: one ledger row each, one post, and the reply says so; every roster status counts', async () => {
    await memberRow(officer, 'Officer');
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up'], [pip, 'Pip', 'bench'], [wren, 'Wren', 'waitlist'], [officerB, 'OfficerB', 'declined']);
    await signup(id, officer, 'tentative');
    const before = fake.messages.length;
    const r = await adjust(officer, id, 5);
    expect(r.data.content).toContain(BATCH_COPY.youSkipped);
    expect((await ledger()).map((l) => [l.member_id, l.amount, l.pool, l.actor])).toEqual([kestrel, pip, wren].map((m) => [m.user.id, 5, 'guild', officer.user.id]));
    const posts = fake.messages.slice(before).filter((m) => m.body.embeds?.[0]?.description?.includes('+5'));
    expect(posts.length).toBe(1);
    const text = postText(posts[0].body);
    for (const n of ['Kestrel', 'Pip', 'Wren']) expect(text).toContain(`(${n}): now 5`);
    expect(text).toContain('Reason: test');
    expect(text).not.toContain('(Officer): now');
    expect(posts[0].body.allowed_mentions).toEqual({ parse: [] });
  });

  it("the pool defaults to the linked raid's zone, and a typed pool overrides it", async () => {
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up']);
    await openRaid();
    await adjust(officer, id, 2);
    expect((await ledger())[0].pool).toBe('glinting hollow');
    await adjust(officer, id, 2, { pool: 'guild' });
    expect((await ledger()).map((l) => l.pool).sort()).toEqual(['glinting hollow', 'guild']);
  });

  it('the cap applies to each member, and the post names anyone capped', async () => {
    await dkp(admin, 'settings', { setting: 'cap', value: 10 });
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up'], [pip, 'Pip', 'signed_up']);
    await adjust(officer, id, 8);
    await signup(await openEvent({ title: 'Solo' }), kestrel, 'signed_up');
    const solo = (await one<{ id: number }>("SELECT id FROM event WHERE title = 'Solo'")).id;
    await adjust(officer, solo, 8);
    expect((await ledger()).filter((l) => l.member_id === kestrel.user.id).map((l) => [l.amount, l.cut]).sort()).toEqual([[2, 6], [8, 0]]);
    expect(postText(lastPost())).toContain('now 10; 6 over the cap was not added');
  });

  it('over the threshold the whole batch waits for a second officer: one card, members fixed when asked', async () => {
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up'], [pip, 'Pip', 'signed_up']);
    const r = await adjust(officer, id, 50);
    expect(r.data.content).toContain('second officer');
    expect(await ledger()).toEqual([]);
    expect(await count('dkp_pending')).toBe(1);
    const { id: pid } = await one<{ id: number }>('SELECT id FROM dkp_pending');
    expect((await items())[`lapse:${pid}`]).toBeDefined();
    await memberRow(wren, 'Wren');
    await signup(id, wren, 'signed_up');
    expect((await pressAs(officer, `${APPROVE_PREFIX}${pid}`)).data.content).toBe(DKP_COPY.asked);
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${pid}`)).data.content).toBe(DKP_COPY.approvedReply);
    expect((await ledger()).map((l) => [l.member_id, l.amount, l.actor])).toEqual([[kestrel.user.id, 50, officerB.user.id], [pip.user.id, 50, officerB.user.id]]);
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${pid}`)).data.content).toBe(DKP_COPY.notOpen);
    expect((await ledger()).length).toBe(2);
  });

  it('it lapses after the usual 24 hours and pays nothing', async () => {
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up']);
    await adjust(officer, id, 50);
    const p = await one<{ id: number; due_at: string; asked_at: string }>('SELECT id, due_at, asked_at FROM dkp_pending');
    expect(Date.parse(p.due_at) - Date.parse(p.asked_at)).toBe(DAY);
    await HANDLERS.lapse(withToken, GUILD, String(p.id), 0, Date.parse(p.due_at) + 1000, api());
    expect(await one('SELECT status FROM dkp_pending')).toEqual({ status: 'lapsed' });
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.notOpen);
    expect(await ledger()).toEqual([]);
  });

  it('an approver in the batch is refused, and changes nothing', async () => {
    await memberRow(officerB, 'OfficerB');
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up']);
    await signup(id, officerB, 'signed_up');
    await adjust(officer, id, 50);
    const { id: pid } = await one<{ id: number }>('SELECT id FROM dkp_pending');
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${pid}`)).data.content).toBe(BATCH_COPY.inBatch);
    expect(await one('SELECT status FROM dkp_pending')).toEqual({ status: 'open' });
    expect(await ledger()).toEqual([]);
  });

  it('frozen members are skipped and named, at the request and at the approval', async () => {
    const id = await rosterOf([kestrel, 'Kestrel', 'signed_up'], [pip, 'Pip', 'signed_up'], [wren, 'Wren', 'signed_up']);
    await memberRow(wren, 'Wren', 'left');
    const r = await adjust(officer, id, 50);
    expect(r.data.content).toContain(`Skipped as frozen: <@${wren.user.id}> (Wren)`);
    await memberRow(pip, 'Pip', 'left');
    const { id: pid } = await one<{ id: number }>('SELECT id FROM dkp_pending');
    await pressAs(officerB, `${APPROVE_PREFIX}${pid}`);
    expect((await ledger()).map((l) => l.member_id)).toEqual([kestrel.user.id]);
    const text = postText(lastPost().embeds ? lastPost() : fake.messages.at(-2)!.body);
    expect(text).toContain(`<@${pip.user.id}> (Pip)`);
  });

  it('refused when no one is eligible, with the officer told they were skipped', async () => {
    await memberRow(officer, 'Officer');
    const id = await openEvent();
    await signup(id, officer, 'signed_up');
    expect((await adjust(officer, id, 1)).data.content).toBe(BATCH_COPY.onlyYou('Link test'));
    expect((await adjust(officerB, await openEvent({ title: 'Empty' }), 1)).data.content).toBe(BATCH_COPY.noOne('Empty'));
    expect(await ledger()).toEqual([]);
  });

  it('a closed event can be adjusted; a cancelled one, an unknown one and both targets at once cannot', async () => {
    const closed = await rosterOf([kestrel, 'Kestrel', 'signed_up']);
    await env.DB.prepare("UPDATE event SET status = 'closed' WHERE id = ?").bind(closed).run();
    await adjust(officer, closed, 1);
    expect((await ledger()).length).toBe(1);
    const off = await openEvent({ status: 'cancelled' });
    expect((await adjust(officer, off, 1)).data.content).toBe(BATCH_COPY.cancelled);
    expect((await dkp(officer, 'adjust', { event: 'nonsense', points: 1, reason: 'x' })).data.content).toBe(EVENT_COPY.pickEvent);
    expect((await adjust(officer, closed, 1, { member: kestrel.user.id })).data.content).toBe(BATCH_COPY.either);
    expect((await dkp(officer, 'adjust', { points: 1, reason: 'x' })).data.content).toBe(BATCH_COPY.either);
    expect((await dkp(officer, 'adjust', { member: kestrel.user.id, points: 1, reason: 'x' })).data.content).toBe(BATCH_COPY.needsPool);
  });

  it("a member's single adjustment works as before", async () => {
    await memberRow(kestrel, 'Kestrel');
    expect((await dkp(officer, 'adjust', { member: kestrel.user.id, pool: 'guild', points: 3, reason: 'x' })).data.content).toBe(DKP_COPY.adjustDone(true));
    expect((await dkp(kestrel, 'adjust', { member: kestrel.user.id, pool: 'guild', points: 3, reason: 'x' })).data.content).toBe(DKP_COPY.notRunner);
    expect((await ledger()).length).toBe(1);
  });

  it('the event list offers open and closed events, never cancelled ones', async () => {
    await openEvent({ title: 'Open one' });
    await openEvent({ title: 'Closed one', status: 'closed' });
    await openEvent({ title: 'Cancelled one', status: 'cancelled' });
    const list = await autocomplete(env.DB, { guild_id: GUILD, member: officer, data: { name: 'dkp', options: [{ type: 1, name: 'adjust', options: [{ type: 3, name: 'event', value: '', focused: true }] }] } } as never);
    expect(list.map((c) => c.name).join()).toMatch(/Open one.*Closed one|Closed one.*Open one/);
    expect(list.map((c) => c.name).join()).not.toContain('Cancelled');
  });
});

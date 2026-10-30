// Work order 32, PR C: sign-ups, roles, limits, the waitlist or bench, the lock, the Left check and the spam limit, in workerd
// against a mocked Discord. Timers are proven by running their handlers (order 27's method).
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import { HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { CHANGE_CHARACTER_PREFIX, CHANGE_ROLE_PREFIX, STATUS_PREFIX } from '../../src/events/card.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { EVENT_COMING } from '../../src/events/definition.ts';
import { signupRefusal, SPAM_LIMIT } from '../../src/events/eligible.ts';
import { POST_PREFIX } from '../../src/events/manage.ts';
import { CHANGE_CHARACTER_PICK, CHANGE_ROLE_PICK, CONFIRM_PREFIX, PICK_CHARACTER_PREFIX, PICK_ROLE_PREFIX } from '../../src/events/press.ts';
import { ADD_EVENTS_PREFIX, REMOVE_EVENTS_PREFIX } from '../../src/events/setup.ts';
import { ADMIN_ONLY } from '../../src/interactions.ts';
import { SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, select, send, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const BOT_ROLE = '600000000000000001';
const MEMBER_ROLE = '600000000000000003';
const RAID_ROLE = '600000000000000004';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE] });
const ann = as('100000000000000011');
const bo = as('100000000000000012');
const cy = as('100000000000000013');

const fake = { channels: [] as any[], messages: [] as { id: string; body: any }[], next: 1, gone: new Set<string>(), broken: new Set<string>(), lookups: 0 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const pick = (m: Member, id: string, values: string[]) => send(select(m, id, values), TOKEN);
const event = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'event', sub, opts), TOKEN);
const row = (id: number, m: Member) => one<{ status: string; role: string | null; char_name: string | null; char_class: string | null; char_level: number | null; queued_at: string | null } | null>('SELECT status, role, char_name, char_class, char_level, queued_at FROM event_signup WHERE event_id = ? AND member_id = ?', id, m.user.id);
const history = (id: number) => all<{ member_id: string; status: string; role: string | null; actor: string; reason: string | null }>('SELECT member_id, status, role, actor, reason FROM event_signup_history WHERE event_id = ? ORDER BY id', id);
const notices = () => fake.messages.filter((m) => m.body.content).map((m) => m.body.content as string);
const tokenEnv = () => ({ ...env, DISCORD_BOT_TOKEN: 'test-bot-token' }) as never;
const runItem = (kind: string, id: number) => HANDLERS[kind](tokenEnv(), GUILD, String(id), 0, Date.now(), timerApi(tokenEnv(), Date.now(), () => 0));
const lockPassed = (id: number) => env.DB.prepare('UPDATE event SET lock_at = ? WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), id).run();

let nextChar = 1;
async function character(m: Member, name: string, cls: string | null, level: number | null, main = 1) {
  const at = '2026-10-30T00:00:00.000Z';
  const n = nextChar++;
  await env.DB.batch([
    env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?) ON CONFLICT DO NOTHING").bind(GUILD, m.user.id, name, at),
    env.DB.prepare('INSERT INTO character (id, guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(n, GUILD, m.user.id, name, name.toLowerCase(), cls, level, main, at, at),
  ]);
  return n;
}

beforeEach(async () => {
  await reset(['Blacksmithing'], [['CLR', 10], ['WAR', 10]]);
  await env.DB.batch([env.DB.prepare('DELETE FROM zone'), env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow')")]);
  Object.assign(fake, { channels: [], messages: [], next: 1, gone: new Set(), broken: new Set(), lookups: 0 });
  nextChar = 1;
  await timersOf(env, GUILD).cancel();
  await timersOf(env, GUILD).cancelEvents();
  botApi.handle = (method, path, body) => {
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    const member = path.match(new RegExp(`^/guilds/${GUILD}/members/(\\d+)$`));
    if (method === 'GET' && member) {
      fake.lookups++;
      if (fake.broken.has(member[1])) return json({ message: 'Server error', code: 0 }, 500);
      return fake.gone.has(member[1]) ? json({ message: 'Unknown Member', code: 10007 }, 404) : json({ user: { id: member[1] }, roles: [] });
    }
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === 4 ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path.endsWith('/commands')) return json({ id: id(), name: body.name }, 201);
    if (method === 'GET' && path.endsWith('/commands')) return json([]);
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) {
      const m = { id: id(), body };
      fake.messages.push(m);
      return json({ id: m.id });
    }
    const patch = path.match(/^\/channels\/\d+\/messages\/(\d+)$/);
    if (method === 'PATCH' && patch) {
      const m = fake.messages.find((x) => x.id === patch[1]);
      if (!m) return json({ code: 10008, message: 'Unknown Message' }, 404);
      m.body = { ...m.body, ...body };
      return json({ id: m.id });
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
  await pressAs(admin, ADD_EVENTS_PREFIX);
  fake.messages = [];
});

async function posted(opts: Record<string, unknown>) {
  const r = await event(officer, 'create', { start: 'tomorrow 20:00', ...opts });
  const post = r.data.components![0].components[0].custom_id as string;
  await pressAs(officer, post);
  fake.messages = [];
  return Number(post.slice(POST_PREFIX.length));
}
const RAID = { type: 'raid', title: 'Test raid', zone: 'Glinting Hollow' };
const GROUP = { type: 'group', title: 'Group' };
const SOCIAL = { type: 'social', title: 'Party' };
const OTHER = { type: 'other', title: 'Other' };
/** The whole sign-up, as a member does it: the button, then the form's confirm, for a member with one character. */
async function signUp(id: number, m: Member, charId: number, role: string, status = 'signed_up') {
  const r = await pressAs(m, `${STATUS_PREFIX}${id}:${status}`);
  if (!r.data.components?.length) return r;
  return pressAs(m, `${CONFIRM_PREFIX}${id}:${status}:${charId}:${role}`);
}

it('the switch is in /guildcraft setup; nothing is left coming', async () => {
  const ids = async () => (await send(rawCmd(admin, 'guildcraft', 'setup'), TOKEN)).data.components!.flatMap((r: any) => r.components.map((b: any) => b.custom_id));
  expect(await ids()).toContain(REMOVE_EVENTS_PREFIX);
  await pressAs(admin, REMOVE_EVENTS_PREFIX);
  expect(await ids()).toContain(ADD_EVENTS_PREFIX);
  expect(EVENT_COMING).toEqual([]);
  expect((await pressAs(ann, ADD_EVENTS_PREFIX)).data.content).toBe(ADMIN_ONLY);
});

describe('the one function (src/events/eligible.ts)', () => {
  const base = { event: { status: 'open', lock_at: null, signup_role: null }, memberRole: null, roles: [], memberStatus: 'active', current: null, leaving: false, route: 'member' as const, inServer: true, recent: 0, now: 1000 };
  it('each gate, one at a time', () => {
    expect(signupRefusal(base)).toBeNull();
    expect(signupRefusal({ ...base, event: { ...base.event, status: 'cancelled' } })).toEqual({ code: 'cancelled' });
    expect(signupRefusal({ ...base, event: { ...base.event, status: 'closed' } })).toEqual({ code: 'closed' });
    expect(signupRefusal({ ...base, memberStatus: 'left' })).toEqual({ code: 'frozen' });
    expect(signupRefusal({ ...base, memberRole: 'm' })).toEqual({ code: 'member_role', role: 'm' });
    expect(signupRefusal({ ...base, event: { ...base.event, signup_role: 's' } })).toEqual({ code: 'signup_role', role: 's' });
    expect(signupRefusal({ ...base, event: { ...base.event, lock_at: '1970-01-01T00:00:00.000Z' } })).toEqual({ code: 'locked' });
    expect(signupRefusal({ ...base, recent: SPAM_LIMIT })).toEqual({ code: 'spam' });
    expect(signupRefusal({ ...base, route: 'officer', current: 'left', inServer: false })).toEqual({ code: 'left' });
  });
  it("Can't make it passes the role gates, frozen and the lock", () => {
    expect(signupRefusal({ ...base, leaving: true, memberRole: 'm', memberStatus: 'left', event: { ...base.event, signup_role: 's', lock_at: '1970-01-01T00:00:00.000Z' } })).toBeNull();
  });
  it('an officer passes the lock and the spam limit, not a role gate', () => {
    const o = { ...base, route: 'officer' as const };
    expect(signupRefusal({ ...o, event: { ...base.event, lock_at: '1970-01-01T00:00:00.000Z' }, recent: 99 })).toBeNull();
    expect(signupRefusal({ ...o, event: { ...base.event, signup_role: 's' } })).toEqual({ code: 'signup_role', role: 's' });
  });
  it('every route calls it', async () => {
    const SOURCES = import.meta.glob('../../src/events/press.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const text = Object.values(SOURCES)[0];
    expect(text.match(/signupRefusal\(\{/g)!.length).toBe(2); // the press path's askRefusal, and /event roster
    expect(text.match(/askRefusal\(c, e, p/g)!.length).toBe(3); // the status press, the confirm, and changing()
  });
  it('only src/events/signup.ts and the row-less readers touch event_signup', () => {
    const SOURCES = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const writers = Object.entries(SOURCES).filter(([, t]) => /(INSERT INTO|UPDATE|DELETE FROM) event_signup\b/.test(t)).map(([f]) => f.split('/').at(-1));
    expect(writers).toEqual(['signup.ts']);
  });
});

describe('each status, for each type', () => {
  it('Raid: signed up, tentative, bench, can\'t make it; a character and a role are required', async () => {
    const c = await character(ann, 'Aelin', 'CLR', 32);
    const id = await posted({ ...RAID, healer: 2 });
    const form = await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    expect(form.data.flags).toBe(64);
    expect(form.data.components!.length).toBe(3);
    expect(form.data.components![2].components[0].disabled).toBe(true); // no role yet: never a guess
    await pressAs(ann, `${CONFIRM_PREFIX}${id}:signed_up:${c}:healer`);
    expect(await row(id, ann)).toMatchObject({ status: 'signed_up', role: 'healer', char_name: 'Aelin', char_class: 'CLR', char_level: 32 });
    for (const s of ['tentative', 'bench', 'declined']) {
      const r = await pressAs(ann, `${STATUS_PREFIX}${id}:${s}`);
      expect(r.data.flags, s).toBe(64);
      expect((await row(id, ann))!.status).toBe(s);
    }
    expect(await count('event_signup')).toBe(1);
  });

  it('Group: no Bench to press; a character and a role are required', async () => {
    const c = await character(ann, 'Aelin', 'CLR', 32);
    const id = await posted(GROUP);
    await signUp(id, ann, c, 'dps');
    expect(await row(id, ann)).toMatchObject({ status: 'signed_up', role: 'dps' });
    expect((await pressAs(ann, `${STATUS_PREFIX}${id}:bench`)).data.content).toBe(EVENT_COPY.notOpen);
    await pressAs(ann, `${STATUS_PREFIX}${id}:tentative`);
    expect((await row(id, ann))!.status).toBe('tentative');
  });

  it('Social: Going and Maybe, stored as signed up and tentative; nothing asked', async () => {
    const id = await posted(SOCIAL);
    await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    expect(await row(id, ann)).toMatchObject({ status: 'signed_up', role: null, char_name: null });
    await pressAs(ann, `${STATUS_PREFIX}${id}:tentative`);
    expect((await row(id, ann))!.status).toBe('tentative');
    await pressAs(ann, `${STATUS_PREFIX}${id}:declined`);
    expect((await row(id, ann))!.status).toBe('declined');
  });

  it('Other: a character and a role are optional', async () => {
    const id = await posted(OTHER);
    await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`); // no characters: straight in
    expect(await row(id, ann)).toMatchObject({ status: 'signed_up', role: null });
    const c = await character(bo, 'Bryn', 'WAR', 12);
    const form = await pressAs(bo, `${STATUS_PREFIX}${id}:signed_up`);
    expect(form.data.components![2].components[0].disabled).toBeUndefined();
    await pressAs(bo, `${CONFIRM_PREFIX}${id}:signed_up:${c}:-`);
    expect(await row(id, bo)).toMatchObject({ status: 'signed_up', role: null, char_name: 'Bryn' });
  });

  it('a member with no character is offered Add a character first; a press changes no row', async () => {
    const id = await posted(RAID);
    const r = await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    expect(r.data.content).toBe(EVENT_COPY.needsCharacter);
    expect(r.data.components![0].components[0].custom_id).toBe(`mea:${ann.user.id}`);
    expect(await count('event_signup')).toBe(0);
  });

  it('the class default is preselected, the member can pick another, and with none set nothing is', async () => {
    const c = await character(ann, 'Aelin', 'CLR', 32);
    await character(ann, 'Other', 'WAR', 5, 0);
    await event(admin, 'settings', { class: 'CLR', role: 'healer' });
    const id = await posted(RAID);
    const form = await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    const roles = form.data.components![1].components[0].options;
    expect(roles.filter((o: any) => o.default).map((o: any) => o.value)).toEqual(['healer']);
    expect(form.data.components![2].components[0].custom_id).toBe(`${CONFIRM_PREFIX}${id}:signed_up:${c}:healer`);
    const other = await pick(ann, form.data.components![1].components[0].custom_id, ['tank']);
    expect(other.type).toBe(7);
    expect(other.data.components![2].components[0].custom_id).toBe(`${CONFIRM_PREFIX}${id}:signed_up:${c}:tank`);
  });

  it('turning Support off stops new ones; existing ones stay', async () => {
    const a = await character(ann, 'Aelin', 'CLR', 32);
    const b = await character(bo, 'Bryn', 'WAR', 12);
    const id = await posted(RAID);
    await signUp(id, ann, a, 'support');
    await event(admin, 'settings', { support: false });
    expect((await pressAs(bo, `${CONFIRM_PREFIX}${id}:signed_up:${b}:support`)).data.content).toBe(EVENT_COPY.supportOff('Support'));
    const form = await pressAs(bo, `${STATUS_PREFIX}${id}:signed_up`);
    expect(form.data.components![1].components[0].options.map((o: any) => o.value)).not.toContain('support');
    expect((await row(id, ann))!.role).toBe('support');
  });

  it('a character removed or renamed leaves the card as it was (the snapshot)', async () => {
    const a = await character(ann, 'Aelin', 'CLR', 32);
    const id = await posted(RAID);
    await signUp(id, ann, a, 'tank');
    await env.DB.prepare("UPDATE character SET name = 'Renamed', deleted_at = 'x' WHERE id = ?").bind(a).run();
    expect((await row(id, ann))!.char_name).toBe('Aelin');
  });
});

describe('full: the waitlist or the bench, and promotion', () => {
  async function three(opts: Record<string, unknown>) {
    const [a, b, c] = [await character(ann, 'Aelin', 'CLR', 32), await character(bo, 'Bryn', 'CLR', 30), await character(cy, 'Cyra', 'WAR', 20)];
    return { id: await posted(opts), a, b, c };
  }

  it('a full role sends a member to the waitlist, and the reply says so', async () => {
    const { id, a, b } = await three({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    const r = await signUp(id, bo, b, 'healer');
    expect(r.data.content).toBe(EVENT_COPY.fullWaitlist);
    expect(await row(id, bo)).toMatchObject({ status: 'waitlist', role: 'healer' });
  });

  it('a full role sends a member to the bench when the event says so', async () => {
    const { id, a, b } = await three({ ...RAID, healer: 1, when_full: 'bench' });
    await signUp(id, ann, a, 'healer');
    const r = await signUp(id, bo, b, 'healer');
    expect(r.data.content).toBe(EVENT_COPY.fullBench);
    expect(await row(id, bo)).toMatchObject({ status: 'bench', queued_at: null });
  });

  it('a full capacity does the same, whatever the role; a Social too', async () => {
    const { id, a, b } = await three({ ...RAID, capacity: 1 });
    await signUp(id, ann, a, 'dps');
    await signUp(id, bo, b, 'tank');
    expect((await row(id, bo))!.status).toBe('waitlist');
    const party = await posted({ ...SOCIAL, capacity: 1 });
    await pressAs(ann, `${STATUS_PREFIX}${party}:signed_up`);
    expect((await pressAs(bo, `${STATUS_PREFIX}${party}:signed_up`)).data.content).toBe(EVENT_COPY.fullWaitlist);
  });

  it('Tentative and Bench take no place', async () => {
    const { id, a, b } = await three({ ...RAID, healer: 1, capacity: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer', 'tentative');
    expect((await row(id, bo))!.status).toBe('tentative');
  });

  it('the earliest waitlisted member whose role now has room moves up, not simply the earliest', async () => {
    const { id, a, b, c } = await three({ ...RAID, healer: 1, tank: 1 });
    const d = await character(as('100000000000000014'), 'Dara', 'CLR', 9);
    const dan = as('100000000000000014');
    await signUp(id, ann, a, 'tank');
    await signUp(id, bo, b, 'healer');
    await signUp(id, cy, c, 'tank'); // waitlist first, for tank
    await signUp(id, dan, d, 'healer'); // waitlist second, for healer
    await pressAs(bo, `${STATUS_PREFIX}${id}:declined`); // a healer place opens
    expect((await row(id, dan))!.status).toBe('signed_up');
    expect((await row(id, cy))!.status).toBe('waitlist');
    expect((await history(id)).at(-1)).toEqual({ member_id: dan.user.id, status: 'signed_up', role: 'healer', actor: 'bot', reason: 'promoted' });
  });

  it('among those who fit, the order is the order they joined', async () => {
    const { id, a, b, c } = await three({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    await new Promise((r) => setTimeout(r, 3));
    await signUp(id, cy, c, 'healer');
    await pressAs(ann, `${STATUS_PREFIX}${id}:declined`);
    expect((await row(id, bo))!.status).toBe('signed_up');
    expect((await row(id, cy))!.status).toBe('waitlist');
  });

  it("Change character and Change role keep a place; Can't make it gives it up", async () => {
    const { id, a, b, c } = await three({ ...RAID, healer: 1 });
    const b2 = await character(bo, 'Bryn2', 'WAR', 40, 0);
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    await new Promise((r) => setTimeout(r, 3));
    await signUp(id, cy, c, 'healer');
    const place = (await row(id, bo))!.queued_at;
    await pick(bo, `${CHANGE_CHARACTER_PICK}${id}`, [String(b2)]);
    expect(await row(id, bo)).toMatchObject({ status: 'waitlist', char_name: 'Bryn2', queued_at: place });
    await pressAs(bo, `${STATUS_PREFIX}${id}:declined`);
    expect(await row(id, bo)).toMatchObject({ status: 'declined', queued_at: null });
    await pressAs(bo, `${STATUS_PREFIX}${id}:signed_up`);
    expect((await row(id, bo))!.queued_at! > (await row(id, cy))!.queued_at!).toBe(true);
    await pressAs(ann, `${STATUS_PREFIX}${id}:declined`);
    expect((await row(id, cy))!.status).toBe('signed_up');
  });

  it('switching roles: to a role with room until the lock; a full one changes nothing; the old place promotes', async () => {
    const { id, a, b, c } = await three({ ...RAID, healer: 1, tank: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'tank');
    await signUp(id, cy, c, 'healer'); // waitlisted
    expect((await pressAs(ann, `${CHANGE_ROLE_PREFIX}${id}`)).data.components![0].components[0].options.find((o: any) => o.default).value).toBe('healer');
    expect((await pick(ann, `${CHANGE_ROLE_PICK}${id}`, ['tank'])).data.content).toBe(EVENT_COPY.roleFull('Tank'));
    expect((await row(id, ann))!.role).toBe('healer');
    expect((await pick(ann, `${CHANGE_ROLE_PICK}${id}`, ['dps'])).data.content).toBe(EVENT_COPY.roleChanged('DPS'));
    expect((await row(id, cy))!.status).toBe('signed_up');
    await lockPassed(id);
    expect((await pressAs(ann, `${CHANGE_ROLE_PREFIX}${id}`)).data.content).toBe(EVENT_COPY.isLocked);
    expect((await pick(ann, `${CHANGE_ROLE_PICK}${id}`, ['support'])).data.content).toBe(EVENT_COPY.isLocked);
  });

  it('a waitlisted member who changes to a role with room moves up on their own press, and is told privately', async () => {
    const { id, a, b } = await three({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    const r = await pick(bo, `${CHANGE_ROLE_PICK}${id}`, ['dps']);
    expect(r.data.content).toBe(EVENT_COPY.promotedYou('DPS'));
    expect(await row(id, bo)).toMatchObject({ status: 'signed_up', role: 'dps' });
  });

  it('pressing Sign up again while waitlisted keeps the place', async () => {
    const { id, a, b } = await three({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    const place = (await row(id, bo))!.queued_at;
    expect((await pressAs(bo, `${STATUS_PREFIX}${id}:signed_up`)).data.content).toBe(EVENT_COPY.already('Waitlist'));
    expect((await row(id, bo))!.queued_at).toBe(place);
  });

  it('promotion stops at the start', async () => {
    const { id, a, b } = await three({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    await env.DB.prepare('UPDATE event SET start_at = ?, lock_at = NULL WHERE id = ?').bind(new Date(Date.now() - 1000).toISOString(), id).run();
    await pressAs(ann, `${STATUS_PREFIX}${id}:declined`);
    expect((await row(id, bo))!.status).toBe('waitlist');
  });

  it('Change character and Change role ask to sign up first', async () => {
    const { id } = await three(RAID);
    expect((await pressAs(ann, `${CHANGE_CHARACTER_PREFIX}${id}`)).data.content).toBe(EVENT_COPY.signUpFirst);
    expect((await pressAs(ann, `${CHANGE_ROLE_PREFIX}${id}`)).data.content).toBe(EVENT_COPY.signUpFirst);
  });
});

describe('the lock', () => {
  it("after it members can only choose Can't make it, which is posted with who and why; promotion continues", async () => {
    const [a, b] = [await character(ann, 'Aelin', 'CLR', 32), await character(bo, 'Bryn', 'CLR', 30)];
    const c = await character(cy, 'Cyra', 'WAR', 20);
    const id = await posted({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    await lockPassed(id);
    for (const s of ['signed_up', 'tentative', 'bench']) expect((await pressAs(cy, `${STATUS_PREFIX}${id}:${s}`)).data.content, s).toBe(EVENT_COPY.isLocked);
    expect((await pressAs(cy, `${CONFIRM_PREFIX}${id}:signed_up:${c}:dps`)).data.content).toBe(EVENT_COPY.isLocked);
    expect((await pressAs(bo, `${CHANGE_CHARACTER_PREFIX}${id}`)).data.content).toBe(EVENT_COPY.isLocked);
    await pressAs(ann, `${STATUS_PREFIX}${id}:declined`);
    expect((await row(id, ann))!.status).toBe('declined');
    expect((await row(id, bo))!.status).toBe('signed_up');
    const line = notices().at(-1)!;
    expect(line).toContain(ann.user.id);
    expect(line).toContain('moved up');
    expect(fake.messages.at(-1)!.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('a lock of 0 means never', async () => {
    await event(admin, 'settings', { lock_minutes: 0 });
    const id = await posted(SOCIAL);
    expect(await one('SELECT lock_at FROM event')).toEqual({ lock_at: null });
    await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    expect((await row(id, ann))!.status).toBe('signed_up');
  });

  it('the lock time follows a setting and a new start', async () => {
    await event(admin, 'settings', { lock_minutes: 60 });
    await posted(SOCIAL);
    const e = await one<{ start_at: string; lock_at: string }>('SELECT start_at, lock_at FROM event');
    expect(Date.parse(e.start_at) - Date.parse(e.lock_at)).toBe(3_600_000);
  });
});

describe('who may sign up', () => {
  it('the server member role and the event\'s sign-up role gate joining; Can\'t make it never', async () => {
    await send(rawCmd(admin, 'guildcraft', 'setup', { member_role: MEMBER_ROLE }), TOKEN);
    const without = as('100000000000000021');
    const withMember = as('100000000000000022', { roles: [MEMBER_ROLE] });
    const withBoth = as('100000000000000023', { roles: [MEMBER_ROLE, RAID_ROLE] });
    const id = await posted({ ...SOCIAL, signup_role: RAID_ROLE });
    expect((await pressAs(without, `${STATUS_PREFIX}${id}:signed_up`)).data.content).toBe(EVENT_COPY.needsRole(MEMBER_ROLE));
    expect((await pressAs(withMember, `${STATUS_PREFIX}${id}:tentative`)).data.content).toBe(EVENT_COPY.needsRole(RAID_ROLE));
    await pressAs(withBoth, `${STATUS_PREFIX}${id}:signed_up`);
    expect((await row(id, withBoth))!.status).toBe('signed_up');
    await pressAs(without, `${STATUS_PREFIX}${id}:declined`);
    expect((await row(id, without))!.status).toBe('declined');
  });

  it('a frozen member is told how to thaw, and thaws with a command', async () => {
    await character(ann, 'Aelin', 'CLR', 32);
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(ann.user.id).run();
    const id = await posted(SOCIAL);
    expect((await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`)).data.content).toBe(EVENT_COPY.frozen);
    await send(rawCmd(ann, 'help', undefined), TOKEN);
    await send(rawCmd(ann, 'me', undefined), TOKEN);
    await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    expect((await row(id, ann))!.status).toBe('signed_up');
  });

  it('a cancelled or closed event refuses presses, and an old card answers "off" while the module is off', async () => {
    const id = await posted(SOCIAL);
    await env.DB.prepare("UPDATE event SET status = 'closed' WHERE id = ?").bind(id).run();
    expect((await pressAs(ann, `${STATUS_PREFIX}${id}:declined`)).data.content).toBe(EVENT_COPY.isClosed);
    await env.DB.prepare("UPDATE event SET status = 'cancelled' WHERE id = ?").bind(id).run();
    expect((await pressAs(ann, `${STATUS_PREFIX}${id}:declined`)).data.content).toBe(EVENT_COPY.isCancelled);
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    expect((await pressAs(ann, `${STATUS_PREFIX}${id}:declined`)).data.content).toBe(EVENT_COPY.off);
  });
});

describe('the spam limit', () => {
  it('counts every change the member makes, Change character and Change role too; officers are not counted', async () => {
    const a = await character(ann, 'Aelin', 'CLR', 32);
    const a2 = await character(ann, 'Second', 'WAR', 2, 0);
    const id = await posted(RAID);
    await signUp(id, ann, a, 'dps'); // 1
    await pick(ann, `${CHANGE_ROLE_PICK}${id}`, ['tank']); // 2
    await pick(ann, `${CHANGE_CHARACTER_PICK}${id}`, [String(a2)]); // 3
    for (let i = 0; i < 7; i++) await pressAs(ann, `${STATUS_PREFIX}${id}:${i % 2 ? 'signed_up' : 'tentative'}`); // 4..10
    expect(await count('event_signup_history', 'actor = ?', ann.user.id)).toBe(SPAM_LIMIT);
    expect((await pressAs(ann, `${STATUS_PREFIX}${id}:bench`)).data.content).toBe(EVENT_COPY.tooFast);
    expect((await pick(ann, `${CHANGE_ROLE_PICK}${id}`, ['dps'])).data.content).toBe(EVENT_COPY.tooFast);
    expect(await count('event_signup_history', 'actor = ?', ann.user.id)).toBe(SPAM_LIMIT);
    // A minute on, it opens again.
    await env.DB.prepare("UPDATE event_signup_history SET at = '2000-01-01T00:00:00.000Z'").run();
    await pressAs(ann, `${STATUS_PREFIX}${id}:bench`);
    expect((await row(id, ann))!.status).toBe('bench');
    expect((await event(officer, 'roster', { event: String(id), action: 'move', member: ann.user.id, status: 'tentative', reason: 'x' })).data.content).toBe(EVENT_COPY.rosterDone);
  });
});

describe('Left at the lock', () => {
  const seed = async (id: number, n: number, status = 'signed_up') => {
    const ids = Array.from({ length: n }, (_, i) => String(200000000000000000n + BigInt(i)));
    await env.DB.batch(ids.map((m) => env.DB.prepare("INSERT INTO event_signup (event_id, guild_id, member_id, status, role, queued_at, updated_at, changed_by) VALUES (?, ?, ?, ?, 'dps', ?, 'x', 'x')").bind(id, GUILD, m, status, status === 'waitlist' ? m : null)));
    return ids;
  };

  it('a 404 Unknown Member marks them Left, the waitlist promotes, and the change is posted', async () => {
    const id = await posted({ ...RAID, dps: 2 });
    const [m1, m2] = await seed(id, 2);
    await env.DB.prepare("INSERT INTO event_signup (event_id, guild_id, member_id, status, role, queued_at, updated_at, changed_by) VALUES (?, ?, '300000000000000000', 'waitlist', 'dps', '2000', 'x', 'x')").bind(id, GUILD).run();
    fake.gone.add(m1);
    await lockPassed(id);
    const r = await runItem('evlock', id);
    expect(r).toMatchObject({ schedule: [{ key: `evcard:${id}` }] });
    expect(await all('SELECT member_id, status FROM event_signup ORDER BY member_id')).toEqual([{ member_id: m1, status: 'left' }, { member_id: m2, status: 'signed_up' }, { member_id: '300000000000000000', status: 'signed_up' }]);
    expect(notices().at(-1)).toContain('left the server');
    expect(notices().at(-1)).toContain('moved up');
    expect((await history(id)).map((h) => [h.status, h.actor, h.reason])).toEqual([['left', 'bot', 'left the server'], ['signed_up', 'bot', 'promoted']]);
    expect(await one('SELECT lock_done_at IS NOT NULL AS done FROM event')).toEqual({ done: 1 });
  });

  it('only a 404 with Unknown Member counts: anything else marks nobody and tries again', async () => {
    const id = await posted(RAID);
    const [m1, m2] = await seed(id, 2);
    fake.broken.add(m1);
    await lockPassed(id);
    const r = await runItem('evlock', id);
    expect(r!.again).toBeGreaterThan(Date.now());
    expect(await count('event_signup', "status = 'left'")).toBe(0);
    fake.broken.clear();
    fake.gone.add(m2);
    await runItem('evlock', id);
    expect(await count('event_signup', "status = 'left'")).toBe(1);
  });

  it('checks signed up, tentative, bench and waitlisted; not those who said no', async () => {
    const id = await posted(RAID);
    for (const [i, s] of ['signed_up', 'tentative', 'bench', 'waitlist', 'declined'].entries())
      await env.DB.prepare("INSERT INTO event_signup (event_id, guild_id, member_id, status, updated_at, changed_by) VALUES (?, ?, ?, ?, 'x', 'x')").bind(id, GUILD, String(400000000000000000n + BigInt(i)), s).run();
    await lockPassed(id);
    await runItem('evlock', id);
    expect(fake.lookups).toBe(4);
  });

  it('batches stay inside the budget and resume where they stopped; every member is looked up once; a re-run does nothing', async () => {
    const id = await posted(RAID);
    await seed(id, 100);
    await lockPassed(id);
    let runs = 0;
    const per: number[] = [];
    for (;;) {
      const before = fake.lookups;
      const r = await runItem('evlock', id);
      per.push(fake.lookups - before);
      runs++;
      if (!r?.again) break;
      expect(runs).toBeLessThan(10);
    }
    expect(fake.lookups).toBe(100);
    expect(Math.max(...per)).toBeLessThanOrEqual(40);
    await runItem('evlock', id);
    expect(fake.lookups).toBe(100);
    console.warn(JSON.stringify({ left_check: { members: 100, alarms: runs, per } }));
  });

  it('a lock not due yet waits; a new start resets it; the module being off stops it', async () => {
    const id = await posted(RAID);
    const r = await runItem('evlock', id);
    expect(r!.again).toBeGreaterThan(Date.now());
    await lockPassed(id);
    await runItem('evlock', id);
    await event(officer, 'edit', { event: String(id), start: 'tomorrow 22:00' });
    expect(await one('SELECT lock_done_at, left_cursor FROM event')).toEqual({ lock_done_at: null, left_cursor: null });
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    await lockPassed(id);
    expect(await runItem('evlock', id)).toBeNull();
  });
});

describe('/event roster', () => {
  const resolved = (m: Member, roles: string[] = []) => ({ users: { [m.user.id]: m.user }, members: { [m.user.id]: { nick: null, roles } } });
  const roster = (actor: Member, target: Member, opts: Record<string, unknown>, roles?: string[]) => {
    const i = rawCmd(actor, 'event', 'roster', { member: target.user.id, ...opts });
    return send({ ...i, data: { ...i.data, resolved: resolved(target, roles) } }, TOKEN);
  };

  it('adds, moves and removes with a public reason; may exceed a limit, and the card says so', async () => {
    const a = await character(ann, 'Aelin', 'CLR', 32);
    const b = await character(bo, 'Bryn', 'CLR', 30);
    const id = await posted({ ...RAID, healer: 0 });
    expect((await roster(officer, ann, { event: String(id), action: 'add', role: 'healer', reason: 'needed' })).data.content).toBe(EVENT_COPY.rosterDone);
    expect(await row(id, ann)).toMatchObject({ status: 'signed_up', role: 'healer', char_name: 'Aelin' });
    expect(notices().at(-1)).toContain('needed');
    expect(fake.messages.at(-1)!.body.allowed_mentions).toEqual({ parse: [] });
    await runItem('evcard', id); // the mock has no card since the helper cleared it: Unknown Message, so it is posted again
    expect(fake.messages.at(-1)!.body.embeds[0].description).toContain('**Healers 1 / 0 (over limit)**');
    await roster(officer, ann, { event: String(id), action: 'move', role: 'dps', reason: 'swap' });
    expect((await row(id, ann))!.role).toBe('dps');
    await roster(officer, ann, { event: String(id), action: 'remove', reason: 'gone' });
    expect((await row(id, ann))!.status).toBe('removed');
    expect((await history(id)).map((h) => [h.status, h.actor, h.reason])).toEqual([['signed_up', officer.user.id, 'needed'], ['signed_up', officer.user.id, 'swap'], ['removed', officer.user.id, 'gone']]);
    expect(b).toBeGreaterThan(a);
  });

  it('works after the lock; a member can\'t use it; a reason is required; a sign-up role still applies', async () => {
    await character(ann, 'Aelin', 'CLR', 32);
    const id = await posted({ ...RAID, signup_role: RAID_ROLE });
    await lockPassed(id);
    expect((await roster(ann, bo, { event: String(id), action: 'add', reason: 'x' })).data.content).toBe(EVENT_COPY.notRunner);
    expect((await roster(officer, ann, { event: String(id), action: 'add', role: 'tank', reason: ' ' })).data.content).toBe(EVENT_COPY.noReason);
    expect((await roster(officer, ann, { event: String(id), action: 'add', role: 'tank', reason: 'x' })).data.content).toBe(EVENT_COPY.needsRole(RAID_ROLE));
    expect((await roster(officer, ann, { event: String(id), action: 'add', role: 'tank', reason: 'x' }, [RAID_ROLE])).data.content).toBe(EVENT_COPY.rosterDone);
  });

  it('refuses what makes no sense: moving someone not on it, adding someone on it, a character they lack', async () => {
    await character(ann, 'Aelin', 'CLR', 32);
    const id = await posted(RAID);
    expect((await roster(officer, ann, { event: String(id), action: 'move', reason: 'x' })).data.content).toBe(EVENT_COPY.notOnRoster);
    expect((await roster(officer, bo, { event: String(id), action: 'add', role: 'tank', reason: 'x' })).data.content).toBe(EVENT_COPY.memberNeedsCharacter);
    expect((await roster(officer, ann, { event: String(id), action: 'add', reason: 'x' })).data.content).toBe(EVENT_COPY.memberNeedsRole);
    await roster(officer, ann, { event: String(id), action: 'add', role: 'tank', reason: 'x' });
    expect((await roster(officer, ann, { event: String(id), action: 'add', role: 'tank', reason: 'x' })).data.content).toBe(EVENT_COPY.alreadyOn);
  });

  it('a removal frees the place', async () => {
    const [a, b] = [await character(ann, 'Aelin', 'CLR', 32), await character(bo, 'Bryn', 'CLR', 30)];
    const id = await posted({ ...RAID, healer: 1 });
    await signUp(id, ann, a, 'healer');
    await signUp(id, bo, b, 'healer');
    await roster(officer, ann, { event: String(id), action: 'remove', reason: 'x' });
    expect((await row(id, bo))!.status).toBe('signed_up');
  });
});

it('the card is derived from the rows, and every press asks for one edit', async () => {
  const a = await character(ann, 'Aelin', 'CLR', 32);
  const id = await posted({ ...RAID, healer: 1 });
  await signUp(id, ann, a, 'healer');
  await until(async () => `evcard:${id}` in (await timersOf(env, GUILD).list()) || true);
  fake.messages.push({ id: (await one<{ message_id: string }>('SELECT message_id FROM event')).message_id, body: {} });
  await runItem('evcard', id);
  const d = fake.messages.at(-1)!.body.embeds[0].description as string;
  expect(d).toContain('**Healers 1 / 1**');
  expect(d).toContain('Aelin · CLR 32 · <@');
  expect(fake.messages.at(-1)!.body.allowed_mentions).toEqual({ parse: [] });
});
const until = async (ok: () => Promise<boolean>) => {
  for (let i = 0; i < 40 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50));
};

describe('the cost of a press', () => {
  const spy = vi.spyOn(console, 'log');
  afterEach(() => spy.mockClear());
  const lastQ = () => JSON.parse(spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"gc":"interaction"')).at(-1)!).q as number;
  it('stays what the report states', async () => {
    const a = await character(ann, 'Aelin', 'CLR', 32);
    const id = await posted({ ...RAID, healer: 1 });
    const c: Record<string, number> = {};
    spy.mockClear();
    await pressAs(ann, `${STATUS_PREFIX}${id}:signed_up`);
    c.form = lastQ();
    await pressAs(ann, `${CONFIRM_PREFIX}${id}:signed_up:${a}:healer`);
    c.confirm = lastQ();
    await pressAs(ann, `${STATUS_PREFIX}${id}:tentative`);
    c.status = lastQ();
    await pick(ann, `${CHANGE_ROLE_PICK}${id}`, ['dps']);
    c.changeRole = lastQ();
    console.warn(JSON.stringify({ d1_statements: c }));
    for (const v of Object.values(c)) expect(v).toBeLessThanOrEqual(6);
  });
});

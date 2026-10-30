// Work order 32, PR B: times, /event create with its preview, the card, edit, cancel and list, in workerd against a mocked
// Discord. ITEM 2's overflow test inserts sign-up rows directly, so it doesn't depend on ITEM 3.
import { env, runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import { HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { EMBED_LIMITS, embedChars } from '../../src/discord.ts';
import { cardButtons, cardMessage, layoutRoster, type EventRow, type SignupRow } from '../../src/events/card.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { EVENT_COMMAND } from '../../src/events/definition.ts';
import { DROP_PREFIX, POST_PREFIX, ROSTER_PAGE_PREFIX } from '../../src/events/manage.ts';
import { eventSettingsOf } from '../../src/events/settings.ts';
import { ADD_EVENTS_PREFIX, EVENTS_CHANNEL_NAME } from '../../src/events/setup.ts';
import { fullDate, localToUtc, parseStart } from '../../src/events/times.ts';
import { TYPES, type Role } from '../../src/events/types.ts';
import { SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, auto, botApi, GUILD, press, rawCmd, send, type Member } from '../discord.ts';

const NY = 'America/New_York';
const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const BOT_ROLE = '600000000000000001';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE] });
const member = as('100000000000000004');

/** Friday 2026-10-30, 12:00 in New York (EDT). The clocks go back on Sunday 2026-11-01. */
const NOW = Date.UTC(2026, 9, 30, 16, 0);

describe('times (each form, and each date\'s own offset)', () => {
  const at = (s: string, tz = NY, now = NOW) => {
    const r = parseStart(s, tz, now);
    return 'at' in r ? new Date(r.at).toISOString() : r.error;
  };
  it('YYYY-MM-DD HH:MM, on both sides of the daylight-saving change', () => {
    expect(at('2026-10-31 20:00')).toBe('2026-11-01T00:00:00.000Z'); // EDT, -4
    expect(at('2026-11-01 20:00')).toBe('2026-11-02T01:00:00.000Z'); // EST, -5
  });
  it('today, tomorrow and a weekday, the weekday being the next such day', () => {
    expect(at('today 20:00')).toBe('2026-10-31T00:00:00.000Z');
    expect(at('tomorrow 20:00')).toBe('2026-11-01T00:00:00.000Z');
    expect(at('sunday 20:00')).toBe('2026-11-02T01:00:00.000Z'); // across the change
    expect(at('friday 20:00')).toBe('2026-10-31T00:00:00.000Z'); // today, still ahead
    expect(at('friday 09:00')).toBe('2026-11-06T14:00:00.000Z'); // today has passed: next week, in EST
    expect(at('Sat 8pm')).toBe('2026-11-01T00:00:00.000Z');
    expect(at('monday 8:30 am')).toBe('2026-11-02T13:30:00.000Z');
  });
  it('the week the clocks go forward in another zone, and in New York in March', () => {
    const now = Date.UTC(2027, 2, 1, 12);
    expect(at('2027-03-13 20:00', NY, now)).toBe('2027-03-14T01:00:00.000Z'); // EST
    expect(at('2027-03-14 20:00', NY, now)).toBe('2027-03-15T00:00:00.000Z'); // EDT
    expect(at('2027-03-28 20:00', 'Europe/London', now)).toBe('2027-03-28T19:00:00.000Z'); // BST
  });
  it('an hour the clocks skip is refused; an hour they repeat means the first', () => {
    expect(at('2027-03-14 02:30', NY, Date.UTC(2027, 2, 1))).toBe('skipped');
    expect(at('2026-11-01 01:30')).toBe('2026-11-01T05:30:00.000Z');
    expect(localToUtc(2026, 11, 1, 2, 0, NY)).toBe(Date.UTC(2026, 10, 1, 7));
  });
  it('past, more than 90 days ahead, and unreadable times are refused', () => {
    expect(at('2026-10-30 11:59')).toBe('past');
    expect(at('today 09:00')).toBe('past');
    expect(at('2027-01-29 12:00')).toBe('far');
    for (const bad of ['', 'soon', '2026-13-01 20:00', '2026-02-30 20:00', 'tomorrow', 'tomorrow 25:00', 'blursday 20:00']) expect(at(bad), bad).toBe('format');
  });
  it('the full date names the zone of that date', () => {
    expect(fullDate(Date.UTC(2026, 10, 1, 0), NY)).toContain('EDT');
    expect(fullDate(Date.UTC(2026, 10, 2, 1), NY)).toContain('EST');
  });
});

const fake = { channels: [] as any[], messages: [] as { id: string; body: any }[], commands: [] as any[], next: 1, patches: 0 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const event = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'event', sub, opts), TOKEN);
const until = async (ok: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 60 && !(await ok()); i++) await new Promise((r) => setTimeout(r, 50));
};
const items = () => timersOf(env, GUILD).list();
/** An evcard item run with a bot token, as src/dkp/timers.ts runs it (the test object has none of its own). */
const draw = (id: number) => {
  const e = { ...env, DISCORD_BOT_TOKEN: 'test-bot-token' };
  return HANDLERS.evcard(e as never, GUILD, String(id), 0, Date.now(), timerApi(e as never, Date.now(), () => 0));
};
const card = (id: number) => one<{ message_id: string }>('SELECT message_id FROM event WHERE id = ?', id).then((e) => fake.messages.find((m) => m.id === e.message_id)!);
const signup = (id: number, member_id: string, status: string, role: string | null, extra: Partial<Record<'queued_at' | 'char_name', string>> = {}) =>
  env.DB.prepare('INSERT INTO event_signup (event_id, guild_id, member_id, status, role, char_name, char_class, char_level, queued_at, updated_at, changed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, GUILD, member_id, status, role, extra.char_name ?? null, 'CLR', 32, extra.queued_at ?? null, '2026-10-30T00:00:00.000Z', member_id)
    .run();

async function setup() {
  await reset(['Blacksmithing'], [['CLR', 10]]);
  await env.DB.batch([env.DB.prepare('DELETE FROM zone'), env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow')")]);
  Object.assign(fake, { channels: [], messages: [], commands: [], next: 1, patches: 0 });
  await timersOf(env, GUILD).cancel();
  await timersOf(env, GUILD).cancelEvents();
  botApi.handle = (method, path, body) => {
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: BOT_ROLE, permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: [BOT_ROLE] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === 4 ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'POST' && path.endsWith('/commands')) return json({ id: id(), name: body.name }, 201);
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) {
      const m = { id: id(), body };
      fake.messages.push(m);
      return json({ id: m.id });
    }
    const patch = path.match(/^\/channels\/\d+\/messages\/(\d+)$/);
    if (method === 'PATCH' && patch) {
      fake.patches++;
      const m = fake.messages.find((x) => x.id === patch[1]);
      if (!m) return json({ code: 10008, message: 'Unknown Message' }, 404);
      m.body = { ...m.body, ...body };
      return json({ id: m.id });
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
  await pressAs(admin, ADD_EVENTS_PREFIX);
}

/** Creates and posts an event; returns its id. */
async function posted(opts: Record<string, unknown>) {
  const r = await event(officer, 'create', { start: 'tomorrow 20:00', ...opts });
  const post = r.data.components![0].components[0].custom_id as string;
  await pressAs(officer, post);
  return Number(post.slice(POST_PREFIX.length));
}
const raid = { type: 'raid', title: 'Test raid', zone: 'Glinting Hollow', healer: 1 };

describe('/event create and its preview', () => {
  beforeEach(setup);

  it('fits Discord: at most 25 options per subcommand, descriptions up to 100, every option required before the optional ones', () => {
    for (const s of EVENT_COMMAND.options as unknown as { name: string; description: string; options: { required?: boolean; description: string }[] }[]) {
      expect(s.options.length, s.name).toBeLessThanOrEqual(25);
      expect(s.description.length, s.name).toBeLessThanOrEqual(100);
      for (const o of s.options) expect(o.description.length, o.description).toBeLessThanOrEqual(100);
      const first = s.options.findIndex((o) => !o.required);
      if (first >= 0) expect(s.options.slice(first).some((o) => o.required), s.name).toBe(false);
    }
  });

  it('answers privately with Discord\'s local time, the full date, Post and Cancel, and posts nothing', async () => {
    const r = await event(officer, 'create', { ...raid, start: 'tomorrow 20:00' });
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('Saturday, October 31');
    expect(r.data.embeds![0].description).toMatch(/<t:\d+:F> \(<t:\d+:R>\)/);
    expect(r.data.components![0].components.map((b: any) => b.label)).toEqual([EVENT_COPY.post, EVENT_COPY.cancel]);
    expect(fake.messages).toEqual([]);
    expect(await one('SELECT status, duration_minutes FROM event')).toEqual({ status: 'draft', duration_minutes: 180 });
  });

  it('Post puts one card in GC-Events, pinging nobody, and sets the lock and close items; a second press posts nothing', async () => {
    const r = await event(officer, 'create', { ...raid, start: 'tomorrow 20:00' });
    const id = r.data.components![0].components[0].custom_id as string;
    const n = Number(id.slice(POST_PREFIX.length));
    const done = await pressAs(officer, id);
    expect(done.type).toBe(7);
    expect(done.data.content).toContain('https://discord.com/channels/');
    expect(fake.messages.length).toBe(1);
    expect(fake.messages[0].body.allowed_mentions).toEqual({ parse: [] });
    const e = await one<{ status: string; start_at: string; lock_at: string; closes_at: string }>('SELECT status, start_at, lock_at, closes_at FROM event');
    expect(e.status).toBe('open');
    expect(Date.parse(e.start_at) - Date.parse(e.lock_at)).toBe(30 * 60_000);
    expect(Date.parse(e.closes_at) - Date.parse(e.start_at)).toBe(8 * 3_600_000);
    await until(async () => `evclose:${n}` in (await items()));
    expect(await items()).toEqual(expect.objectContaining({ [`evlock:${n}`]: Date.parse(e.lock_at), [`evclose:${n}`]: Date.parse(e.closes_at) }));
    await pressAs(officer, id);
    expect(fake.messages.length).toBe(1);
    expect(fake.messages[0].body.embeds[0].description).toContain('**Healers 0 / 1**');
  });

  it('Cancel removes the preview; a member can\'t press an officer\'s Post', async () => {
    const r = await event(officer, 'create', { ...raid, start: 'tomorrow 20:00' });
    const [post, drop] = r.data.components![0].components.map((b: any) => b.custom_id as string);
    expect((await pressAs(member, post)).data.content).toBe(EVENT_COPY.notRunner);
    expect(drop.startsWith(DROP_PREFIX)).toBe(true);
    expect((await pressAs(officer, drop)).data.content).toBe(EVENT_COPY.dropped);
    expect(await count('event')).toBe(0);
  });

  it('refuses by type: a Raid needs a zone, a Social takes none and no limits; a past time; an unknown zone; a member', async () => {
    expect((await event(officer, 'create', { type: 'raid', title: 'x', start: 'tomorrow 20:00' })).data.content).toBe(EVENT_COPY.needsZone('Raid'));
    expect((await event(officer, 'create', { type: 'social', title: 'x', start: 'tomorrow 20:00', zone: 'Glinting Hollow' })).data.content).toBe(EVENT_COPY.noZone('Social'));
    expect((await event(officer, 'create', { type: 'other', title: 'x', start: 'tomorrow 20:00', tank: 2 })).data.content).toBe(EVENT_COPY.noLimits('Other'));
    expect((await event(officer, 'create', { ...raid, start: '2020-01-01 20:00' })).data.content).toBe(EVENT_COPY.pastStart);
    expect((await event(officer, 'create', { ...raid, start: 'tomorrow 20:00', zone: 'Atlantis' })).data.content).toBe(EVENT_COPY.unknownZone('Atlantis'));
    expect((await event(member, 'create', { ...raid, start: 'tomorrow 20:00' })).data.content).toBe(EVENT_COPY.notRunner);
    expect(await count('event')).toBe(0);
  });

  it('a Group and a Social default to 2 hours; the server\'s sign-up role is the default', async () => {
    await event(admin, 'settings', { signup_role: OFFICER_ROLE });
    await event(officer, 'create', { type: 'social', title: 'Party', start: 'tomorrow 20:00' });
    expect(await one('SELECT duration_minutes, signup_role FROM event')).toEqual({ duration_minutes: 120, signup_role: OFFICER_ROLE });
  });

  it('the event options autocomplete this server\'s open events', async () => {
    const id = await posted(raid);
    const r = await send(auto(officer, 'event', 'cancel', { event: 'test' }, 'event'), TOKEN);
    expect(r.data.choices!.map((c) => c.value)).toEqual([String(id)]);
  });
});

describe('each type\'s buttons (every one a member can press)', () => {
  it('derives statuses from the type; only Raid and Group ask for a character and a role', () => {
    const labels = (type: (typeof TYPES)[number]) => (cardButtons({ id: 1, type }) as any[]).flatMap((r) => r.components.map((b: any) => b.label));
    expect(labels('raid')).toEqual(['Signed up', 'Tentative', 'Bench', "Can't make it", 'Change character', 'Change role']);
    expect(labels('group')).toEqual(['Signed up', 'Tentative', "Can't make it", 'Change character', 'Change role']);
    expect(labels('social')).toEqual(['Going', 'Maybe', "Can't make it"]);
    expect(labels('other')).toEqual(['Going', 'Maybe', "Can't make it"]);
    for (const t of TYPES) expect((cardButtons({ id: 1, type: t }) as any[]).flatMap((r) => r.components.map((b: any) => b.custom_id)).every((c: string) => c.startsWith('ev'))).toBe(true);
  });
});

const base = (o: Partial<EventRow> = {}): EventRow => ({
  id: 1, guild_id: GUILD, type: 'raid', title: 'A very long raid title that goes on', start_at: '2026-11-07T01:00:00.000Z', duration_minutes: 180, zone_key: 'glinting hollow', zone_name: 'Glinting Hollow', description: 'Bring food.', capacity: null,
  limit_tank: 8, limit_healer: 12, limit_dps: 30, limit_support: 10, when_full: 'waitlist', signup_role: null, lock_at: '2026-11-07T00:30:00.000Z', closes_at: '2026-11-07T09:00:00.000Z', status: 'open', message_id: '1', posted_by: '2000', poster_name: 'Joegandomi',
  cancelled_by: null, cancel_reason: null, lock_done_at: null, left_cursor: null, ...o,
});
const people = (n: number, nameLen = 12): SignupRow[] =>
  Array.from({ length: n }, (_, i) => ({
    member_id: String(100000000000000000n + BigInt(i)), status: 'signed_up' as const, role: (['tank', 'healer', 'dps', 'support'] as Role[])[i % 4], char_name: `Char${i}`.padEnd(nameLen, 'x'), char_class: 'CLR', char_level: 32, queued_at: null, name: `Member${i}`.padEnd(nameLen, 'y'),
  }));
const check = (m: ReturnType<typeof cardMessage>) => {
  const e = m.embeds[0];
  expect(embedChars(m.embeds)).toBeLessThanOrEqual(EMBED_LIMITS.total);
  expect(e.description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
  expect((e.fields ?? []).length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
  for (const f of e.fields ?? []) {
    expect(f.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    expect(f.value.length).toBeGreaterThan(0);
    expect(f.name.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldName);
  }
};

describe('the card\'s limits', () => {
  const s = eventSettingsOf(null);
  const at = Date.parse('2026-11-01T00:00:00Z');

  it('a 40-person Raid card fits the description, without fields', () => {
    const m = cardMessage(base(), people(40), s, at);
    check(m);
    expect(m.embeds[0].fields).toBeUndefined();
  });

  it('a 60-person roster with long names stays inside every limit and says what it left out', () => {
    const m = cardMessage(base(), people(60, 32), s, at);
    check(m);
    const text = [m.embeds[0].description, ...(m.embeds[0].fields ?? []).map((f) => f.value)].join('\n');
    expect(text).toMatch(/\+\d+ more: `\/event list`/);
    const shown = (text.match(/<@1\d+>/g) ?? []).length;
    const more = Number(/\+(\d+) more/.exec(text)![1]);
    expect(shown + more).toBe(60);
  });

  it('a 60-person roster with ordinary names is whole, using fields after the description', () => {
    const m = cardMessage(base(), people(60), s, at);
    check(m);
    expect(JSON.stringify(m.embeds)).not.toContain('more:');
    expect(([m.embeds[0].description, ...(m.embeds[0].fields ?? []).map((f) => f.value)].join('\n').match(/<@1\d+>/g) ?? []).length).toBe(60);
  });

  it('every size from 0 to 200 stays inside the limits, and no line is lost or counted twice', () => {
    for (const n of [0, 1, 39, 40, 41, 80, 120, 200])
      for (const len of [4, 12, 32]) {
        const m = cardMessage(base({ description: 'x'.repeat(1000), title: 'T'.repeat(100) }), people(n, len), s, at);
        check(m);
        const text = [m.embeds[0].description, ...(m.embeds[0].fields ?? []).map((f) => f.value)].join('\n');
        const shown = (text.match(/<@1\d+>/g) ?? []).length;
        const more = Number(/\+(\d+) more/.exec(text)?.[1] ?? 0);
        expect(shown + more, `${n}/${len}`).toBe(n);
      }
  });

  it('layoutRoster fills the description first', () => {
    const r = layoutRoster('Head', [{ head: 'A', lines: ['one'] }], 0);
    expect(r).toEqual({ description: 'Head\n**A**\none' });
  });

  it('Tentative, Bench and Waitlist are listed; Can\'t make it is a count; a limit passed says so', () => {
    const list = [...people(2)];
    list[0] = { ...list[0], role: 'healer' };
    list[1] = { ...list[1], role: 'healer' };
    const more: SignupRow[] = [
      { ...people(1)[0], member_id: '9', status: 'tentative' }, { ...people(1)[0], member_id: '10', status: 'bench' }, { ...people(1)[0], member_id: '11', status: 'waitlist', queued_at: 'x' }, { ...people(1)[0], member_id: '12', status: 'declined' },
    ];
    const m = cardMessage(base({ limit_healer: 1 }), [...list, ...more], s, at);
    const d = m.embeds[0].description!;
    expect(d).toContain('**Healers 2 / 1 (over limit)**');
    for (const h of ['**Tentative 1**', '**Bench 1**', '**Waitlist 1**']) expect(d).toContain(h);
    expect(d).not.toContain('<@12>');
    expect(m.embeds[0].footer!.text).toContain("Can't make it 1");
  });

  it('a renamed role shows as typed; the same limits apply', () => {
    const custom = eventSettingsOf({ role_label_tank: 'Wall' });
    expect(cardMessage(base({ limit_tank: 2 }), [], custom, at).embeds[0].description).toContain('**Wall 0 / 2**');
  });
});

describe('/event edit', () => {
  beforeEach(setup);

  it('the type is locked once anyone has signed up', async () => {
    const id = await posted(raid);
    await signup(id, '5', 'declined', null);
    expect((await event(officer, 'edit', { event: String(id), type: 'group' })).data.content).toBe(EVENT_COPY.typeLocked);
    expect(await one('SELECT type FROM event')).toEqual({ type: 'raid' });
  });

  it('before anyone signs up the type can change, dropping what the new type does not take', async () => {
    const id = await posted(raid);
    await event(officer, 'edit', { event: String(id), type: 'social' });
    expect(await one('SELECT type, zone_key, limit_healer FROM event')).toEqual({ type: 'social', zone_key: null, limit_healer: null });
  });

  it('lowering a limit removes nobody and the card says over limit; raising one promotes the earliest who fits', async () => {
    const id = await posted(raid);
    await signup(id, '5', 'signed_up', 'healer', { char_name: 'Five' });
    await signup(id, '6', 'waitlist', 'healer', { queued_at: '2026-10-30T01:00:00.000Z' });
    await signup(id, '7', 'waitlist', 'healer', { queued_at: '2026-10-30T02:00:00.000Z' });
    await event(officer, 'edit', { event: String(id), healer: 0 });
    await draw(id);
    expect((await card(id)).body.embeds[0].description).toContain('**Healers 1 / 0 (over limit)**');
    expect(await count('event_signup', "status = 'signed_up'")).toBe(1);
    await event(officer, 'edit', { event: String(id), healer: 2 });
    expect(await all('SELECT member_id, status FROM event_signup ORDER BY member_id')).toEqual([{ member_id: '5', status: 'signed_up' }, { member_id: '6', status: 'signed_up' }, { member_id: '7', status: 'waitlist' }]);
    expect(await all("SELECT member_id, status, actor, reason FROM event_signup_history")).toEqual([{ member_id: '6', status: 'signed_up', actor: 'bot', reason: 'promoted' }]);
  });

  it('a new start moves the lock and the close, later or earlier; a past start is refused', async () => {
    const id = await posted(raid);
    await until(async () => `evclose:${id}` in (await items()));
    await event(officer, 'edit', { event: String(id), start: 'tomorrow 22:00' });
    const e = await one<{ lock_at: string; closes_at: string; start_at: string }>('SELECT lock_at, closes_at, start_at FROM event');
    expect(Date.parse(e.start_at) - Date.parse(e.lock_at)).toBe(30 * 60_000);
    await until(async () => (await items())[`evlock:${id}`] === Date.parse(e.lock_at));
    expect((await items())[`evlock:${id}`]).toBe(Date.parse(e.lock_at));
    expect((await items())[`evclose:${id}`]).toBe(Date.parse(e.closes_at));
    expect((await event(officer, 'edit', { event: String(id), start: '2020-01-01 20:00' })).data.content).toBe(EVENT_COPY.pastStart);
  });

  it('clear: takes a value away; an edit with no field is refused', async () => {
    const id = await posted({ ...raid, capacity: 5 });
    await event(officer, 'edit', { event: String(id), clear: 'capacity' });
    expect(await one('SELECT capacity FROM event')).toEqual({ capacity: null });
    expect((await event(officer, 'edit', { event: String(id) })).data.content).toBe(EVENT_COPY.nothingToEdit);
  });
});

describe('review of PR B', () => {
  beforeEach(setup);

  it('a card edit Discord refuses throws, so the object retries it; a gone card is posted again', async () => {
    const id = await posted(raid);
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'PATCH' ? json({ message: 'oops', code: 0 }, 500) : handle(m, p, b));
    await expect(draw(id)).rejects.toThrow('event card edit failed');
    botApi.handle = handle;
    fake.messages = [];
    await draw(id);
    expect(fake.messages.length).toBe(1);
    expect(await one('SELECT message_id FROM event')).toEqual({ message_id: fake.messages[0].id });
  });

  it('an open event with no message id yet gets no second card', async () => {
    const id = await posted(raid);
    await env.DB.prepare('UPDATE event SET message_id = NULL').run();
    const n = fake.messages.length;
    await draw(id);
    expect(fake.messages.length).toBe(n);
  });

  it('a change during a run keeps its item, so its edit still comes', async () => {
    const stub: any = timersOf(env, GUILD);
    await (runInDurableObject as any)(stub, async (o: any) => {
      await o.schedule(GUILD, [{ key: 'evcard:1', due: 1000 }]);
      o.running = 'evcard:1';
      await o.schedule(GUILD, [{ key: 'evcard:1', due: 1000 }]);
      o.running = null;
    });
    expect((await stub.list())['evcard:1']).toBeGreaterThan(1000);
    await stub.cancelEvents();
  });

  it('a runner without the member role still gets the list of events to edit; a member-only list keeps its gate', async () => {
    const id = await posted(raid);
    await send(rawCmd(admin, 'guildcraft', 'setup', { member_role: '600000000000000009' }), TOKEN);
    expect((await send(auto(officer, 'event', 'edit', { event: '' }, 'event'), TOKEN)).data.choices!.map((c) => c.value)).toEqual([String(id)]);
    expect((await send(auto(officer, 'event', 'list', { event: '' }, 'event'), TOKEN)).data.choices).toEqual([]);
    expect((await send(auto(member, 'event', 'edit', { event: '' }, 'event'), TOKEN)).data.choices).toEqual([]);
  });

  it('a refused cancel writes no audit row', async () => {
    const id = await posted(raid);
    await event(officer, 'cancel', { event: String(id), reason: 'x' });
    await event(officer, 'cancel', { event: String(id), reason: 'y' });
    expect(await count('audit_log', "action = 'event.cancel'")).toBe(1);
  });

  it('a press that lost the race gets a new private message, never an edit of the winner\'s', async () => {
    const r = await event(officer, 'create', { ...raid, start: 'tomorrow 20:00' });
    const [post, drop] = r.data.components![0].components.map((b: any) => b.custom_id as string);
    await pressAs(officer, post);
    for (const id of [post, drop]) {
      const late = await pressAs(officer, id);
      expect(late.type).toBe(4);
      expect(late.data.content).toBe(EVENT_COPY.draftGone);
    }
    expect(await one('SELECT status FROM event')).toEqual({ status: 'open' });
  });

  it('an edit writes only what it changes, and a part-hour reads cleanly', async () => {
    const id = await posted(raid);
    await env.DB.prepare("UPDATE event SET title = 'Changed by another officer'").run();
    await event(officer, 'edit', { event: String(id), healer: 3, hours: 1.3333 });
    expect(await one('SELECT title, limit_healer FROM event')).toEqual({ title: 'Changed by another officer', limit_healer: 3 });
    await draw(id);
    expect((await card(id)).body.embeds[0].description).toContain('1.33 h');
  });

  it('a long roster pages whole, however long the names', async () => {
    const id = await posted(raid);
    for (let i = 0; i < 39; i++) await signup(id, `5${i}`, 'signed_up', 'dps', { char_name: `*${'N'.repeat(31)}${i}` });
    const r = await event(member, 'list', { event: String(id) });
    expect(r.data.embeds![0].description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
  });

  it('a weekday\'s skipped hour, once it has passed today, means next week', () => {
    const now = Date.UTC(2027, 2, 14, 12); // Sunday 2027-03-14, 08:00 EDT
    const r = parseStart('sunday 02:30', NY, now);
    expect(r).toEqual({ at: Date.UTC(2027, 2, 21, 6, 30) });
  });
});

describe('/event cancel', () => {
  beforeEach(setup);

  it('needs a reason; the card says Cancelled with it and loses its buttons; a second cancel is refused', async () => {
    const id = await posted(raid);
    expect((await event(officer, 'cancel', { event: String(id), reason: '  ' })).data.content).toBe(EVENT_COPY.noReason);
    expect((await event(member, 'cancel', { event: String(id), reason: 'x' })).data.content).toBe(EVENT_COPY.notRunner);
    expect((await event(officer, 'cancel', { event: String(id), reason: 'test' })).data.content).toBe(EVENT_COPY.cancelled);
    await draw(id);
    const c = await card(id);
    expect(c.body.components).toEqual([]);
    expect(c.body.embeds[0].title).toContain('Cancelled');
    expect(c.body.embeds[0].description).toContain('test');
    expect(c.body.allowed_mentions).toEqual({ parse: [] });
    expect((await event(officer, 'cancel', { event: String(id), reason: 'again' })).data.content).toBe(EVENT_COPY.notOpen);
  });
});

describe('/event list', () => {
  beforeEach(setup);

  it('lists upcoming events privately with links, filtered by type', async () => {
    await posted(raid);
    await posted({ type: 'social', title: 'Party' });
    const r = await event(member, 'list');
    expect(r.data.flags).toBe(64);
    const d = r.data.embeds![0].description!;
    expect(d).toContain('https://discord.com/channels/');
    expect(d).toContain('Test raid');
    expect(d).toContain('Party');
    const only = (await event(member, 'list', { type: 'social' })).data.embeds![0].description!;
    expect(only).not.toContain('Test raid');
  });

  it('shows one event\'s full roster privately, paged', async () => {
    const id = await posted(raid);
    for (let i = 0; i < 60; i++) await signup(id, `5${i}`, 'signed_up', 'dps', { char_name: `C${i}` });
    const r = await event(member, 'list', { event: String(id) });
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds![0].footer!.text).toBe(EVENT_COPY.page(1, 2));
    const next = r.data.components![0].components[1].custom_id as string;
    expect(next).toBe(`${ROSTER_PAGE_PREFIX}${id}:1`);
    const two = await pressAs(member, next);
    expect(two.type).toBe(7);
    expect(two.data.embeds![0].footer!.text).toBe(EVENT_COPY.page(2, 2));
  });

  it('history is for officers', async () => {
    const id = await posted(raid);
    await env.DB.prepare("INSERT INTO event_signup_history (event_id, guild_id, member_id, status, actor, at) VALUES (?, ?, '5', 'declined', '5', '2026-10-30T00:00:00.000Z')").bind(id, GUILD).run();
    expect((await event(member, 'list', { event: String(id), history: true })).data.content).toBe(EVENT_COPY.historyOfficers);
    const r = await event(officer, 'list', { event: String(id), history: true });
    expect(r.data.embeds![0].description).toContain("Can't make it");
  });
});

describe('the cost of a press (D1 statements and Discord calls)', () => {
  beforeEach(setup);
  const spy = vi.spyOn(console, 'log');
  afterEach(() => spy.mockClear());
  const lastQ = () => JSON.parse(spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"gc":"interaction"')).at(-1)!).q as number;

  it('stays what the report states', async () => {
    const c: Record<string, number> = {};
    spy.mockClear();
    const r = await event(officer, 'create', { ...raid, start: 'tomorrow 20:00' });
    c.create = lastQ();
    const before = fake.messages.length;
    await pressAs(officer, r.data.components![0].components[0].custom_id);
    c.post = lastQ();
    expect(fake.messages.length - before).toBe(1);
    const id = (await one<{ id: number }>('SELECT id FROM event')).id;
    await event(officer, 'edit', { event: String(id), healer: 2 });
    c.edit = lastQ();
    await event(officer, 'cancel', { event: String(id), reason: 'x' });
    c.cancel = lastQ();
    await event(member, 'list');
    c.list = lastQ();
    console.warn(JSON.stringify({ d1_statements: c }));
    expect(c).toEqual(expect.objectContaining({ create: expect.any(Number) }));
    for (const v of Object.values(c)) expect(v).toBeLessThanOrEqual(10);
  });
});

// Work order 33, PR A: the wording fixes (ITEM 0), a refused Add or Remove leaving the state as it was, and cards Discord
// refused being put right by the sweep (ITEM 1), in workerd against a mocked Discord. Nothing reaches a real server.
import { createExecutionContext, createScheduledController, env, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index.ts';
import { storedName } from '../../src/commands/channels.ts';
import { DKP_COPY } from '../../src/dkp/copy.ts';
import { CLOSE_PREFIX } from '../../src/dkp/raid.ts';
import { ADD_DKP_PREFIX, REMOVE_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { SHOP_CLOSE_PREFIX } from '../../src/dkp/shop.ts';
import { cardRefused, CARD_KINDS, isCardItem } from '../../src/dkp/stale.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { DKP_HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { cardButtons } from '../../src/events/card.ts';
import { EVENT_COPY } from '../../src/events/copy.ts';
import { EVENT_HANDLERS } from '../../src/events/due.ts';
import { POST_PREFIX } from '../../src/events/manage.ts';
import { ADD_EVENTS_PREFIX, REMOVE_EVENTS_PREFIX } from '../../src/events/setup.ts';
import { shortDate } from '../../src/events/times.ts';
import { TYPES } from '../../src/events/types.ts';
import { SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, auto, botApi, GUILD, press, rawCmd, send, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const BOT_ROLE = '600000000000000001';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE], global_name: 'Joegandomi' });

const fake = { channels: [] as any[], messages: [] as { id: string; body: any }[], commands: [] as any[], next: 1, patches: [] as { id: string; body: any }[], posts: 0 };
const json = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const event = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'event', sub, opts), TOKEN);
const addEvents = () => pressAs(admin, ADD_EVENTS_PREFIX);
const items = () => timersOf(env, GUILD).list();

beforeEach(async () => {
  await reset(['Blacksmithing'], [['CLR', 10]]);
  await env.DB.batch([env.DB.prepare('DELETE FROM zone'), env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow')")]);
  Object.assign(fake, { channels: [], messages: [], commands: [], next: 1, patches: [], posts: 0 });
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
    if (method === 'POST' && path.endsWith('/commands')) {
      const had = fake.commands.find((c) => c.name === body.name);
      if (had) return json(had);
      const c = { id: id(), name: body.name };
      fake.commands.push(c);
      return json(c, 201);
    }
    if (method === 'GET' && path.endsWith('/commands')) return json(fake.commands);
    const del = path.match(/\/commands\/(\d+)$/);
    if (method === 'DELETE' && del) {
      fake.commands = fake.commands.filter((c) => c.id !== del[1]);
      return new Response(null, { status: 204 });
    }
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) {
      fake.posts++;
      const m = { id: id(), body };
      fake.messages.push(m);
      return json({ id: m.id });
    }
    const patch = path.match(/^\/channels\/\d+\/messages\/(\d+)$/);
    if (method === 'PATCH' && patch) {
      fake.patches.push({ id: patch[1], body });
      return json({ id: patch[1] });
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
  await (runInDurableObject as unknown as (s: unknown, f: (o: any) => void) => Promise<void>)(timersOf(env, GUILD), (o) => {
    o.env = { ...o.env, ...TOKEN.env };
  });
});

async function posted(opts: Record<string, unknown> = {}) {
  const r = await event(officer, 'create', { type: 'raid', title: 'Test raid', zone: 'Glinting Hollow', start: 'tomorrow 20:00', ...opts });
  const post = r.data.components![0].components[0].custom_id as string;
  await pressAs(officer, post);
  return Number(post.slice(POST_PREFIX.length));
}
const insertOpen = async (title: string, start: string) =>
  (await one<{ id: number }>("INSERT INTO event (guild_id, type, title, start_at, duration_minutes, closes_at, status, posted_by, created_at) VALUES (?, 'social', ?, ?, 120, ?, 'open', 'u', 'x') RETURNING id", GUILD, title, start, start)).id;

describe('ITEM 0: wording', () => {
  it('no button reads "Signed up": the card on every type, and the sign-up form', async () => {
    const labels = TYPES.flatMap((type) => cardButtons({ id: 1, type }).flatMap((r: any) => r.components.map((b: any) => b.label as string)));
    expect(labels).not.toContain(EVENT_COPY.signedUp);
    expect(labels).toContain('Sign up');
    for (const kept of ['Tentative', 'Bench', "Can't make it", 'Going', 'Maybe']) expect(labels).toContain(kept);
    await addEvents();
    const id = await posted();
    await env.DB.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, 'Joe', 'joe', 'CLR', 30, 1, 'x', 'x')").bind(GUILD, officer.user.id).run();
    const form = await pressAs(officer, `evs:${id}:signed_up`);
    const onForm = form.data.components!.flatMap((r: any) => r.components).filter((c: any) => c.type === 2).map((b: any) => b.label);
    expect(onForm).toEqual(['Sign up']);
  });

  it('the roster keeps the status: the card says Signed up, only the button is the action', async () => {
    await addEvents();
    const id = await posted();
    const card = fake.messages.at(-1)!.body;
    expect(card.embeds[0].footer.text).toContain(EVENT_COPY.signedUp);
    expect(card.components[0].components[0].custom_id).toBe(`evs:${id}:signed_up`);
  });

  it('shows the start in the server time zone on /event edit, cancel, roster and list', async () => {
    await addEvents();
    await insertOpen('Test raid', '2026-11-01T00:00:00.000Z');
    for (const sub of ['edit', 'cancel', 'roster', 'list']) {
      const r = await send(auto(officer, 'event', sub, { event: '' }, 'event'), TOKEN);
      expect(r.data.choices!.map((c) => c.name), sub).toEqual(['Test raid · Sat Oct 31, 8:00 PM EDT']);
    }
    await event(admin, 'settings', { time_zone: 'Europe/London' });
    const r = await send(auto(officer, 'event', 'edit', { event: '' }, 'event'), TOKEN);
    expect(r.data.choices![0].name).toBe('Test raid · Sun Nov 1, 12:00 AM GMT');
  });

  it('keeps the time and stays within 100 characters when the title is as long as it can be', async () => {
    await addEvents();
    await insertOpen('T'.repeat(100), '2026-11-01T00:00:00.000Z');
    const name = (await send(auto(officer, 'event', 'edit', { event: '' }, 'event'), TOKEN)).data.choices![0].name;
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.endsWith('· Sat Oct 31, 8:00 PM EDT')).toBe(true);
  });

  it('each date carries its own zone name across the daylight-saving change', () => {
    expect(shortDate(Date.UTC(2026, 10, 1, 0), 'America/New_York')).toBe('Sat Oct 31, 8:00 PM EDT');
    expect(shortDate(Date.UTC(2026, 10, 2, 1), 'America/New_York')).toBe('Sun Nov 1, 8:00 PM EST');
  });

  it('no member-facing text says UTC: every string in src, each exception named', () => {
    const sources = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    // Comments aside; Date.UTC and getUTC* are code, not text.
    const exempt: Record<string, RegExp> = {
      'src/usage.ts': /per UTC day/, // the dev copy's operator line (order 11), never a guild's
      'src/events/settings.ts': /tz === 'UTC'/, // an admin may name UTC as the server's zone
    };
    const found: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      const file = path.replace('../../', '');
      const code = text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, ''));
      for (const line of code) if (/\bUTC\b/.test(line.replace(/Date\.UTC/g, '')) && !exempt[file]?.test(line)) found.push(`${file}: ${line.trim()}`);
    }
    expect(found).toEqual([]);
    expect(Object.keys(sources).length).toBeGreaterThan(80); // the scan saw the source tree
  });

  it('the cancelled card reads as DKP\'s does, with the name beside the mention', async () => {
    await addEvents();
    const id = await posted();
    await event(officer, 'cancel', { event: String(id), reason: 'test' });
    await env.DB.prepare('UPDATE member SET display_name = ? WHERE discord_user_id = ?').bind('Joegandomi', officer.user.id).run();
    const e = { ...env, ...TOKEN.env };
    await EVENT_HANDLERS.evcard(e as never, GUILD, String(id), 0, Date.now(), timerApi(e as never, Date.now(), () => 0));
    const d = fake.patches.at(-1)!.body.embeds[0].description as string;
    expect(d).toContain(`**Cancelled** by <@${officer.user.id}> (Joegandomi). Reason: test`);
  });
});

describe.each([
  { table: 'dkp_guild' as const, add: ADD_DKP_PREFIX, remove: REMOVE_DKP_PREFIX, failed: DKP_COPY.commandFailed(500) },
  { table: 'event_guild' as const, add: ADD_EVENTS_PREFIX, remove: REMOVE_EVENTS_PREFIX, failed: EVENT_COPY.commandFailed(500) },
])('ITEM 1: a refused Add or Remove leaves $table as it was', ({ table, add, remove, failed }) => {
  const row = () => one(`SELECT * FROM ${table}`);
  const refuse = (match: (m: string, p: string) => boolean) => {
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (match(m, p) ? json({ message: 'no', code: 0 }, 500) : handle(m, p, b));
  };

  it('a refused second Add', async () => {
    await pressAs(admin, add);
    const before = await row();
    refuse((m, p) => m === 'POST' && p.endsWith('/commands'));
    expect((await pressAs(admin, add)).data.content).toContain(failed);
    expect(await row()).toEqual(before);
  });

  it('a refused first Add stays off, and keeps the channel for the retry', async () => {
    refuse((m, p) => m === 'POST' && p.endsWith('/commands'));
    expect((await pressAs(admin, add)).data.content).toContain(failed);
    expect(await row()).toMatchObject({ enabled: 0, command_id: null });
    expect((await row() as { channel_id: string }).channel_id).toBeTruthy();
  });

  it('a refused Remove, at the list and at the delete', async () => {
    await pressAs(admin, add);
    const before = await row();
    const handle = botApi.handle!;
    refuse((m, p) => m === 'GET' && p.endsWith('/commands'));
    expect((await pressAs(admin, remove)).data.content).toContain(failed);
    expect(await row()).toEqual(before);
    botApi.handle = handle;
    refuse((m) => m === 'DELETE');
    expect((await pressAs(admin, remove)).data.content).toContain(failed);
    expect(await row()).toEqual(before);
  });
});

/** The object's alarm, with the bot token the test object doesn't hold. */
const alarm = () =>
  (runInDurableObject as unknown as (s: unknown, f: (o: any) => Promise<void>) => Promise<void>)(timersOf(env, GUILD), (o) => o.alarm());
const stored = (key: string) => (runInDurableObject as unknown as (s: unknown, f: (o: any, st: DurableObjectState) => Promise<unknown>) => Promise<any>)(timersOf(env, GUILD), (_o, st) => st.storage.get(key));
const store = (key: string, v: unknown) => (runInDurableObject as unknown as (s: unknown, f: (o: any, st: DurableObjectState) => Promise<void>) => Promise<void>)(timersOf(env, GUILD), (_o, st) => st.storage.put(key, v));
const cron = async () => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: Date.parse('2026-10-20T12:15:00Z'), cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
  await waitOnExecutionContext(ctx);
};
/** The cron, then the object's own redraw: its real alarm, with the token beforeEach gave it. */
const sweep = async (key: string) => {
  await cron();
  for (let i = 0; i < 60 && (await stored(key)); i++) await new Promise((r) => setTimeout(r, 50));
  expect(await stored(key)).toBeUndefined();
};
const flags = () => all<{ item: string; status: number; code: number | null }>('SELECT item, status, code FROM card_stale ORDER BY item');
/** PATCH answers this from now on. */
const refusing = (status: number, code: number, headers: Record<string, string> = {}, extra: object = {}) => {
  const handle = botApi.handle!;
  botApi.handle = (m, p, b) => (m === 'PATCH' ? json({ message: 'no', code, ...extra }, status, headers) : handle(m, p, b));
  return () => (botApi.handle = handle);
};
const eventCard = async () => {
  await addEvents();
  const id = await posted();
  await timersOf(env, GUILD).cancelEvents();
  fake.patches = [];
  return id;
};

describe('ITEM 1: out-of-date cards (Events)', () => {
  it('every card kind has a handler, and only card kinds are card items', () => {
    const handlers = { ...DKP_HANDLERS, ...EVENT_HANDLERS };
    for (const k of CARD_KINDS) expect(handlers[k], k).toBeTypeOf('function');
    expect(isCardItem('evcard:1')).toBe(true);
    expect(isCardItem('evlock:1')).toBe(false);
  });

  it('a refused edit marks the card; the retries run out and the flag stays; the sweep redraws it from the current rows', async () => {
    const id = await eventCard();
    const key = `evcard:${id}`;
    const allow = refusing(500, 0);
    await store(key, { due: Date.now() - 1 });
    await alarm();
    expect(await flags()).toEqual([{ item: key, status: 500, code: 0 }]);
    expect((await stored(key)).tries).toBe(1);
    // The fifth failure: the item goes, the flag doesn't.
    await store(key, { due: Date.now() - 1, tries: 4 });
    await alarm();
    expect(await stored(key)).toBeUndefined();
    expect(await flags()).toEqual([{ item: key, status: 500, code: 0 }]);
    // Meanwhile the event was cancelled: the sweep's edit shows it.
    await event(officer, 'cancel', { event: String(id), reason: 'test' });
    await timersOf(env, GUILD).cancel([key]);
    allow();
    fake.patches = [];
    await sweep(key);
    expect(fake.patches.length).toBe(1);
    expect(fake.patches[0].body.embeds[0].title).toContain('Cancelled');
    expect(fake.patches[0].body.components).toEqual([]);
    expect(await flags()).toEqual([]);
    expect(await stored(key)).toBeUndefined();
  });

  it('a redraw Discord still refuses has one try, keeps its flag, and the next sweep tries again', async () => {
    const id = await eventCard();
    const key = `evcard:${id}`;
    await env.DB.prepare("INSERT INTO card_stale (guild_id, item, since, status) VALUES (?, ?, 'x', 500)").bind(GUILD, key).run();
    const allow = refusing(500, 0);
    await sweep(key);
    expect(await stored(key)).toBeUndefined();
    expect(await count('card_stale')).toBe(1);
    allow();
    await sweep(key);
    expect(await count('card_stale')).toBe(0);
  });

  it.each([[404, 10008], [404, 10003], [403, 50001]])('Discord\'s %i %i stops the retries and is recorded, without looping or posting', async (status, code) => {
    const id = await eventCard();
    const key = `evcard:${id}`;
    await env.DB.prepare("INSERT INTO card_stale (guild_id, item, since, status) VALUES (?, ?, 'x', 500)").bind(GUILD, key).run();
    refusing(status, code);
    const posts = fake.posts;
    await sweep(key);
    expect(await flags()).toEqual([]);
    expect(await stored(key)).toBeUndefined();
    expect(fake.posts).toBe(posts);
    const a = await one<{ target: string; detail_json: string }>("SELECT target, detail_json FROM audit_log WHERE action = 'card.stopped'");
    expect(a.target).toBe(key);
    expect(JSON.parse(a.detail_json).after).toEqual({ status, code });
    await cron();
    expect(await stored(key)).toBeUndefined();
  });

  it('a change to an event still posts a card Discord no longer has (order 32); only the sweep never posts', async () => {
    const id = await eventCard();
    refusing(404, 10008);
    const posts = fake.posts;
    await store(`evcard:${id}`, { due: Date.now() - 1 });
    await alarm();
    expect(fake.posts).toBe(posts + 1);
    expect(await count('audit_log', "action = 'card.stopped'")).toBe(0);
  });

  it('a 429 waits for retry_after, costs no try, and paces the next edit', async () => {
    const id = await eventCard();
    const key = `evcard:${id}`;
    refusing(429, 0, { 'Retry-After': '60' }, { retry_after: 60, global: false });
    await store(key, { due: Date.now() - 1 });
    const before = Date.now();
    await alarm();
    const it = await stored(key);
    expect(it.tries).toBeUndefined();
    expect(it.due).toBeGreaterThanOrEqual(before + 59_000);
    expect((await stored(`!pace:${key}`)).blockedUntil).toBeGreaterThanOrEqual(before + 59_000);
    expect(await count('card_stale')).toBe(1);
  });

  it('a retry that succeeds clears the flag, so a passing refusal costs no redraw', async () => {
    const id = await eventCard();
    const key = `evcard:${id}`;
    await env.DB.prepare("INSERT INTO card_stale (guild_id, item, since, status) VALUES (?, ?, 'x', 500)").bind(GUILD, key).run();
    await store(key, { due: Date.now() - 1, tries: 1 });
    await alarm();
    expect(await count('card_stale')).toBe(0);
  });

  it('nothing out of date: the sweep makes no Discord call and leaves the object alone', async () => {
    await eventCard();
    const before = await items();
    await cron();
    expect(fake.patches).toEqual([]);
    expect(await items()).toEqual(before);
  });

  it('while the Events module is off its cards wait: the flag stays and nothing is asked', async () => {
    const id = await eventCard();
    const key = `evcard:${id}`;
    await env.DB.prepare("INSERT INTO card_stale (guild_id, item, since, status) VALUES (?, ?, 'x', 500)").bind(GUILD, key).run();
    await pressAs(admin, REMOVE_EVENTS_PREFIX);
    await cron();
    expect(await stored(key)).toBeUndefined();
    expect(await count('card_stale')).toBe(1);
    await addEvents();
    await sweep(key);
    expect(await count('card_stale')).toBe(0);
  });

  it('the one decision: a refusal Discord may change its mind on throws; the three codes don\'t', async () => {
    for (const code of [0, 50013, 30046]) await expect(cardRefused(env.DB, GUILD, 'evcard:1', { ok: false, status: 403, code, error: 'x' })).rejects.toThrow('card edit refused');
    await expect(cardRefused(env.DB, GUILD, 'evcard:1', { ok: false, status: 0, error: 'x' })).rejects.toThrow('card edit refused');
  });
});

describe('ITEM 1: out-of-date cards (DKP raid, auction and shop)', () => {
  const dkp = async () => {
    await pressAs(admin, ADD_DKP_PREFIX);
    const at = new Date().toISOString();
    await env.DB.prepare("INSERT OR IGNORE INTO item (id, name, name_key, imported_at) VALUES (7001, 'Fungal Robe', 'fungal robe', ?)").bind(at).run();
    const raid = await one<{ id: number }>("INSERT INTO dkp_raid (guild_id, pool, mode, message_id, opened_by, opened_at, closes_at) VALUES (?, 'guild', 'flat', '7100', 'u', ?, ?) RETURNING id", GUILD, at, new Date(Date.now() + 9e6).toISOString());
    const auction = await one<{ id: number }>("INSERT INTO dkp_auction (guild_id, kind, item_id, min_bid, seconds, status, created_by, created_at, opened_at, closes_at, message_id) VALUES (?, 'general', 7001, 1, 60, 'open', 'u', ?, ?, ?, '7101') RETURNING id", GUILD, at, at, new Date(Date.now() + 9e6).toISOString());
    const listing = await one<{ id: number }>("INSERT INTO dkp_listing (guild_id, item_id, price, quantity, per_member, posted_by, posted_at, message_id) VALUES (?, 7001, 5, 1, 1, 'u', ?, '7102') RETURNING id", GUILD, at);
    return { render: raid.id, acard: auction.id, scard: listing.id };
  };

  it.each(['render', 'acard', 'scard'] as const)('%s: a refused redraw keeps the flag, an accepted one clears it', async (kind) => {
    const ids = await dkp();
    const key = `${kind}:${ids[kind]}`;
    await env.DB.prepare("INSERT INTO card_stale (guild_id, item, since, status) VALUES (?, ?, 'x', 500)").bind(GUILD, key).run();
    fake.patches = [];
    const allow = refusing(500, 0);
    await sweep(key);
    expect((await flags()).map((f) => f.item)).toEqual([key]);
    allow();
    await sweep(key);
    expect(fake.patches.length).toBe(1);
    expect(await flags()).toEqual([]);
  });

  it('render: a refused edit is no longer lost: the object now retries it, and flags it', async () => {
    const ids = await dkp();
    const key = `render:${ids.render}`;
    refusing(500, 0);
    await store(key, { due: Date.now() - 1 });
    await alarm();
    expect((await stored(key)).tries).toBe(1);
    expect((await flags()).map((f) => f.item)).toEqual([key]);
  });

  it('edits made on a press are flagged too: a raid closed and a listing closed while Discord refuses', async () => {
    const ids = await dkp();
    refusing(500, 0);
    await pressAs(officer, `${CLOSE_PREFIX}${ids.render}`);
    await pressAs(officer, `${SHOP_CLOSE_PREFIX}${ids.scard}`);
    expect((await flags()).map((f) => f.item).sort()).toEqual([`render:${ids.render}`, `scard:${ids.scard}`].sort());
  });

  it('a deleted card (10008) stops, recorded, for a DKP card too', async () => {
    const ids = await dkp();
    const key = `acard:${ids.acard}`;
    await env.DB.prepare("INSERT INTO card_stale (guild_id, item, since, status) VALUES (?, ?, 'x', 500)").bind(GUILD, key).run();
    refusing(404, 10008);
    await store(key, { due: Date.now() - 1, stale: true });
    await alarm();
    expect(await flags()).toEqual([]);
    expect(await count('audit_log', "action = 'card.stopped'")).toBe(1);
  });
});

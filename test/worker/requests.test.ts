// Order 16, ITEM 2: craft requests against a mocked Discord. The fake answers as Discord documents
// (docs.discord.com/developers/resources/channel, topics/threads): a private thread (type 12) in a text channel; Add
// Thread Member is refused on an archived thread; an edit in an archived thread is refused (50083) and sending a message
// unarchives it unless it is locked; GET /guilds/{id}/threads/active lists unarchived threads.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { REQUEST_PERMISSIONS } from '../../src/commands/setup.ts';
import { NO_REQUEST_CHANNEL, routeItems, threadName } from '../../src/requests.ts';
import { all, count, markImported, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, cmd, GUILD, press, rawCmd, select, send, spyOnFetch, submit, top, webhook } from '../discord.ts';
import { ME_COPY } from '../../src/commands/me.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token', GUILDCRAFT_COPY: 'production' } };
const REQ = '600000000000000040';
const ANN = '100000000000000001'; // the requester
const BO = '100000000000000002'; // an opted-in crafter
const CY = '100000000000000003'; // opted in, but can't see the request channel
const DEE = '100000000000000004'; // opted in, but no longer in the server
const EVE = '100000000000000005'; // marked left in GuildCraft
const OFF = '100000000000000009'; // an officer (Administrator)
const OWNER = '100000000000000099';
const HIDDEN_ROLE = '500000000000000077';
const MOD_ROLE = '500000000000000078';
const ann = as(ANN, { nick: 'Ann' });
const bo = as(BO, { nick: 'Bo' });
const cy = as(CY, { nick: 'Cy', roles: [HIDDEN_ROLE] });
const dee = as(DEE, { nick: 'Dee' });
const eve = as(EVE, { nick: 'Eve' });
const off = as(OFF, { nick: 'Off', permissions: ADMIN });
const ALL_REQUEST_PERMS = String(REQUEST_PERMISSIONS.reduce((b, [bit]) => b | bit, 0n));
const VIEW = 1n << 10n;
const MANAGE_THREADS = 1n << 34n;

interface Thread {
  id: string;
  name: string;
  type: number;
  invitable: boolean;
  autoArchive: number;
  archived: boolean;
  locked: boolean;
  members: Set<string>;
  messages: Map<string, any>;
  archiveTimestamp: string;
}

let seq = 900000000000000000n;
const nextId = () => String(++seq);
let threads: Map<string, Thread>;
let calls: { method: string; path: string; body: any }[];
/** Discord's answer to a rename: 'ok', or 'refuse' (a 429 with a long retry_after, as discord-api-docs #1900 reports). */
let rename: 'ok' | 'refuse';
let logs: string[];

function fakeDiscord() {
  threads = new Map();
  calls = [];
  rename = 'ok';
  const json = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'X-RateLimit-Limit': '5', 'X-RateLimit-Remaining': '4', 'X-RateLimit-Reset-After': '15', 'X-RateLimit-Bucket': 'b1' } });
  botApi.handle = (method, fullPath, body) => {
    calls.push({ method, path: fullPath, body });
    const path = fullPath.split('?')[0];
    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json(200, { id: GUILD, name: 'The Test Guild', owner_id: OWNER });
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`)
      return json(200, [
        { id: GUILD, permissions: String(VIEW | (1n << 11n)) },
        { id: HIDDEN_ROLE, permissions: '0' },
        { id: MOD_ROLE, permissions: '0' },
        { id: '500000000000000079', permissions: String(1n << 3n) },
      ]);
    if (method === 'GET' && path === `/channels/${REQ}`)
      return json(200, { id: REQ, type: 0, permission_overwrites: [{ id: HIDDEN_ROLE, type: 0, allow: '0', deny: String(VIEW) }, { id: MOD_ROLE, type: 0, allow: String(MANAGE_THREADS), deny: '0' }] });
    if (method === 'GET' && path === `/guilds/${GUILD}/members`) return json(200, [ANN, BO, CY, EVE, OFF].map((id) => ({ user: { id }, roles: id === CY ? [HIDDEN_ROLE] : [] })));
    if (method === 'GET' && path === `/guilds/${GUILD}/threads/active`)
      return json(200, {
        threads: [...threads.values()].filter((t) => !t.archived).map((t) => ({ id: t.id, flags: 0, last_message_id: [...t.messages.keys()].at(-1) ?? null, thread_metadata: { archived: false, archive_timestamp: t.archiveTimestamp, auto_archive_duration: t.autoArchive } })),
      });
    if (method === 'POST' && path === `/channels/${REQ}/threads`) {
      const t: Thread = { id: nextId(), name: body.name, type: body.type, invitable: body.invitable, autoArchive: body.auto_archive_duration, archived: false, locked: false, members: new Set([APP_ID]), messages: new Map(), archiveTimestamp: new Date().toISOString() };
      threads.set(t.id, t);
      return json(201, { id: t.id, type: t.type });
    }
    if ((m = path.match(/^\/channels\/(\d+)\/thread-members\/(\d+)$/)) && method === 'PUT') {
      const t = threads.get(m[1])!;
      if (t.archived) return json(400, { code: 50083, message: 'Thread is archived' });
      t.members.add(m[2]);
      return json(204, null);
    }
    if ((m = path.match(/^\/channels\/(\d+)\/messages(?:\/(\d+))?$/))) {
      const t = threads.get(m[1]);
      if (!t) return json(404, { code: 10003, message: 'Unknown Channel' });
      if (method === 'POST') {
        if (t.archived && t.locked) return json(400, { code: 50083, message: 'Thread is archived' });
        t.archived = false; // "Sending a message will automatically unarchive the thread, unless the thread has been locked"
        const id = nextId();
        t.messages.set(id, body);
        return json(200, { id });
      }
      if (t.archived) return json(400, { code: 50083, message: 'Thread is archived' });
      t.messages.set(m[2], body);
      return json(200, { id: m[2] });
    }
    if ((m = path.match(/^\/channels\/(\d+)$/)) && method === 'PATCH') {
      const t = threads.get(m[1]);
      if (!t) return json(404, { code: 10003, message: 'Unknown Channel' });
      if (body.name !== undefined && rename === 'refuse') return json(429, { retry_after: 582.019, global: false, message: 'You are being rate limited.' });
      if (body.archived === false) t.archived = false;
      if (body.name !== undefined) t.name = body.name;
      if (body.auto_archive_duration !== undefined) {
        t.autoArchive = body.auto_archive_duration;
        t.archiveTimestamp = new Date().toISOString();
      }
      if (body.locked !== undefined) t.locked = body.locked;
      if (body.archived === true) t.archived = true;
      return json(200, { id: t.id });
    }
    return json(404, { code: 0, message: `fake: no route for ${method} ${fullPath}` });
  };
}

const at = '2026-10-19T00:00:00Z';
let itemIds: Record<string, number>;
async function item(name: string): Promise<number> {
  return (await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES (?, ?, 'wiki', ?)").bind(name, name.toLowerCase(), at).run()).meta.last_row_id;
}
async function recipe(skill: string, result: number, trivial: number | null, acquisition = 'unknown') {
  await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, acquisition, source, imported_at) VALUES (?, (SELECT id FROM tradeskill WHERE name = ?), ?, ?, ?, 'wiki', ?)")
    .bind(`${skill}|${result}`, skill, result, trivial, acquisition, at)
    .run();
}

beforeEach(async () => {
  await reset(['Blacksmithing', 'Tailoring', 'Tinkering']);
  await env.DB.batch(['recipe_component', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  webhook.reset();
  spyOnFetch();
  fakeDiscord();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
  itemIds = {
    plate: await item('Copper Plate Breastplate'),
    cap: await item('Wool Cap'),
    hard: await item('Mithril Greathelm'),
    gadget: await item('Clockwork Gadget'),
  };
  await recipe('Blacksmithing', itemIds.plate, 20);
  await recipe('Tailoring', itemIds.cap, null); // trivial unknown: everyone with Tailoring
  await recipe('Blacksmithing', itemIds.hard, 200); // no one is Reliable
  await recipe('Tinkering', itemIds.gadget, 10);
  await markImported();
  // Characters: Ann (the requester) can make the plate too; Eve is marked left.
  for (const [m, name, skills] of [
    [ann, 'Testchar', { Blacksmithing: 50 }],
    [bo, 'Bochar', { Blacksmithing: 30, Tailoring: 5 }],
    [cy, 'Cychar', { Blacksmithing: 40 }],
    [dee, 'Deechar', { Blacksmithing: 60 }],
    [eve, 'Evechar', { Blacksmithing: 99 }],
    [off, 'Offchar', { Tinkering: 1 }],
  ] as const) {
    await send(cmd(m, 'character', 'add', { name }), TOKEN);
    for (const [skill, level] of Object.entries(skills)) await send(cmd(m, 'craft', 'set', { skill, level }), TOKEN);
  }
  await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(EVE).run();
});
afterEach(() => {
  botApi.reset();
  vi.restoreAllMocks();
});

const setupRequests = (app_permissions = ALL_REQUEST_PERMS, type = 0) => {
  const i = cmd(off, 'guildcraft', 'setup', { requests: REQ }) as any;
  i.data.resolved = { channels: { [REQ]: { id: REQ, name: 'craft-requests', type, permissions: ADMIN, app_permissions } } };
  return send(i, TOKEN);
};
const notify = (m: ReturnType<typeof as>, tradeskill: string, on = true) => send(cmd(m, 'craft', 'notify', { tradeskill, on }), TOKEN);
const request = (m: ReturnType<typeof as>, itemName: string, o: Record<string, unknown> = {}) => send(cmd(m, 'craft', 'request', { item: itemName, ...o }), TOKEN);
const buttons = (r: any) => (r.data.components ?? []).flatMap((x: any) => x.components);
const button = (r: any, label: string) => buttons(r).find((b: any) => b.label === label)!;
const thread = () => [...threads.values()].at(-1)!;
const firstMessage = (t: Thread) => [...t.messages.values()][0];
const requestLogs = () => logs.filter((l) => l.startsWith('{"gc":"request"')).map((l) => JSON.parse(l));
const runCron = async (scheduledTime = Date.now()) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime, cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
  await waitOnExecutionContext(ctx);
  const line = logs.filter((l) => l.startsWith('{"gc":"requests"')).at(-1);
  return line ? JSON.parse(line) : null;
};
/** Sends Ann's request for the plate: Bo is the one crafter who gets it. */
async function sendPlate() {
  await setupRequests();
  for (const m of [bo, cy, dee]) await notify(m, 'Blacksmithing');
  // Eve opted in before she was marked left (a command of hers now would mark her active again).
  await env.DB.prepare("INSERT INTO craft_notify VALUES (?, ?, (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?)").bind(GUILD, EVE, at).run();
  const draft = await request(ann, 'Copper Plate Breastplate', { quantity: 2, note: 'For the raid' });
  return send(press(ann, button(draft, 'Send request').custom_id), TOKEN);
}

describe('no request channel set (production commands are global)', () => {
  it('/request, Notices and Cancel a request (on /me) reply clearly, with no error', async () => {
    for (const r of [await request(ann, 'Copper Plate Breastplate'), await send(press(bo, `men:${BO}`), TOKEN), await send(cmd(ann, 'craft', 'requests'), TOKEN)]) {
      expect(r.data.content).toBe(NO_REQUEST_CHANNEL);
      expect(r.data.flags).toBe(64);
    }
    expect(NO_REQUEST_CHANNEL).toBe('An admin needs to run `/guildcraft setup requests:` first.');
  });
});

describe('/guildcraft setup requests:', () => {
  it('refuses a channel that is not a text channel, and names each missing permission with how to grant it', async () => {
    expect((await setupRequests(ALL_REQUEST_PERMS, 15)).data.content).toMatch(/is not a text channel/);
    const r = await setupRequests(String(VIEW | MANAGE_THREADS));
    expect(r.data.content).toContain('Nothing was changed');
    for (const name of ['Create Private Threads', 'Send Messages in Threads', 'Read Message History']) expect(r.data.content).toContain(name);
    expect(r.data.content).toContain('re-invite GuildCraft with the current install link');
    expect((await one<{ c: string | null }>('SELECT request_channel_id AS c FROM guild')).c).toBeNull();
  });

  it('saves, and names who else can read every private thread (Manage Threads in the channel, Administrator, the owner)', async () => {
    const r = await setupRequests();
    expect(r.data.content).toContain(`Request channel: <#${REQ}>`);
    expect(r.data.content).toContain('visible to anyone with Manage Threads there or Administrator, and to the server owner');
    expect(r.data.content).toContain('Here that is: <@&500000000000000079>, <@&500000000000000078>.');
    expect((await one<{ c: string }>('SELECT request_channel_id AS c FROM guild')).c).toBe(REQ);
  });
});

describe('Notices (on /me; formerly /craft notify)', () => {
  it('off by default; on and off per tradeskill, or every one; /me lists the opt-ins', async () => {
    await setupRequests();
    expect((await send(cmd(bo, 'craft', 'me'), TOKEN)).data.content).toContain('**Craft request notices:** off');
    expect((await notify(bo, 'blacksmithing')).data.content).toContain('**Craft request notices:** Blacksmithing');
    expect((await send(cmd(bo, 'craft', 'me'), TOKEN)).data.content).toContain('**Craft request notices:** Blacksmithing (**Notices** on `/me` changes them)');
    await notify(bo, 'All');
    expect((await send(cmd(bo, 'craft', 'me'), TOKEN)).data.content).toContain('Blacksmithing, Tailoring, Tinkering');
    await notify(bo, 'Tailoring', false);
    expect(await all<{ t: number }>('SELECT tradeskill_id AS t FROM craft_notify WHERE discord_user_id = ?', BO)).toHaveLength(2);
    // The select lists the import's tradeskills, each picked as it is on.
    const view = await send(press(bo, `men:${BO}`), TOKEN);
    expect(view.data.components![0].components[0].options.filter((o: any) => o.default).map((o: any) => o.label)).toEqual(['Blacksmithing', 'Tinkering']);
  });
});

describe('routing (src/requests.ts routeItems: the /craft find tiers, opt-ins, the requester and departed members)', () => {
  const route = (itemNames: (keyof typeof itemIds)[], requester = ANN) => routeItems(env.DB, GUILD, requester, itemNames.map((n) => itemIds[n]), 25);
  const ids = (cs: { userId: string }[]) => cs.map((c) => c.userId).sort();

  it('a single item: Reliable crafters who opted in; the requester is never routed to; a member marked left never appears', async () => {
    await env.DB.batch([BO, CY, DEE, EVE, ANN].map((u) => env.DB.prepare("INSERT INTO craft_notify VALUES (?, ?, (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?)").bind(GUILD, u, at)));
    const [plate] = await route(['plate']);
    expect(ids(plate.eligible)).toEqual([BO, CY, DEE].sort()); // Ann asked; Eve left
    expect(plate.notOptedIn).toEqual([]);
  });

  it('several items across tradeskills: each item routes by its own tradeskill opt-in; trivial unknown means everyone with the skill', async () => {
    await env.DB.prepare("INSERT INTO craft_notify VALUES (?, ?, (SELECT id FROM tradeskill WHERE name = 'Tailoring'), ?)").bind(GUILD, BO, at).run();
    const [plate, cap] = await route(['plate', 'cap']);
    expect(plate.eligible).toEqual([]);
    expect(ids(plate.notOptedIn)).toEqual([BO, CY, DEE].sort()); // can make it, haven't opted in for Blacksmithing
    expect(ids(cap.eligible)).toEqual([BO]); // Tailoring 5, trivial unknown
  });

  it('no eligible crafters: nobody is Reliable for a trivial-200 item', async () => {
    await env.DB.batch([BO, CY].map((u) => env.DB.prepare("INSERT INTO craft_notify VALUES (?, ?, (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?)").bind(GUILD, u, at)));
    const [hard] = await route(['hard']);
    expect(hard).toMatchObject({ eligible: [], notOptedIn: [] });
  });

  it('a reputation recipe counts only characters who marked it known', async () => {
    await env.DB.prepare("UPDATE recipe SET acquisition = 'reputation' WHERE result_item_id = ?").bind(itemIds.plate).run();
    await env.DB.prepare("INSERT INTO craft_notify VALUES (?, ?, (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?)").bind(GUILD, BO, at).run();
    expect((await route(['plate']))[0].eligible).toEqual([]);
    await env.DB.prepare("INSERT INTO character_recipe SELECT c.id, r.id, ? FROM character c, recipe r WHERE c.name = 'Bochar' AND r.result_item_id = ?").bind(at, itemIds.plate).run();
    expect(ids((await route(['plate']))[0].eligible)).toEqual([BO]);
  });
});

describe('/craft request: the unsent request, then Send', () => {
  it('no opted-in crafter: the private reply says so and shows who could be asked directly; Send is off and no thread opens', async () => {
    await setupRequests();
    const r = await request(ann, 'Copper Plate Breastplate');
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('No opted-in crafter can make it yet.');
    expect(r.data.content).toContain('ask them directly: Dee, Cy, Bo');
    expect(r.data.content).not.toContain('<@'); // order 42: plain names, no mentions
    expect(r.data.content).not.toContain('Ann'); // never routed to the requester
    expect(button(r, 'Send request').disabled).toBe(true);
    expect(threads.size).toBe(0);
  });

  it('Send: one private thread (invitable false, 7-day auto-archive) with the requester and the crafters; who was left out and why, privately', async () => {
    const sent = await sendPlate();
    expect(sent.type).toBe(7); // the private unsent request is replaced by the result
    const t = thread();
    expect(t).toMatchObject({ type: 12, invitable: false, autoArchive: 10080, name: '[Open] Copper Plate Breastplate ×2 · Testchar' });
    expect([...t.members].sort(), JSON.stringify(sent.data.content)).toEqual([APP_ID, ANN, BO].sort());
    expect(sent.data.content).toContain(`Sent: <#${t.id}>. 1 crafter added and pinged there.`);
    expect(sent.data.content).toContain(`Cy: can't see <#${REQ}>`);
    expect(sent.data.content).toContain('Dee: no longer in the server');
    expect(sent.data.content).not.toContain('<@');
    expect(sent.data.content).not.toContain(EVE);
    const first = firstMessage(t);
    // Order 42: one name, plain, no brackets; "· <character>" after it.
    expect(first.content.split('\n')[0]).toBe('## Craft request from Ann · Testchar');
    expect(first.content).toContain('**Copper Plate Breastplate** ×2 · Open');
    expect(first.content).toContain('Crafters: Bo');
    expect(first.content).not.toContain('<@');
    expect(first.content).toContain('**Note:** For the raid');
    // The first message pings nobody; the crafters it adds are pinged by the short message right after it, which names
    // only them, as mentions.
    expect(first.allowed_mentions).toEqual({ parse: [] });
    expect([...t.messages.values()][1]).toEqual({ content: `<@${BO}>: a new craft request for you`, allowed_mentions: { parse: [], users: [BO] } });
    expect(t.messages.size).toBe(2);
    expect(buttons({ data: first }).map((b: any) => b.label)).toEqual(["I'll craft this", 'Done', 'Cancel']);
    expect(await one('SELECT status, thread_id, message_id, thread_name FROM craft_request')).toMatchObject({ status: 'open', thread_id: t.id, thread_name: t.name });
    expect(await count('audit_log', "action = 'request.create'")).toBe(1);
  });

  it('Send pressed twice opens one thread and pings once (the request is claimed before any Discord call)', async () => {
    await setupRequests();
    await notify(bo, 'Blacksmithing');
    const unsent = await request(ann, 'Copper Plate Breastplate');
    const id = button(unsent, 'Send request').custom_id;
    // The second press arrives while the first is still opening the thread: the claim has already happened.
    let second: any = null;
    const real = botApi.handle!;
    botApi.handle = async (method, path, body) => {
      if (method === 'POST' && path === `/channels/${REQ}/threads` && second === null) {
        second = 'pending';
        const r = await env.DB.prepare("SELECT status, thread_id FROM craft_request WHERE status <> 'closed'").first<{ status: string; thread_id: string | null }>();
        second = r; // what a second press would load: no longer unsent
      }
      return real(method, path, body);
    };
    const a = await send(press(ann, id), TOKEN);
    expect(second).toEqual({ status: 'open', thread_id: null });
    const b = await send(press(ann, id), TOKEN);
    expect(a.data.content).toMatch(/^Sent:/);
    expect(b.data.content).toBe('That request was already sent or discarded. Run `/request` to start another.');
    expect(threads.size).toBe(1);
    expect(await count('audit_log', "action = 'request.create'")).toBe(1);
  });

  it('Request a craft on a /craft find card posted to a channel answers privately with a new message', async () => {
    await setupRequests();
    await notify(bo, 'Blacksmithing');
    const found = await send(cmd(ann, 'craft', 'find', { item: 'Copper Plate Breastplate' }), TOKEN);
    const posted = await send(press(bo, buttons(found).find((b: any) => b.label === 'Post to channel').custom_id), TOKEN);
    expect(posted.data.flags).toBeUndefined();
    const r = await send(press(cy, buttons(posted).find((b: any) => b.label === 'Request a craft').custom_id), TOKEN);
    expect(r.type).toBe(4);
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('**Your craft request** (not sent yet)');
  });

  it('up to 5 items: the command, then Add item (a form), then the command again; items across tradeskills each list their crafters', async () => {
    await setupRequests();
    await notify(bo, 'All');
    await request(ann, 'Copper Plate Breastplate');
    const draft = await request(ann, 'Wool Cap', { quantity: 3 });
    expect(draft.data.content).toMatch(/1\. \*\*Copper Plate Breastplate\*\* ×1[\s\S]*2\. \*\*Wool Cap\*\* ×3/);
    const added = await send(submit(ann, button(draft, 'Add item').custom_id.replace('rqa:', 'rqam:'), { item: 'clockwork gadget', qty: '1' }), TOKEN);
    expect(added.data.content).toMatch(/3\. \*\*Clockwork Gadget\*\* ×1 · No opted-in crafter can make it yet/);
    const sent = await send(press(ann, button(added, 'Send request').custom_id), TOKEN);
    expect(sent.data.content).toContain('**Wool Cap** ×3: Bo');
    expect(sent.data.content).toContain('**Clockwork Gadget** ×1: no crafter added');
    expect(thread().name).toBe('[Open] Copper Plate Breastplate ×1 +2 more · Testchar');
    expect(buttons({ data: firstMessage(thread()) }).map((b: any) => b.label)).toEqual([
      "1 · I'll craft this", '1 · Done', '1 · Cancel', "2 · I'll craft this", '2 · Done', '2 · Cancel', "3 · I'll craft this", '3 · Done', '3 · Cancel',
    ]);
  });

  it('at most 5 open requests per member', async () => {
    await setupRequests();
    await notify(bo, 'Blacksmithing');
    for (let i = 0; i < 5; i++) {
      const d = await request(ann, 'Copper Plate Breastplate');
      await send(press(ann, button(d, 'Send request').custom_id), TOKEN);
    }
    expect(await count('craft_request', "status = 'open'")).toBe(5);
    expect((await request(ann, 'Copper Plate Breastplate')).data.content).toMatch(/You already have 5 open requests/);
  });
});

describe('the thread: claim, done, cancel', () => {
  const press1 = (m: ReturnType<typeof as>, label: string) => send(press(m, buttons({ data: firstMessage(thread()) }).find((b: any) => b.label === label).custom_id), TOKEN);
  // After the first message and the crafters' ping (order 42).
  const notices = () => [...thread().messages.values()].slice(2);

  it("I'll craft this pings the requester; Done pings the other party; the last item closes, locks and archives the thread", async () => {
    await sendPlate();
    expect((await press1(ann, "I'll craft this")).data.content).toBe("You asked for this item, so you can't take it.");
    expect((await press1(off, "I'll craft this")).data.content).toMatch(/Only opted-in crafters/); // can't make it
    const claim = await press1(bo, "I'll craft this");
    expect(claim.data.flags).toBe(64);
    expect(claim.data.content).toContain("You're down to craft **Copper Plate Breastplate** ×2.");
    expect(claim.data.content).toContain('Ann has been told.');
    // Order 42: the pinged requester is their mention; the crafter who acted is their saved name.
    expect(notices()[0]).toEqual({ content: `<@${ANN}>: Bo will craft **Copper Plate Breastplate** ×2.`, allowed_mentions: { parse: [], users: [ANN] } });
    expect(thread().name).toBe('[Claimed] Copper Plate Breastplate ×2 · Testchar');
    expect(firstMessage(thread()).content).toContain('· Claimed by Bo');
    expect(firstMessage(thread()).content).not.toContain('<@');
    expect((await press1(cy, 'Done')).data.content).toMatch(/Only the crafter who took it, or the requester/);
    await press1(bo, 'Done');
    expect(notices()[1].allowed_mentions).toEqual({ parse: [], users: [ANN] });
    expect(notices()[1].content).toBe(`<@${ANN}>: **Copper Plate Breastplate** ×2 is done (marked by Bo). Every item is done or cancelled, so this thread is now closed.`);
    expect(firstMessage(thread()).content).toContain('· Done by Bo');
    expect(thread()).toMatchObject({ name: '[Done] Copper Plate Breastplate ×2 · Testchar', locked: true, archived: true });
    expect(firstMessage(thread()).components).toEqual([]);
    expect(await one('SELECT status, close_reason FROM craft_request')).toEqual({ status: 'closed', close_reason: 'done' });
    expect((await all<{ action: string }>("SELECT action FROM audit_log WHERE action LIKE 'request.%' ORDER BY id")).map((a) => a.action)).toEqual(['request.create', 'request.claim', 'request.done']);
  });

  it('Done by the requester pings the claimer; Cancel is the requester\'s (or an officer\'s) and pings the other party', async () => {
    await sendPlate();
    await press1(bo, "I'll craft this");
    expect((await press1(bo, 'Cancel')).data.content).toMatch(/Only the requester can cancel/);
    await press1(ann, 'Cancel');
    expect(notices().at(-1)).toEqual({ content: `<@${BO}>: **Copper Plate Breastplate** ×2 was cancelled by Ann. Every item is done or cancelled, so this thread is now closed.`, allowed_mentions: { parse: [], users: [BO] } });
    expect(thread()).toMatchObject({ name: '[Cancelled] Copper Plate Breastplate ×2 · Testchar', locked: true });
  });

  it('every edit of the first message pings nobody, and sends allowed_mentions explicitly', async () => {
    await sendPlate();
    await press1(bo, "I'll craft this");
    await press1(bo, 'Done');
    const edits = calls.filter((c) => c.method === 'PATCH' && /\/messages\/\d+$/.test(c.path));
    expect(edits.length).toBe(2);
    for (const e of edits) expect(e.body.allowed_mentions).toEqual({ parse: [] });
    // Every message create or edit in the thread carries allowed_mentions.
    for (const c of calls.filter((x) => /\/messages/.test(x.path) && x.method !== 'GET')) expect(c.body.allowed_mentions, c.path).toBeDefined();
  });

  it('a refused rename leaves the first message correct; the sweep catches the name up', async () => {
    await sendPlate();
    rename = 'refuse';
    await press1(bo, "I'll craft this");
    expect(firstMessage(thread()).content).toContain('Claimed by');
    expect(thread().name).toBe('[Open] Copper Plate Breastplate ×2 · Testchar');
    const refused = requestLogs().at(-1);
    expect(refused.calls.find((c: any) => c.status === 429)).toMatchObject({ route: 'PATCH /channels/{id}', retry_after: 582.019 });
    rename = 'ok';
    const swept = await runCron();
    expect(swept).toMatchObject({ open: 1, renamed: 1 });
    expect(thread().name).toBe('[Claimed] Copper Plate Breastplate ×2 · Testchar');
    expect(swept.calls.find((c: any) => c.route === 'PATCH /channels/{id}')).toMatchObject({ limit: '5', remaining: '4', bucket: 'b1' });
  });

  it('archived threads: the sweep unarchives an open request without posting, and its buttons work afterwards', async () => {
    await sendPlate();
    thread().archived = true;
    const before = thread().messages.size;
    const swept = await runCron();
    expect(swept).toMatchObject({ unarchived: 1 });
    expect(thread().archived).toBe(false);
    expect(thread().messages.size).toBe(before); // no message posted to keep it active
    const claim = await press1(bo, "I'll craft this");
    expect(claim.data.content).toContain("You're down to craft");
    // An edit that meets an archived thread unarchives first, then edits.
    thread().archived = true;
    await press1(bo, 'Done');
    expect(calls.filter((c) => c.method === 'PATCH' && c.body?.archived === false).length).toBeGreaterThanOrEqual(2);
    expect(firstMessage(thread()).content).toContain('· Done');
  });

  it('a thread due to auto-archive within two days gets its auto-archive time changed by the sweep', async () => {
    await sendPlate();
    thread().archiveTimestamp = new Date(Date.now() - 6 * 86_400_000).toISOString();
    for (const id of [...thread().messages.keys()]) thread().messages.delete(id);
    thread().messages.set('1', firstMessage(thread()) ?? { content: 'x' }); // an old last_message_id (snowflake 1: 2015)
    const swept = await runCron();
    expect(swept).toMatchObject({ bumped: 1 });
    expect(thread().autoArchive).toBe(4320);
  });
});

describe('expiry, through the */15 sweep (no extra cron)', () => {
  it('nothing claimed in 14 days: closed with a note (request.expire), locked; a claimed request stays open until 30 days of no activity', async () => {
    await sendPlate();
    await env.DB.prepare('UPDATE craft_request SET created_at = ?1, opened_at = ?1').bind(new Date(Date.now() - 15 * 86_400_000).toISOString()).run();
    await env.DB.prepare("UPDATE audit_log SET created_at = ? WHERE action LIKE 'request.%'").bind(new Date(Date.now() - 15 * 86_400_000).toISOString()).run();
    const swept = await runCron();
    expect(swept).toMatchObject({ expired: 1 });
    expect(await one('SELECT status, close_reason FROM craft_request')).toEqual({ status: 'closed', close_reason: 'expired' });
    expect([...thread().messages.values()].at(-1)).toEqual({ content: 'This request closed itself: nothing was claimed in 14 days.', allowed_mentions: { parse: [] } });
    expect(thread()).toMatchObject({ locked: true, archived: true, name: '[Cancelled] Copper Plate Breastplate ×2 · Testchar' });
    expect(await count('audit_log', "action = 'request.expire' AND actor = 'sweep'")).toBe(1);
  });

  it('the 14 days count from when it was sent, not from when the member started it', async () => {
    await setupRequests();
    await notify(bo, 'Blacksmithing');
    const unsent = await request(ann, 'Copper Plate Breastplate');
    await env.DB.prepare('UPDATE craft_request SET created_at = ?').bind(new Date(Date.now() - 20 * 86_400_000).toISOString()).run();
    await send(press(ann, button(unsent, 'Send request').custom_id), TOKEN);
    expect(await runCron()).toMatchObject({ open: 1, expired: 0 });
  });

  it('a thread deleted in Discord closes its request; it is not retried every sweep', async () => {
    await sendPlate();
    threads.delete(thread().id);
    expect(await runCron()).toMatchObject({ expired: 1 });
    expect(await one('SELECT status, close_reason FROM craft_request')).toEqual({ status: 'closed', close_reason: 'cancelled' });
    logs.length = 0;
    expect(await runCron()).toBeNull(); // nothing left to look at, so no log line
  });

  it('claimed: open at 15 days; closed after 30 days with no activity', async () => {
    await sendPlate();
    await send(press(bo, buttons({ data: firstMessage(thread()) })[0].custom_id), TOKEN);
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    await env.DB.prepare('UPDATE craft_request SET created_at = ?1, opened_at = ?1').bind(ago(31)).run();
    await env.DB.prepare("UPDATE audit_log SET created_at = ? WHERE action LIKE 'request.%'").bind(ago(15)).run();
    expect(await runCron()).toMatchObject({ expired: 0 });
    await env.DB.prepare("UPDATE audit_log SET created_at = ? WHERE action LIKE 'request.%'").bind(ago(31)).run();
    expect(await runCron()).toMatchObject({ expired: 1 });
    expect(await one('SELECT close_reason FROM craft_request')).toEqual({ close_reason: 'inactive' });
    expect([...thread().messages.values()].at(-1).content).toBe('This request closed itself after 30 days with no activity.');
  });
});

describe('open requests: Cancel a request on /me (own), /officer requests (all)', () => {
  it('a member sees their own; an officer sees every open request and can cancel one from outside the thread', async () => {
    await sendPlate();
    expect((await send(cmd(bo, 'craft', 'requests'), TOKEN)).data.content).toBe(ME_COPY.noOpen);
    const mine = await send(cmd(ann, 'craft', 'requests'), TOKEN);
    expect(mine.data.content).toMatch(/Pick a request to cancel[\s\S]*Copper Plate Breastplate ×2 · Open/);
    // /me lists them too.
    expect((await send(top(ann, 'me'), TOKEN)).data.content).toMatch(/Your open craft requests:\*\*\n\*\*#\d+\*\*.*Copper Plate Breastplate ×2/);
    await send(press(bo, buttons({ data: firstMessage(thread()) })[0].custom_id), TOKEN);
    const list = await send(rawCmd(off, 'officer', 'requests'), TOKEN);
    expect(list.data.flags).toBe(64);
    expect(list.data.content).toContain('from Ann');
    expect(list.data.content).not.toContain(`<@${ANN}>`);
    const id = String((await one<{ id: number }>('SELECT id FROM craft_request')).id);
    const done = await send(select(off, 'rql:', [id]), TOKEN);
    expect(done.data.content).toContain(`Cancelled request #${id}`);
    const last = [...thread().messages.values()].at(-1);
    expect(last.allowed_mentions.users.sort()).toEqual([ANN, BO].sort());
    expect(thread().locked).toBe(true);
  });
});

describe('writes per action (D1 rows_written, measured)', () => {
  it('create, claim, done, cancel and expire each write a few rows', async () => {
    await sendPlate();
    await send(press(bo, buttons({ data: firstMessage(thread()) })[0].custom_id), TOKEN);
    await send(press(bo, buttons({ data: firstMessage(thread()) }).find((b: any) => b.label === 'Done').custom_id), TOKEN);
    // A second request, cancelled by the requester; a third, expired by the sweep.
    const second = await request(ann, 'Copper Plate Breastplate');
    await send(press(ann, button(second, 'Send request').custom_id), TOKEN);
    await send(press(ann, buttons({ data: firstMessage(thread()) }).find((b: any) => b.label === 'Cancel').custom_id), TOKEN);
    const third = await request(ann, 'Copper Plate Breastplate');
    await send(press(ann, button(third, 'Send request').custom_id), TOKEN);
    await env.DB.prepare("UPDATE craft_request SET opened_at = ? WHERE status = 'open'").bind(new Date(Date.now() - 15 * 86_400_000).toISOString()).run();
    const swept = await runCron();
    const byAction: Record<string, number> = { ...Object.fromEntries(requestLogs().map((l) => [l.action, l.rows_written])), expire: swept.rows_written };
    // Measured here (workerd's D1, index writes included), 2026-10-21: notify 5, compose 5, create 8 (with its claim
    // before the thread), claim 5, done 7 (it closed the request), cancel 7 (closed), expire 7.
    expect(byAction).toEqual({ notify: 5, compose: 5, create: 8, claim: 5, done: 7, cancel: 7, expire: 7 });
    for (const a of ['compose', 'create', 'claim', 'done', 'cancel', 'expire']) {
      expect(byAction[a], a).toBeGreaterThan(0);
      expect(byAction[a], a).toBeLessThanOrEqual(12);
    }
  });
});

describe('thread names', () => {
  it("cut to Discord's 100 characters, keeping the status and the main character", () => {
    const name = threadName('Claimed', [{ name: 'A'.repeat(150), quantity: 2 }, { name: 'B', quantity: 1 }], 'Testchar');
    expect(name.length).toBeLessThanOrEqual(100);
    expect(name.startsWith('[Claimed] AAA')).toBe(true);
    expect(name.endsWith('… ×2 +1 more · Testchar')).toBe(true);
  });
});

describe('order 42: names once, plain; a mention only where it pings', () => {
  const userMentions = (s: string) => [...s.matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
  /** B13's control: a ping is real only if the pinged member's mention is in that same message's content. */
  const checkPings = () => {
    const posts = calls.filter((c) => /\/channels\/\d+\/messages(\/\d+)?$/.test(c.path) && (c.method === 'POST' || c.method === 'PATCH') && c.body?.content !== undefined);
    expect(posts.length).toBeGreaterThan(0);
    const pinged: string[][] = [];
    for (const p of posts) {
      const users: string[] = p.body.allowed_mentions?.users ?? [];
      expect(p.body.allowed_mentions?.parse, p.path).toEqual([]);
      if (p.method === 'PATCH') expect(users, 'an edit never pings').toEqual([]);
      // Every member it pings is mentioned in it; every member mentioned in a ping message is one it pings.
      for (const u of users) expect(userMentions(p.body.content), `${u} pinged without a mention`).toContain(u);
      if (users.length) expect(userMentions(p.body.content).every((u) => users.includes(u)), p.body.content).toBe(true);
      // A message that pings nobody names members by saved name, never as a mention (each has one here).
      else expect(userMentions(p.body.content), p.body.content).toEqual([]);
      if (users.length) pinged.push(users);
    }
    return pinged;
  };

  it('the same members are pinged, each by a message that mentions them: the crafters (right after the first message), the requester on a claim, the other party on Done', async () => {
    await sendPlate();
    const press1 = (m: ReturnType<typeof as>, label: string) => send(press(m, buttons({ data: firstMessage(thread()) }).find((b: any) => b.label === label).custom_id), TOKEN);
    await press1(bo, "I'll craft this");
    await press1(bo, 'Done');
    expect(checkPings()).toEqual([[BO], [ANN], [ANN]]);
    // No rendered line holds both a member's mention and their name.
    for (const msg of thread().messages.values()) for (const [id, name] of [[ANN, 'Ann'], [BO, 'Bo']]) expect(msg.content.includes(`<@${id}>`) && msg.content.includes(name), msg.content).toBe(false);
  });

  it('an officer who is not involved cancels: the notice pings the requester and names the officer by saved name', async () => {
    await sendPlate();
    const press1 = (m: ReturnType<typeof as>, label: string) => send(press(m, buttons({ data: firstMessage(thread()) }).find((b: any) => b.label === label).custom_id), TOKEN);
    await press1(off, 'Cancel');
    expect([...thread().messages.values()].at(-1).content).toBe(`<@${ANN}>: **Copper Plate Breastplate** ×2 was cancelled by Off. Every item is done or cancelled, so this thread is now closed.`);
    expect(checkPings()).toEqual([[BO], [ANN]]);
  });

  it('a crafters\' ping that fails is not claimed in the reply', async () => {
    const real = botApi.handle!;
    let posts = 0;
    botApi.handle = async (method, path, body) => {
      if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path) && path !== `/channels/${REQ}/messages` && ++posts === 2) {
        calls.push({ method, path, body });
        return new Response(JSON.stringify({ code: 50013, message: 'Missing Permissions' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return real(method, path, body);
    };
    const sent = await sendPlate();
    expect(sent.data.content).toContain(`Sent: <#${thread().id}>. 1 crafter added there.`);
    expect(sent.data.content).toContain("-# The crafters' ping didn't go out");
    expect(requestLogs().find((l) => l.action === 'create' && l.crafter_ping)).toBeTruthy();
  });

  it('a first message posted late by the sweep pings nobody, and the crafters\' ping follows it once', async () => {
    const real = botApi.handle!;
    let refused = false;
    botApi.handle = async (method, path, body) => {
      if (!refused && method === 'POST' && /^\/channels\/\d+\/messages$/.test(path) && path !== `/channels/${REQ}/messages`) {
        refused = true;
        calls.push({ method, path, body });
        return new Response(JSON.stringify({ code: 50013, message: 'Missing Permissions' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
      }
      return real(method, path, body);
    };
    const sent = await sendPlate();
    expect(sent.data.content).toContain("The thread's first message didn't go out");
    expect(thread().messages.size).toBe(0); // no ping without the message it belongs to
    const swept = await runCron();
    expect(swept).toMatchObject({ first_messages: 1 });
    const [first, ping] = [...thread().messages.values()];
    expect(first.allowed_mentions).toEqual({ parse: [] });
    expect(first.content.split('\n')[0]).toBe('## Craft request from Ann · Testchar');
    expect(ping).toEqual({ content: `<@${BO}>: a new craft request for you`, allowed_mentions: { parse: [], users: [BO] } });
    await runCron();
    expect(thread().messages.size).toBe(2); // the next sweep pings nobody again
  });

  it('a member with no saved name is shown as the mention alone, never as a raw id; no character, no "·"', async () => {
    const { requestContent } = await import('../../src/requests.ts');
    const req = { id: 1, guild_id: GUILD, requester: ANN, note: null, status: 'open', close_reason: null, thread_id: null, message_id: null, thread_name: null, created_at: at, opened_at: at, main: null, last_activity: null } as const;
    const items = [{ request_id: 1, position: 1, item_id: 1, name: 'Wool Cap', quantity: 1, status: 'done', claimer: BO, crafters_json: JSON.stringify([BO]) }] as any;
    const none = requestContent(req as any, items, new Map());
    expect(none.split('\n')[0]).toBe(`## Craft request from <@${ANN}>`);
    expect(none).toContain(`Done by <@${BO}>`);
    // Every id shown is inside a mention: never bare digits.
    expect(none.replace(/<@\d+>/g, '')).not.toMatch(/\d{17,}/);
    const named = requestContent(req as any, items, new Map([[ANN, 'Ann'], [BO, 'Bo_1']]));
    expect(named.split('\n')[0]).toBe('## Craft request from Ann');
    expect(named).toContain('Done by Bo\\_1'); // markdown-escaped
    expect(named).not.toContain('<@');
  });
});

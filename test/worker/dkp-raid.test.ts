// Work order 27, PR B: raid nights and what members see, in workerd against a mocked Discord that keeps the messages it
// is asked to post and edit. Each edge case of docs/PRD.md's raid night has its own test. Nothing reaches a real server.
import { env, runDurableObjectAlarm } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import { HELP_PREFIX } from '../../src/commands/help.ts';
import { APPROVE_PREFIX } from '../../src/dkp/commands.ts';
import { DKP_COPY, RAID_COPY } from '../../src/dkp/copy.ts';
import { CREATURES_SQL } from '../../src/dkp/creatures.ts';
import { HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { POOL_GUILD } from '../../src/dkp/ledger.ts';
import {
  CHECK_PREFIX, CLOSE_PREFIX, HISTORY_PAGE_PREFIX, KILLS_SHOWN, LEAVING_PREFIX, NAMED_PREFIX, NAMES_SHOWN, PAY_PREFIX, PRESENT_PREFIX, RESPAWN_PREFIX, STANDBY_PREFIX, WHO_EARNED_PREFIX, WHO_HERE_PREFIX,
} from '../../src/dkp/raid.ts';
import { ADD_DKP_PREFIX, DKP_CHANNEL_NAME, REMOVE_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { DKP_PREFIX, OPENS_MODAL, planFor } from '../../src/interactions.ts';
import { embedChars, GUILD_CATEGORY, SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, select, send, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const MEMBER_ROLE = '600000000000000005';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE, MEMBER_ROLE], global_name: 'Officer' });
const officerB = as('100000000000000003', { roles: [OFFICER_ROLE, MEMBER_ROLE], global_name: 'OfficerB' });
const kestrel = as('100000000000000004', { roles: [MEMBER_ROLE], global_name: 'Kestrel' });
const pip = as('100000000000000005', { roles: [MEMBER_ROLE], global_name: 'Pip' });
const outsider = as('100000000000000006', { global_name: 'Outsider' });

interface Msg { id: string; channel: string; body: any }
const fake = { channels: [] as any[], messages: [] as Msg[], commands: [] as { id: string; name: string }[], calls: [] as { method: string; path: string; body: any }[], next: 1 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const withToken = { ...env, DISCORD_BOT_TOKEN: 'test-bot-token' } as never;

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM zone'),
    env.DB.prepare('DELETE FROM npc'),
    env.DB.prepare('DELETE FROM mob'),
    env.DB.prepare('DELETE FROM zone_name'),
    env.DB.prepare("INSERT INTO zone (key, name) VALUES ('the ruins', 'The Ruins'), ('empty vale', 'Empty Vale'), ('glinting hollow', 'Glinting Hollow')"),
    // Order 28b: the wiki's tags (Category:Raid Encounters, Category:Named Mobs). The Ruins' rows carry none (NULL).
    env.DB.prepare(
      "INSERT INTO npc (zone_key, name, kind, named, raid) VALUES ('glinting hollow', 'a myconid', 'npc', 0, 0), ('glinting hollow', 'A myconid prince', 'npc', 1, 0), ('glinting hollow', 'Zymora the Sporequeen', 'npc', 1, 1), ('glinting hollow', 'A cave bat', 'npc', 0, 0), ('glinting hollow', 'A spore merchant', 'merchant', 1, 0)",
    ),
    env.DB.prepare(
      "INSERT INTO npc (zone_key, name, kind) VALUES ('the ruins', 'Kestrel the Old', 'named'), ('the ruins', 'a rat', NULL), ('the ruins', 'Bob', 'merchant'), ('the ruins', 'An Ogre', NULL)",
    ),
    env.DB.prepare("INSERT INTO zone_name (source, name, zone_key) VALUES ('mnm-tools:mobs', 'The Ruins', 'the ruins')"),
    env.DB.prepare("INSERT INTO mob (key, title, zones_json) VALUES ('goblin_king', 'Goblin King', '[\"The Ruins\"]'), ('an_ogre', 'an ogre', '[\"The Ruins\"]')"),
  ]);
  Object.assign(fake, { channels: [], messages: [], commands: [], calls: [], next: 1 });
  botApi.handle = (method, path, body) => {
    fake.calls.push({ method, path, body });
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: 'botrole', permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: ['botrole'] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === GUILD_CATEGORY ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null, permission_overwrites: body.permission_overwrites ?? [] };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'GET' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) return json(fake.commands);
    if (method === 'POST' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) {
      const c = fake.commands.find((x) => x.name === body.name) ?? { id: id(), name: body.name };
      fake.commands = [...fake.commands.filter((x) => x.name !== body.name), c];
      return json(c);
    }
    if (method === 'DELETE' && path.startsWith(`/applications/${APP_ID}/guilds/${GUILD}/commands/`)) {
      fake.commands = fake.commands.filter((x) => !path.endsWith(x.id));
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
      return new Response(JSON.stringify({ id: m.id }), { status: 200, headers: { 'Content-Type': 'application/json', 'X-RateLimit-Remaining': '4', 'X-RateLimit-Reset-After': '5.000' } });
    }
    return json({ message: 'Unknown', code: 0 }, 404);
  };
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE, member_role: MEMBER_ROLE }), TOKEN);
  await send(press(admin, ADD_DKP_PREFIX), TOKEN);
});

const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const dkp = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'dkp', sub, opts), TOKEN);
const raid = () => one<{ id: number; message_id: string }>('SELECT id, message_id FROM dkp_raid ORDER BY id DESC LIMIT 1');
const card = async () => {
  const { message_id } = await raid();
  return fake.messages.find((m) => m.id === message_id)!.body;
};
/** The card as the timer object renders it (the edit a tap asked for). */
const render = async () => {
  await HANDLERS.render(withToken, GUILD, String((await raid()).id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
  return card();
};
const balance = async (member: Member, pool: string) => (await env.DB.prepare('SELECT balance_after AS b FROM dkp_ledger WHERE member_id = ? AND pool = ? ORDER BY id DESC LIMIT 1').bind(member.user.id, pool).first<{ b: number }>())?.b ?? 0;
const open = async (zone = 'The Ruins', mode?: string) => dkp(officer, 'raid', { zone, ...(mode ? { mode } : {}) });

describe('raid nights (ITEM 4)', () => {
  it('opens a raid card in GC-DKP; a second /dkp raid is refused with a link to the open one', async () => {
    const r = await open();
    const { id, message_id } = await raid();
    const ch = fake.channels.find((c) => c.name === storedName(DKP_CHANNEL_NAME))!;
    const url = `https://discord.com/channels/${GUILD}/${ch.id}/${message_id}`;
    expect(r.data.content).toBe(RAID_COPY.opened('The Ruins', url));
    expect((await card()).embeds[0].title).toBe(RAID_COPY.title('The Ruins', 'named'));
    expect((await open()).data.content).toBe(RAID_COPY.alreadyOpen(url));
    expect(await count('dkp_raid')).toBe(1);
    // Its auto-close is set on the timer object at closes_at.
    const closes = Date.parse((await one<{ closes_at: string }>('SELECT closes_at FROM dkp_raid WHERE id = ?', id)).closes_at);
    expect((await timersOf(env, GUILD).list())[`close:${id}`]).toBe(closes);
  });

  it('Named killed offers the zone\'s creatures (mobs and NPCs, no merchants, deduplicated); an untagged zone shows only "Other creatures", A→Z', async () => {
    await open();
    const sel = (await card()).components.flatMap((r: any) => r.components).find((c: any) => c.custom_id?.startsWith(NAMED_PREFIX));
    // "An Ogre" (NPC) and "an ogre" (mob) are one creature: either spelling is kept, once. Order 28b: nothing is inferred
    // from a name (the "a "/"an " order is gone); with no tags, every creature is in "Other creatures".
    expect(sel.options.map((o: any) => o.label.toLowerCase())).toEqual(['a rat', 'an ogre', 'goblin king', 'kestrel the old']);
    expect(new Set(sel.options.map((o: any) => o.description))).toEqual(new Set([RAID_COPY.creaturePart.other]));
    expect((await env.DB.prepare(CREATURES_SQL).bind('empty vale').all()).results).toEqual([]);
  });

  it('order 28b: Named killed in Glinting Hollow lists raid encounters, then named mobs (A myconid prince), then other creatures, each A→Z', async () => {
    await open('Glinting Hollow');
    const sel = (await card()).components.flatMap((r: any) => r.components).find((c: any) => c.custom_id?.startsWith(NAMED_PREFIX));
    expect(sel.options.map((o: any) => [o.label, o.description])).toEqual([
      ['Zymora the Sporequeen', RAID_COPY.creaturePart.raid],
      ['A myconid prince', RAID_COPY.creaturePart.named],
      ['A cave bat', RAID_COPY.creaturePart.other],
      ['a myconid', RAID_COPY.creaturePart.other],
    ]);
    // The same order for /dkp kill's autocomplete (one statement, the open raid's zone).
    expect((await env.DB.prepare(CREATURES_SQL).bind('glinting hollow').all<{ name: string }>()).results.map((r) => r.name)).toEqual(sel.options.map((o: any) => o.label));
  });

  it('a zone with no creatures shows no select, and the card says to use /dkp kill', async () => {
    await open('Empty Vale');
    const c = await card();
    expect(c.components.flatMap((r: any) => r.components).some((x: any) => x.custom_id?.startsWith(NAMED_PREFIX))).toBe(false);
    expect(c.embeds[0].description).toContain(RAID_COPY.noCreatures);
  });

  it('Present answers privately at once; the card edit is a coalesced timer item; the card then shows the member', async () => {
    await open();
    const { id } = await raid();
    const r = await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    expect(r.data).toMatchObject({ content: RAID_COPY.youPresent, flags: 64 });
    for (let i = 0; i < 20; i++) await pressAs(pip, `${i % 2 ? STANDBY_PREFIX : PRESENT_PREFIX}${id}`);
    // Twenty-one taps: at most one card edit waits at a time (the object coalesces; workerd runs a due alarm itself). The
    // object's env in this pool has no bot token (the harness gives it to the Worker's fetch only), so the edit it runs
    // here sends nothing; the pace it keeps is proven in test/worker/dkp-pace.test.ts, and the edit itself below.
    expect(Object.keys(await timersOf(env, GUILD).list()).filter((k) => k.startsWith('render:')).length).toBeLessThanOrEqual(1);
    const c = await render();
    // Pip's last tap (the twentieth) was Standby.
    expect(c.embeds[0].description).toContain('**Present** (1): Kestrel\n**Standby** (1): Pip');
    expect(c.allowed_mentions).toEqual({ parse: [] });
  });

  it('a kill pays everyone Present or Standby at that moment (raid and guild points); Present after a kill earns only later ones; /me shows it', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    const k = await send(select(officer, `${NAMED_PREFIX}${id}`, ['Kestrel the Old']), TOKEN);
    expect(k.data.content).toBe(RAID_COPY.killed('Kestrel the Old', 10, 1));
    expect([await balance(kestrel, 'the ruins'), await balance(kestrel, POOL_GUILD)]).toEqual([10, 2]);
    await pressAs(pip, `${STANDBY_PREFIX}${id}`);
    expect(await balance(pip, 'the ruins')).toBe(0);
    await dkp(officer, 'kill', { named: 'Goblin King' });
    expect([await balance(kestrel, 'the ruins'), await balance(pip, 'the ruins')]).toEqual([20, 10]);
    const line = (await render()).embeds[0].description.split('\n').find((l: string) => l.includes('Goblin King'));
    expect(line).toMatch(/Goblin King\*\* · 10 pts · 2 earned · \+Pip$/);
    const me = await send(rawCmd(kestrel, 'me', undefined), TOKEN);
    expect(me.data.content).toContain(`${RAID_COPY.meHead}\n${RAID_COPY.meLine('Guild pool', 4, 2, 2)}\n${RAID_COPY.meLine('The Ruins', 20, 2, 2)}`);
    const who = await pressAs(pip, `${WHO_EARNED_PREFIX}${id}`);
    expect(who.data.content).toContain(RAID_COPY.earnedHead('Goblin King', 2));
  });

  it('the same named within 2 minutes asks to confirm a respawn; confirming records it', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await dkp(officer, 'kill', { named: 'Kestrel the Old' });
    const again = await dkp(officer, 'kill', { named: 'kestrel the old' });
    expect(again.data.content).toBe(RAID_COPY.respawnAsk('kestrel the old'));
    expect(await count('dkp_kill')).toBe(1);
    const confirm = again.data.components![0].components[0].custom_id;
    expect(confirm.startsWith(RESPAWN_PREFIX)).toBe(true);
    await pressAs(officer, confirm);
    expect(await count('dkp_kill')).toBe(2);
    expect(await balance(kestrel, 'the ruins')).toBe(20);
  });

  it('review of PR B: the respawn confirm records once, however often it is pressed; flat mode pays once; a refused approval changes nothing', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await dkp(officer, 'kill', { named: 'Kestrel the Old' });
    const confirm = (await dkp(officer, 'kill', { named: 'Kestrel the Old' })).data.components![0].components[0].custom_id;
    const first = await pressAs(officer, confirm);
    expect(first.type).toBe(7);
    expect(first.data.components).toEqual([]);
    expect((await pressAs(officer, confirm)).data.content).toBe(RAID_COPY.respawnDone);
    expect(await count('dkp_kill')).toBe(2);
    // A correction over 20 points, lapsed (Remove DKP lapses open ones; here its time passes): Approve changes nothing.
    await pressAs(officer, `${PRESENT_PREFIX}${id}`);
    await dkp(officer, 'correct', { member: kestrel.user.id, action: 'remove', reason: 'afk all night' });
    const p = await one<{ id: number }>("SELECT id FROM dkp_pending WHERE kind = 'correction'");
    await env.DB.prepare("UPDATE dkp_pending SET due_at = '2000-01-01T00:00:00Z'").run();
    const before = await count('dkp_ledger');
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.notOpen);
    expect(await count('dkp_ledger')).toBe(before);
    expect(await balance(kestrel, 'the ruins')).toBe(20);
    await pressAs(officer, `${CLOSE_PREFIX}${id}`);
    await open('The Ruins', 'flat');
    const flat = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${flat.id}`);
    await pressAs(officer, `${PAY_PREFIX}${flat.id}`);
    expect((await pressAs(officer, `${PAY_PREFIX}${flat.id}`)).data.content).toBe(RAID_COPY.flatPaid);
    expect(await balance(kestrel, 'the ruins')).toBe(50);
  });

  it('a raid whose card Discord refuses is closed at once, so the next /dkp raid is not refused', async () => {
    const handle = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'POST' && /\/messages$/.test(p) && b?.embeds?.[0]?.title?.startsWith('Raid') ? json({ code: 50013, message: 'Missing Permissions' }, 403) : handle(m, p, b));
    expect((await open()).data.content).toBe(RAID_COPY.cannotPost);
    botApi.handle = handle;
    expect((await open()).data.content).toMatch(/^Raid open/);
  });

  it('a typed name the data lacks is accepted and stored as typed', async () => {
    await open();
    await dkp(officer, 'kill', { named: 'Sir Unlisted' });
    expect(await one('SELECT name FROM dkp_kill')).toEqual({ name: 'Sir Unlisted' });
  });

  it('Check again: who taps Present keeps the kill; who does not loses it and is absent after; a first-time Present inside the window gains nothing; the card shows closed (due)', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await pressAs(pip, `${PRESENT_PREFIX}${id}`);
    await dkp(officer, 'kill', { named: 'Kestrel the Old' });
    const outsiderMember = as('100000000000000008', { roles: [MEMBER_ROLE], global_name: 'Late' });
    expect((await pressAs(officer, `${CHECK_PREFIX}${id}`)).data.content).toBe(RAID_COPY.checkStarted('Kestrel the Old', 300));
    const kill = await one<{ id: number; check_due: string }>('SELECT id, check_due FROM dkp_kill');
    expect((await timersOf(env, GUILD).list())[`check:${kill.id}`]).toBe(Date.parse(kill.check_due));
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await pressAs(outsiderMember, `${PRESENT_PREFIX}${id}`);
    const due = Date.parse(kill.check_due);
    await HANDLERS.check(withToken, GUILD, String(kill.id), due, due + 3000, null);
    await HANDLERS.check(withToken, GUILD, String(kill.id), due, due + 4000, null); // at least once: twice changes nothing
    expect([await balance(kestrel, 'the ruins'), await balance(pip, 'the ruins'), await balance(outsiderMember, 'the ruins')]).toEqual([10, 0, 0]);
    expect(await balance(pip, POOL_GUILD)).toBe(0);
    expect((await one<{ state: string }>('SELECT state FROM dkp_attendance WHERE member_id = ?', pip.user.id)).state).toBe('absent');
    expect(await count('dkp_ledger', "actor = 'bot' AND kind = 'correction'")).toBe(2);
    const line = (await render()).embeds[0].description.split('\n').find((l: string) => l.includes('Kestrel the Old'));
    const closed = await one<{ check_closed_at: string }>('SELECT check_closed_at FROM dkp_kill');
    expect(line).toContain(RAID_COPY.checkClosed(Math.floor(Date.parse(closed.check_closed_at) / 1000), Math.floor(due / 1000)));
    // The next kill pays Kestrel and the late member, not Pip.
    await dkp(officer, 'kill', { named: 'Goblin King' });
    expect([await balance(kestrel, 'the ruins'), await balance(pip, 'the ruins'), await balance(outsiderMember, 'the ruins')]).toEqual([20, 0, 10]);
  });

  it('a frozen member (status left) earns nothing; their own next raid-button press thaws them', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(kestrel.user.id).run();
    await dkp(officer, 'kill', { named: 'Kestrel the Old' });
    expect(await balance(kestrel, 'the ruins')).toBe(0);
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    expect((await one<{ status: string }>('SELECT status FROM member WHERE discord_user_id = ?', kestrel.user.id)).status).toBe('active');
    await dkp(officer, 'kill', { named: 'Goblin King' });
    expect(await balance(kestrel, 'the ruins')).toBe(10);
  });

  it('a presser without the member role is refused privately; a member cannot record kills', async () => {
    await open();
    const { id } = await raid();
    expect((await pressAs(outsider, `${PRESENT_PREFIX}${id}`)).data.content).toMatch(/is for members with the/);
    expect((await pressAs(kestrel, `${PAY_PREFIX}${id}`)).data.content).toBe(RAID_COPY.notRunner);
    expect((await send(select(kestrel, `${NAMED_PREFIX}${id}`, ['Goblin King']), TOKEN)).data.content).toBe(RAID_COPY.notRunner);
  });

  it('corrections: a small one applies at once with its reason posted; one over 20 points needs a second officer; nobody corrects their own', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await pressAs(officer, `${PRESENT_PREFIX}${id}`);
    for (const n of ['Kestrel the Old', 'Goblin King']) await dkp(officer, 'kill', { named: n });
    expect((await dkp(officer, 'correct', { member: officer.user.id, action: 'remove', reason: 'mine' })).data.content).toBe(RAID_COPY.own);
    const k1 = await one<{ id: number }>('SELECT min(id) AS id FROM dkp_kill');
    expect((await dkp(officer, 'correct', { member: kestrel.user.id, action: 'remove', reason: 'was afk', kill: k1.id })).data.content).toBe(RAID_COPY.correctedReply);
    expect(await balance(kestrel, 'the ruins')).toBe(10);
    expect(fake.messages.some((m) => m.body.content?.includes('Reason: was afk'))).toBe(true);
    // The whole raid: 2 kills × (10 + 2) = 24 points, over 20: an approval card.
    expect((await dkp(officer, 'correct', { member: kestrel.user.id, action: 'add', reason: 'was there' })).data.content).toBe(DKP_COPY.approvalPosted(20));
    const p = await one<{ id: number }>("SELECT id FROM dkp_pending WHERE kind = 'correction'");
    expect((await pressAs(officer, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.asked);
    expect((await pressAs(officerB, `${APPROVE_PREFIX}${p.id}`)).data.content).toBe(DKP_COPY.approvedReply);
    // Re-added on the kill they lost; the kill they kept is not paid twice.
    expect([await balance(kestrel, 'the ruins'), await balance(kestrel, POOL_GUILD)]).toEqual([20, 4]);
  });

  it('flat mode: no Named killed; Pay attendance pays the flat value once to everyone Present or Standby', async () => {
    await open('The Ruins', 'flat');
    const { id } = await raid();
    const ids = (await card()).components.flatMap((r: any) => r.components).map((c: any) => c.custom_id);
    expect(ids.some((x: string) => x.startsWith(NAMED_PREFIX))).toBe(false);
    expect(ids).toContain(`${PAY_PREFIX}${id}`);
    await pressAs(kestrel, `${STANDBY_PREFIX}${id}`);
    expect((await pressAs(officer, `${PAY_PREFIX}${id}`)).data.content).toBe(RAID_COPY.paid(30, 1));
    expect([await balance(kestrel, 'the ruins'), await balance(kestrel, POOL_GUILD)]).toEqual([30, 2]);
    expect((await dkp(officer, 'kill', { named: 'x' })).data.content).toBe(RAID_COPY.flatNoKills);
  });

  it('Close raid posts the summary, closes the card (no buttons) and refreshes standings; auto-close does the same at closes_at, once', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await dkp(officer, 'kill', { named: 'Goblin King' });
    expect((await pressAs(officer, `${CLOSE_PREFIX}${id}`)).data.content).toBe(RAID_COPY.closedReply);
    expect((await card()).components).toEqual([]);
    expect(fake.messages.some((m) => m.body.content === RAID_COPY.summary('The Ruins', 1, 1, 10, 'officer'))).toBe(true);
    expect((await fake.messages.find((m) => m.body.embeds?.[0]?.title === DKP_COPY.standingsTitle('The Ruins'))!).body.embeds[0].description).toContain('**10**');
    expect((await pressAs(kestrel, `${PRESENT_PREFIX}${id}`)).data.content).toBe(RAID_COPY.raidClosed);
    // A second raid, closed by its timer: not before closes_at, then once.
    await open();
    const second = await raid();
    const closes = Date.parse((await one<{ closes_at: string }>('SELECT closes_at FROM dkp_raid WHERE id = ?', second.id)).closes_at);
    const api = () => timerApi(withToken, Date.now(), () => 0);
    await HANDLERS.close(withToken, GUILD, String(second.id), closes, closes - 60_000, api());
    expect((await one<{ closed_at: string | null }>('SELECT closed_at FROM dkp_raid WHERE id = ?', second.id)).closed_at).toBe(null);
    await HANDLERS.close(withToken, GUILD, String(second.id), closes, closes + 1000, api());
    await HANDLERS.close(withToken, GUILD, String(second.id), closes, closes + 2000, api());
    expect(await one('SELECT close_reason FROM dkp_raid WHERE id = ?', second.id)).toEqual({ close_reason: 'auto' });
    expect(fake.messages.filter((m) => m.body.content === RAID_COPY.summary('The Ruins', 0, 0, 0, 'auto')).length).toBe(1);
  });

  it('Remove DKP mid-raid closes the raid at once, cancels its timers, and its buttons answer "DKP is off"', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    await pressAs(admin, REMOVE_DKP_PREFIX);
    expect(await one('SELECT close_reason FROM dkp_raid')).toEqual({ close_reason: 'removed' });
    expect((await card()).components).toEqual([]);
    expect(await timersOf(env, GUILD).list()).toEqual({});
    for (const p of [PRESENT_PREFIX, STANDBY_PREFIX, LEAVING_PREFIX, WHO_HERE_PREFIX, WHO_EARNED_PREFIX, CHECK_PREFIX, PAY_PREFIX, CLOSE_PREFIX, NAMED_PREFIX, RESPAWN_PREFIX])
      expect((await pressAs(kestrel, `${p}${id}`)).data.content, p).toBe(DKP_COPY.off);
    expect((await send(rawCmd(kestrel, 'me', undefined), TOKEN)).data.content).not.toContain(RAID_COPY.meHead);
  });

  it('the card at its size limits: names become counts past NAMES_SHOWN, kill lines past KILLS_SHOWN are counted, inside Discord\'s embed limits', async () => {
    await open();
    const { id } = await raid();
    const at = new Date().toISOString();
    const many = Array.from({ length: NAMES_SHOWN + 30 }, (_, i) => `3000000000000${String(i).padStart(4, '0')}`);
    await env.DB.batch([
      ...many.map((m, i) => env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?)").bind(GUILD, m, `A very long member name ${i}`, at)),
      ...many.map((m) => env.DB.prepare("INSERT INTO dkp_attendance (raid_id, member_id, state, since, set_by) VALUES (?, ?, 'present', ?, ?)").bind(id, m, at, m)),
    ]);
    for (let k = 0; k < KILLS_SHOWN + 8; k++) await dkp(officer, 'kill', { named: `A Named With A Long Name Number ${k}` });
    const c = await render();
    expect(c.embeds[0].description).toContain(`**Present** (${many.length}): ${RAID_COPY.counted(many.length)}`);
    expect(c.embeds[0].description).toContain(RAID_COPY.earlier(8));
    expect(c.embeds[0].description.length).toBeLessThanOrEqual(4096);
    expect(embedChars(c.embeds)).toBeLessThan(6000);
    const here = await pressAs(kestrel, `${WHO_HERE_PREFIX}${id}`);
    expect(here.data.content!.length).toBeLessThanOrEqual(2000);
  });

  it('the timer object renders the card from its alarm, paced by the edit\'s X-RateLimit headers', async () => {
    await open();
    const { id } = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${id}`);
    const stub = timersOf(env, GUILD);
    await runDurableObjectAlarm(stub);
    for (let i = 0; i < 40 && Object.keys(await stub.list()).some((k) => k.startsWith('render:')); i++) await new Promise((r) => setTimeout(r, 50));
    expect(Object.keys(await stub.list()).some((k) => k.startsWith('render:'))).toBe(false);
  });

  it('routes each new custom_id prefix (order 23); none opens a modal', () => {
    for (const p of [PRESENT_PREFIX, STANDBY_PREFIX, LEAVING_PREFIX, NAMED_PREFIX, RESPAWN_PREFIX, WHO_HERE_PREFIX, WHO_EARNED_PREFIX, CHECK_PREFIX, PAY_PREFIX, CLOSE_PREFIX, HISTORY_PAGE_PREFIX]) {
      expect(p.startsWith(DKP_PREFIX), p).toBe(true);
      expect(OPENS_MODAL.some((m) => p.startsWith(m)), p).toBe(false);
      expect(planFor(press(kestrel, `${p}1`) as never), p).toMatchObject({ defer: true });
    }
  });
});

describe('what members see (ITEM 5)', () => {
  it('/dkp history answers privately, newest first, paged', async () => {
    for (let i = 1; i <= 12; i++) await dkp(officer, 'adjust', { member: kestrel.user.id, pool: POOL_GUILD, points: i, reason: `r${i}` });
    const h = await dkp(pip, 'history', { member: kestrel.user.id });
    expect(h.data.flags).toBe(64);
    const lines = h.data.embeds![0].description!.split('\n').filter((l) => l.startsWith('<t:'));
    expect(lines.length).toBe(10);
    expect(lines[0]).toContain('+12');
    const next = await pressAs(pip, h.data.components![0].components[1].custom_id);
    expect(next.type).toBe(7);
    expect(next.data.embeds![0].description!.split('\n').filter((l) => l.startsWith('<t:')).length).toBe(2);
  });

  it('/help shows the DKP page only where DKP is on', async () => {
    const pages = async () => (await send(rawCmd(kestrel, 'help', undefined), TOKEN)).data.components!.flatMap((r: any) => r.components.map((b: any) => b.custom_id));
    expect(await pages()).toContain(`${HELP_PREFIX}dkp`);
    await pressAs(admin, REMOVE_DKP_PREFIX);
    expect(await pages()).not.toContain(`${HELP_PREFIX}dkp`);
  });

  it('/me shows DKP only where it is on', async () => {
    expect((await send(rawCmd(kestrel, 'me', undefined), TOKEN)).data.content).toContain(RAID_COPY.meHead);
    await pressAs(admin, REMOVE_DKP_PREFIX);
    expect((await send(rawCmd(kestrel, 'me', undefined), TOKEN)).data.content).not.toContain(RAID_COPY.meHead);
    expect(await all('SELECT 1 FROM dkp_guild WHERE enabled = 1')).toEqual([]);
  });
});

// Work order 29, ITEM 4: raid auctions (docs/PRD.md "Order 29: spending points"), in workerd against a mocked Discord that
// keeps the messages it is asked to post and edit. Nothing reaches a real server.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { storedName } from '../../src/commands/channels.ts';
import {
  AUCTION_DROP_PREFIX, AUCTION_OPENS_MODAL, AUCTION_PREFIXES, BID_MODAL_PREFIX, BID_PREFIX, CANCEL_MODAL_PREFIX, CANCEL_PREFIX, decide, DROP_MODAL_PREFIX, DROP_SELECT_PREFIX, POST_GENERAL_PREFIX,
} from '../../src/dkp/auction.ts';
import { AUCTION_COPY, DKP_COPY } from '../../src/dkp/copy.ts';
import { HANDLERS, timerApi } from '../../src/dkp/due.ts';
import { bidRefusal } from '../../src/dkp/eligible.ts';
import { POOL_GUILD } from '../../src/dkp/ledger.ts';
import { CLOSE_PREFIX, NAMED_PREFIX, PRESENT_PREFIX, STANDBY_PREFIX } from '../../src/dkp/raid.ts';
import { settingsOf } from '../../src/dkp/settings.ts';
import { ADD_DKP_PREFIX, DKP_CHANNEL_NAME, REMOVE_DKP_PREFIX } from '../../src/dkp/setup.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { DKP_PREFIX, OPENS_MODAL, planFor } from '../../src/interactions.ts';
import { GUILD_CATEGORY, SEND_MESSAGES, VIEW_CHANNEL } from '../../src/discord.ts';
import { INSTALL_PERMISSIONS } from '../../src/permissions.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, APP_ID, as, botApi, GUILD, press, rawCmd, select, send, submit, type Member } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const OFFICER_ROLE = '600000000000000002';
const MEMBER_ROLE = '600000000000000005';
const admin = as('100000000000000001', { permissions: ADMIN });
const officer = as('100000000000000002', { roles: [OFFICER_ROLE, MEMBER_ROLE], global_name: 'Officer' });
const officerB = as('100000000000000003', { roles: [OFFICER_ROLE, MEMBER_ROLE], global_name: 'OfficerB' });
const kestrel = as('100000000000000004', { roles: [MEMBER_ROLE], global_name: 'Kestrel' });
const pip = as('100000000000000005', { roles: [MEMBER_ROLE], global_name: 'Pip' });
const wren = as('100000000000000006', { roles: [MEMBER_ROLE], global_name: 'Wren' });

interface Msg { id: string; channel: string; body: any }
const fake = { channels: [] as any[], messages: [] as Msg[], commands: [] as { id: string; name: string }[], next: 1 };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const withToken = { ...env, DISCORD_BOT_TOKEN: 'test-bot-token' } as never;
const ROBE = 7001;
const MUSHROOM = 7002;

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  const at = '2026-10-29T00:00:00Z';
  await env.DB.batch([
    env.DB.prepare('DELETE FROM zone'),
    env.DB.prepare('DELETE FROM npc'),
    env.DB.prepare('DELETE FROM mob'),
    env.DB.prepare('DELETE FROM zone_name'),
    env.DB.prepare('DELETE FROM item WHERE id IN (7001, 7002, 7003)'),
    env.DB.prepare("INSERT INTO zone (key, name) VALUES ('glinting hollow', 'Glinting Hollow')"),
    env.DB.prepare(
      `INSERT INTO npc (zone_key, name, kind, named, raid, loot_json) VALUES ('glinting hollow', 'A myconid prince', 'npc', 1, 0, '["Fungal Robe","Black Mushroom","Not An Item"]'), ('glinting hollow', 'A cave bat', 'npc', 0, 0, '[]')`,
    ),
    env.DB.prepare("INSERT INTO item (id, name, name_key, imported_at) VALUES (7001, 'Fungal Robe', 'fungal robe', ?), (7002, 'Black Mushroom', 'black mushroom', ?), (7003, 'Lantern', 'lantern', ?)").bind(at, at, at),
  ]);
  Object.assign(fake, { channels: [], messages: [], commands: [], next: 1 });
  botApi.handle = (method, path, body) => {
    const id = () => `70000000000000${String(fake.next++).padStart(4, '0')}`;
    if (method === 'GET' && path === `/guilds/${GUILD}/channels`) return json(fake.channels);
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json([{ id: GUILD, permissions: String(VIEW_CHANNEL | SEND_MESSAGES) }, { id: 'botrole', permissions: String(INSTALL_PERMISSIONS) }]);
    if (method === 'GET' && path === `/guilds/${GUILD}/members/${APP_ID}`) return json({ roles: ['botrole'] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json({ id: GUILD, name: 'Test Guild' });
    if (method === 'POST' && path === `/guilds/${GUILD}/channels`) {
      const ch = { id: id(), name: body.type === GUILD_CATEGORY ? body.name : storedName(body.name), type: body.type, parent_id: body.parent_id ?? null, permission_overwrites: [] };
      fake.channels.push(ch);
      return json(ch, 201);
    }
    if (method === 'GET' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) return json(fake.commands);
    if (method === 'POST' && path === `/applications/${APP_ID}/guilds/${GUILD}/commands`) return json({ id: id(), name: body.name });
    if (method === 'DELETE' && path.startsWith(`/applications/${APP_ID}/guilds/${GUILD}/commands/`)) return new Response(null, { status: 204 });
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
  await send(rawCmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE, member_role: MEMBER_ROLE }), TOKEN);
  await send(press(admin, ADD_DKP_PREFIX), TOKEN);
  // The new-member wait is its own test; elsewhere members are past it.
  await setting('new_member_kills', 0);
});

const setting = (key: string, value: number) =>
  env.DB.prepare("INSERT INTO dkp_setting (guild_id, key, value, set_at, set_by) VALUES (?1, ?2, ?3, 'x', 'x') ON CONFLICT (guild_id, key) DO UPDATE SET value = ?3").bind(GUILD, key, String(value)).run();
const pressAs = (m: Member, id: string) => send(press(m, id), TOKEN);
const dkp = (m: Member, sub: string, opts: Record<string, unknown> = {}) => send(rawCmd(m, 'dkp', sub, opts), TOKEN);
const raid = () => one<{ id: number; message_id: string }>('SELECT id, message_id FROM dkp_raid ORDER BY id DESC LIMIT 1');
const auction = () => one<{ id: number; message_id: string; status: string; closes_at: string; winner: string | null; price: number | null }>('SELECT id, message_id, status, closes_at, winner, price FROM dkp_auction ORDER BY id DESC LIMIT 1');
const cardOf = (id: string) => fake.messages.find((m) => m.id === id)!.body;
/** Whether a message shows the number n on its own (not inside an id, a time or a date). */
const shows = (body: unknown, n: number) => new RegExp(`(?<![\\d.:T-])${n}(?![\\d:])`).test(JSON.stringify(body));
const balance = async (m: Member, pool: string) => (await env.DB.prepare('SELECT balance_after AS b FROM dkp_ledger WHERE member_id = ? AND pool = ? ORDER BY id DESC LIMIT 1').bind(m.user.id, pool).first<{ b: number }>())?.b ?? 0;
const give = async (m: Member, points: number, pool = 'Glinting Hollow') => {
  await setting('second_officer_over', 100000);
  await dkp(officerB, 'adjust', { member: m.user.id, pool, points, reason: 'test points' });
};
/** Opens Glinting Hollow, puts members Present, records A myconid prince. */
async function nightWithKill(present: Member[] = [kestrel, pip]) {
  await dkp(officer, 'raid', { zone: 'Glinting Hollow' });
  const r = await raid();
  for (const m of present) await pressAs(m, `${PRESENT_PREFIX}${r.id}`);
  await send(select(officer, `${NAMED_PREFIX}${r.id}`, ['A myconid prince']), TOKEN);
  return r;
}
/** Auction a drop → the select → the form, as an officer. */
async function auctionDrop(r: { id: number }, itemId = ROBE, minimum = '5', minutes = '3') {
  const pick = await pressAs(officer, `${AUCTION_DROP_PREFIX}${r.id}`);
  const sel = pick.data.components![0].components[0];
  const form = await send(select(officer, sel.custom_id, [String(itemId)]), TOKEN);
  return { pick, form, done: await send(submit(officer, form.data.custom_id!, { minimum, minutes }), TOKEN) };
}
const bid = (m: Member, id: number, amount: string) => send(submit(m, `${BID_MODAL_PREFIX}${id}`, { amount }), TOKEN);
const closeAt = async (id: number, offsetMs = 1000) => {
  const a = await one<{ closes_at: string }>('SELECT closes_at FROM dkp_auction WHERE id = ?', id);
  const due = Date.parse(a.closes_at);
  const r = await HANDLERS.auction(withToken, GUILD, String(id), due, due + offsetMs, timerApi(withToken, Date.now(), () => 0));
  // The result is its own timer item (review of PR B), run here as the object would.
  if (r?.schedule?.some((s) => s.key === `result:${id}`)) await HANDLERS.result(withToken, GUILD, String(id), due, due + offsetMs, timerApi(withToken, Date.now(), () => 0));
  return r;
};

describe('raid auctions (order 29, ITEM 4)', () => {
  it("Auction a drop offers the latest kill's known loot (matched to items); the form opens a card with the item's stats, the minimum, and a hidden bidder count", async () => {
    const r = await nightWithKill();
    const { pick, form, done } = await auctionDrop(r);
    const sel = pick.data.components![0].components[0];
    expect(sel.custom_id.startsWith(DROP_SELECT_PREFIX)).toBe(true);
    // Not An Item has no item row: only the two matches, A→Z.
    expect(sel.options.map((o: any) => o.label)).toEqual(['Black Mushroom', 'Fungal Robe']);
    expect(form.type).toBe(9);
    expect(form.data.custom_id).toBe(`${DROP_MODAL_PREFIX}${(await one<{ id: number }>('SELECT max(id) AS id FROM dkp_kill')).id}:${ROBE}`);
    expect(done.data.content).toMatch(/^Auction open: \*\*Fungal Robe\*\*\./);
    const a = await auction();
    expect(a.status).toBe('open');
    const card = cardOf(a.message_id);
    expect(card.embeds[0].title).toBe('Fungal Robe');
    expect(card.embeds[1].description).toContain(AUCTION_COPY.minimum(5));
    expect(card.embeds[1].description).toContain(AUCTION_COPY.bidders(0));
    expect(card.components[0].components.map((b: any) => b.custom_id)).toEqual([`${BID_PREFIX}${a.id}`, `${CANCEL_PREFIX}${a.id}`]);
    expect(card.allowed_mentions).toEqual({ parse: [] });
    // Closing is the timer's: auction:<id> at closes_at, 3 minutes on.
    expect((await timersOf(env, GUILD).list())[`auction:${a.id}`]).toBe(Date.parse(a.closes_at));
  });

  it("Brian's check, mocked: a lone bidder of 20 wins and pays the minimum, 5; the card showed only \"1 bidder\"; the result reveals the bid", async () => {
    const r = await nightWithKill([kestrel]);
    await give(kestrel, 30);
    await auctionDrop(r);
    const a = await auction();
    const form = await pressAs(kestrel, `${BID_PREFIX}${a.id}`);
    expect(form.type).toBe(9);
    expect((await bid(kestrel, a.id, '20')).data.content).toBe(AUCTION_COPY.bidIn(20, Math.floor(Date.parse(a.closes_at) / 1000)));
    await HANDLERS.acard(withToken, GUILD, String(a.id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    expect(JSON.stringify(cardOf(a.message_id))).toContain('1 bidder');
    expect(shows(cardOf(a.message_id), 20)).toBe(false);
    await closeAt(a.id);
    const done = await auction();
    expect([done.status, done.winner, done.price]).toEqual(['sold', kestrel.user.id, 5]);
    expect(await balance(kestrel, 'glinting hollow')).toBe(10 + 30 - 5);
    const spend = await one<{ amount: number; kind: string; actor: string; auction_id: number }>("SELECT amount, kind, actor, auction_id FROM dkp_ledger WHERE kind = 'spend'");
    expect(spend).toEqual({ amount: -5, kind: 'spend', actor: 'bot', auction_id: a.id });
    const result = cardOf(a.message_id).embeds[1].description;
    expect(result).toContain(AUCTION_COPY.sold(`<@${kestrel.user.id}> (Kestrel)`, 5));
    expect(result).toContain(`<@${kestrel.user.id}> (Kestrel): 20`);
    expect(cardOf(a.message_id).components).toEqual([]);
    const line = fake.messages.find((m) => m.body.content?.startsWith('**Auction closed'))!;
    expect(line.body.allowed_mentions).toEqual({ parse: [] });
    // The mocked render of a result, for the order's report.
    console.log(JSON.stringify({ result: cardOf(a.message_id).embeds[1], line: line.body.content }, null, 1));
  });

  it('the price: two bids pay the second + 1; a tie goes to the higher 30-day attendance, then the earlier bid; never more than the winner bid', () => {
    const t = (s: number) => new Date(Date.UTC(2026, 9, 29, 20, 0, s)).toISOString();
    const rich = () => 1000;
    const no = () => false;
    expect(decide([{ member_id: 'a', amount: 20, at: t(1) }, { member_id: 'b', amount: 12, at: t(0) }], rich, no, () => 0, 5)).toMatchObject({ winner: 'a', price: 13 });
    expect(decide([{ member_id: 'a', amount: 20, at: t(1) }], rich, no, () => 0, 5)).toMatchObject({ winner: 'a', price: 5 });
    // A tie: the price is the tied amount (second + 1 capped at the winner's bid); attendance decides, then time.
    expect(decide([{ member_id: 'a', amount: 20, at: t(0) }, { member_id: 'b', amount: 20, at: t(5) }], rich, no, (m) => (m === 'b' ? 3 : 1), 5)).toMatchObject({ winner: 'b', price: 20 });
    expect(decide([{ member_id: 'a', amount: 20, at: t(5) }, { member_id: 'b', amount: 20, at: t(0) }], rich, no, () => 2, 5)).toMatchObject({ winner: 'b', price: 20 });
    // A winner whose balance fell below their bid is dropped; the next bid wins, alone, at the minimum.
    const r = decide([{ member_id: 'a', amount: 20, at: t(0) }, { member_id: 'b', amount: 9, at: t(1) }], (m) => (m === 'a' ? 15 : 100), no, () => 0, 5);
    expect(r).toMatchObject({ winner: 'b', price: 5 });
    expect([...r.dropped]).toEqual([['a', 'balance']]);
    expect(decide([], rich, no, () => 0, 5)).toMatchObject({ winner: null, price: null });
  });

  it('at close every bid is checked against the balance again: a bid that can no longer be paid is dropped, and the result says so', async () => {
    const r = await nightWithKill();
    await give(kestrel, 30);
    await give(pip, 30);
    await auctionDrop(r);
    const a = await auction();
    await bid(kestrel, a.id, '35');
    await bid(pip, a.id, '12');
    // Kestrel's points fall below the bid before close.
    await dkp(officerB, 'adjust', { member: kestrel.user.id, pool: 'Glinting Hollow', points: -20, reason: 'oops' });
    await closeAt(a.id);
    expect(await auction()).toMatchObject({ status: 'sold', winner: pip.user.id, price: 5 });
    const text = cardOf(a.message_id).embeds[1].description;
    expect(text).toContain(`<@${kestrel.user.id}> (Kestrel): 35 (did not count: ${AUCTION_COPY.dropped.balance})`);
    expect(await one("SELECT dropped FROM dkp_bid WHERE member_id = ?", kestrel.user.id)).toEqual({ dropped: 'balance' });
  });

  it('a two-bid auction through the timer: second + 1; the timer finding it closed again pays nothing more', async () => {
    const r = await nightWithKill();
    await give(kestrel, 30);
    await give(pip, 30);
    await auctionDrop(r);
    const a = await auction();
    await bid(kestrel, a.id, '25');
    await bid(pip, a.id, '17');
    await closeAt(a.id);
    await closeAt(a.id, 5000);
    expect(await auction()).toMatchObject({ winner: kestrel.user.id, price: 18 });
    expect(await count('dkp_ledger', "kind = 'spend'")).toBe(1);
  });

  it('a bid counts only before closes_at by the server clock, even when the alarm runs late; raise, lower and withdraw while open', async () => {
    const r = await nightWithKill();
    await give(kestrel, 50);
    await auctionDrop(r);
    const a = await auction();
    expect((await bid(kestrel, a.id, '9.5')).data.content).toBe(AUCTION_COPY.wholeNumber(AUCTION_COPY.amountLabel));
    expect((await bid(kestrel, a.id, '4')).data.content).toBe(AUCTION_COPY.belowMinimum(5));
    expect((await bid(kestrel, a.id, '61')).data.content).toBe(AUCTION_COPY.overBalance(60));
    await bid(kestrel, a.id, '30');
    await bid(kestrel, a.id, '12');
    expect(await one('SELECT amount FROM dkp_bid WHERE member_id = ?', kestrel.user.id)).toEqual({ amount: 12 });
    expect((await bid(kestrel, a.id, '0')).data.content).toBe(AUCTION_COPY.withdrawn);
    // The row stays, marked withdrawn (it never counts); a second withdrawal finds nothing to withdraw.
    expect(await one('SELECT dropped FROM dkp_bid WHERE member_id = ?', kestrel.user.id)).toEqual({ dropped: 'withdrawn' });
    expect((await bid(kestrel, a.id, '0')).data.content).toBe(AUCTION_COPY.noBidToWithdraw);
    await bid(kestrel, a.id, '12');
    // Past closes_at, the alarm not yet run: the bid is refused, and the close sees the bid as it stood.
    await env.DB.prepare("UPDATE dkp_auction SET closes_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(a.id).run();
    expect((await bid(kestrel, a.id, '40')).data.content).toBe(AUCTION_COPY.closed);
    expect(await one('SELECT amount FROM dkp_bid WHERE member_id = ?', kestrel.user.id)).toEqual({ amount: 12 });
  });

  it('nobody sees a bid before close, officers included: the card, the officer\'s own Bid form and Cancel show no amounts', async () => {
    const r = await nightWithKill([kestrel, pip, officer]);
    await give(kestrel, 40);
    await auctionDrop(r);
    const a = await auction();
    await bid(kestrel, a.id, '33');
    await HANDLERS.acard(withToken, GUILD, String(a.id), 0, Date.now(), timerApi(withToken, Date.now(), () => 0));
    expect(shows(cardOf(a.message_id), 33)).toBe(false);
    expect(shows(cardOf(a.message_id), 20)).toBe(false);
    const officerForm = await pressAs(officer, `${BID_PREFIX}${a.id}`);
    expect(shows(officerForm, 33)).toBe(false);
    const cancelForm = await pressAs(officerB, `${CANCEL_PREFIX}${a.id}`);
    expect(shows(cancelForm, 33)).toBe(false);
    expect(fake.messages.some((m) => shows(m.body, 33))).toBe(false);
    // The check itself sees an amount when one is there (an implausible control is presumed broken).
    expect(shows({ description: 'Kestrel: 33' }, 33)).toBe(true);
  });

  it('cancel: an officer who has bid cannot; another officer cancels with a public reason that reveals the bids; no spend', async () => {
    const r = await nightWithKill([kestrel, officer]);
    await give(kestrel, 30);
    await give(officer, 30);
    await auctionDrop(r);
    const a = await auction();
    await bid(officer, a.id, '8');
    await bid(kestrel, a.id, '11');
    expect((await pressAs(officer, `${CANCEL_PREFIX}${a.id}`)).data.content).toBe(AUCTION_COPY.ownBid);
    expect((await pressAs(kestrel, `${CANCEL_PREFIX}${a.id}`)).data.content).toBe(DKP_COPY.notRunner);
    expect((await pressAs(officerB, `${CANCEL_PREFIX}${a.id}`)).type).toBe(9);
    expect((await send(submit(officerB, `${CANCEL_MODAL_PREFIX}${a.id}`, { reason: '   ' }), TOKEN)).data.content).toBe(DKP_COPY.adjustReason);
    // Even the form, submitted by an officer who bid after opening it, is refused.
    expect((await send(submit(officer, `${CANCEL_MODAL_PREFIX}${a.id}`, { reason: 'mine' }), TOKEN)).data.content).toBe(AUCTION_COPY.ownBid);
    expect((await send(submit(officerB, `${CANCEL_MODAL_PREFIX}${a.id}`, { reason: 'wrong drop' }), TOKEN)).data.content).toBe(AUCTION_COPY.cancelledReply);
    expect((await auction()).status).toBe('cancelled');
    const text = cardOf(a.message_id).embeds[1].description;
    expect(text).toContain('Reason: wrong drop');
    expect(text).toContain(`<@${kestrel.user.id}> (Kestrel): 11`);
    expect(text).toContain(`<@${officer.user.id}> (Officer): 8`);
    expect(fake.messages.some((m) => m.body.content?.startsWith('**Auction cancelled: Fungal Robe.**'))).toBe(true);
    expect(await count('dkp_ledger', "kind = 'spend'")).toBe(0);
    // Its timer finds it cancelled: nothing.
    expect(await closeAt(a.id)).toBe(null);
  });

  it('who may bid: Present or Standby at a kill of this raid; not frozen; the new-member wait; each refusal says why (one function)', async () => {
    await dkp(officer, 'raid', { zone: 'Glinting Hollow' });
    const r = await raid();
    await pressAs(kestrel, `${PRESENT_PREFIX}${r.id}`);
    await pressAs(pip, `${STANDBY_PREFIX}${r.id}`);
    await send(select(officer, `${NAMED_PREFIX}${r.id}`, ['A myconid prince']), TOKEN);
    await give(kestrel, 30);
    await give(pip, 30);
    await give(wren, 30);
    await auctionDrop(r);
    const a = await auction();
    const s = settingsOf({ new_member_kills: '0' });
    // Wren was at no kill of this raid.
    expect((await pressAs(wren, `${BID_PREFIX}${a.id}`)).data.content).toBe(AUCTION_COPY.refusal.not_at_raid);
    // Standby at a kill may bid.
    expect((await pressAs(pip, `${BID_PREFIX}${a.id}`)).type).toBe(9);
    // The new-member wait: 3 kills in the pool, ever (Kestrel has 1).
    await setting('new_member_kills', 3);
    expect((await pressAs(kestrel, `${BID_PREFIX}${a.id}`)).data.content).toBe(AUCTION_COPY.refusal.new_member(3));
    expect((await bid(kestrel, a.id, '10')).data.content).toBe(AUCTION_COPY.refusal.new_member(3));
    await setting('new_member_kills', 0);
    // Frozen.
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(kestrel.user.id).run();
    expect((await bid(kestrel, a.id, '10')).data.content).toBe(AUCTION_COPY.refusal.frozen);
    // The decider itself, rule by rule.
    const f = { member_id: 'x', status: 'active', at_kills: 1, raid_wins: 0, week_wins: 0, pool_kills: 3 };
    expect(bidRefusal({ kind: 'raid' }, f, s)).toBe(null);
    expect(bidRefusal({ kind: 'raid' }, { ...f, status: 'left' }, s)).toBe('frozen');
    expect(bidRefusal({ kind: 'raid' }, { ...f, at_kills: 0 }, s)).toBe('not_at_raid');
    expect(bidRefusal({ kind: 'raid' }, { ...f, raid_wins: 2 }, s)).toBe('raid_limit');
    expect(bidRefusal({ kind: 'raid' }, { ...f, week_wins: 4 }, s)).toBe('week_limit');
    expect(bidRefusal({ kind: 'raid' }, { ...f, pool_kills: 2 }, settingsOf({}))).toBe('new_member');
    // The general auction: no presence rule, no wait; the 7-day limit and frozen still apply.
    expect(bidRefusal({ kind: 'general' }, { ...f, at_kills: 0, pool_kills: 0 }, settingsOf({}))).toBe(null);
    expect(bidRefusal({ kind: 'general' }, { ...f, week_wins: 4 }, s)).toBe('week_limit');
  });

  it('win limits: 2 per raid, then refused in that raid; 4 in any 7 days across raids, general-auction wins included', async () => {
    const r = await nightWithKill([kestrel]);
    await give(kestrel, 200);
    for (let i = 0; i < 2; i++) {
      await auctionDrop(r);
      const a = await auction();
      await bid(kestrel, a.id, '5');
      await closeAt(a.id);
    }
    expect(await count('dkp_auction', "status = 'sold' AND winner = ?", kestrel.user.id)).toBe(2);
    await auctionDrop(r);
    const third = await auction();
    expect((await pressAs(kestrel, `${BID_PREFIX}${third.id}`)).data.content).toBe(AUCTION_COPY.refusal.raid_limit(2));
    // Two more wins elsewhere this week (a general auction counts toward the 7 days): the fifth is refused anywhere.
    const now = new Date().toISOString();
    await env.DB.batch(
      [1, 2].map(() =>
        env.DB.prepare("INSERT INTO dkp_auction (guild_id, kind, item_id, min_bid, seconds, status, created_by, created_at, closed_at, winner, price) VALUES (?, 'general', 7003, 1, 60, 'sold', 'x', ?, ?, ?, 1)").bind(GUILD, now, now, kestrel.user.id),
      ),
    );
    await dkp(officer, 'auction', { item: 'Lantern', general: true });
    const general = await auction();
    expect((await pressAs(kestrel, `${BID_PREFIX}${general.id}`)).data.content).toBe(AUCTION_COPY.refusal.week_limit(4));
    // A win 8 days ago no longer counts.
    await env.DB.prepare("UPDATE dkp_auction SET closed_at = '2000-01-01T00:00:00.000Z' WHERE kind = 'general' AND status = 'sold'").run();
    expect((await pressAs(kestrel, `${BID_PREFIX}${general.id}`)).type).toBe(9);
  });

  it('/dkp auction: any item; a raid auction needs an open raid (the reply points to the general auction); the general auction spends guild points', async () => {
    expect((await dkp(officer, 'auction', { item: 'Lantern' })).data.content).toBe(AUCTION_COPY.noRaid);
    expect((await dkp(officer, 'auction', { item: 'No Such Thing' })).data.content).toBe(AUCTION_COPY.noItem('No Such Thing'));
    expect((await dkp(kestrel, 'auction', { item: 'Lantern', general: true })).data.content).toBe(DKP_COPY.notRunner);
    await dkp(officer, 'auction', { item: 'Lantern', general: true, minimum: 2 });
    const a = await auction();
    // 24 hours by default; every active member may bid, here in the guild pool.
    expect(Date.parse(a.closes_at) - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
    await give(wren, 10, 'Guild pool');
    await bid(wren, a.id, '7');
    await closeAt(a.id);
    expect(await auction()).toMatchObject({ winner: wren.user.id, price: 2 });
    expect(await balance(wren, POOL_GUILD)).toBe(8);
  });

  it('no bids: the closed raid auction offers Post to general auction, once; an auction open when its raid closes runs to its timer', async () => {
    const r = await nightWithKill([kestrel]);
    await auctionDrop(r);
    const a = await auction();
    await pressAs(officer, `${CLOSE_PREFIX}${r.id}`);
    expect((await auction()).status).toBe('open');
    await closeAt(a.id);
    expect((await auction()).status).toBe('unsold');
    const card = cardOf(a.message_id);
    expect(card.embeds[1].description).toContain(AUCTION_COPY.unsold);
    expect(card.components[0].components[0].custom_id).toBe(`${POST_GENERAL_PREFIX}${a.id}`);
    expect((await pressAs(officer, `${POST_GENERAL_PREFIX}${a.id}`)).data.content).toMatch(/^Posted to the general auction\.|^Auction open/);
    const g = await one<{ kind: string; from_auction: number; min_bid: number }>('SELECT kind, from_auction, min_bid FROM dkp_auction ORDER BY id DESC LIMIT 1');
    expect(g).toEqual({ kind: 'general', from_auction: a.id, min_bid: 5 });
    expect((await pressAs(officer, `${POST_GENERAL_PREFIX}${a.id}`)).data.content).toBe(AUCTION_COPY.alreadyPosted);
  });

  it('Remove DKP cancels every open auction ("DKP removed", bids revealed) before the timers are cleared', async () => {
    const r = await nightWithKill([kestrel]);
    await give(kestrel, 30);
    await auctionDrop(r);
    const a = await auction();
    await bid(kestrel, a.id, '9');
    await pressAs(admin, REMOVE_DKP_PREFIX);
    expect(await auction()).toMatchObject({ status: 'cancelled' });
    expect(await one('SELECT reason, cancelled_by FROM dkp_auction WHERE id = ?', a.id)).toEqual({ reason: AUCTION_COPY.removedReason, cancelled_by: 'bot' });
    expect(cardOf(a.message_id).embeds[1].description).toContain(`<@${kestrel.user.id}> (Kestrel): 9`);
    expect(await timersOf(env, GUILD).list()).toEqual({});
    expect((await pressAs(kestrel, `${BID_PREFIX}${a.id}`)).data.content).toBe(DKP_COPY.off);
  });

  it('review of PR B: an officer who bid and withdrew still cannot cancel; nobody cancels after the close time; a withdrawn bid neither counts nor shows', async () => {
    const r = await nightWithKill([kestrel, officer]);
    await give(kestrel, 30);
    await give(officer, 30);
    await auctionDrop(r);
    const a = await auction();
    await bid(officer, a.id, '9');
    await bid(officer, a.id, '0');
    expect((await pressAs(officer, `${CANCEL_PREFIX}${a.id}`)).data.content).toBe(AUCTION_COPY.ownBid);
    await bid(kestrel, a.id, '6');
    await env.DB.prepare("UPDATE dkp_auction SET closes_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").bind(a.id).run();
    expect((await send(submit(officerB, `${CANCEL_MODAL_PREFIX}${a.id}`, { reason: 'late' }), TOKEN)).data.content).toBe(AUCTION_COPY.closed);
    await closeAt(a.id);
    expect(await auction()).toMatchObject({ status: 'sold', winner: kestrel.user.id, price: 5 });
    const text = cardOf(a.message_id).embeds[1].description;
    expect(text).not.toContain(`<@${officer.user.id}>`);
    expect(text).toContain(`<@${kestrel.user.id}> (Kestrel): 6`);
  });

  it('review of PR B: the close waits for a run with the calls it needs; the result is its own item and posts the line', async () => {
    const r = await nightWithKill([kestrel]);
    await give(kestrel, 30);
    await auctionDrop(r);
    const a = await auction();
    await bid(kestrel, a.id, '7');
    const due = Date.parse(a.closes_at);
    const spentApi = timerApi(withToken, Date.now(), () => 39);
    expect(await HANDLERS.auction(withToken, GUILD, String(a.id), due, due + 1, spentApi)).toEqual({ again: due + 1 });
    expect((await auction()).status).toBe('open');
    expect(await HANDLERS.result(withToken, GUILD, String(a.id), due, due + 1, spentApi)).toBe(null);
    await closeAt(a.id);
    expect(fake.messages.filter((m) => m.body.content?.startsWith('**Auction closed: Fungal Robe.**')).length).toBe(1);
    // A result item with too few calls left waits.
    expect(await HANDLERS.result(withToken, GUILD, String(a.id), due, due + 2, spentApi)).toEqual({ again: due + 2 });
  });

  it('routes each new custom_id prefix (order 23): Bid, Cancel auction and the drop select open a form at once; the rest defer', () => {
    for (const p of AUCTION_PREFIXES) {
      expect(p.startsWith(DKP_PREFIX), p).toBe(true);
      const modal = AUCTION_OPENS_MODAL.includes(p);
      expect(OPENS_MODAL.some((m) => p.startsWith(m)), p).toBe(modal);
      if (![DROP_MODAL_PREFIX, BID_MODAL_PREFIX, CANCEL_MODAL_PREFIX].includes(p)) expect(planFor(press(kestrel, `${p}1`) as never), p).toMatchObject({ defer: !modal });
    }
    expect(new Set(AUCTION_PREFIXES).size).toBe(AUCTION_PREFIXES.length);
    expect(storedName(DKP_CHANNEL_NAME)).toBeTruthy();
    void all;
  });
});

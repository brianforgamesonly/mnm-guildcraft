// Order 29 (ITEM 7): the shop (docs/PRD.md "Order 29: spending points"): fixed prices in guild points. An officer lists an
// item (/dkp shop add item: price: quantity: per_member:) and the bot posts a listing card in GC-DKP with Buy; first come,
// first served. A purchase is a dkp_purchase row and a spend ledger row by the bot, in one batch: the stock, the
// per-member limit, the poster's exclusion (dkpSelfConflict) and the balance are checked inside the purchase's insert,
// and the spend checks the balance again inside its own (ORDER-RULES Order 29). Each purchase is posted; an officer can
// close a listing early. Purchases count toward no win limit.
//
// Costs per press (D1 statements; Discord calls), besides the interaction's own reply:
//   /dkp shop add: guild, state, member row, item, insert, item card (about 4), save: about 10 D1; 1 Discord (the card).
//   Buy: guild, state, listing, one batch (purchase and spend), balance, item card (about 4), standings (2): about 11 D1;
//     3 Discord (the card, the purchase line, the guild pool's standings).
//   Close listing: guild, state, update, listing, item card (about 4): about 8 D1; 1 Discord.
import { audit, dkpSelfConflict, isDkpRunner, now } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import { itemCard } from '../commands/item.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, memberTag, optInt, optString, row, STYLE_DANGER, STYLE_SUCCESS, truncate, type Embed, type MessageReply } from '../discord.ts';
import type { DkpRun } from './commands.ts';
import { DKP_COPY, SHOP_COPY as S } from './copy.ts';
import { balanceSql, dkpRead, POOL_GUILD, purchaseSpendStatement } from './ledger.ts';
import { editIn, postIn, refreshStandings, type Message } from './messages.ts';
import type { DkpState } from './state.ts';

export const BUY_PREFIX = 'dkpbuy:';
export const SHOP_CLOSE_PREFIX = 'dkpshx:';
export const SHOP_PREFIXES = [BUY_PREFIX, SHOP_CLOSE_PREFIX];
const CALL_CAP = 8;

interface Listing {
  id: number;
  item_id: number;
  item_name: string;
  price: number;
  quantity: number;
  per_member: number;
  posted_by: string;
  poster: string;
  message_id: string | null;
  closed_at: string | null;
  closed_by: string | null;
  sold: number;
}
const LISTING_SQL = `SELECT s.id, s.item_id, i.name AS item_name, s.price, s.quantity, s.per_member, s.posted_by, coalesce(m.display_name, s.posted_by) AS poster, s.message_id, s.closed_at, s.closed_by,
  (SELECT count(*) FROM dkp_purchase p WHERE p.listing_id = s.id) AS sold
  FROM dkp_listing s JOIN item i ON i.id = s.item_id LEFT JOIN member m ON m.guild_id = s.guild_id AND m.discord_user_id = s.posted_by WHERE s.id = ?1 AND s.guild_id = ?2`;
const listingById = (db: D1Database, guildId: string, id: number) => db.prepare(LISTING_SQL).bind(id, guildId).first<Listing>();

const apiFor = (c: Ctx): BotApi | null => (c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap: CALL_CAP, deadline: Date.now() + 10_000 }) : null);
const spent = (c: Ctx, api: BotApi | null) => {
  if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
};
const by = (c: Ctx) => memberTag(c.userId, c.member.nick || c.member.user.global_name || c.member.user.username);
const link = (guildId: string, channel: string | null, message: string | null) => (channel && message ? `https://discord.com/channels/${guildId}/${channel}/${message}` : null);

/** The listing card: the item's stats (the /item card's first embed), the price, what is left, and Buy while open. */
export function listingMessage(l: Listing, item: Embed | null, closedByName: string | null): Message {
  const left = l.quantity - l.sold;
  const open = !l.closed_at && left > 0;
  const lines = [S.price(l.price), S.left(left, l.quantity, l.per_member), S.postedBy(memberTag(l.posted_by, l.poster))];
  if (l.closed_at) lines.push('', S.closedEarly(memberTag(l.closed_by ?? '', closedByName ?? l.closed_by ?? '')));
  else if (!left) lines.push('', S.soldOut);
  return {
    embeds: [...(item ? [item] : []), { title: truncate(S.title(l.item_name), 256), description: lines.join('\n') }],
    components: open ? [row([button(`${BUY_PREFIX}${l.id}`, S.buy, STYLE_SUCCESS), button(`${SHOP_CLOSE_PREFIX}${l.id}`, S.close, STYLE_DANGER)])] : [],
  };
}

async function cardFor(c: Ctx, l: Listing): Promise<Message> {
  const [card, closer] = await Promise.all([
    itemCard({ db: c.db, guild: c.guild }, l.item_id),
    l.closed_by ? c.db.prepare('SELECT display_name FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, l.closed_by).first<{ display_name: string }>() : Promise.resolve(null),
  ]);
  return listingMessage(l, card?.embeds[0] ?? null, closer?.display_name ?? null);
}

/** /dkp shop add item: price: quantity: per_member: (officers). */
export const shopAdd: DkpRun = async (c, opts, d) => {
  const typed = (optString(opts, 'item') ?? '').trim();
  const item = await c.db.prepare('SELECT id, name FROM item WHERE name_key = lower(?)').bind(typed).first<{ id: number; name: string }>();
  if (!item) return ephemeral(S.noItem(truncate(typed, 100)));
  const price = optInt(opts, 'price') ?? 1;
  const quantity = optInt(opts, 'quantity') ?? 1;
  const perMember = optInt(opts, 'per_member') ?? 1;
  const api = apiFor(c);
  if (!api || !d.channel_id) return ephemeral(S.cannotPost);
  try {
    const at = now();
    const [ins] = await c.db.batch<{ id: number }>([
      c.db
        .prepare('INSERT INTO dkp_listing (guild_id, item_id, price, quantity, per_member, posted_by, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(c.guild.id, item.id, Math.max(1, price), Math.max(1, quantity), Math.max(1, perMember), c.userId, at),
      audit(c.db, c.guild.id, c.userId, 'dkp.shop.add', `item:${item.id}`, null, { price, quantity, per_member: perMember }),
    ]);
    const id = ins.results[0].id;
    const l = (await listingById(c.db, c.guild.id, id))!;
    const posted = await postIn(api, d.channel_id, await cardFor(c, l));
    if (!posted) {
      await c.db.prepare('UPDATE dkp_listing SET closed_at = ?, closed_by = ? WHERE id = ?').bind(at, 'bot', id).run();
      return ephemeral(S.cannotPost);
    }
    await c.db.prepare('UPDATE dkp_listing SET message_id = ? WHERE id = ?').bind(posted, id).run();
    return ephemeral(S.posted(link(c.guild.id, d.channel_id, posted)));
  } finally {
    spent(c, api);
  }
};

/** Buy: members (not the poster); stock, per-member limit and balance checked inside the purchase's own insert. */
async function buy(c: Ctx, d: DkpState, id: number): Promise<MessageReply> {
  const l = await listingById(c.db, c.guild.id, id);
  if (!l || l.closed_at) return ephemeral(S.closed);
  if (dkpSelfConflict(c.userId, { postedBy: l.posted_by })) return ephemeral(S.own);
  const at = now();
  const [purchase] = await c.db.batch<{ id: number }>([
    c.db
      .prepare(
        `INSERT INTO dkp_purchase (listing_id, member_id, at) SELECT ?3, ?4, ?5
         WHERE EXISTS (SELECT 1 FROM dkp_listing s WHERE s.id = ?3 AND s.guild_id = ?1 AND s.closed_at IS NULL AND s.posted_by <> ?4
                         AND (SELECT count(*) FROM dkp_purchase p WHERE p.listing_id = s.id) < s.quantity
                         AND (SELECT count(*) FROM dkp_purchase p WHERE p.listing_id = s.id AND p.member_id = ?4) < s.per_member
                         AND ${balanceSql('?4')} >= s.price)
         RETURNING id`,
      )
      .bind(c.guild.id, POOL_GUILD, id, c.userId, at),
    purchaseSpendStatement(c.db, { guildId: c.guild.id, member: c.userId, price: l.price, listingId: id, reason: S.spendReason(l.item_name), at }),
  ]);
  if (!purchase.results.length) {
    // Why not, from what holds now: the stock, the member's limit, or the balance.
    const held = (await listingById(c.db, c.guild.id, id))!;
    if (held.closed_at) return ephemeral(S.closed);
    if (held.sold >= held.quantity) return ephemeral(S.gone);
    const mine = await c.db.prepare('SELECT count(*) AS n FROM dkp_purchase WHERE listing_id = ? AND member_id = ?').bind(id, c.userId).first<{ n: number }>();
    if ((mine?.n ?? 0) >= held.per_member) return ephemeral(S.limit(mine!.n));
    const { standings } = await dkpRead(c.db, c.guild.id, { pools: [POOL_GUILD], member: c.userId });
    return ephemeral(S.poor(l.price, standings.get(POOL_GUILD)?.[0]?.balance ?? 0));
  }
  const { standings } = await dkpRead(c.db, c.guild.id, { pools: [POOL_GUILD], member: c.userId });
  const api = apiFor(c);
  try {
    if (api && d.channel_id) {
      const fresh = (await listingById(c.db, c.guild.id, id))!;
      if (fresh.message_id) await editIn(api, d.channel_id, fresh.message_id, await cardFor(c, fresh));
      await postIn(api, d.channel_id, { content: S.purchaseLine(by(c), l.item_name, l.price) });
      await refreshStandings(c.db, api, c.guild.id, d.channel_id, [POOL_GUILD]);
    }
  } finally {
    spent(c, api);
  }
  return ephemeral(S.bought(l.item_name, l.price, standings.get(POOL_GUILD)?.[0]?.balance ?? 0));
}

/** Close listing: officers, early. */
async function closeListing(c: Ctx, d: DkpState, id: number): Promise<MessageReply> {
  if (!isDkpRunner(c.guild, d.settings.runner_role, c.member)) return ephemeral(DKP_COPY.notRunner);
  const res = await c.db.prepare('UPDATE dkp_listing SET closed_at = ?1, closed_by = ?2 WHERE id = ?3 AND guild_id = ?4 AND closed_at IS NULL').bind(now(), c.userId, id, c.guild.id).run();
  if (!res.meta.changes) return ephemeral(S.closed);
  const l = (await listingById(c.db, c.guild.id, id))!;
  const api = apiFor(c);
  try {
    if (api && d.channel_id && l.message_id) await editIn(api, d.channel_id, l.message_id, await cardFor(c, l));
  } finally {
    spent(c, api);
  }
  return ephemeral(S.closedReply);
}

/** The shop's controls (deferred; each answers the presser privately; the card is edited in place). */
export async function shopComponent(c: Ctx, id: string, d: DkpState): Promise<MessageReply | null> {
  if (id.startsWith(BUY_PREFIX)) return buy(c, d, Number(id.slice(BUY_PREFIX.length)));
  if (id.startsWith(SHOP_CLOSE_PREFIX)) return closeListing(c, d, Number(id.slice(SHOP_CLOSE_PREFIX.length)));
  return null;
}

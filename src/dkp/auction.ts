// Order 29 (ITEM 4): raid auctions, and the general auction they can go to (docs/PRD.md "Order 29: spending points").
// The bot decides every auction: bids stay hidden from everyone until close, closing is by timer only (auction:<id> on the
// guild's timer object, src/dkp/timers.ts), and the price is computed. Who may bid is src/dkp/eligible.ts, called by every
// route here. Every spend is a ledger row by the bot that checks the balance inside its own insert (auctionSpendStatement).
// The card in GC-DKP is the bot's own message, edited in place whatever the cause (order 27's override 2, order 29's
// override 5); every presser's answer is a new private message; nobody is pinged (memberTag, NO_PINGS).
//
// Discord (read 2026-10-29, docs.discord.com/developers/components/reference): a Text Input has only the styles Short (1)
// and Paragraph (2), "min 0, max 4000"; there is no number input, so the server validates the amount. "Going forward all
// Text Inputs should be placed inside a Label component." A String Select holds at most 25 options. A modal can't follow
// a deferral (src/interactions.ts OPENS_MODAL), so Bid, Cancel auction and the drop select answer at once.
//
// Costs per press (D1 statements; Discord calls), besides the interaction's own reply:
//   Auction a drop: guild, state, raid, latest kill, loot: 5 D1; 0. The drop select: 3 D1 (guild, state, kill); 0 (a modal).
//   The drop form (submitted) and /dkp auction: guild, state, raid, item, insert, open (update, item card 4, post, save):
//     about 12 D1; 1 Discord (the card).
//   Bid (press): guild, state, auction, eligibility, balance, own bid: 6 D1; 0 (a modal).
//   Bid (submitted): guild, state, auction, eligibility, balance, upsert: 6 D1; 0 (the card's bidder count: 1 timer item).
//   /dkp cancel: 14 D1, 2 Discord (the card, the notice), as the test's timing line counts it; 25 D1, 3 Discord when a
//     queued drop opens. A raid auction's timer items add next: (3 D1) and render: (a card read; 1 Discord). An old card's
//     Cancel auction (press): guild, state, auction, bidders: 4 D1; 0. Its form: about 13 D1; 2 Discord.
//     The auction: autocomplete: 1 D1 per keystroke; 0.
//   Post to general auction: guild, state, auction, insert, open: about 11 D1; 1 Discord.
//   The close (auction:, timer): guild, state, auction, bids with their fingerprint (1 batch), balances, eligibility (tie: 1
//     per tied bidder), the closing batch, the auction again: about 8 D1; 0 Discord; it starts only with CLOSE_NEEDS calls
//     left. The result (result:, its own item): guild, state, auction, card (about 7), standings (3), name: about 13 D1;
//     3 Discord (card, standings, line), only with RESULT_NEEDS left. The card edit (acard:): about 9 D1; 1 Discord.
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import { audit, dkpSelfConflict, isDkpRunner, loadGuild, now, type Guild } from '../access.ts';
import { botApi, budgetLeft, type BotApi } from '../board/api.ts';
import { itemCard } from '../commands/item.ts';
import { modalValues } from '../commands/reports.ts';
import type { Ctx } from '../context.ts';
import {
  button, EMBED_LIMITS, embedChars, ephemeral, memberTag, NO_PINGS, optBool, optInt, optString, row, STYLE_PRIMARY, STYLE_SECONDARY, truncate, type Embed, type InteractionReply, type MessageReply,
  type ModalComponent,
} from '../discord.ts';
import { MOB_ZONES_SOURCE, zoneNamesSql } from '../zone/names.ts';
import type { DkpRun } from './commands.ts';
import { AUCTION_COPY as A, QUEUE_COPY as Q, RAID_COPY } from './copy.ts';
import { WISHERS_SQL } from './wishlist.ts';
import { eligibility, refusalOf, type Refusal } from './eligible.ts';
import { auctionSpendStatement, balanceSql, dkpRead, POOL_GUILD } from './ledger.ts';
import { editCard, editCardItem, poolNames, postIn, refreshStandings, type Message } from './messages.ts';
import { markStale } from './stale.ts';
import type { Settings } from './settings.ts';
import type { DkpState } from './state.ts';

export const AUCTION_DROP_PREFIX = 'dkpad:';
export const DROP_SELECT_PREFIX = 'dkpas:';
export const DROP_MODAL_PREFIX = 'dkpam:';
export const BID_PREFIX = 'dkpb:';
export const BID_MODAL_PREFIX = 'dkpbm:';
export const CANCEL_PREFIX = 'dkpac:';
export const CANCEL_MODAL_PREFIX = 'dkpacm:';
export const POST_GENERAL_PREFIX = 'dkpag:';
/** Order 29, PR C: a general auction that closed unsold: Record what was done (a form). */
export const RECORD_PREFIX = 'dkpgd:';
export const RECORD_MODAL_PREFIX = 'dkpgdm:';
/** The controls that answer with a modal, at once (src/interactions.ts OPENS_MODAL). */
export const AUCTION_OPENS_MODAL = [DROP_SELECT_PREFIX, BID_PREFIX, CANCEL_PREFIX, RECORD_PREFIX];
/** Every auction custom_id prefix (routing; order 23: each has its own routing test). */
export const AUCTION_PREFIXES = [AUCTION_DROP_PREFIX, DROP_SELECT_PREFIX, DROP_MODAL_PREFIX, BID_PREFIX, BID_MODAL_PREFIX, CANCEL_PREFIX, CANCEL_MODAL_PREFIX, POST_GENERAL_PREFIX, RECORD_PREFIX, RECORD_MODAL_PREFIX];

/** Discord's String Select limit, and the most minutes an auction may run (7 days). */
const SELECT_MAX = 25;
/** The item queue: at most this many drops picked at once (their ids fit the form's 100-character custom_id). */
export const QUEUE_MAX = 10;
export const MAX_MINUTES = 7 * 24 * 60;
const CALL_CAP = 8;
const BIDS_SHOWN = 40;

export interface Auction {
  id: number;
  guild_id: string;
  kind: 'raid' | 'general';
  raid_id: number | null;
  kill_id: number | null;
  from_auction: number | null;
  item_id: number;
  min_bid: number;
  seconds: number;
  status: 'queued' | 'open' | 'sold' | 'unsold' | 'cancelled';
  created_by: string;
  opened_at: string | null;
  closes_at: string | null;
  message_id: string | null;
  closed_at: string | null;
  winner: string | null;
  price: number | null;
  reason: string | null;
  cancelled_by: string | null;
  /** Order 29, PR C: what was done with an unsold general auction's item (free text, public), and who recorded it. */
  disposal: string | null;
  disposal_by: string | null;
  /** The pool it spends: the raid's zone, or the guild pool (derived, never stored). */
  pool: string;
  item_name: string;
}
const AUCTION_SQL = `SELECT a.id, a.guild_id, a.kind, a.raid_id, a.kill_id, a.from_auction, a.item_id, a.min_bid, a.seconds, a.status, a.created_by, a.opened_at, a.closes_at,
  a.message_id, a.closed_at, a.winner, a.price, a.reason, a.cancelled_by, a.disposal, a.disposal_by, coalesce(r.pool, '${POOL_GUILD}') AS pool, i.name AS item_name
  FROM dkp_auction a LEFT JOIN dkp_raid r ON r.id = a.raid_id JOIN item i ON i.id = a.item_id WHERE a.id = ?1 AND a.guild_id = ?2`;
export const auctionById = (db: D1Database, guildId: string, id: number) => db.prepare(AUCTION_SQL).bind(id, guildId).first<Auction>();

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
/**
 * A bid's write counts only while the auction is open and before closes_at by the receipt time (?4 / ?3, the Worker's clock)
 * and by D1's own clock at the write (review of PR B: a bid read, checked and written slowly must not land after the close
 * read the bids). The close also compares the bids it read with the bids at its write (BIDS_FINGERPRINT).
 */
const STILL_OPEN = `status = 'open' AND closes_at > ?4 AND closes_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
/** The bids as one text: changed by any bid, raise, lower or withdrawal (the close's check that nothing moved). */
const BIDS_FINGERPRINT = (id: string) => `(SELECT count(*) || ':' || coalesce(sum(amount), 0) || ':' || coalesce(max(at), '') || ':' || coalesce(sum(dropped IS NOT NULL), 0) FROM dkp_bid WHERE auction_id = ${id})`;
const link = (guildId: string, channel: string | null, message: string | null) => (channel && message ? `https://discord.com/channels/${guildId}/${channel}/${message}` : null);
const apiFor = (c: Ctx): BotApi | null => (c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap: CALL_CAP, deadline: Date.now() + 10_000 }) : null);
const spent = (c: Ctx, api: BotApi | null) => {
  if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
};
const by = (c: Ctx) => memberTag(c.userId, c.member.nick || c.member.user.global_name || c.member.user.username);
const runner = (c: Ctx, d: DkpState) => isDkpRunner(c.guild, d.settings.runner_role, c.member);
const schedule = (c: Ctx, items: { key: string; due: number }[]) => {
  c.effects.dkpTimers = { guildId: c.guild.id, items: [...(c.effects.dkpTimers?.items ?? []), ...items] };
};
/** The card's bidder count after a bid: a coalesced, paced edit on the timer object (acard:<id>). */
const recount = (c: Ctx, id: number) => schedule(c, [{ key: `acard:${id}`, due: Date.now() }]);

/** The refusal's words (settings fill in the limits). */
export function refusalText(r: Refusal, s: Settings): string {
  switch (r) {
    case 'raid_limit':
      return A.refusal.raid_limit(s.wins_per_raid);
    case 'week_limit':
      return A.refusal.week_limit(s.wins_per_week);
    case 'new_member':
      return A.refusal.new_member(s.new_member_kills);
    default:
      return A.refusal[r];
  }
}

/** One member's balance in a pool, from the one reader (dkpRead). */
async function balanceOf(db: D1Database, guildId: string, pool: string, member: string): Promise<number> {
  const { standings } = await dkpRead(db, guildId, { pools: [pool], member });
  return standings.get(pool)?.[0]?.balance ?? 0;
}

// ---------------------------------------------------------------- the card

interface BidRow {
  member_id: string;
  name: string;
  amount: number;
  at: string;
  dropped: string | null;
}
/** dkp_bid.dropped for a withdrawn bid (it never counts, and is never revealed as a bid). */
export const WITHDRAWN = 'withdrawn';
const BIDS_SQL = `SELECT b.member_id, coalesce(m.display_name, b.member_id) AS name, b.amount, b.at, b.dropped FROM dkp_bid b
  LEFT JOIN member m ON m.guild_id = ?2 AND m.discord_user_id = b.member_id WHERE b.auction_id = ?1 ORDER BY b.amount DESC, b.at`;

/** The card: the item's stats (the /item card's first embed) and the auction; once closed, the result with every bid. */
export function auctionMessage(
  a: Auction,
  d: { item: Embed | null; poolName: string; bids: BidRow[]; winnerName: string | null; cancelledByName: string | null; wanted?: number; disposalByName?: string | null },
): Message {
  const lines: string[] = [a.kind === 'raid' ? A.raidLine(d.poolName) : A.generalLine, A.minimum(a.min_bid)];
  const open = a.status === 'open';
  // A withdrawn bid is not a bid (its row stays: review of PR B).
  const bids = d.bids.filter((b) => b.dropped !== WITHDRAWN);
  const head: string[] = [];
  const shown: string[] = [];
  const tail: string[] = [];
  if (open && a.closes_at) lines.push(A.closes(unix(a.closes_at)), '', A.bidders(bids.length), ...(d.wanted ? [Q.wanted(d.wanted)] : []));
  else {
    lines.push('');
    if (a.status === 'sold') lines.push(A.sold(memberTag(a.winner!, d.winnerName ?? a.winner!), a.price!));
    else if (a.status === 'unsold') lines.push(A.unsold);
    else if (a.status === 'cancelled') lines.push(A.cancelledBy(a.cancelled_by === 'bot' || !a.cancelled_by ? 'GuildCraft' : memberTag(a.cancelled_by, d.cancelledByName ?? a.cancelled_by), a.reason ?? ''));
    // Revealed after close (order 29's override 4: guild-public DKP data), members shown, nobody pinged.
    head.push('', A.bidsHead);
    shown.push(...(bids.length ? bids.slice(0, BIDS_SHOWN).map((b) => A.bidLine(memberTag(b.member_id, b.name), b.amount, b.dropped ? (A.dropped[b.dropped] ?? b.dropped) : null)) : [A.noBids]));
    if (a.disposal) tail.push('', Q.disposal(a.disposal, memberTag(a.disposal_by ?? '', d.disposalByName ?? a.disposal_by ?? '')));
  }
  // Whole bid lines only, inside Discord's 6,000 characters across the message's embeds (the item card's included).
  const build = (list: string[]): Embed => {
    const more = bids.length - list.length;
    return { title: truncate(A.title(a.item_name), 256), description: truncate([...lines, ...head, ...list, ...(more > 0 && list.length ? [RAID_COPY.counted(more)] : []), ...tail].join('\n'), 4096) };
  };
  let n = shown.length;
  let embed = build(shown);
  while (n > 1 && embedChars([...(d.item ? [d.item] : []), embed]) > EMBED_LIMITS.total - 200) embed = build(shown.slice(0, --n));
  const components: unknown[] = open
    ? [row([button(`${BID_PREFIX}${a.id}`, A.bid, STYLE_PRIMARY)])]
    : a.status === 'unsold' && a.kind === 'raid'
      ? [row([button(`${POST_GENERAL_PREFIX}${a.id}`, A.postGeneral, STYLE_SECONDARY)])]
      : a.status === 'unsold' && a.kind === 'general' && !a.disposal
        ? [row([button(`${RECORD_PREFIX}${a.id}`, Q.record, STYLE_SECONDARY)])]
        : [];
  return { embeds: [...(d.item ? [d.item] : []), embed], components };
}

/** Members who wish for the auction's item and may bid in it (the one decider): "wanted by N eligible", and the nudges. */
async function eligibleWishers(db: D1Database, guildId: string, a: Auction, nowMs: number, s: Settings): Promise<string[]> {
  const wishers = (await db.prepare(WISHERS_SQL).bind(guildId, a.item_id).all<{ member_id: string }>()).results.map((r) => r.member_id);
  const verdicts = await eligibility(db, guildId, a, wishers, nowMs, s);
  return wishers.filter((m) => refusalOf(verdicts, m) === null);
}

async function cardFor(db: D1Database, guild: Guild, a: Auction, s?: Settings): Promise<Message> {
  const [card, names, { results: bids }, people, wanted] = await Promise.all([
    itemCard({ db, guild }, a.item_id),
    poolNames(db, [a.pool]),
    db.prepare(BIDS_SQL).bind(a.id, guild.id).all<BidRow>(),
    db
      .prepare('SELECT discord_user_id AS id, display_name AS name FROM member WHERE guild_id = ?1 AND discord_user_id IN (?2, ?3, ?4)')
      .bind(guild.id, a.winner ?? '', a.cancelled_by ?? '', a.disposal_by ?? '')
      .all<{ id: string; name: string }>(),
    a.status === 'open' && s ? eligibleWishers(db, guild.id, a, Date.now(), s) : Promise.resolve([]),
  ]);
  const name = (id: string | null) => people.results.find((p) => p.id === id)?.name ?? null;
  return auctionMessage(a, {
    item: card?.embeds[0] ?? null, poolName: names.get(a.pool)!, bids, winnerName: name(a.winner), cancelledByName: name(a.cancelled_by), wanted: wanted.length, disposalByName: name(a.disposal_by),
  });
}

/** acard:<id> on the timer object: the card, edited in place. Returns Discord's rate-limit headers, for the pace. */
export async function renderAuction(db: D1Database, api: BotApi, guildId: string, channelId: string, id: number, s?: Settings) {
  const [a, guild] = await Promise.all([auctionById(db, guildId, id), loadGuild(db, guildId)]);
  if (!a?.message_id || !guild) return null;
  return editCardItem(db, api, guildId, `acard:${id}`, channelId, a.message_id, await cardFor(db, guild, a, s));
}

// ---------------------------------------------------------------- opening

/**
 * Opens a queued auction: its close time from now, its card in GC-DKP, its timer, and (order 29, PR C) its wishlist nudges.
 * The card refused: it's cancelled. Only one raid auction of a raid is open at a time (the item queue).
 */
export async function openAuction(db: D1Database, api: BotApi | null, guild: Guild, channelId: string | null, id: number, nowMs: number, s?: Settings): Promise<{ key: string; due: number }[]> {
  const at = new Date(nowMs).toISOString();
  const opened = await db
    .prepare(
      `UPDATE dkp_auction SET status = 'open', opened_at = ?1, closes_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?1, '+' || seconds || ' seconds')
       WHERE id = ?2 AND guild_id = ?3 AND status = 'queued'
         AND (raid_id IS NULL OR NOT EXISTS (SELECT 1 FROM dkp_auction o WHERE o.raid_id = dkp_auction.raid_id AND o.status = 'open')) RETURNING id`,
    )
    .bind(at, id, guild.id)
    .first<{ id: number }>();
  if (!opened) return [];
  // Review of PR C: anything short of Discord refusing the card puts it back in the queue (an open auction with no card
  // and no timer would hold the raid's queue for good); only a refusal (a 4xx with its code) cancels it.
  const requeue = () => db.prepare("UPDATE dkp_auction SET status = 'queued', opened_at = NULL, closes_at = NULL WHERE id = ? AND status = 'open' AND message_id IS NULL").bind(id).run();
  let r: Awaited<ReturnType<BotApi['call']>> | null = null;
  try {
    const a = (await auctionById(db, guild.id, id))!;
    if (api && channelId) r = await api.call<{ id: string }>('POST', `/channels/${channelId}/messages`, { ...(await cardFor(db, guild, a, s)), allowed_mentions: NO_PINGS });
    if (r?.ok) {
      await db.prepare('UPDATE dkp_auction SET message_id = ? WHERE id = ?').bind((r.body as { id: string }).id, id).run();
      return [
        { key: `auction:${id}`, due: Date.parse(a.closes_at!) },
        { key: `nudge:${id}`, due: nowMs },
      ];
    }
  } catch (e) {
    await requeue();
    throw e;
  }
  if (!r || transient(r)) {
    await requeue();
    return a_retry(guild.id, id, nowMs);
  }
  await db.prepare("UPDATE dkp_auction SET status = 'cancelled', reason = ?1, cancelled_by = 'bot', closed_at = ?2 WHERE id = ?3 AND status = 'open'").bind(A.cannotPost, at, id).run();
  return [];
}

/** A Discord answer worth trying again: skipped (budget, deadline, rate), no answer, 429, or a server error. */
export const transient = (r: { ok: boolean; status: number; skipped?: string }) => !r.ok && (!!r.skipped || r.status === 0 || r.status === 429 || r.status >= 500);
/** Calls opening an auction needs (its card's reads and the post): below this, the opening waits for a fresh run. */
export const OPEN_NEEDS = 12;
const RETRY_MS = 30_000;
/** An opening that could not post: the raid's queue (or a general auction's own retry) tries again shortly. */
const a_retry = (_guildId: string, id: number, nowMs: number) => [{ key: `reopen:${id}`, due: nowMs + RETRY_MS }];

/**
 * The item queue (order 29, PR C): when a raid's auction closes (sold, unsold or cancelled), its next queued drop opens.
 * Returns the timer items to set. A card Discord refuses is cancelled, and the one after it is tried (at most 3).
 */
export async function openNext(
  db: D1Database,
  api: BotApi | null,
  guild: Guild,
  channelId: string | null,
  raidId: number | null,
  nowMs: number,
  s?: Settings,
  /** Calls an opening needs: OPEN_NEEDS on the timer object (its budget counts D1); 1 in an interaction (Discord only). */
  needs = OPEN_NEEDS,
): Promise<{ key: string; due: number }[]> {
  if (raidId === null) return [];
  for (let tries = 0; tries < 3; tries++) {
    // Review of PR C: only with the calls an opening needs; otherwise the next run (next:<raid>) opens it.
    if (api && budgetLeft(api.budget) < needs) return [{ key: `next:${raidId}`, due: nowMs }];
    const next = await db.prepare("SELECT id FROM dkp_auction WHERE raid_id = ? AND guild_id = ? AND status = 'queued' ORDER BY id LIMIT 1").bind(raidId, guild.id).first<{ id: number }>();
    if (!next) return [];
    const items = await openAuction(db, api, guild, channelId, next.id, nowMs, s);
    // A transient failure: the queue tries again shortly (next:<raid>), never cancels.
    if (items.some((i) => i.key.startsWith('reopen:'))) return [{ key: `next:${raidId}`, due: nowMs + RETRY_MS }];
    if (items.length) return items;
    // Not opened: another is open (it waits), or Discord refused its card (cancelled: try the next).
    if ((await auctionById(db, guild.id, next.id))?.status !== 'cancelled') return [];
  }
  return [];
}

/** reopen:<id>: a general auction whose card could not post yet tries again (raid auctions retry through next:). */
export async function reopen(db: D1Database, api: BotApi | null, guild: Guild, channelId: string | null, id: number, nowMs: number, s?: Settings) {
  const a = await auctionById(db, guild.id, id);
  if (!a || a.status !== 'queued') return [];
  if (a.raid_id !== null) return openNext(db, api, guild, channelId, a.raid_id, nowMs, s);
  if (api && budgetLeft(api.budget) < OPEN_NEEDS) return [{ key: `reopen:${id}`, due: nowMs }];
  return openAuction(db, api, guild, channelId, id, nowMs, s);
}

/**
 * Creates auctions: a general one opens now; raid ones join the raid's queue, the first opening now when none of that
 * raid's is open or queued (order 29, PR C: "each auction opens as the one before it closes").
 */
async function createAuctions(
  c: Ctx,
  d: DkpState,
  p: { kind: 'raid' | 'general'; raidId: number | null; killId: number | null; fromAuction?: number | null; itemIds: number[]; min: number; seconds: number },
): Promise<MessageReply> {
  const api = apiFor(c);
  if (!api || !d.channel_id) return ephemeral(A.cannotPost);
  try {
    const at = now();
    // An unsold auction goes to the general auction once (review of PR B: the check is inside the insert).
    const ins = c.db.prepare(
      `INSERT INTO dkp_auction (guild_id, kind, raid_id, kill_id, from_auction, item_id, min_bid, seconds, status, created_by, created_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'queued', ?9, ?10 WHERE ?5 IS NULL OR NOT EXISTS (SELECT 1 FROM dkp_auction WHERE from_auction = ?5) RETURNING id`,
    );
    const rows = await c.db.batch<{ id: number }>(p.itemIds.map((itemId) => ins.bind(c.guild.id, p.kind, p.raidId, p.killId, p.fromAuction ?? null, itemId, p.min, p.seconds, c.userId, at)));
    const ids = rows.flatMap((r) => r.results.map((x) => x.id));
    if (!ids.length) return ephemeral(A.alreadyPosted);
    // The audit row only for what was created (review of PR C).
    await audit(c.db, c.guild.id, c.userId, 'dkp.auction.create', `raid:${p.raidId ?? 'general'}`, null, { kind: p.kind, auctions: ids, items: p.itemIds, min: p.min, seconds: p.seconds }).run();
    const items = p.kind === 'raid' ? await openNext(c.db, api, c.guild, d.channel_id, p.raidId, Date.now(), d.settings, 1) : await openAuction(c.db, api, c.guild, d.channel_id, ids[0], Date.now(), d.settings);
    schedule(c, items);
    // The reply names what opened (any of these: a refused first card lets the next open), else what waits.
    const { results: now_ } = await c.db.prepare('SELECT id, status FROM dkp_auction WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ id: number; status: string }>();
    const opened = now_.find((x) => x.status === 'open');
    const waiting = now_.filter((x) => x.status === 'queued').length;
    if (opened) {
      const a = (await auctionById(c.db, c.guild.id, opened.id))!;
      return ephemeral([A.opened(a.item_name, link(c.guild.id, d.channel_id, a.message_id)), ...(waiting ? [Q.queuedMany(waiting)] : [])].join('\n'));
    }
    if (!waiting) return ephemeral(A.cannotPost);
    const first = (await auctionById(c.db, c.guild.id, ids[0]))!;
    const ahead = await c.db.prepare("SELECT count(*) AS n FROM dkp_auction WHERE raid_id = ? AND status IN ('open', 'queued') AND id < ?").bind(p.raidId, ids[0]).first<{ n: number }>();
    return ephemeral(waiting > 1 ? Q.queuedMany(waiting) : Q.queued(first.item_name, Math.max(1, ahead?.n ?? 1)));
  } finally {
    spent(c, api);
  }
}

const openRaidOf = (db: D1Database, guildId: string) => db.prepare('SELECT id, pool FROM dkp_raid WHERE guild_id = ? AND closed_at IS NULL').bind(guildId).first<{ id: number; pool: string }>();

/** /dkp auction item: minimum: minutes: general: (officers). A raid auction needs an open raid. */
export const auctionCommand: DkpRun = async (c, opts, d) => {
  const typed = (optString(opts, 'item') ?? '').trim();
  const item = await c.db.prepare('SELECT id, name FROM item WHERE name_key = lower(?)').bind(typed).first<{ id: number; name: string }>();
  if (!item) return ephemeral(A.noItem(truncate(typed, 100)));
  const general = optBool(opts, 'general') === true;
  const minutes = optInt(opts, 'minutes');
  if (minutes !== undefined && (minutes < 1 || minutes > MAX_MINUTES)) return ephemeral(A.minutesRange(MAX_MINUTES));
  const min = optInt(opts, 'minimum') ?? 1;
  if (min < 1) return ephemeral(A.minimumRange);
  const seconds = minutes !== undefined ? minutes * 60 : general ? d.settings.general_auction_hours * 3600 : d.settings.raid_auction_seconds;
  if (general) return createAuctions(c, d, { kind: 'general', raidId: null, killId: null, itemIds: [item.id], min, seconds });
  const raid = await openRaidOf(c.db, c.guild.id);
  if (!raid) return ephemeral(A.noRaid);
  return createAuctions(c, d, { kind: 'raid', raidId: raid.id, killId: null, itemIds: [item.id], min, seconds });
};

// ---------------------------------------------------------------- Auction a drop

/** The latest kill's known loot: its named's loot names in the raid's zone (NPCs and mobs) matched to items, A→Z, 25. */
export const LOOT_SQL = `WITH loot AS (
  SELECT j.value AS name FROM npc n, json_each(n.loot_json) j WHERE n.zone_key = ?1 AND lower(n.name) = lower(?2) AND n.active = 1
  UNION
  SELECT j.value FROM mob m, json_each(m.loot_json) j WHERE lower(m.title) = lower(?2) AND m.active = 1
    AND EXISTS (SELECT 1 FROM json_each(m.zones_json) z WHERE z.value IN ${zoneNamesSql(MOB_ZONES_SOURCE, '?1')}))
SELECT DISTINCT i.id, i.name FROM loot l JOIN item i ON i.name_key = lower(l.name) ORDER BY i.name COLLATE NOCASE LIMIT ${SELECT_MAX}`;

async function dropButton(c: Ctx, d: DkpState, raidId: number): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const raid = await c.db.prepare('SELECT id, pool FROM dkp_raid WHERE id = ? AND guild_id = ? AND closed_at IS NULL').bind(raidId, c.guild.id).first<{ id: number; pool: string }>();
  if (!raid) return ephemeral(RAID_COPY.raidClosed);
  const kill = await c.db.prepare('SELECT id, name FROM dkp_kill WHERE raid_id = ? AND name IS NOT NULL ORDER BY id DESC LIMIT 1').bind(raid.id).first<{ id: number; name: string }>();
  if (!kill) return ephemeral(A.noKillYet);
  const { results } = await c.db.prepare(LOOT_SQL).bind(raid.pool, kill.name).all<{ id: number; name: string }>();
  if (!results.length) return ephemeral(A.noLoot(kill.name));
  // Order 29, PR C (the item queue): several drops at once, each opening as the one before it closes.
  return ephemeral(A.pickDrop(kill.name), {
    components: [
      row([
        {
          type: 3, custom_id: `${DROP_SELECT_PREFIX}${kill.id}`, placeholder: A.dropPlaceholder, min_values: 1, max_values: Math.min(QUEUE_MAX, results.length),
          options: results.map((r) => ({ label: truncate(r.name, 100), value: String(r.id) })),
        },
      ]),
    ],
  });
}

const textInput = (custom_id: string, label: string, o: { description?: string; value?: string; max?: number; style?: number; required?: boolean } = {}) => ({
  type: MessageComponentTypes.LABEL,
  label,
  ...(o.description ? { description: truncate(o.description, 100) } : {}),
  component: { type: MessageComponentTypes.INPUT_TEXT, custom_id, style: o.style ?? 1, required: o.required ?? true, max_length: o.max ?? 10, ...(o.value ? { value: o.value } : {}) },
});

/** The drops picked: the form for their minimum bid and length (a modal, at once). Ids in base 36, "."-joined (≤100 chars). */
function dropModal(killId: number, itemIds: number[], s: Settings): InteractionReply {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${DROP_MODAL_PREFIX}${killId}:${itemIds.map((n) => `${n.toString(36)}.`).join('')}`,
      title: A.formTitle,
      components: [textInput('minimum', A.minimumLabel, { value: '1', max: 6 }), textInput('minutes', A.minutesLabel, { value: String(Math.max(1, Math.round(s.raid_auction_seconds / 60))), max: 5 })],
    },
  };
}

/** A form's whole number, or null (the text input has no number type: the server validates). */
const whole = (s: string | undefined) => (s !== undefined && /^\d{1,9}$/.test(s.trim()) ? Number(s.trim()) : null);

async function dropSubmitted(c: Ctx, d: DkpState, rest: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  // "<kill>:<ids>": each id in base 36 followed by "." (PR C); a decimal id without "." is a form sent before the queue
  // (order 18: every custom_id sent stays handled).
  const [killText, idsText = ''] = rest.split(':');
  const killId = Number(killText);
  const itemIds = [...new Set(idsText.includes('.') ? idsText.split('.').filter(Boolean).map((x) => parseInt(x, 36)) : [Number(idsText)])].filter(Number.isInteger).slice(0, QUEUE_MAX);
  if (!itemIds.length) return ephemeral(RAID_COPY.noName);
  const v = modalValues(components);
  const min = whole(v.get('minimum'));
  const minutes = whole(v.get('minutes'));
  if (min === null) return ephemeral(A.wholeNumber(A.minimumLabel));
  if (minutes === null) return ephemeral(A.wholeNumber(A.minutesLabel));
  if (min < 1) return ephemeral(A.minimumRange);
  if (minutes < 1 || minutes > MAX_MINUTES) return ephemeral(A.minutesRange(MAX_MINUTES));
  const kill = await c.db
    .prepare('SELECT k.raid_id, r.pool, k.name FROM dkp_kill k JOIN dkp_raid r ON r.id = k.raid_id WHERE k.id = ? AND r.guild_id = ? AND r.closed_at IS NULL')
    .bind(killId, c.guild.id)
    .first<{ raid_id: number; pool: string; name: string }>();
  if (!kill) return ephemeral(RAID_COPY.raidClosed);
  // The item must still be that named's known loot (the form's id is the presser's, never trusted).
  const { results } = await c.db.prepare(LOOT_SQL).bind(kill.pool, kill.name).all<{ id: number }>();
  if (!itemIds.every((id) => results.some((r) => r.id === id))) return ephemeral(A.noLoot(kill.name));
  return createAuctions(c, d, { kind: 'raid', raidId: kill.raid_id, killId, itemIds, min, seconds: minutes * 60 });
}

// ---------------------------------------------------------------- bidding

/** Bid: the member may bid (eligibility), and can pay the minimum: the form, with their own bid filled in. */
async function bidButton(c: Ctx, d: DkpState, id: number): Promise<InteractionReply> {
  const a = await auctionById(c.db, c.guild.id, id);
  if (!a || a.status !== 'open' || Date.parse(a.closes_at!) <= Date.now()) return ephemeral(A.closed);
  const refusal = refusalOf(await eligibility(c.db, c.guild.id, a, [c.userId], Date.now(), d.settings), c.userId);
  if (refusal) return ephemeral(refusalText(refusal, d.settings));
  const [balance, mine] = await Promise.all([
    balanceOf(c.db, c.guild.id, a.pool, c.userId),
    c.db.prepare('SELECT amount FROM dkp_bid WHERE auction_id = ? AND member_id = ?').bind(id, c.userId).first<{ amount: number }>(),
  ]);
  if (balance < a.min_bid && !mine) return ephemeral(A.tooPoor(a.min_bid, balance));
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${BID_MODAL_PREFIX}${id}`,
      title: A.bidTitle(a.item_name),
      components: [textInput('amount', A.amountLabel, { description: A.amountHint(a.min_bid, balance), value: mine ? String(mine.amount) : undefined })],
    },
  };
}

/**
 * The bid form: a whole number from the minimum to the member's balance in the pool; 0 withdraws. It counts only if it
 * arrives before closes_at by the server's clock (the upsert's own condition), however late the alarm runs.
 */
async function bidSubmitted(c: Ctx, d: DkpState, id: number, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const at = new Date();
  const a = await auctionById(c.db, c.guild.id, id);
  if (!a || a.status !== 'open' || Date.parse(a.closes_at!) <= at.getTime()) return ephemeral(A.closed);
  const n = whole(modalValues(components).get('amount'));
  if (n === null) return ephemeral(A.wholeNumber(A.amountLabel));
  if (n === 0) {
    // A withdrawal keeps its row, marked (review of PR B: an officer who bid stays a bidder for dkpSelfConflict).
    const gone = await c.db
      .prepare(`UPDATE dkp_bid SET dropped = 'withdrawn', at = ?3 WHERE auction_id = ?1 AND member_id = ?2 AND dropped IS NULL AND EXISTS (SELECT 1 FROM dkp_auction WHERE id = ?1 AND ${STILL_OPEN})`)
      .bind(id, c.userId, at.toISOString(), at.toISOString())
      .run();
    if (!gone.meta.changes) return ephemeral(A.noBidToWithdraw);
    recount(c, id);
    return ephemeral(A.withdrawn);
  }
  const refusal = refusalOf(await eligibility(c.db, c.guild.id, a, [c.userId], at.getTime(), d.settings), c.userId);
  if (refusal) return ephemeral(refusalText(refusal, d.settings));
  if (n < a.min_bid) return ephemeral(A.belowMinimum(a.min_bid));
  const balance = await balanceOf(c.db, c.guild.id, a.pool, c.userId);
  if (n > balance) return ephemeral(A.overBalance(balance));
  const put = await c.db
    .prepare(
      `INSERT INTO dkp_bid (auction_id, member_id, amount, at) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM dkp_auction WHERE id = ?1 AND ${STILL_OPEN})
       ON CONFLICT (auction_id, member_id) DO UPDATE SET amount = ?3, at = ?4, dropped = NULL`,
    )
    .bind(id, c.userId, n, at.toISOString())
    .run();
  if (!put.meta.changes) return ephemeral(A.closed);
  recount(c, id);
  return ephemeral(A.bidIn(n, unix(a.closes_at!)));
}

// ---------------------------------------------------------------- closing (the timer only)

/**
 * The result, from the bids and the balances at close: every bid checked again (balance, and who may bid); the highest
 * valid bid wins, a tie going to the higher 30-day attendance in the pool, then to the earlier bid; the price is the
 * second-highest valid bid + 1, never more than the winner's own bid; a lone bidder pays the minimum.
 */
export function decide(
  bids: { member_id: string; amount: number; at: string }[],
  balance: (m: string) => number,
  refused: (m: string) => boolean,
  attendance: (m: string) => number,
  minBid: number,
): { winner: string | null; price: number | null; dropped: Map<string, 'balance' | 'limit'> } {
  const dropped = new Map<string, 'balance' | 'limit'>();
  const valid = bids.filter((b) => {
    if (refused(b.member_id)) return (dropped.set(b.member_id, 'limit'), false);
    if (b.amount > balance(b.member_id)) return (dropped.set(b.member_id, 'balance'), false);
    return true;
  });
  if (!valid.length) return { winner: null, price: null, dropped };
  valid.sort((x, y) => y.amount - x.amount || attendance(y.member_id) - attendance(x.member_id) || Date.parse(x.at) - Date.parse(y.at) || x.member_id.localeCompare(y.member_id));
  const [w, second] = valid;
  return { winner: w.member_id, price: second ? Math.min(w.amount, second.amount + 1) : minBid, dropped };
}

/** Calls a close needs in one invocation (D1 and Discord, the tie-break aside): it waits for a fresh run below this. */
export const CLOSE_NEEDS = 16;
/** Calls the result's card edit, line and standings need (result:<id>). */
export const RESULT_NEEDS = 14;

/**
 * auction:<id> at closes_at. Idempotent (alarms run at least once): only an open auction past its close time closes, in a
 * batch whose first statement re-checks both, with the winner's balance and the bids as they were read (review of PR B):
 * a balance or a bid that moved since (a shop purchase, a bid landing during the close) closes nothing, and the item runs
 * again at once. The card, the result line and the standings are their own item, result:<id>, so they retry on their own.
 */
export async function closeAuction(db: D1Database, api: BotApi | null, guild: Guild, id: number, nowMs: number, s: Settings): Promise<{ again: number } | { closed: Auction } | null> {
  const a = await auctionById(db, guild.id, id);
  if (!a || a.status !== 'open') return null;
  if (Date.parse(a.closes_at!) > nowMs) return { again: Date.parse(a.closes_at!) };
  if (api && budgetLeft(api.budget) < CLOSE_NEEDS) return { again: nowMs };
  const [read, print] = await db.batch<Record<string, unknown>>([db.prepare(BIDS_SQL).bind(id, guild.id), db.prepare(`SELECT ${BIDS_FINGERPRINT('?1')} AS fp`).bind(id)]);
  const bids = (read.results as unknown as BidRow[]).filter((b) => b.dropped !== WITHDRAWN);
  const fp = (print.results[0] as { fp: string }).fp;
  const members = bids.map((b) => b.member_id);
  const [{ standings }, refusals] = await Promise.all([dkpRead(db, guild.id, { pools: [a.pool] }), eligibility(db, guild.id, a, members, nowMs, s)]);
  const balances = new Map((standings.get(a.pool) ?? []).map((m) => [m.member_id, m.balance]));
  // The tie-break reads 30-day attendance only for members tied on the top valid amount (dkpRead, one batch each).
  const refused = (m: string) => refusalOf(refusals, m) !== null;
  const counts = (b: BidRow) => !refused(b.member_id) && b.amount <= (balances.get(b.member_id) ?? 0);
  const top = Math.max(0, ...bids.filter(counts).map((b) => b.amount));
  const tied = bids.filter((b) => b.amount === top && counts(b)).map((b) => b.member_id);
  const attendance = new Map<string, number>();
  if (tied.length > 1)
    for (const m of tied) {
      const r = await dkpRead(db, guild.id, { pools: [a.pool], member: m, attendance: true, now: nowMs });
      attendance.set(m, r.attendance.find((x) => x.pool === a.pool)?.earned ?? 0);
    }
  const result = decide(bids, (m) => balances.get(m) ?? 0, refused, (m) => attendance.get(m) ?? 0, a.min_bid);
  const at = new Date(nowMs).toISOString();
  // The marks apply only with this close (review of PR B: a close that changed nothing leaves no stale mark).
  const marks = [...result.dropped].map(([m, why]) =>
    db.prepare('UPDATE dkp_bid SET dropped = ?1 WHERE auction_id = ?2 AND member_id = ?3 AND EXISTS (SELECT 1 FROM dkp_auction WHERE id = ?2 AND closed_at = ?4)').bind(why, id, m, at),
  );
  const [closed] = await db.batch([
    result.winner
      ? db
          .prepare(
            `UPDATE dkp_auction SET status = 'sold', winner = ?3, price = ?4, closed_at = ?5 WHERE id = ?6 AND status = 'open' AND closes_at <= ?5
               AND ${balanceSql('?3')} >= ?4 AND ${BIDS_FINGERPRINT('?6')} = ?7`,
          )
          .bind(guild.id, a.pool, result.winner, result.price, at, id, fp)
      : db.prepare(`UPDATE dkp_auction SET status = 'unsold', closed_at = ?1 WHERE id = ?2 AND status = 'open' AND closes_at <= ?1 AND ${BIDS_FINGERPRINT('?2')} = ?3`).bind(at, id, fp),
    ...(result.winner ? [auctionSpendStatement(db, { guildId: guild.id, pool: a.pool, member: result.winner, price: result.price!, auctionId: id, raidId: a.raid_id, reason: A.spendReason(a.item_name), at })] : []),
    ...marks,
  ]);
  if (!closed.meta.changes) {
    const still = await auctionById(db, guild.id, id);
    return still?.status === 'open' ? { again: nowMs } : null;
  }
  return { closed: (await auctionById(db, guild.id, id))! };
}

/**
 * result:<id> after a close: the card edited into the result (every bid revealed), the result line, the standings. Waits
 * for a run with the calls it needs; a throw is retried by the timer object (the line is posted last, after the edits).
 */
export async function announceResult(db: D1Database, api: BotApi | null, guild: Guild, channelId: string | null, id: number, nowMs: number): Promise<{ again: number } | null> {
  const a = await auctionById(db, guild.id, id);
  if (!a || (a.status !== 'sold' && a.status !== 'unsold') || !api || !channelId) return null;
  if (budgetLeft(api.budget) < RESULT_NEEDS) return { again: nowMs };
  if (a.message_id) await editCard(db, api, guild.id, `acard:${id}`, channelId, a.message_id, await cardFor(db, guild, a));
  if (a.winner) await refreshStandings(db, api, guild.id, channelId, [a.pool]);
  const name = a.winner ? (await db.prepare('SELECT display_name FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(guild.id, a.winner).first<{ display_name: string }>())?.display_name : null;
  await postIn(api, channelId, { content: A.result(a.item_name, a.winner ? memberTag(a.winner, name ?? a.winner) : null, a.price, link(guild.id, channelId, a.message_id)) });
  return null;
}

// ---------------------------------------------------------------- cancel, and Post to general auction

const biddersOf = async (db: D1Database, id: number) => (await db.prepare('SELECT member_id FROM dkp_bid WHERE auction_id = ?').bind(id).all<{ member_id: string }>()).results.map((r) => r.member_id);

/** The longest reason: the old form's, and /dkp cancel's max_length (src/dkp/definition.ts holds literals; a test ties them). */
export const CANCEL_REASON_MAX = 200;

/**
 * The one cancel (order 31): /dkp cancel and an old card's form both end here. The update holds only while the auction is
 * open and before its close time, so it can't race the timer's close (review of PR B: a late alarm leaves the close to the
 * timer). The auction:<id> item stays set and does nothing when it fires (closeAuction reads the status).
 */
async function cancelAuction(c: Ctx, d: DkpState, id: number, reason: string): Promise<MessageReply> {
  // The conflict from this press: a bid placed after an old form opened counts.
  if (dkpSelfConflict(c.userId, { bidders: await biddersOf(c.db, id) })) return ephemeral(A.ownBid);
  const at = now();
  // A card must exist: openAuction commits 'open' before it posts, and a cancel in that gap would leave a Bid card behind.
  const done = await c.db
    .prepare("UPDATE dkp_auction SET status = 'cancelled', reason = ?1, cancelled_by = ?2, closed_at = ?3 WHERE id = ?4 AND guild_id = ?5 AND status = 'open' AND closes_at > ?3 AND message_id IS NOT NULL RETURNING raid_id")
    .bind(reason, c.userId, at, id, c.guild.id)
    .first<{ raid_id: number | null }>();
  if (!done) return ephemeral(A.closed);
  // From here it is cancelled, whatever fails below, and effects run even after a throw (src/index.ts): the timer object
  // opens the raid's next drop (next: does nothing if this run already did) and redraws the raid card's queue line.
  if (done.raid_id) schedule(c, [{ key: `next:${done.raid_id}`, due: Date.now() + 1 }, { key: `render:${done.raid_id}`, due: Date.now() }]);
  const api = apiFor(c);
  let carded = false;
  try {
    // The audit row only for a cancel made (as review of PR C had it for a record).
    await audit(c.db, c.guild.id, c.userId, 'dkp.auction.cancel', `auction:${id}`, { status: 'open' }, { status: 'cancelled' }).run();
    const a = (await auctionById(c.db, c.guild.id, id))!;
    if (api && d.channel_id) {
      carded = (await editCard(c.db, api, c.guild.id, `acard:${id}`, d.channel_id, a.message_id!, await cardFor(c.db, c.guild, a))) !== 'failed';
      await postIn(api, d.channel_id, { content: A.cancelled(a.item_name, by(c), reason, link(c.guild.id, d.channel_id, a.message_id)) });
    }
    // The item queue: the raid's next drop opens now, so its card follows the cancel notice.
    schedule(c, await openNext(c.db, api, c.guild, d.channel_id, a.raid_id, Date.now(), d.settings, 1));
  } finally {
    // A card that still shows Bid is edited by the timer object (acard:).
    if (!carded) schedule(c, [{ key: `acard:${id}`, due: Date.now() }]);
    spent(c, api);
  }
  return ephemeral(A.cancelledReply);
}

/** /dkp cancel auction: reason: (officers, DKP_ROUTES). The value is an auction id from the list; anything else is refused. */
export const cancelCommand: DkpRun = async (c, opts, d) => {
  const typed = (optString(opts, 'auction') ?? '').trim();
  const a = /^\d{1,15}$/.test(typed) ? await auctionById(c.db, c.guild.id, Number(typed)) : null;
  if (!a) return ephemeral(A.pickAuction);
  if (a.status !== 'open') return ephemeral(A.notOpen);
  const reason = (optString(opts, 'reason') ?? '').trim();
  if (!reason) return ephemeral(RAID_COPY.reason);
  return cancelAuction(c, d, a.id, reason);
};

/** Choices for /dkp cancel auction: this server's open auctions, newest first, matched on item or place. One statement. */
const OPEN_AUCTIONS_SQL = `SELECT a.id, i.name AS item, coalesce(z.name, r.pool) AS zone, a.closes_at FROM dkp_auction a
  JOIN item i ON i.id = a.item_id LEFT JOIN dkp_raid r ON r.id = a.raid_id LEFT JOIN zone z ON z.key = r.pool
  WHERE a.guild_id = ?1 AND a.status = 'open' AND a.closes_at > ?2 AND a.message_id IS NOT NULL
    AND (instr(lower(i.name), lower(?3)) > 0 OR instr(lower(coalesce(z.name, r.pool, ?4)), lower(?3)) > 0)
  ORDER BY a.opened_at DESC, a.id DESC LIMIT 25`;

/** "2 h 14 m": plain text, because Discord's <t:…> tags don't render in choices. Rounded up, so it never reads 0. */
export function timeLeft(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const [d, h, m] = [Math.floor(minutes / 1440), Math.floor(minutes / 60) % 24, minutes % 60];
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} m` : `${m} m`;
}

export async function openAuctionChoices(db: D1Database, guildId: string, typed: string, nowMs: number): Promise<{ name: string; value: string }[]> {
  const { results } = await db
    .prepare(OPEN_AUCTIONS_SQL)
    .bind(guildId, new Date(nowMs).toISOString(), typed.trim(), A.generalChoice)
    .all<{ id: number; item: string; zone: string | null; closes_at: string }>();
  return results.map((r) => ({ name: A.choice(r.item, r.zone ?? A.generalChoice, timeLeft(Date.parse(r.closes_at) - nowMs)), value: String(r.id) }));
}

/** An old card's Cancel auction (order 31: new cards have none; order 18: it stays handled): the reason, in a form. */
async function cancelButton(c: Ctx, d: DkpState, id: number): Promise<InteractionReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const a = await auctionById(c.db, c.guild.id, id);
  if (!a || a.status !== 'open') return ephemeral(A.closed);
  if (dkpSelfConflict(c.userId, { bidders: await biddersOf(c.db, id) })) return ephemeral(A.ownBid);
  return { type: InteractionResponseType.MODAL, data: { custom_id: `${CANCEL_MODAL_PREFIX}${id}`, title: A.cancelTitle, components: [textInput('reason', A.reasonLabel, { style: 2, max: CANCEL_REASON_MAX })] } };
}

async function cancelSubmitted(c: Ctx, d: DkpState, id: number, components: ModalComponent[] | undefined): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const reason = (modalValues(components).get('reason') ?? '').trim();
  if (!reason) return ephemeral(RAID_COPY.reason);
  return cancelAuction(c, d, id, reason);
}

// ---------------------------------------------------------------- the general auction's record (order 29, PR C)

/** Record what was done: officers, for a general auction that closed unsold; free text, public, kept. */
function recordButton(c: Ctx, d: DkpState, id: number): InteractionReply {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  return { type: InteractionResponseType.MODAL, data: { custom_id: `${RECORD_MODAL_PREFIX}${id}`, title: Q.recordTitle, components: [textInput('disposal', Q.recordLabel, { style: 2, max: 300 })] } };
}

async function recordSubmitted(c: Ctx, d: DkpState, id: number, components: ModalComponent[] | undefined): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const text = (modalValues(components).get('disposal') ?? '').trim();
  if (!text) return ephemeral(RAID_COPY.reason);
  const res = await c.db
    .prepare("UPDATE dkp_auction SET disposal = ?1, disposal_by = ?2, disposal_at = ?3 WHERE id = ?4 AND guild_id = ?5 AND kind = 'general' AND status = 'unsold' AND disposal IS NULL")
    .bind(text, c.userId, now(), id, c.guild.id)
    .run();
  if (!res.meta.changes) return ephemeral(Q.notRecordable);
  // The audit row only for a record made (review of PR C).
  await audit(c.db, c.guild.id, c.userId, 'dkp.auction.disposal', `auction:${id}`, null, { recorded: true }).run();
  const a = (await auctionById(c.db, c.guild.id, id))!;
  const api = apiFor(c);
  try {
    if (api && d.channel_id) {
      if (a.message_id) await editCard(c.db, api, c.guild.id, `acard:${id}`, d.channel_id, a.message_id, await cardFor(c.db, c.guild, a));
      await postIn(api, d.channel_id, { content: Q.disposalLine(a.item_name, text, by(c)) });
    }
  } finally {
    spent(c, api);
  }
  return ephemeral(Q.recorded);
}

// ---------------------------------------------------------------- wishlist nudges (order 29, PR C; override 3)

/**
 * nudge:<id> on the timer object, when an auction opens: a direct message to each eligible member who wishes for its
 * item (a link to the card, never a Bid button: a press from a direct message has no server member), 2 calls each (open
 * the DM, then send), in chunks inside the invocation's calls, rescheduled until done. One dkp_nudge row per member, so
 * nobody is messaged twice; Discord's 50007 ("Cannot send messages to this user") is a refusal, skipped and counted.
 * Discord (docs.discord.com/developers/resources/user, Create DM): "DMs should generally be initiated by a user action";
 * adding the item is that action.
 */
export async function nudge(db: D1Database, api: BotApi | null, guild: Guild, channelId: string | null, id: number, nowMs: number, s: Settings): Promise<{ again: number } | null> {
  const a = await auctionById(db, guild.id, id);
  if (!a || a.status !== 'open' || !api || !channelId || !a.message_id) return null;
  const done = new Set((await db.prepare('SELECT member_id FROM dkp_nudge WHERE auction_id = ?').bind(id).all<{ member_id: string }>()).results.map((r) => r.member_id));
  const todo = (await eligibleWishers(db, guild.id, a, nowMs, s)).filter((m) => !done.has(m));
  const url = link(guild.id, channelId, a.message_id)!;
  const at = new Date(nowMs).toISOString();
  const record = db.prepare('INSERT INTO dkp_nudge (auction_id, member_id, result, at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING');
  let handled = 0;
  for (const member of todo) {
    // Two calls for this member and one to record it, right after its send (review of PR C: a run that dies part-way
    // never messages anyone twice).
    if (budgetLeft(api.budget) < 4) break;
    const dm = await api.call<{ id: string }>('POST', '/users/@me/channels', { recipient_id: member });
    const sent = dm.ok ? await api.call('POST', `/channels/${dm.body.id}/messages`, { content: Q.nudge(a.item_name, url, unix(a.closes_at!)), allowed_mentions: NO_PINGS }) : dm;
    // A transient failure (skipped, no answer, 429, 5xx) is tried again later, unrecorded; a refusal or another 4xx is final.
    if (transient(sent)) return { again: nowMs + RETRY_MS };
    await record.bind(id, member, sent.ok ? 'sent' : sent.code === CANNOT_DM ? 'refused' : 'failed', at).run();
    handled++;
  }
  return handled < todo.length ? { again: nowMs } : null;
}
/** Discord's JSON error code 50007, "Cannot send messages to this user" (docs.discord.com/developers/topics/opcodes-and-status-codes). */
export const CANNOT_DM = 50007;

/** Post to general auction: an unsold raid auction's item, for guild points, at the general auction's length. Once. */
async function postGeneral(c: Ctx, d: DkpState, id: number): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const a = await auctionById(c.db, c.guild.id, id);
  if (!a || a.status !== 'unsold') return ephemeral(A.notUnsold);
  if (await c.db.prepare('SELECT 1 FROM dkp_auction WHERE from_auction = ?').bind(id).first()) return ephemeral(A.alreadyPosted);
  const r = await createAuctions(c, d, { kind: 'general', raidId: null, killId: null, fromAuction: id, itemIds: [a.item_id], min: a.min_bid, seconds: d.settings.general_auction_hours * 3600 });
  return r;
}

// ---------------------------------------------------------------- Remove DKP

/** Remove DKP: every open or queued auction is cancelled ("DKP removed"), in Remove DKP's batch, before its timers go. */
export const cancelAllStatement = (db: D1Database, guildId: string, at: string) =>
  db.prepare("UPDATE dkp_auction SET status = 'cancelled', reason = ?1, cancelled_by = 'bot', closed_at = ?2 WHERE guild_id = ?3 AND status IN ('open', 'queued') RETURNING id, message_id").bind(A.removedReason, at, guildId);

/** Remove DKP's cards: each cancelled auction's card shows the reason and its bids, while the call budget lasts. */
export async function showCancelled(db: D1Database, api: BotApi, guild: Guild, channelId: string | null, ids: number[]) {
  if (!channelId) return;
  for (const id of ids) {
    const a = await auctionById(db, guild.id, id);
    if (!a?.message_id) continue;
    // Order 33: a card past the budget still says Bid, so the sweep is told to redraw it.
    if (budgetLeft(api.budget) > 1) await editCard(db, api, guild.id, `acard:${id}`, channelId, a.message_id, await cardFor(db, guild, a));
    else await markStale(db, guild.id, `acard:${id}`, { status: 0 }).run();
  }
}

// ---------------------------------------------------------------- routing

const idOf = (id: string, prefix: string) => Number(id.slice(prefix.length));

/** The controls that answer at once (a modal, or a refusal): the drop select, Bid, Cancel auction. */
export async function auctionImmediate(c: Ctx, id: string, values: string[], d: DkpState): Promise<InteractionReply | null> {
  if (id.startsWith(DROP_SELECT_PREFIX)) {
    if (!runner(c, d)) return ephemeral(A.notRunner);
    const itemIds = values.map(Number).filter(Number.isInteger).slice(0, QUEUE_MAX);
    if (!itemIds.length) return ephemeral(RAID_COPY.noName);
    return dropModal(idOf(id, DROP_SELECT_PREFIX), itemIds, d.settings);
  }
  if (id.startsWith(BID_PREFIX)) return bidButton(c, d, idOf(id, BID_PREFIX));
  if (id.startsWith(CANCEL_PREFIX)) return cancelButton(c, d, idOf(id, CANCEL_PREFIX));
  if (id.startsWith(RECORD_PREFIX)) return recordButton(c, d, idOf(id, RECORD_PREFIX));
  return null;
}

/** The deferred controls and forms: Auction a drop, the forms' submits, Post to general auction. */
export async function auctionComponent(c: Ctx, id: string, components: ModalComponent[] | undefined, d: DkpState): Promise<MessageReply | null> {
  if (id.startsWith(AUCTION_DROP_PREFIX)) return dropButton(c, d, idOf(id, AUCTION_DROP_PREFIX));
  if (id.startsWith(DROP_MODAL_PREFIX)) return dropSubmitted(c, d, id.slice(DROP_MODAL_PREFIX.length), components);
  if (id.startsWith(BID_MODAL_PREFIX)) return bidSubmitted(c, d, idOf(id, BID_MODAL_PREFIX), components);
  if (id.startsWith(CANCEL_MODAL_PREFIX)) return cancelSubmitted(c, d, idOf(id, CANCEL_MODAL_PREFIX), components);
  if (id.startsWith(POST_GENERAL_PREFIX)) return postGeneral(c, d, idOf(id, POST_GENERAL_PREFIX));
  if (id.startsWith(RECORD_MODAL_PREFIX)) return recordSubmitted(c, d, idOf(id, RECORD_MODAL_PREFIX), components);
  return null;
}

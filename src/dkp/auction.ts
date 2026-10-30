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
//   Cancel auction (press): guild, state, auction, bidders: 4 D1; 0. Its form: guild, state, auction, bidders, update,
//     card (bids, item card 4): about 11 D1; 2 Discord (the card, the notice).
//   Post to general auction: guild, state, auction, insert, open: about 11 D1; 1 Discord.
//   The close (timer): auction, bids, balances, eligibility, (tie: 1 per tied bidder), one batch, card (about 6): about
//     12 D1; 3 Discord (card, result, standings). The card edit (acard:, timer): about 7 D1; 1 Discord.
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import { audit, dkpSelfConflict, isDkpRunner, loadGuild, now, type Guild } from '../access.ts';
import { botApi, budgetLeft, type BotApi } from '../board/api.ts';
import { itemCard } from '../commands/item.ts';
import { modalValues } from '../commands/reports.ts';
import type { Ctx } from '../context.ts';
import {
  button, ephemeral, memberTag, optBool, optInt, optString, row, STYLE_DANGER, STYLE_PRIMARY, STYLE_SECONDARY, truncate, type Embed, type InteractionReply, type MessageReply, type ModalComponent,
} from '../discord.ts';
import { MOB_ZONES_SOURCE, zoneNamesSql } from '../zone/names.ts';
import type { DkpRun } from './commands.ts';
import { AUCTION_COPY as A, RAID_COPY } from './copy.ts';
import { eligibility, refusalOf, type Refusal } from './eligible.ts';
import { auctionSpendStatement, balanceSql, dkpRead, POOL_GUILD } from './ledger.ts';
import { editIn, poolNames, postIn, refreshStandings, type Message } from './messages.ts';
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
/** The controls that answer with a modal, at once (src/interactions.ts OPENS_MODAL). */
export const AUCTION_OPENS_MODAL = [DROP_SELECT_PREFIX, BID_PREFIX, CANCEL_PREFIX];
/** Every auction custom_id prefix (routing; order 23: each has its own routing test). */
export const AUCTION_PREFIXES = [AUCTION_DROP_PREFIX, DROP_SELECT_PREFIX, DROP_MODAL_PREFIX, BID_PREFIX, BID_MODAL_PREFIX, CANCEL_PREFIX, CANCEL_MODAL_PREFIX, POST_GENERAL_PREFIX];

/** Discord's String Select limit, and the most minutes an auction may run (7 days). */
const SELECT_MAX = 25;
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
  /** The pool it spends: the raid's zone, or the guild pool (derived, never stored). */
  pool: string;
  item_name: string;
}
const AUCTION_SQL = `SELECT a.id, a.guild_id, a.kind, a.raid_id, a.kill_id, a.from_auction, a.item_id, a.min_bid, a.seconds, a.status, a.created_by, a.opened_at, a.closes_at,
  a.message_id, a.closed_at, a.winner, a.price, a.reason, a.cancelled_by, coalesce(r.pool, '${POOL_GUILD}') AS pool, i.name AS item_name
  FROM dkp_auction a LEFT JOIN dkp_raid r ON r.id = a.raid_id JOIN item i ON i.id = a.item_id WHERE a.id = ?1 AND a.guild_id = ?2`;
export const auctionById = (db: D1Database, guildId: string, id: number) => db.prepare(AUCTION_SQL).bind(id, guildId).first<Auction>();

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
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
const BIDS_SQL = `SELECT b.member_id, coalesce(m.display_name, b.member_id) AS name, b.amount, b.at, b.dropped FROM dkp_bid b
  LEFT JOIN member m ON m.guild_id = ?2 AND m.discord_user_id = b.member_id WHERE b.auction_id = ?1 ORDER BY b.amount DESC, b.at`;

/** The card: the item's stats (the /item card's first embed) and the auction; once closed, the result with every bid. */
export function auctionMessage(a: Auction, d: { item: Embed | null; poolName: string; bids: BidRow[]; winnerName: string | null; cancelledByName: string | null }): Message {
  const lines: string[] = [a.kind === 'raid' ? A.raidLine(d.poolName) : A.generalLine, A.minimum(a.min_bid)];
  const open = a.status === 'open';
  if (open && a.closes_at) lines.push(A.closes(unix(a.closes_at)), '', A.bidders(d.bids.length));
  else {
    lines.push('');
    if (a.status === 'sold') lines.push(A.sold(memberTag(a.winner!, d.winnerName ?? a.winner!), a.price!));
    else if (a.status === 'unsold') lines.push(A.unsold);
    else if (a.status === 'cancelled') lines.push(A.cancelledBy(a.cancelled_by === 'bot' || !a.cancelled_by ? 'GuildCraft' : memberTag(a.cancelled_by, d.cancelledByName ?? a.cancelled_by), a.reason ?? ''));
    // Revealed after close (order 29's override 4: guild-public DKP data), members shown, nobody pinged.
    lines.push('', A.bidsHead, ...(d.bids.length ? d.bids.slice(0, BIDS_SHOWN).map((b) => A.bidLine(memberTag(b.member_id, b.name), b.amount, b.dropped ? (A.dropped[b.dropped] ?? b.dropped) : null)) : [A.noBids]));
    if (d.bids.length > BIDS_SHOWN) lines.push(RAID_COPY.counted(d.bids.length - BIDS_SHOWN));
  }
  const embed: Embed = { title: truncate(A.title(a.item_name), 256), description: truncate(lines.join('\n'), 4096) };
  const components: unknown[] = open
    ? [row([button(`${BID_PREFIX}${a.id}`, A.bid, STYLE_PRIMARY), button(`${CANCEL_PREFIX}${a.id}`, A.cancel, STYLE_DANGER)])]
    : a.status === 'unsold' && a.kind === 'raid'
      ? [row([button(`${POST_GENERAL_PREFIX}${a.id}`, A.postGeneral, STYLE_SECONDARY)])]
      : [];
  return { embeds: [...(d.item ? [d.item] : []), embed], components };
}

async function cardFor(db: D1Database, guild: Guild, a: Auction): Promise<Message> {
  const [card, names, { results: bids }, people] = await Promise.all([
    itemCard({ db, guild }, a.item_id),
    poolNames(db, [a.pool]),
    db.prepare(BIDS_SQL).bind(a.id, guild.id).all<BidRow>(),
    db
      .prepare('SELECT discord_user_id AS id, display_name AS name FROM member WHERE guild_id = ?1 AND discord_user_id IN (?2, ?3)')
      .bind(guild.id, a.winner ?? '', a.cancelled_by ?? '')
      .all<{ id: string; name: string }>(),
  ]);
  const name = (id: string | null) => people.results.find((p) => p.id === id)?.name ?? null;
  return auctionMessage(a, { item: card?.embeds[0] ?? null, poolName: names.get(a.pool)!, bids, winnerName: name(a.winner), cancelledByName: name(a.cancelled_by) });
}

/** acard:<id> on the timer object: the card, edited in place. Returns Discord's rate-limit headers, for the pace. */
export async function renderAuction(db: D1Database, api: BotApi, guildId: string, channelId: string, id: number) {
  const [a, guild] = await Promise.all([auctionById(db, guildId, id), loadGuild(db, guildId)]);
  if (!a?.message_id || !guild) return null;
  await editIn(api, channelId, a.message_id, await cardFor(db, guild, a));
  const last = api.log.at(-1);
  return last ? { remaining: last.remaining ?? null, resetAfter: last.reset_after ?? null, retryAfter: last.retry_after ?? null } : null;
}

// ---------------------------------------------------------------- opening

/** Opens a queued auction: its close time from now, its card in GC-DKP, its timer. The card refused: it's cancelled. */
export async function openAuction(db: D1Database, api: BotApi | null, guild: Guild, channelId: string | null, id: number, nowMs: number): Promise<{ key: string; due: number }[]> {
  const at = new Date(nowMs).toISOString();
  const opened = await db
    .prepare("UPDATE dkp_auction SET status = 'open', opened_at = ?1, closes_at = strftime('%Y-%m-%dT%H:%M:%fZ', ?1, '+' || seconds || ' seconds') WHERE id = ?2 AND guild_id = ?3 AND status = 'queued' RETURNING id")
    .bind(at, id, guild.id)
    .first<{ id: number }>();
  if (!opened) return [];
  const a = (await auctionById(db, guild.id, id))!;
  const posted = api && channelId ? await postIn(api, channelId, await cardFor(db, guild, a)) : null;
  if (!posted) {
    await db.prepare("UPDATE dkp_auction SET status = 'cancelled', reason = ?1, cancelled_by = 'bot', closed_at = ?2 WHERE id = ?3 AND status = 'open'").bind(A.cannotPost, at, id).run();
    return [];
  }
  await db.prepare('UPDATE dkp_auction SET message_id = ? WHERE id = ?').bind(posted, id).run();
  return [{ key: `auction:${id}`, due: Date.parse(a.closes_at!) }];
}

/** Creates one auction and opens it now (the item queue, order 29 PR C, waits its turn instead). */
async function createAuction(
  c: Ctx,
  d: DkpState,
  p: { kind: 'raid' | 'general'; raidId: number | null; killId: number | null; fromAuction?: number | null; itemId: number; min: number; seconds: number },
): Promise<MessageReply> {
  const api = apiFor(c);
  if (!api || !d.channel_id) return ephemeral(A.cannotPost);
  try {
    const at = now();
    const row = await c.db
      .prepare(
        "INSERT INTO dkp_auction (guild_id, kind, raid_id, kill_id, from_auction, item_id, min_bid, seconds, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?) RETURNING id",
      )
      .bind(c.guild.id, p.kind, p.raidId, p.killId, p.fromAuction ?? null, p.itemId, p.min, p.seconds, c.userId, at)
      .first<{ id: number }>();
    await audit(c.db, c.guild.id, c.userId, 'dkp.auction.open', `auction:${row!.id}`, null, { kind: p.kind, item: p.itemId, min: p.min, seconds: p.seconds }).run();
    const items = await openAuction(c.db, api, c.guild, d.channel_id, row!.id, Date.now());
    if (!items.length) return ephemeral(A.cannotPost);
    schedule(c, items);
    const a = (await auctionById(c.db, c.guild.id, row!.id))!;
    return ephemeral(A.opened(a.item_name, link(c.guild.id, d.channel_id, a.message_id)));
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
  if (general) return createAuction(c, d, { kind: 'general', raidId: null, killId: null, itemId: item.id, min, seconds });
  const raid = await openRaidOf(c.db, c.guild.id);
  if (!raid) return ephemeral(A.noRaid);
  return createAuction(c, d, { kind: 'raid', raidId: raid.id, killId: null, itemId: item.id, min, seconds });
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
  return ephemeral(A.pickDrop(kill.name), {
    components: [row([{ type: 3, custom_id: `${DROP_SELECT_PREFIX}${kill.id}`, placeholder: A.dropPlaceholder, options: results.map((r) => ({ label: truncate(r.name, 100), value: String(r.id) })) }])],
  });
}

const textInput = (custom_id: string, label: string, o: { description?: string; value?: string; max?: number; style?: number; required?: boolean } = {}) => ({
  type: MessageComponentTypes.LABEL,
  label,
  ...(o.description ? { description: truncate(o.description, 100) } : {}),
  component: { type: MessageComponentTypes.INPUT_TEXT, custom_id, style: o.style ?? 1, required: o.required ?? true, max_length: o.max ?? 10, ...(o.value ? { value: o.value } : {}) },
});

/** The drop picked: the form for its minimum bid and length (a modal, at once). */
function dropModal(killId: number, itemId: number, s: Settings): InteractionReply {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${DROP_MODAL_PREFIX}${killId}:${itemId}`,
      title: A.formTitle,
      components: [textInput('minimum', A.minimumLabel, { value: '1', max: 6 }), textInput('minutes', A.minutesLabel, { value: String(Math.max(1, Math.round(s.raid_auction_seconds / 60))), max: 5 })],
    },
  };
}

/** A form's whole number, or null (the text input has no number type: the server validates). */
const whole = (s: string | undefined) => (s !== undefined && /^\d{1,9}$/.test(s.trim()) ? Number(s.trim()) : null);

async function dropSubmitted(c: Ctx, d: DkpState, rest: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const [killId, itemId] = rest.split(':').map(Number);
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
  if (!results.some((r) => r.id === itemId)) return ephemeral(A.noLoot(kill.name));
  return createAuction(c, d, { kind: 'raid', raidId: kill.raid_id, killId, itemId, min, seconds: minutes * 60 });
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
    const gone = await c.db
      .prepare("DELETE FROM dkp_bid WHERE auction_id = ?1 AND member_id = ?2 AND EXISTS (SELECT 1 FROM dkp_auction WHERE id = ?1 AND status = 'open' AND closes_at > ?3)")
      .bind(id, c.userId, at.toISOString())
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
      `INSERT INTO dkp_bid (auction_id, member_id, amount, at) SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM dkp_auction WHERE id = ?1 AND status = 'open' AND closes_at > ?4)
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

/**
 * auction:<id> at closes_at. Idempotent (alarms run at least once): only an open auction past its close time closes, in a
 * batch whose first statement re-checks both, with the winner's balance; a balance that moved since it was read (a shop
 * purchase in between) closes nothing, and the item runs again at once.
 */
export async function closeAuction(db: D1Database, api: BotApi | null, guild: Guild, channelId: string | null, id: number, nowMs: number, s: Settings): Promise<{ again: number } | { closed: Auction } | null> {
  const a = await auctionById(db, guild.id, id);
  if (!a || a.status !== 'open') return null;
  if (Date.parse(a.closes_at!) > nowMs) return { again: Date.parse(a.closes_at!) };
  const { results: bids } = await db.prepare(BIDS_SQL).bind(id, guild.id).all<BidRow>();
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
  const marks = [...result.dropped].map(([m, why]) => db.prepare('UPDATE dkp_bid SET dropped = ? WHERE auction_id = ? AND member_id = ?').bind(why, id, m));
  if (result.winner) {
    const [closed] = await db.batch([
      db
        .prepare(
          `UPDATE dkp_auction SET status = 'sold', winner = ?3, price = ?4, closed_at = ?5 WHERE id = ?6 AND status = 'open' AND closes_at <= ?5
             AND ${balanceSql('?3')} >= ?4`,
        )
        .bind(guild.id, a.pool, result.winner, result.price, at, id),
      auctionSpendStatement(db, { guildId: guild.id, pool: a.pool, member: result.winner, price: result.price!, auctionId: id, raidId: a.raid_id, reason: A.spendReason(a.item_name), at }),
      ...marks,
    ]);
    if (!closed.meta.changes) {
      const still = await auctionById(db, guild.id, id);
      return still?.status === 'open' ? { again: nowMs } : null;
    }
  } else {
    const [closed] = await db.batch([
      db.prepare("UPDATE dkp_auction SET status = 'unsold', closed_at = ?1 WHERE id = ?2 AND status = 'open' AND closes_at <= ?1").bind(at, id),
      ...marks,
    ]);
    if (!closed.meta.changes) return null;
  }
  const done = (await auctionById(db, guild.id, id))!;
  if (api && channelId) {
    if (done.message_id) await editIn(api, channelId, done.message_id, await cardFor(db, guild, done));
    const winner = done.winner ? memberTag(done.winner, bids.find((b) => b.member_id === done.winner)?.name ?? done.winner) : null;
    await postIn(api, channelId, { content: A.result(done.item_name, winner, done.price, link(guild.id, channelId, done.message_id)) });
    if (done.winner) await refreshStandings(db, api, guild.id, channelId, [done.pool]);
  }
  return { closed: done };
}

// ---------------------------------------------------------------- cancel, and Post to general auction

const biddersOf = async (db: D1Database, id: number) => (await db.prepare('SELECT member_id FROM dkp_bid WHERE auction_id = ?').bind(id).all<{ member_id: string }>()).results.map((r) => r.member_id);

/** Cancel auction: officers, never one who has bid in it (dkpSelfConflict); the reason, in a form. */
async function cancelButton(c: Ctx, d: DkpState, id: number): Promise<InteractionReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const a = await auctionById(c.db, c.guild.id, id);
  if (!a || a.status !== 'open') return ephemeral(A.closed);
  if (dkpSelfConflict(c.userId, { bidders: await biddersOf(c.db, id) })) return ephemeral(A.ownBid);
  return { type: InteractionResponseType.MODAL, data: { custom_id: `${CANCEL_MODAL_PREFIX}${id}`, title: A.cancelTitle, components: [textInput('reason', A.reasonLabel, { style: 2, max: 200 })] } };
}

async function cancelSubmitted(c: Ctx, d: DkpState, id: number, components: ModalComponent[] | undefined): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const reason = (modalValues(components).get('reason') ?? '').trim();
  if (!reason) return ephemeral(RAID_COPY.reason);
  // The conflict again, from this press: a bid placed after the form opened counts.
  if (dkpSelfConflict(c.userId, { bidders: await biddersOf(c.db, id) })) return ephemeral(A.ownBid);
  const at = now();
  const [res] = await c.db.batch([
    c.db.prepare("UPDATE dkp_auction SET status = 'cancelled', reason = ?1, cancelled_by = ?2, closed_at = ?3 WHERE id = ?4 AND guild_id = ?5 AND status IN ('open', 'queued')").bind(reason, c.userId, at, id, c.guild.id),
    audit(c.db, c.guild.id, c.userId, 'dkp.auction.cancel', `auction:${id}`, { status: 'open' }, { status: 'cancelled' }),
  ]);
  if (!res.meta.changes) return ephemeral(A.closed);
  const a = (await auctionById(c.db, c.guild.id, id))!;
  const api = apiFor(c);
  try {
    if (api && d.channel_id) {
      if (a.message_id) await editIn(api, d.channel_id, a.message_id, await cardFor(c.db, c.guild, a));
      await postIn(api, d.channel_id, { content: A.cancelled(a.item_name, by(c), reason, link(c.guild.id, d.channel_id, a.message_id)) });
    }
  } finally {
    spent(c, api);
  }
  return ephemeral(A.cancelledReply);
}

/** Post to general auction: an unsold raid auction's item, for guild points, at the general auction's length. Once. */
async function postGeneral(c: Ctx, d: DkpState, id: number): Promise<MessageReply> {
  if (!runner(c, d)) return ephemeral(A.notRunner);
  const a = await auctionById(c.db, c.guild.id, id);
  if (!a || a.status !== 'unsold') return ephemeral(A.notUnsold);
  if (await c.db.prepare('SELECT 1 FROM dkp_auction WHERE from_auction = ?').bind(id).first()) return ephemeral(A.alreadyPosted);
  const r = await createAuction(c, d, { kind: 'general', raidId: null, killId: null, fromAuction: id, itemId: a.item_id, min: a.min_bid, seconds: d.settings.general_auction_hours * 3600 });
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
    if (a?.message_id && budgetLeft(api.budget) > 1) await editIn(api, channelId, a.message_id, await cardFor(db, guild, a));
  }
}

// ---------------------------------------------------------------- routing

const idOf = (id: string, prefix: string) => Number(id.slice(prefix.length));

/** The controls that answer at once (a modal, or a refusal): the drop select, Bid, Cancel auction. */
export async function auctionImmediate(c: Ctx, id: string, values: string[], d: DkpState): Promise<InteractionReply | null> {
  if (id.startsWith(DROP_SELECT_PREFIX)) {
    if (!runner(c, d)) return ephemeral(A.notRunner);
    const itemId = Number(values[0]);
    if (!Number.isInteger(itemId)) return ephemeral(RAID_COPY.noName);
    return dropModal(idOf(id, DROP_SELECT_PREFIX), itemId, d.settings);
  }
  if (id.startsWith(BID_PREFIX)) return bidButton(c, d, idOf(id, BID_PREFIX));
  if (id.startsWith(CANCEL_PREFIX)) return cancelButton(c, d, idOf(id, CANCEL_PREFIX));
  return null;
}

/** The deferred controls and forms: Auction a drop, the forms' submits, Post to general auction. */
export async function auctionComponent(c: Ctx, id: string, components: ModalComponent[] | undefined, d: DkpState): Promise<MessageReply | null> {
  if (id.startsWith(AUCTION_DROP_PREFIX)) return dropButton(c, d, idOf(id, AUCTION_DROP_PREFIX));
  if (id.startsWith(DROP_MODAL_PREFIX)) return dropSubmitted(c, d, id.slice(DROP_MODAL_PREFIX.length), components);
  if (id.startsWith(BID_MODAL_PREFIX)) return bidSubmitted(c, d, idOf(id, BID_MODAL_PREFIX), components);
  if (id.startsWith(CANCEL_MODAL_PREFIX)) return cancelSubmitted(c, d, idOf(id, CANCEL_MODAL_PREFIX), components);
  if (id.startsWith(POST_GENERAL_PREFIX)) return postGeneral(c, d, idOf(id, POST_GENERAL_PREFIX));
  return null;
}

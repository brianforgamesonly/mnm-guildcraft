// Order 27 (ITEM 4): raid nights (docs/PRD.md "DKP add-on", Raid night). One open raid per server (dkp_raid_open). The
// card in GC-DKP is the bot's own message, edited in place by any cause (override 2 of order 9), never more than the pace
// allows (src/dkp/pace.ts, on the guild's timer object); every presser's answer is a new private message, at once.
//
// Costs per press (D1 statements; Discord calls), besides the interaction's own reply:
//   Present / Standby / Leaving: guild, DKP state, the member row (touchMember), the raid, one write batch: 5 D1; 0 Discord
//     (the card edit is a timer item: 1 Durable Object request). Order 34: Present or Standby on a linked raid adds one read,
//     6 D1 (5 when refused: no write). Leaving, and an unlinked raid, add none.
//   Named killed / /dkp kill / Pay attendance: guild, state, raid, respawn (or flat) check, named value, earners, the kill,
//     one pay batch: 8 D1; 0
//     Discord (card edit: a timer item).
//   Kill roll call: guild, state, raid, latest kill, one write: 5 D1; 0 Discord. Who's here / Who earned: 3-4 D1; 0 Discord.
//   Close raid: guild, state, close, card render (1 batch), summary, standings (2 + 1 per pool): about 8 D1; 3 Discord.
//   The card render (timer): 1 batch of 5 statements, 1 Discord edit. Order 34: a linked raid adds 1 batch of 2 statements.
import { audit, dkpSelfConflict, isDkpRunner, now, touchMember } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, memberTag, optInt, optString, plural, row, STYLE_DANGER, STYLE_PRIMARY, STYLE_SECONDARY, STYLE_SUCCESS, truncate, updateMessage, type Embed, type MessageReply, type Option } from '../discord.ts';
import { EVENT_COPY } from '../events/copy.ts';
import { presentVerdict } from '../events/eligible.ts';
import { closedEvent, closeWithRaid, linkedRoster, marked, matchEvents, pickableEvent, tapLink, type EventLink, type Linkable, type LinkedRoster } from '../events/link.ts';
import { loadEvents } from '../events/state.ts';
import { zoneKey } from '../zone/names.ts';
import { AUCTION_DROP_PREFIX } from './auction.ts';
import { AUCTION_COPY, QUEUE_COPY, RAID_COPY } from './copy.ts';
import { zoneCreatures, type Creature } from './creatures.ts';
import { askApproval, type DkpRun } from './commands.ts';
import {
  historySql, payStatement, POOL_GUILD, readdStatement, registerPool, reverseStatement, rosterAddStatement, rosterRemoveStatement, standbyReverseStatement, standbyStatement, type LedgerRow,
} from './ledger.ts';
import { editCard, editCardItem, poolNames, postIn, refreshStandings, type Message } from './messages.ts';
import { markStale } from './stale.ts';
import type { Settings } from './settings.ts';
import type { DkpState } from './state.ts';

export const PRESENT_PREFIX = 'dkpp:';
export const STANDBY_PREFIX = 'dkpsb:';
export const LEAVING_PREFIX = 'dkpl:';
export const NAMED_PREFIX = 'dkpk:';
export const RESPAWN_PREFIX = 'dkprs:';
export const WHO_HERE_PREFIX = 'dkph:';
export const WHO_EARNED_PREFIX = 'dkpw:';
export const CHECK_PREFIX = 'dkpc:';
export const PAY_PREFIX = 'dkpf:';
export const CLOSE_PREFIX = 'dkpx:';
export const HISTORY_PAGE_PREFIX = 'dkphp:';

/** The same named recorded again within this asks the officer to confirm it was a respawn. */
export const RESPAWN_MS = 120_000;
/** The card names members up to this many; beyond it, counts (Who's here answers with the full list). */
export const NAMES_SHOWN = 30;
/** Kill lines on the card: the most recent; the rest are counted. */
export const KILLS_SHOWN = 12;
export const HISTORY_PAGE = 10;
/** Order 29, PR C: Won tonight's lines on the card: the latest (the card's 4,096 characters hold them with the kills). */
export const WON_SHOWN = 15;
const SELECT_MAX = 25;
const CALL_CAP = 8;

interface Raid {
  id: number;
  guild_id: string;
  pool: string;
  mode: 'named' | 'flat';
  message_id: string | null;
  opened_at: string;
  closes_at: string;
  closed_at: string | null;
  close_reason: string | null;
  /** Order 29: 1 when Standby earns the standby value once, at close; 0 for raids opened before (Standby earns each kill). */
  standby_once: number;
  /** Order 34: the event linked when the raid opened (src/events/link.ts). */
  event_id: number | null;
}
const RAID_COLS = 'id, guild_id, pool, mode, message_id, opened_at, closes_at, closed_at, close_reason, standby_once, event_id';
const openRaid = (db: D1Database, guildId: string) => db.prepare(`SELECT ${RAID_COLS} FROM dkp_raid WHERE guild_id = ? AND closed_at IS NULL`).bind(guildId).first<Raid>();
const raidById = (db: D1Database, guildId: string, id: number) => db.prepare(`SELECT ${RAID_COLS} FROM dkp_raid WHERE guild_id = ? AND id = ?`).bind(guildId, id).first<Raid>();
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const link = (guildId: string, channel: string | null, message: string | null) => (channel && message ? `https://discord.com/channels/${guildId}/${channel}/${message}` : null);
const apiFor = (c: Ctx): BotApi | null => (c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap: CALL_CAP, deadline: Date.now() + 10_000 }) : null);
const by = (c: Ctx) => memberTag(c.userId, c.member.nick || c.member.user.global_name || c.member.user.username);
const runner = (c: Ctx, d: DkpState) => isDkpRunner(c.guild, d.settings.runner_role, c.member);
/** A card edit, through the guild's timer object (coalesced to the pace Discord's answers allow). */
const rerender = (c: Ctx, raidId: number) => {
  const items = [...(c.effects.dkpTimers?.items ?? []), { key: `render:${raidId}`, due: Date.now() }];
  c.effects.dkpTimers = { guildId: c.guild.id, items };
};

// ---------------------------------------------------------------- the card

/** A member on a kill's roster (order 29: dkp_kill_member). state null: recorded before order 29 (unknown; they earned it). */
export interface AtKill {
  member_id: string;
  name: string;
  state: 'present' | 'standby' | null;
}
interface CardData {
  raid: Raid;
  zone: string;
  people: { member_id: string; name: string; state: string; status: string }[];
  kills: { id: number; name: string | null; points: number; at: string; check_due: string | null; check_closed_at: string | null }[];
  /** Who was at each kill, from its roster (never from the ledger). */
  earned: Map<number, AtKill[]>;
  creatures: Creature[];
  /** Order 29, PR C: Won tonight (the raid's sold auctions, in order), and the drops still queued. */
  won: { item: string; winner: string; name: string; price: number }[];
  queued: number;
  /** Order 34: the linked event and its roster, read each time the card is drawn. Null: no link. */
  link: LinkedRoster | null;
}

/** Whether a member on a kill's roster earned that kill's points (order 29: Standby earns once, at close, instead). */
export const earnedKill = (raid: Pick<Raid, 'standby_once'>, a: Pick<AtKill, 'state'>) => !(raid.standby_once === 1 && a.state === 'standby');

async function cardData(db: D1Database, raid: Raid): Promise<CardData> {
  const [zone, people, kills, earned, won] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT name FROM zone WHERE key = ?').bind(raid.pool),
    db
      .prepare(
        `SELECT a.member_id, coalesce(m.display_name, a.member_id) AS name, a.state, coalesce(m.status, 'active') AS status FROM dkp_attendance a
         LEFT JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = a.member_id WHERE a.raid_id = ?2 ORDER BY lower(name)`,
      )
      .bind(raid.guild_id, raid.id),
    db.prepare('SELECT id, name, points, at, check_due, check_closed_at FROM dkp_kill WHERE raid_id = ? ORDER BY id').bind(raid.id),
    // Order 29: who was at each kill, from its roster (corrections and Kill roll call keep it current), never the ledger.
    db
      .prepare(
        `SELECT km.kill_id, km.member_id, coalesce(m.display_name, km.member_id) AS name, km.state FROM dkp_kill_member km JOIN dkp_kill k ON k.id = km.kill_id
         LEFT JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = km.member_id
         WHERE k.raid_id = ?2 ORDER BY lower(name)`,
      )
      .bind(raid.guild_id, raid.id),
    // Order 29, PR C: the raid's auctions (dkp_auction_by_raid): Won tonight, and how many wait in the queue.
    db
      .prepare(
        `SELECT a.status, i.name AS item, a.winner, coalesce(m.display_name, a.winner) AS name, a.price FROM dkp_auction a JOIN item i ON i.id = a.item_id
         LEFT JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = a.winner WHERE a.raid_id = ?2 AND a.status IN ('sold', 'queued') ORDER BY a.closed_at, a.id`,
      )
      .bind(raid.guild_id, raid.id),
  ]);
  const auctions = won.results as { status: string; item: string; winner: string; name: string; price: number }[];
  const byKill = new Map<number, AtKill[]>();
  for (const r of earned.results as unknown as (AtKill & { kill_id: number })[]) byKill.set(r.kill_id, [...(byKill.get(r.kill_id) ?? []), { member_id: r.member_id, name: r.name, state: r.state }]);
  return {
    raid,
    zone: (zone.results[0] as { name?: string } | undefined)?.name ?? raid.pool,
    people: people.results as CardData['people'],
    kills: kills.results as CardData['kills'],
    earned: byKill,
    won: auctions.filter((a) => a.status === 'sold'),
    queued: auctions.filter((a) => a.status === 'queued').length,
    creatures: raid.mode === 'named' && !raid.closed_at ? (await zoneCreatures(db, raid.pool)).slice(0, SELECT_MAX) : [],
    link: raid.event_id ? await linkedRoster(db, raid.guild_id, raid.event_id) : null,
  };
}

/** The card's Event line, or null with no link. The link goes to the event card when it has one. */
function eventLine(l: EventLink, guildId: string): string {
  if (l.cancelled) return RAID_COPY.eventCancelled(l.title);
  return RAID_COPY.eventLine(l.title, link(guildId, l.channel_id, l.message_id));
}

/**
 * One kill's line: time, named, points, how many earned (order 29: and how many were on Standby, who earn once at close),
 * changes against the kill before it (who was at it), Kill roll call's state.
 */
export function killLine(k: CardData['kills'][number], at: AtKill[], before: AtKill[] | null, raid: Pick<Raid, 'standby_once'> = { standby_once: 0 }): string {
  const ids = new Set(at.map((e) => e.member_id));
  const was = new Set((before ?? []).map((e) => e.member_id));
  const diff = before
    ? [...at.filter((e) => !was.has(e.member_id)).map((e) => `+${md(e.name)}`), ...(before ?? []).filter((e) => !ids.has(e.member_id)).map((e) => `−${md(e.name)}`)]
    : [];
  const earned = at.filter((e) => earnedKill(raid, e)).length;
  const standby = at.length - earned;
  const check = k.check_due
    ? k.check_closed_at
      ? RAID_COPY.checkClosed(unix(k.check_closed_at), unix(k.check_due))
      : RAID_COPY.checkOpen(unix(k.check_due))
    : '';
  return truncate(
    `<t:${unix(k.at)}:T> **${md(k.name ?? RAID_COPY.flatName)}** · ${k.points} pts · ${plural(earned, 'earned', 'earned')}${standby ? ` · ${RAID_COPY.onStandby(standby)}` : ''}${diff.length ? ` · ${truncate(diff.join(' '), 300)}` : ''}${check}`,
    1000,
  );
}

export function cardMessage(d: CardData, guildId: string): Message {
  const { raid } = d;
  const here = d.people.filter((p) => p.state === 'present');
  const standby = d.people.filter((p) => p.state === 'standby');
  const names = (list: CardData['people']) =>
    list.length > NAMES_SHOWN ? RAID_COPY.counted(list.length) : list.map((p) => `${md(p.name)}${p.status === 'left' ? RAID_COPY.frozen : ''}${marked(d.link, p.member_id) ? RAID_COPY.notSignedUp : ''}`).join(', ') || RAID_COPY.nobody;
  // Order 34: the event's Bench, until they tap for themselves. They earn nothing from this line.
  const tapped = new Set(d.people.filter((p) => p.state !== 'absent').map((p) => p.member_id));
  const bench = d.link && !d.link.link.cancelled && !raid.closed_at ? d.link.bench.filter((b) => !tapped.has(b.member_id)) : [];
  const shown = d.kills.slice(-KILLS_SHOWN);
  const lines = shown.map((k) => {
    const i = d.kills.indexOf(k);
    return killLine(k, d.earned.get(k.id) ?? [], i > 0 ? (d.earned.get(d.kills[i - 1].id) ?? []) : null, raid);
  });
  // Order 29 (ITEM 2): a closed card no longer tells an officer to pick Named killed below.
  const none = raid.closed_at ? (raid.mode === 'named' ? RAID_COPY.noKillsClosed : RAID_COPY.noPayoutsClosed) : raid.mode === 'named' ? RAID_COPY.noKills : RAID_COPY.noPayouts;
  const embed: Embed = {
    title: truncate(RAID_COPY.title(d.zone, raid.mode), 256),
    description: truncate(
      [
        raid.closed_at ? RAID_COPY.closedAt(unix(raid.closed_at), raid.close_reason) : RAID_COPY.openUntil(unix(raid.closes_at)),
        ...(d.link ? [eventLine(d.link.link, raid.guild_id)] : []),
        '',
        `**${RAID_COPY.present}** (${here.length}): ${names(here)}`,
        `**${RAID_COPY.standby}** (${standby.length}): ${names(standby)}`,
        ...(bench.length ? [RAID_COPY.benchLine(bench.length > NAMES_SHOWN ? RAID_COPY.counted(bench.length) : bench.map((b) => md(b.name)).join(', '))] : []),
        '',
        ...(d.kills.length > shown.length ? [RAID_COPY.earlier(d.kills.length - shown.length)] : []),
        ...(lines.length ? lines : [none]),
        // Order 29, PR C: Won tonight (item, winner, price), members shown, nobody pinged; and the queue's length.
        ...(d.won.length ? ['', QUEUE_COPY.wonTonight, ...d.won.slice(-WON_SHOWN).map((w) => QUEUE_COPY.wonLine(w.item, memberTag(w.winner, w.name), w.price))] : []),
        ...(d.queued && !raid.closed_at ? [QUEUE_COPY.upNext(d.queued)] : []),
        ...(raid.mode === 'named' && !raid.closed_at && !d.creatures.length ? ['', RAID_COPY.noCreatures] : []),
      ].join('\n'),
      4096,
    ),
  };
  if (raid.closed_at) return { embeds: [embed], components: [] };
  const id = raid.id;
  const rows: unknown[] = [
    row([button(`${PRESENT_PREFIX}${id}`, RAID_COPY.present, STYLE_SUCCESS), button(`${STANDBY_PREFIX}${id}`, RAID_COPY.standby, STYLE_PRIMARY), button(`${LEAVING_PREFIX}${id}`, RAID_COPY.leaving, STYLE_SECONDARY)]),
    row([
      button(`${WHO_HERE_PREFIX}${id}`, RAID_COPY.whoHere),
      button(`${WHO_EARNED_PREFIX}${id}`, RAID_COPY.whoEarned, STYLE_SECONDARY, !d.kills.length),
      button(`${CHECK_PREFIX}${id}`, RAID_COPY.checkAgain, STYLE_SECONDARY, !d.kills.length),
      // Order 29: Auction a drop (the latest kill's known loot); flat mode has no named, so no loot.
      ...(raid.mode === 'flat' ? [button(`${PAY_PREFIX}${id}`, RAID_COPY.payAttendance, STYLE_PRIMARY)] : [button(`${AUCTION_DROP_PREFIX}${id}`, AUCTION_COPY.auctionDrop, STYLE_SECONDARY, !d.kills.length)]),
      button(`${CLOSE_PREFIX}${id}`, RAID_COPY.close, STYLE_DANGER),
    ]),
  ];
  if (d.creatures.length)
    rows.push(row([{ type: 3, custom_id: `${NAMED_PREFIX}${id}`, placeholder: RAID_COPY.namedKilled, options: d.creatures.map((c) => ({ label: truncate(c.name, 100), value: truncate(c.name, 100), description: RAID_COPY.creaturePart[c.part] })) }]));
  void guildId;
  return { embeds: [embed], components: rows };
}

/** render:<raid id> on the timer object. Returns Discord's rate-limit headers, for the pace of the next edit. */
export async function renderCard(db: D1Database, api: BotApi, guildId: string, channelId: string, raidId: number): Promise<{ remaining?: string | null; resetAfter?: string | null; retryAfter?: number | null } | null> {
  const raid = await raidById(db, guildId, raidId);
  if (!raid?.message_id) return null;
  return editCardItem(db, api, guildId, `render:${raidId}`, channelId, raid.message_id, cardMessage(await cardData(db, raid), guildId));
}

// ---------------------------------------------------------------- /dkp raid, /dkp kill, /dkp correct, /dkp history

/**
 * Order 34: which event a new raid links to. The event: option overrides the match; a refusal opens nothing. With the Events
 * module off, the raid opens exactly as before. Otherwise `note` tells the officer what happened: the link can't be set later.
 */
async function pickLink(c: Ctx, opts: Option[], zone: string, nowMs: number): Promise<{ refusal: string } | { event: Linkable | null; note: string | null }> {
  const typed = optString(opts, 'event');
  if (!(await loadEvents(c.db, c.guild.id)).enabled) return typed === undefined ? { event: null, note: null } : { refusal: EVENT_COPY.off };
  const linked = (e: Linkable) => ({ event: e, note: RAID_COPY.linked(e.title, Math.floor(Date.parse(e.start_at) / 1000)) });
  if (typed !== undefined) {
    const id = Number(typed);
    const e = Number.isInteger(id) && id > 0 ? await pickableEvent(c.db, c.guild.id, id) : null;
    return e ? linked(e) : { refusal: RAID_COPY.notLinkable };
  }
  const fits = await matchEvents(c.db, c.guild.id, zone, nowMs);
  if (fits.length === 1) return linked(fits[0]);
  return { event: null, note: fits.length ? RAID_COPY.notLinkedSeveral(fits.length) : RAID_COPY.notLinkedNone };
}

export const raidCommand: DkpRun = async (c, opts, d) => {
  const typed = optString(opts, 'zone') ?? '';
  const zone = await c.db.prepare('SELECT key, name FROM zone WHERE key = ? AND active = 1').bind(zoneKey(typed.trim())).first<{ key: string; name: string }>();
  if (!zone) return ephemeral(RAID_COPY.unknownZone(truncate(typed, 100)));
  const mode = optString(opts, 'mode') === 'flat' ? 'flat' : 'named';
  const open = await openRaid(c.db, c.guild.id);
  if (open) return ephemeral(RAID_COPY.alreadyOpen(link(c.guild.id, d.channel_id, open.message_id)));
  // No card, no raid (review of PR B): a raid that cannot be posted could never be closed.
  const api = apiFor(c);
  if (!api || !d.channel_id) return ephemeral(RAID_COPY.cannotPost);
  const at = now();
  const picked = await pickLink(c, opts, zone.key, Date.parse(at));
  if ('refusal' in picked) return ephemeral(picked.refusal);
  const closes = new Date(Date.parse(at) + d.settings.auto_close_hours * 3_600_000).toISOString();
  let raid: Raid | null;
  try {
    raid = await c.db
      // Order 29 (override 2): raids opened from now on pay Standby once, at close.
      .prepare(`INSERT INTO dkp_raid (guild_id, pool, mode, opened_by, opened_at, closes_at, standby_once, event_id) VALUES (?, ?, ?, ?, ?, ?, 1, ?) RETURNING ${RAID_COLS}`)
      .bind(c.guild.id, zone.key, mode, c.userId, at, closes, picked.event?.id ?? null)
      .first<Raid>();
  } catch {
    // Two openings at once: the unique index lets one through.
    const won = await openRaid(c.db, c.guild.id);
    return ephemeral(RAID_COPY.alreadyOpen(link(c.guild.id, d.channel_id, won?.message_id ?? null)));
  }
  await c.db.batch([registerPool(c.db, c.guild.id, zone.key, at), registerPool(c.db, c.guild.id, POOL_GUILD, at), audit(c.db, c.guild.id, c.userId, 'dkp.raid.open', `raid:${raid!.id}`, null, { pool: zone.key, mode, ...(picked.event ? { event: picked.event.id } : {}) })]);
  try {
    // A pool's first raid: its standings message first, so it sits above the card.
    await refreshStandings(c.db, api, c.guild.id, d.channel_id, [zone.key]);
    const id = await postIn(api, d.channel_id, cardMessage(await cardData(c.db, raid!), c.guild.id));
    if (!id) {
      // The card was refused: the raid closes at once, so the next /dkp raid is not refused as "already open". Order 34: a
      // raid nobody saw never held its event, which the next /dkp raid can link.
      await c.db.prepare("UPDATE dkp_raid SET closed_at = ?1, closed_by = 'bot', close_reason = 'officer', event_id = NULL WHERE id = ?2 AND closed_at IS NULL").bind(now(), raid!.id).run();
      return ephemeral(RAID_COPY.cannotPost);
    }
    await c.db.prepare('UPDATE dkp_raid SET message_id = ? WHERE id = ?').bind(id, raid!.id).run();
    c.effects.dkpTimers = { guildId: c.guild.id, items: [{ key: `close:${raid!.id}`, due: Date.parse(closes) }] };
    return ephemeral([RAID_COPY.opened(zone.name, link(c.guild.id, d.channel_id, id)), picked.note].filter(Boolean).join('\n'));
  } finally {
    c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
  }
};

/**
 * Records a kill (or, name null, a flat payout) in the open raid: everyone Present or Standby, not frozen, now, goes on its
 * roster (order 29), in the same batch as its ledger rows. Present earns the kill; Standby earns it too only in a raid
 * opened before order 29 (standby_once 0); otherwise Standby earns the standby value once, at close.
 */
async function recordKill(c: Ctx, d: DkpState, raid: Raid, name: string | null, confirmed: boolean): Promise<MessageReply> {
  const at = now();
  if (name !== null && !confirmed) {
    const prev = await c.db
      .prepare('SELECT id FROM dkp_kill WHERE raid_id = ? AND lower(name) = lower(?) AND at >= ? ORDER BY id DESC LIMIT 1')
      .bind(raid.id, name, new Date(Date.parse(at) - RESPAWN_MS).toISOString())
      .first<{ id: number }>();
    if (prev) return ephemeral(RAID_COPY.respawnAsk(name), { components: [row([button(`${RESPAWN_PREFIX}${prev.id}`, RAID_COPY.respawnYes, STYLE_PRIMARY)])] });
  }
  // Flat mode pays once (review of PR B): Pay attendance pressed again pays nothing.
  if (name === null && (await c.db.prepare('SELECT 1 FROM dkp_kill WHERE raid_id = ? AND name IS NULL').bind(raid.id).first())) return ephemeral(RAID_COPY.flatPaid);
  const s = d.settings;
  const points =
    name === null
      ? s.flat_points
      : ((await c.db.prepare('SELECT points FROM dkp_named_value WHERE guild_id = ? AND zone_key = ? AND name = ?').bind(c.guild.id, raid.pool, name).first<{ points: number }>())?.points ?? s.kill_points);
  const { results } = await c.db
    .prepare(
      `SELECT a.member_id, a.state FROM dkp_attendance a JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = a.member_id
       WHERE a.raid_id = ?2 AND a.state IN ('present', 'standby') AND m.status = 'active'`,
    )
    .bind(c.guild.id, raid.id)
    .all<{ member_id: string; state: 'present' | 'standby' }>();
  const earners = results.filter((r) => earnedKill(raid, r)).map((r) => r.member_id);
  const standby = results.length - earners.length;
  // Only into a raid still open (review of PR B: a press racing Close records nothing).
  const kill = await c.db
    .prepare('INSERT INTO dkp_kill (raid_id, name, points, guild_points, at, by) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM dkp_raid WHERE id = ?1 AND closed_at IS NULL) RETURNING id')
    .bind(raid.id, name, points, s.guild_points, at, c.userId)
    .first<{ id: number }>();
  if (!kill) return ephemeral(RAID_COPY.raidClosed);
  const kind = name === null ? 'flat' : 'kill';
  if (results.length)
    await c.db.batch([
      rosterAddStatement(c.db, kill!.id, results),
      // Review of PR A: a Close that slipped in between the kill and this batch paid Standby without this kill; paid here
      // (nothing while the raid is open, and never twice).
      ...standbyPayouts(c.db, c.guild.id, raid, s, at),
      ...(earners.length
        ? [
            payStatement(c.db, { guildId: c.guild.id, pool: raid.pool, members: earners, asked: points, cap: s.cap, kind, raidId: raid.id, killId: kill!.id, actor: 'bot', at }),
            payStatement(c.db, { guildId: c.guild.id, pool: POOL_GUILD, members: earners, asked: s.guild_points, cap: s.cap, kind, raidId: raid.id, killId: kill!.id, actor: 'bot', at }),
          ]
        : []),
    ]);
  rerender(c, raid.id);
  const reply = name === null ? RAID_COPY.paid(points, earners.length) : RAID_COPY.killed(name, points, earners.length);
  return ephemeral(standby ? `${reply} ${RAID_COPY.standbyLater(standby)}` : reply);
}

export const killCommand: DkpRun = async (c, opts, d) => {
  const raid = await openRaid(c.db, c.guild.id);
  if (!raid) return ephemeral(RAID_COPY.noOpenRaid);
  if (raid.mode === 'flat') return ephemeral(RAID_COPY.flatNoKills);
  const name = (optString(opts, 'named') ?? '').trim().slice(0, 100);
  if (!name) return ephemeral(RAID_COPY.noName);
  return recordKill(c, d, raid, name, false);
};

/** The kills a correction covers: one (kill:, its id) or the whole of the open raid, else the latest closed one. */
async function correctionScope(c: Ctx, killId: number | undefined) {
  const raid = await c.db.prepare(`SELECT ${RAID_COLS} FROM dkp_raid WHERE guild_id = ? ORDER BY closed_at IS NULL DESC, id DESC LIMIT 1`).bind(c.guild.id).first<Raid>();
  if (!raid) return null;
  const { results } = await c.db
    .prepare('SELECT id, points, guild_points FROM dkp_kill WHERE raid_id = ? AND (?2 IS NULL OR id = ?2) ORDER BY id')
    .bind(raid.id, killId ?? null)
    .all<{ id: number; points: number; guild_points: number }>();
  return { raid, kills: results };
}

/**
 * A correction's statements (order 29: who was at a kill is its roster, never the ledger): removal takes the member off
 * each kill they are on and reverses what it paid; an add puts them on each kill they are not on (as Present) and re-pays
 * it, capped against the cap now. After close, a removal that leaves no Standby kill reverses the standby payout. Once-only
 * by their own conditions, so an approval batches them with its status change (each is gated on that approval).
 */
export async function correctionStatements(db: D1Database, guildId: string, cap: number, k: { member: string; action: 'add' | 'remove'; raidId: number; killId: number | null; reason: string; actor: string; at: string; approvedPending?: number }) {
  const [{ results: kills }, { results: on }] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT id, points, guild_points FROM dkp_kill WHERE raid_id = ? AND (?2 IS NULL OR id = ?2) ORDER BY id').bind(k.raidId, k.killId),
    db.prepare('SELECT km.kill_id FROM dkp_kill_member km JOIN dkp_kill kk ON kk.id = km.kill_id WHERE kk.raid_id = ? AND km.member_id = ?').bind(k.raidId, k.member),
  ]);
  const raid = await db.prepare('SELECT pool, standby_once FROM dkp_raid WHERE id = ?').bind(k.raidId).first<{ pool: string; standby_once: number }>();
  const onKill = new Set((on as { kill_id: number }[]).map((r) => r.kill_id));
  const at = k.at;
  const gate = k.approvedPending !== undefined ? { id: k.approvedPending, actor: k.actor, at } : undefined;
  const out: D1PreparedStatement[] = [];
  for (const kill of kills as { id: number; points: number; guild_points: number }[]) {
    const pools: [string, number][] = [
      [raid!.pool, kill.points],
      [POOL_GUILD, kill.guild_points],
    ];
    if (k.action === 'remove' && onKill.has(kill.id))
      out.push(
        ...pools.map(([pool]) => reverseStatement(db, { guildId, pool, killId: kill.id, members: [k.member], reason: k.reason, actor: k.actor, at, approvedPending: k.approvedPending })),
        rosterRemoveStatement(db, kill.id, [k.member], gate),
      );
    else if (k.action === 'add' && !onKill.has(kill.id))
      out.push(
        ...pools.map(([pool, asked]) => readdStatement(db, { guildId, pool, killId: kill.id, asked, cap, members: [k.member], reason: k.reason, actor: k.actor, at, approvedPending: k.approvedPending })),
        rosterAddStatement(db, kill.id, [{ member_id: k.member, state: 'present' }], gate),
      );
  }
  if (k.action === 'remove' && raid!.standby_once)
    for (const pool of [raid!.pool, POOL_GUILD]) out.push(standbyReverseStatement(db, { guildId, pool, raidId: k.raidId, members: [k.member], reason: k.reason, actor: k.actor, at, approvedPending: k.approvedPending }));
  return out;
}

/** Order 34: who was at a closed linked raid changed, so its event card's no-shows are drawn again. One statement. */
export async function redrawNoShows(c: Ctx, raidId: number): Promise<void> {
  const r = await c.db.prepare("SELECT r.event_id FROM dkp_raid r JOIN event e ON e.id = r.event_id WHERE r.id = ? AND r.closed_at IS NOT NULL AND e.status = 'closed'").bind(raidId).first<{ event_id: number }>();
  if (!r) return;
  // Flagged too: with the Events module off this item does nothing, and the sweep draws the card once it's back.
  await markStale(c.db, c.guild.id, `evcard:${r.event_id}`, { status: 0 }).run();
  c.effects.dkpTimers = { guildId: c.guild.id, items: [...(c.effects.dkpTimers?.items ?? []), { key: `evcard:${r.event_id}`, due: Date.now() }] };
}

export const correctCommand: DkpRun = async (c, opts, d) => {
  const member = optString(opts, 'member') ?? '';
  const action = optString(opts, 'action') === 'add' ? 'add' : 'remove';
  const reason = (optString(opts, 'reason') ?? '').trim();
  if (dkpSelfConflict(c.userId, { member })) return ephemeral(RAID_COPY.own);
  if (!reason) return ephemeral(RAID_COPY.reason);
  const scope = await correctionScope(c, optInt(opts, 'kill'));
  if (!scope?.kills.length) return ephemeral(RAID_COPY.noKill);
  const total = scope.kills.reduce((n, k) => n + k.points + k.guild_points, 0);
  const killId = optInt(opts, 'kill') ?? null;
  if (total > d.settings.second_officer_over) {
    const name = (await c.db.prepare('SELECT display_name FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, member).first<{ display_name: string }>())?.display_name ?? member;
    const names = await poolNames(c.db, [scope.raid.pool]);
    return askApproval(c, d, apiFor(c), {
      member, name, pool: { key: scope.raid.pool, name: names.get(scope.raid.pool)! }, points: action === 'add' ? total : -total, reason, at: now(),
      correction: { action, raidId: scope.raid.id, killId },
    });
  }
  const statements = await correctionStatements(c.db, c.guild.id, d.settings.cap, { member, action, raidId: scope.raid.id, killId, reason, actor: c.userId, at: now() });
  const done = await c.db.batch([...statements, audit(c.db, c.guild.id, c.userId, `dkp.correct.${action}`, `member:${member}`, null, { raid: scope.raid.id, kill: killId })]);
  // Review of PR A: a correction that changes nothing (added where they already are, Standby included; removed where they
  // are not) says so, and posts nothing.
  if (!done.slice(0, statements.length).some((r) => (r.meta.changes ?? 0) > 0)) return ephemeral(RAID_COPY.nothingCorrected(action));
  const api = apiFor(c);
  try {
    if (api && d.channel_id) {
      await postIn(api, d.channel_id, { content: RAID_COPY.corrected(memberTag(member, member), action, scope.kills.length, by(c), reason) });
      await refreshStandings(c.db, api, c.guild.id, d.channel_id, [scope.raid.pool, POOL_GUILD]);
    }
  } finally {
    if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
  }
  rerender(c, scope.raid.id);
  await redrawNoShows(c, scope.raid.id);
  return ephemeral(RAID_COPY.correctedReply);
};

export const historyCommand: DkpRun = async (c, opts) => {
  const member = optString(opts, 'member') ?? c.userId;
  const typed = optString(opts, 'pool') ?? POOL_GUILD;
  const pool = typed === POOL_GUILD ? POOL_GUILD : zoneKey(typed.trim());
  return ephemeral('', await historyPage(c, member, pool, 0));
};

async function historyPage(c: Ctx, member: string, pool: string, page: number): Promise<{ embeds: Embed[]; components: unknown[] }> {
  const [{ results }, names] = await Promise.all([
    c.db.prepare(historySql).bind(c.guild.id, pool, member, HISTORY_PAGE + 1, page * HISTORY_PAGE).all<LedgerRow & { kill_name: string | null }>(),
    poolNames(c.db, [pool]),
  ]);
  const more = results.length > HISTORY_PAGE;
  const lines = results.slice(0, HISTORY_PAGE).map((r) => RAID_COPY.historyLine(unix(r.at), r.amount, r.cut, r.balance_after, r.kind, r.kill_name, r.reason));
  const id = (p: number) => `${HISTORY_PAGE_PREFIX}${member}:${p}:${pool}`.slice(0, 100);
  return {
    embeds: [{ title: truncate(RAID_COPY.historyTitle(names.get(pool)!), 256), description: [memberTag(member, member), '', ...(lines.length ? lines : [RAID_COPY.noHistory])].join('\n') }],
    components: page > 0 || more ? [row([button(id(page - 1), RAID_COPY.previous, STYLE_SECONDARY, page === 0), button(id(page + 1), RAID_COPY.next, STYLE_SECONDARY, !more)])] : [],
  };
}

// ---------------------------------------------------------------- the card's controls

/** Every raid control (prefix dkpp:, dkpsb:, … ; DKP is on: src/interactions.ts checked). */
export async function raidComponent(c: Ctx, id: string, values: string[], d: DkpState): Promise<MessageReply | null> {
  const [prefix, rest] = [id.slice(0, id.indexOf(':') + 1), id.slice(id.indexOf(':') + 1)];
  if (prefix === HISTORY_PAGE_PREFIX) {
    const [member, page, ...pool] = rest.split(':');
    return updateMessage(await historyPage(c, member, pool.join(':'), Math.max(0, Number(page) || 0)));
  }
  if (prefix === RESPAWN_PREFIX) {
    if (!runner(c, d)) return ephemeral(RAID_COPY.notRunner);
    const prev = await c.db.prepare('SELECT k.name, k.raid_id FROM dkp_kill k JOIN dkp_raid r ON r.id = k.raid_id WHERE k.id = ? AND r.guild_id = ?').bind(Number(rest), c.guild.id).first<{ name: string; raid_id: number }>();
    const raid = prev ? await raidById(c.db, c.guild.id, prev.raid_id) : null;
    if (!raid || raid.closed_at) return ephemeral(RAID_COPY.raidClosed);
    // Once per question (review of PR B): a later kill of the same named means this confirm was already used; the answer
    // replaces the question, so its button is gone.
    const again = await c.db.prepare('SELECT 1 FROM dkp_kill WHERE raid_id = ? AND lower(name) = lower(?) AND id > ?').bind(raid.id, prev!.name, Number(rest)).first();
    if (again) return updateMessage({ content: RAID_COPY.respawnDone, components: [] });
    const r = await recordKill(c, d, raid, prev!.name, true);
    return updateMessage({ content: r.data.content, components: [] });
  }
  const raid = await raidById(c.db, c.guild.id, Number(rest));
  if (!raid) return null;
  if (raid.closed_at && prefix !== WHO_EARNED_PREFIX && prefix !== WHO_HERE_PREFIX) return ephemeral(RAID_COPY.raidClosed);
  switch (prefix) {
    case PRESENT_PREFIX:
    case STANDBY_PREFIX:
    case LEAVING_PREFIX:
      return tap(c, raid, prefix === PRESENT_PREFIX ? 'present' : prefix === STANDBY_PREFIX ? 'standby' : 'absent');
    case WHO_HERE_PREFIX: {
      const data = await cardData(c.db, raid);
      const list = (state: string) => data.people.filter((p) => p.state === state).map((p) => `${memberTag(p.member_id, p.name)}${marked(data.link, p.member_id) ? RAID_COPY.notSignedUp : ''}`).join(', ') || RAID_COPY.nobody;
      return ephemeral(truncate(`**${RAID_COPY.present}:** ${list('present')}\n**${RAID_COPY.standby}:** ${list('standby')}`, 2000));
    }
    case WHO_EARNED_PREFIX: {
      const data = await cardData(c.db, raid);
      const k = data.kills.at(-1);
      if (!k) return ephemeral(RAID_COPY.noKill);
      const at = data.earned.get(k.id) ?? [];
      const earned = at.filter((e) => earnedKill(raid, e));
      const standby = at.filter((e) => !earnedKill(raid, e));
      const tags = (list: AtKill[]) => list.map((e) => memberTag(e.member_id, e.name)).join(', ');
      return ephemeral(
        truncate(
          [`${RAID_COPY.earnedHead(k.name ?? RAID_COPY.flatName, earned.length)}`, tags(earned), ...(standby.length ? [RAID_COPY.standbyHead(standby.length), tags(standby)] : [])].filter(Boolean).join('\n'),
          2000,
        ),
      );
    }
  }
  if (!runner(c, d)) return ephemeral(RAID_COPY.notRunner);
  switch (prefix) {
    case NAMED_PREFIX:
      if (!values[0]) return ephemeral(RAID_COPY.noName);
      return recordKill(c, d, raid, values[0], false);
    case PAY_PREFIX:
      return recordKill(c, d, raid, null, false);
    case CHECK_PREFIX: {
      const due = Date.now() + d.settings.check_seconds * 1000;
      const k = await c.db
        .prepare('UPDATE dkp_kill SET check_due = ?1, check_by = ?2 WHERE id = (SELECT max(id) FROM dkp_kill WHERE raid_id = ?3) AND check_due IS NULL RETURNING id, name')
        .bind(new Date(due).toISOString(), c.userId, raid.id)
        .first<{ id: number; name: string | null }>();
      if (!k) return ephemeral(RAID_COPY.checkAlready);
      c.effects.dkpTimers = { guildId: c.guild.id, items: [{ key: `check:${k.id}`, due }] };
      rerender(c, raid.id);
      return ephemeral(RAID_COPY.checkStarted(k.name ?? RAID_COPY.flatName, d.settings.check_seconds));
    }
    case CLOSE_PREFIX: {
      const api = apiFor(c);
      try {
        const closed = await closeRaid(c.db, api, c.guild.id, d.channel_id, raid.id, c.userId, 'officer', Date.now(), d.settings);
        if (closed?.eventId) c.effects.dkpTimers = { guildId: c.guild.id, items: [...(c.effects.dkpTimers?.items ?? []), { key: `evcard:${closed.eventId}`, due: Date.now() }] };
        return ephemeral(closed ? RAID_COPY.closedReply : RAID_COPY.raidClosed);
      } finally {
        if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
      }
    }
  }
  return null;
}

/** Present, Standby or Leaving: the member's state from now on (and, inside an open Kill roll call, keeping a kill). */
async function tap(c: Ctx, raid: Raid, state: 'present' | 'standby' | 'absent'): Promise<MessageReply> {
  // A raid button refreshes the member's row as a command does (a frozen member thaws).
  await touchMember(c.db, c.guild.id, c.member);
  // Order 34: the Present check, read fresh at each tap. An unlinked raid, and Leaving, read nothing more.
  const link = raid.event_id && state !== 'absent' ? await tapLink(c.db, c.guild.id, raid.event_id, c.userId) : null;
  const verdict = link ? presentVerdict({ check: link.check, status: link.signup, eventOpen: link.status === 'open', leaving: false }) : 'ok';
  if (verdict === 'refused') return ephemeral(RAID_COPY.tapRefused(link!.title));
  const at = now();
  await c.db.batch([
    c.db
      .prepare(
        `INSERT INTO dkp_attendance (raid_id, member_id, state, since, set_by) VALUES (?1, ?2, ?3, ?4, ?2)
         ON CONFLICT (raid_id, member_id) DO UPDATE SET state = ?3, since = ?4, set_by = ?2 WHERE state <> ?3`,
      )
      .bind(raid.id, c.userId, state, at),
    // Inside a kill's Kill roll call window, Present (or Standby) keeps the kill for a member it credited.
    c.db
      .prepare(
        `INSERT INTO dkp_recheck (kill_id, member_id, at) SELECT id, ?2, ?3 FROM dkp_kill WHERE raid_id = ?1 AND ?4 <> 'absent'
           AND check_due IS NOT NULL AND check_closed_at IS NULL AND check_due > ?3 ON CONFLICT DO NOTHING`,
      )
      .bind(raid.id, c.userId, at, state),
  ]);
  rerender(c, raid.id);
  const reply = state === 'present' ? RAID_COPY.youPresent : state === 'standby' ? (raid.standby_once ? RAID_COPY.youStandby : RAID_COPY.youStandbyEach) : RAID_COPY.youLeft;
  return ephemeral(verdict === 'flag' ? `${reply}\n${RAID_COPY.tapFlagged(link!.title)}` : reply);
}

// ---------------------------------------------------------------- timers (src/dkp/due.ts)

/** check:<kill id>: members credited on the kill who did not tap again lose it, and are absent from now on. Idempotent. */
export async function closeCheck(db: D1Database, guildId: string, killId: number, nowMs: number): Promise<{ again: number } | { raidId: number; closedEvent: number | null } | null> {
  const k = await db
    .prepare('SELECT k.raid_id, r.pool, r.standby_once, r.closed_at, r.event_id, k.check_due FROM dkp_kill k JOIN dkp_raid r ON r.id = k.raid_id WHERE k.id = ? AND r.guild_id = ? AND k.check_closed_at IS NULL AND k.check_due IS NOT NULL')
    .bind(killId, guildId)
    .first<{ raid_id: number; pool: string; standby_once: number; closed_at: string | null; event_id: number | null; check_due: string }>();
  if (!k) return null;
  if (Date.parse(k.check_due) > nowMs) return { again: Date.parse(k.check_due) };
  // Order 29: who was at the kill is its roster, never the ledger.
  const { results } = await db
    .prepare('SELECT member_id FROM dkp_kill_member WHERE kill_id = ?1 EXCEPT SELECT member_id FROM dkp_recheck WHERE kill_id = ?1')
    .bind(killId)
    .all<{ member_id: string }>();
  const losers = results.map((r) => r.member_id);
  const at = new Date(nowMs).toISOString();
  await db.batch([
    db.prepare('UPDATE dkp_kill SET check_closed_at = ? WHERE id = ? AND check_closed_at IS NULL').bind(at, killId),
    ...(losers.length
      ? [
          reverseStatement(db, { guildId, pool: k.pool, killId, members: losers, reason: RAID_COPY.checkReason, actor: 'bot', at }),
          reverseStatement(db, { guildId, pool: POOL_GUILD, killId, members: losers, reason: RAID_COPY.checkReason, actor: 'bot', at }),
          rosterRemoveStatement(db, killId, losers),
          db
            .prepare("UPDATE dkp_attendance SET state = 'absent', since = ?1, set_by = 'bot' WHERE raid_id = ?2 AND member_id IN (SELECT value FROM json_each(?3)) AND state <> 'absent' AND since <= ?4")
            .bind(at, k.raid_id, JSON.stringify(losers), k.check_due),
          // A window that closes after the raid did: a member it took off their last Standby kill loses the standby payout.
          ...(k.standby_once
            ? [k.pool, POOL_GUILD].map((pool) => standbyReverseStatement(db, { guildId, pool, raidId: k.raid_id, members: losers, reason: RAID_COPY.checkReason, actor: 'bot', at }))
            : []),
        ]
      : []),
  ]);
  // Order 34: a window that closes after a linked raid did can change its no-shows.
  return { raidId: k.raid_id, closedEvent: k.closed_at && k.event_id && losers.length && (await closedEvent(db, k.event_id)) ? k.event_id : null };
}

/**
 * Order 29 (override 2): the standby value and its guild points, paid once to every member Standby at one or more of the
 * raid's kills, in the batch that closes it (however it closes: an officer, auto-close, or Remove DKP). Raids opened
 * before order 29 pay nothing here (their Standby earned each kill).
 */
export const standbyPayouts = (db: D1Database, guildId: string, raid: Pick<Raid, 'id' | 'pool' | 'standby_once'>, s: Settings, at: string): D1PreparedStatement[] =>
  raid.standby_once
    ? [
        standbyStatement(db, { guildId, pool: raid.pool, raidId: raid.id, asked: s.standby_value, cap: s.cap, at }),
        standbyStatement(db, { guildId, pool: POOL_GUILD, raidId: raid.id, asked: s.guild_points, cap: s.cap, at }),
      ]
    : [];

/**
 * Closes a raid (Close raid, or close:<raid id> at closes_at): standby pay, a linked event (order 34), the card, the night's
 * summary, the standings. Idempotent. Returns null when this call closed nothing; otherwise the linked event, whose card
 * the caller asks for.
 */
export async function closeRaid(db: D1Database, api: BotApi | null, guildId: string, channelId: string | null, raidId: number, by: string, reason: 'officer' | 'auto', nowMs: number, s: Settings): Promise<{ eventId: number | null } | null> {
  const at = new Date(nowMs).toISOString();
  const open = await raidById(db, guildId, raidId);
  if (!open || open.closed_at) return null;
  const [res] = await db.batch<Raid>([
    db.prepare(`UPDATE dkp_raid SET closed_at = ?1, closed_by = ?2, close_reason = ?3 WHERE id = ?4 AND guild_id = ?5 AND closed_at IS NULL AND (?3 = 'officer' OR closes_at <= ?1) RETURNING ${RAID_COLS}`).bind(at, by, reason, raidId, guildId),
    ...standbyPayouts(db, guildId, open, s, at),
    ...(open.event_id ? closeWithRaid(db, guildId, raidId, open.event_id, at) : []),
  ]);
  const closed = res.results[0];
  if (!closed) return null;
  if (api && channelId) {
    const data = await cardData(db, closed);
    if (closed.message_id) await editCard(db, api, guildId, `render:${closed.id}`, channelId, closed.message_id, cardMessage(data, guildId));
    // Who was there: every roster; the points: what the ledger paid in the raid's pool (kills, and the standby payouts).
    const earners = new Set([...data.earned.values()].flat().map((e) => e.member_id));
    const paid = await db
      .prepare(
        `SELECT (SELECT coalesce(sum(l.amount), 0) FROM dkp_kill k JOIN dkp_ledger l ON l.kill_id = k.id WHERE k.raid_id = ?1 AND l.pool = ?2) AS points,
                (SELECT count(*) FROM dkp_ledger WHERE raid_id = ?1 AND pool = ?2 AND kind = 'standby') AS standby,
                (SELECT coalesce(sum(amount), 0) FROM dkp_ledger WHERE raid_id = ?1 AND pool = ?2 AND kind = 'standby') AS standby_points`,
      )
      .bind(closed.id, closed.pool)
      .first<{ points: number; standby: number; standby_points: number }>();
    await postIn(api, channelId, { content: RAID_COPY.summary(data.zone, data.kills.length, earners.size, (paid?.points ?? 0) + (paid?.standby_points ?? 0), reason, paid?.standby ?? 0) });
    await refreshStandings(db, api, guildId, channelId, [closed.pool, POOL_GUILD]);
  }
  return { eventId: closed.event_id && (await closedEvent(db, closed.event_id)) ? closed.event_id : null };
}

/** Remove DKP mid-raid: the card shows the raid closed (src/dkp/setup.ts closed it in D1). */
export async function showRemoved(db: D1Database, api: BotApi, guildId: string, channelId: string | null, raidId: number) {
  const raid = await raidById(db, guildId, raidId);
  if (raid?.message_id && channelId) await editCard(db, api, guildId, `render:${raidId}`, channelId, raid.message_id, cardMessage(await cardData(db, raid), guildId));
}

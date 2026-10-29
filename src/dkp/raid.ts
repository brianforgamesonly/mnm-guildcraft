// Order 27 (ITEM 4): raid nights (docs/PRD.md "DKP add-on", Raid night). One open raid per server (dkp_raid_open). The
// card in GC-DKP is the bot's own message, edited in place by any cause (override 2 of order 9), never more than the pace
// allows (src/dkp/pace.ts, on the guild's timer object); every presser's answer is a new private message, at once.
//
// Costs per press (D1 statements; Discord calls), besides the interaction's own reply:
//   Present / Standby / Leaving: guild, DKP state, the member row (touchMember), the raid, one write batch: 5 D1; 0 Discord
//     (the card edit is a timer item: 1 Durable Object request).
//   Named killed / /dkp kill / Pay attendance: guild, state, raid, respawn (or flat) check, named value, earners, the kill,
//     one pay batch: 8 D1; 0
//     Discord (card edit: a timer item).
//   Check again: guild, state, raid, latest kill, one write: 5 D1; 0 Discord. Who's here / Who earned: 3-4 D1; 0 Discord.
//   Close raid: guild, state, close, card render (1 batch), summary, standings (2 + 1 per pool): about 8 D1; 3 Discord.
//   The card render (timer): 1 batch of 5 statements, 1 Discord edit.
import { audit, dkpSelfConflict, isDkpRunner, now, touchMember } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, memberTag, optInt, optString, plural, row, STYLE_DANGER, STYLE_PRIMARY, STYLE_SECONDARY, STYLE_SUCCESS, truncate, updateMessage, type Embed, type MessageReply, type Option } from '../discord.ts';
import { zoneKey } from '../zone/names.ts';
import { RAID_COPY } from './copy.ts';
import { zoneCreatures } from './creatures.ts';
import { askApproval, type DkpRun } from './commands.ts';
import { historySql, payStatement, POOL_GUILD, readdStatement, registerPool, reverseStatement, type LedgerRow } from './ledger.ts';
import { editIn, poolNames, postIn, refreshStandings, type Message } from './messages.ts';
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
}
const RAID_COLS = 'id, guild_id, pool, mode, message_id, opened_at, closes_at, closed_at, close_reason';
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

interface CardData {
  raid: Raid;
  zone: string;
  people: { member_id: string; name: string; state: string; status: string }[];
  kills: { id: number; name: string | null; points: number; at: string; check_due: string | null; check_closed_at: string | null }[];
  earned: Map<number, { member_id: string; name: string }[]>;
  creatures: string[];
}

async function cardData(db: D1Database, raid: Raid): Promise<CardData> {
  const [zone, people, kills, earned] = await db.batch<Record<string, unknown>>([
    db.prepare('SELECT name FROM zone WHERE key = ?').bind(raid.pool),
    db
      .prepare(
        `SELECT a.member_id, coalesce(m.display_name, a.member_id) AS name, a.state, coalesce(m.status, 'active') AS status FROM dkp_attendance a
         LEFT JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = a.member_id WHERE a.raid_id = ?2 ORDER BY lower(name)`,
      )
      .bind(raid.guild_id, raid.id),
    db.prepare('SELECT id, name, points, at, check_due, check_closed_at FROM dkp_kill WHERE raid_id = ? ORDER BY id').bind(raid.id),
    // Who earned each kill: asked amounts in the raid pool summing above zero (corrections and Check again included).
    db
      .prepare(
        `SELECT l.kill_id, l.member_id, coalesce(m.display_name, l.member_id) AS name FROM dkp_ledger l
         LEFT JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = l.member_id
         WHERE l.raid_id = ?2 AND l.pool = ?3 AND l.kill_id IS NOT NULL GROUP BY l.kill_id, l.member_id HAVING sum(l.amount + l.cut) > 0 ORDER BY lower(name)`,
      )
      .bind(raid.guild_id, raid.id, raid.pool),
  ]);
  const byKill = new Map<number, { member_id: string; name: string }[]>();
  for (const r of earned.results as { kill_id: number; member_id: string; name: string }[]) byKill.set(r.kill_id, [...(byKill.get(r.kill_id) ?? []), { member_id: r.member_id, name: r.name }]);
  return {
    raid,
    zone: (zone.results[0] as { name?: string } | undefined)?.name ?? raid.pool,
    people: people.results as CardData['people'],
    kills: kills.results as CardData['kills'],
    earned: byKill,
    creatures: raid.mode === 'named' && !raid.closed_at ? (await zoneCreatures(db, raid.pool)).slice(0, SELECT_MAX) : [],
  };
}

/** One kill's line: time, named, points, how many earned, changes against the kill before it, Check again's state. */
export function killLine(k: CardData['kills'][number], earned: { member_id: string; name: string }[], before: { member_id: string; name: string }[] | null): string {
  const ids = new Set(earned.map((e) => e.member_id));
  const was = new Set((before ?? []).map((e) => e.member_id));
  const diff = before
    ? [...earned.filter((e) => !was.has(e.member_id)).map((e) => `+${md(e.name)}`), ...(before ?? []).filter((e) => !ids.has(e.member_id)).map((e) => `−${md(e.name)}`)]
    : [];
  const check = k.check_due
    ? k.check_closed_at
      ? RAID_COPY.checkClosed(unix(k.check_closed_at), unix(k.check_due))
      : RAID_COPY.checkOpen(unix(k.check_due))
    : '';
  return truncate(`<t:${unix(k.at)}:T> **${md(k.name ?? RAID_COPY.flatName)}** · ${k.points} pts · ${plural(earned.length, 'earned', 'earned')}${diff.length ? ` · ${truncate(diff.join(' '), 300)}` : ''}${check}`, 1000);
}

export function cardMessage(d: CardData, guildId: string): Message {
  const { raid } = d;
  const here = d.people.filter((p) => p.state === 'present');
  const standby = d.people.filter((p) => p.state === 'standby');
  const names = (list: CardData['people']) =>
    list.length > NAMES_SHOWN ? RAID_COPY.counted(list.length) : list.map((p) => `${md(p.name)}${p.status === 'left' ? RAID_COPY.frozen : ''}`).join(', ') || RAID_COPY.nobody;
  const shown = d.kills.slice(-KILLS_SHOWN);
  const lines = shown.map((k) => {
    const i = d.kills.indexOf(k);
    return killLine(k, d.earned.get(k.id) ?? [], i > 0 ? (d.earned.get(d.kills[i - 1].id) ?? []) : null);
  });
  const embed: Embed = {
    title: truncate(RAID_COPY.title(d.zone, raid.mode), 256),
    description: truncate(
      [
        raid.closed_at ? RAID_COPY.closedAt(unix(raid.closed_at), raid.close_reason) : RAID_COPY.openUntil(unix(raid.closes_at)),
        '',
        `**${RAID_COPY.present}** (${here.length}): ${names(here)}`,
        `**${RAID_COPY.standby}** (${standby.length}): ${names(standby)}`,
        '',
        ...(d.kills.length > shown.length ? [RAID_COPY.earlier(d.kills.length - shown.length)] : []),
        ...(lines.length ? lines : [raid.mode === 'named' ? RAID_COPY.noKills : RAID_COPY.noPayouts]),
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
      ...(raid.mode === 'flat' ? [button(`${PAY_PREFIX}${id}`, RAID_COPY.payAttendance, STYLE_PRIMARY)] : []),
      button(`${CLOSE_PREFIX}${id}`, RAID_COPY.close, STYLE_DANGER),
    ]),
  ];
  if (d.creatures.length)
    rows.push(row([{ type: 3, custom_id: `${NAMED_PREFIX}${id}`, placeholder: RAID_COPY.namedKilled, options: d.creatures.map((n) => ({ label: truncate(n, 100), value: truncate(n, 100) })) }]));
  void guildId;
  return { embeds: [embed], components: rows };
}

/** render:<raid id> on the timer object. Returns Discord's rate-limit headers, for the pace of the next edit. */
export async function renderCard(db: D1Database, api: BotApi, guildId: string, channelId: string, raidId: number): Promise<{ remaining?: string | null; resetAfter?: string | null; retryAfter?: number | null } | null> {
  const raid = await raidById(db, guildId, raidId);
  if (!raid?.message_id) return null;
  const m = cardMessage(await cardData(db, raid), guildId);
  await editIn(api, channelId, raid.message_id, m);
  const last = api.log.at(-1);
  return last ? { remaining: last.remaining ?? null, resetAfter: last.reset_after ?? null, retryAfter: last.retry_after ?? null } : null;
}

// ---------------------------------------------------------------- /dkp raid, /dkp kill, /dkp correct, /dkp history

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
  const closes = new Date(Date.parse(at) + d.settings.auto_close_hours * 3_600_000).toISOString();
  let raid: Raid | null;
  try {
    raid = await c.db
      .prepare(`INSERT INTO dkp_raid (guild_id, pool, mode, opened_by, opened_at, closes_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING ${RAID_COLS}`)
      .bind(c.guild.id, zone.key, mode, c.userId, at, closes)
      .first<Raid>();
  } catch {
    // Two openings at once: the unique index lets one through.
    const won = await openRaid(c.db, c.guild.id);
    return ephemeral(RAID_COPY.alreadyOpen(link(c.guild.id, d.channel_id, won?.message_id ?? null)));
  }
  await c.db.batch([registerPool(c.db, c.guild.id, zone.key, at), registerPool(c.db, c.guild.id, POOL_GUILD, at), audit(c.db, c.guild.id, c.userId, 'dkp.raid.open', `raid:${raid!.id}`, null, { pool: zone.key, mode })]);
  try {
    // A pool's first raid: its standings message first, so it sits above the card.
    await refreshStandings(c.db, api, c.guild.id, d.channel_id, [zone.key]);
    const id = await postIn(api, d.channel_id, cardMessage(await cardData(c.db, raid!), c.guild.id));
    if (!id) {
      // The card was refused: the raid closes at once, so the next /dkp raid is not refused as "already open".
      await c.db.prepare("UPDATE dkp_raid SET closed_at = ?1, closed_by = 'bot', close_reason = 'officer' WHERE id = ?2 AND closed_at IS NULL").bind(now(), raid!.id).run();
      return ephemeral(RAID_COPY.cannotPost);
    }
    await c.db.prepare('UPDATE dkp_raid SET message_id = ? WHERE id = ?').bind(id, raid!.id).run();
    c.effects.dkpTimers = { guildId: c.guild.id, items: [{ key: `close:${raid!.id}`, due: Date.parse(closes) }] };
    return ephemeral(RAID_COPY.opened(zone.name, link(c.guild.id, d.channel_id, id)));
  } finally {
    c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
  }
};

/** Records a kill (or, name null, a flat payout) in the open raid: pays everyone Present or Standby, not frozen, now. */
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
      `SELECT a.member_id FROM dkp_attendance a JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = a.member_id
       WHERE a.raid_id = ?2 AND a.state IN ('present', 'standby') AND m.status = 'active'`,
    )
    .bind(c.guild.id, raid.id)
    .all<{ member_id: string }>();
  const earners = results.map((r) => r.member_id);
  // Only into a raid still open (review of PR B: a press racing Close records nothing).
  const kill = await c.db
    .prepare('INSERT INTO dkp_kill (raid_id, name, points, guild_points, at, by) SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM dkp_raid WHERE id = ?1 AND closed_at IS NULL) RETURNING id')
    .bind(raid.id, name, points, s.guild_points, at, c.userId)
    .first<{ id: number }>();
  if (!kill) return ephemeral(RAID_COPY.raidClosed);
  const kind = name === null ? 'flat' : 'kill';
  if (earners.length)
    await c.db.batch([
      payStatement(c.db, { guildId: c.guild.id, pool: raid.pool, members: earners, asked: points, cap: s.cap, kind, raidId: raid.id, killId: kill!.id, actor: 'bot', at }),
      payStatement(c.db, { guildId: c.guild.id, pool: POOL_GUILD, members: earners, asked: s.guild_points, cap: s.cap, kind, raidId: raid.id, killId: kill!.id, actor: 'bot', at }),
    ]);
  rerender(c, raid.id);
  return ephemeral(name === null ? RAID_COPY.paid(points, earners.length) : RAID_COPY.killed(name, points, earners.length));
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
 * A correction's statements: removal reverses what each kill paid; an add re-pays each kill, capped against the cap now.
 * Once-only by their own conditions (a reversal needs the member credited, a re-add needs them not), so an approval batches
 * them with its status change.
 */
export async function correctionStatements(db: D1Database, guildId: string, cap: number, k: { member: string; action: 'add' | 'remove'; raidId: number; killId: number | null; reason: string; actor: string; at: string; approvedPending?: number }) {
  const { results: kills } = await db
    .prepare('SELECT id, points, guild_points FROM dkp_kill WHERE raid_id = ? AND (?2 IS NULL OR id = ?2) ORDER BY id')
    .bind(k.raidId, k.killId)
    .all<{ id: number; points: number; guild_points: number }>();
  const raid = await db.prepare('SELECT pool FROM dkp_raid WHERE id = ?').bind(k.raidId).first<{ pool: string }>();
  const at = k.at;
  return kills.flatMap((kill) =>
    [
      [raid!.pool, kill.points],
      [POOL_GUILD, kill.guild_points],
    ].map(([pool, asked]) =>
      k.action === 'remove'
        ? reverseStatement(db, { guildId, pool: pool as string, killId: kill.id, members: [k.member], reason: k.reason, actor: k.actor, at, approvedPending: k.approvedPending })
        : readdStatement(db, { guildId, pool: pool as string, killId: kill.id, asked: asked as number, cap, members: [k.member], reason: k.reason, actor: k.actor, at, approvedPending: k.approvedPending }),
    ),
  );
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
  await c.db.batch([
    ...(await correctionStatements(c.db, c.guild.id, d.settings.cap, { member, action, raidId: scope.raid.id, killId, reason, actor: c.userId, at: now() })),
    audit(c.db, c.guild.id, c.userId, `dkp.correct.${action}`, `member:${member}`, null, { raid: scope.raid.id, kill: killId }),
  ]);
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
      const list = (state: string) => data.people.filter((p) => p.state === state).map((p) => memberTag(p.member_id, p.name)).join(', ') || RAID_COPY.nobody;
      return ephemeral(truncate(`**${RAID_COPY.present}:** ${list('present')}\n**${RAID_COPY.standby}:** ${list('standby')}`, 2000));
    }
    case WHO_EARNED_PREFIX: {
      const data = await cardData(c.db, raid);
      const k = data.kills.at(-1);
      if (!k) return ephemeral(RAID_COPY.noKill);
      const earned = data.earned.get(k.id) ?? [];
      return ephemeral(truncate(`${RAID_COPY.earnedHead(k.name ?? RAID_COPY.flatName, earned.length)}\n${earned.map((e) => memberTag(e.member_id, e.name)).join(', ')}`, 2000));
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
        const closed = await closeRaid(c.db, api, c.guild.id, d.channel_id, raid.id, c.userId, 'officer', Date.now());
        return ephemeral(closed ? RAID_COPY.closedReply : RAID_COPY.raidClosed);
      } finally {
        if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
      }
    }
  }
  return null;
}

/** Present, Standby or Leaving: the member's state from now on (and, inside an open Check again, keeping a kill). */
async function tap(c: Ctx, raid: Raid, state: 'present' | 'standby' | 'absent'): Promise<MessageReply> {
  // A raid button refreshes the member's row as a command does (a frozen member thaws).
  await touchMember(c.db, c.guild.id, c.member);
  const at = now();
  await c.db.batch([
    c.db
      .prepare(
        `INSERT INTO dkp_attendance (raid_id, member_id, state, since, set_by) VALUES (?1, ?2, ?3, ?4, ?2)
         ON CONFLICT (raid_id, member_id) DO UPDATE SET state = ?3, since = ?4, set_by = ?2 WHERE state <> ?3`,
      )
      .bind(raid.id, c.userId, state, at),
    // Inside a kill's Check again window, Present (or Standby) keeps the kill for a member it credited.
    c.db
      .prepare(
        `INSERT INTO dkp_recheck (kill_id, member_id, at) SELECT id, ?2, ?3 FROM dkp_kill WHERE raid_id = ?1 AND ?4 <> 'absent'
           AND check_due IS NOT NULL AND check_closed_at IS NULL AND check_due > ?3 ON CONFLICT DO NOTHING`,
      )
      .bind(raid.id, c.userId, at, state),
  ]);
  rerender(c, raid.id);
  return ephemeral(state === 'present' ? RAID_COPY.youPresent : state === 'standby' ? RAID_COPY.youStandby : RAID_COPY.youLeft);
}

// ---------------------------------------------------------------- timers (src/dkp/due.ts)

/** check:<kill id>: members credited on the kill who did not tap again lose it, and are absent from now on. Idempotent. */
export async function closeCheck(db: D1Database, guildId: string, killId: number, nowMs: number): Promise<{ again: number } | { raidId: number } | null> {
  const k = await db
    .prepare('SELECT k.raid_id, r.pool, k.check_due FROM dkp_kill k JOIN dkp_raid r ON r.id = k.raid_id WHERE k.id = ? AND r.guild_id = ? AND k.check_closed_at IS NULL AND k.check_due IS NOT NULL')
    .bind(killId, guildId)
    .first<{ raid_id: number; pool: string; check_due: string }>();
  if (!k) return null;
  if (Date.parse(k.check_due) > nowMs) return { again: Date.parse(k.check_due) };
  const { results } = await db
    .prepare(
      `SELECT l.member_id FROM dkp_ledger l WHERE l.kill_id = ?1 AND l.pool = ?2 GROUP BY l.member_id HAVING sum(l.amount + l.cut) > 0
       EXCEPT SELECT member_id FROM dkp_recheck WHERE kill_id = ?1`,
    )
    .bind(killId, k.pool)
    .all<{ member_id: string }>();
  const losers = results.map((r) => r.member_id);
  const at = new Date(nowMs).toISOString();
  await db.batch([
    db.prepare('UPDATE dkp_kill SET check_closed_at = ? WHERE id = ? AND check_closed_at IS NULL').bind(at, killId),
    ...(losers.length
      ? [
          reverseStatement(db, { guildId, pool: k.pool, killId, members: losers, reason: RAID_COPY.checkReason, actor: 'bot', at }),
          reverseStatement(db, { guildId, pool: POOL_GUILD, killId, members: losers, reason: RAID_COPY.checkReason, actor: 'bot', at }),
          db
            .prepare("UPDATE dkp_attendance SET state = 'absent', since = ?1, set_by = 'bot' WHERE raid_id = ?2 AND member_id IN (SELECT value FROM json_each(?3)) AND state <> 'absent' AND since <= ?4")
            .bind(at, k.raid_id, JSON.stringify(losers), k.check_due),
        ]
      : []),
  ]);
  return { raidId: k.raid_id };
}

/** Closes a raid (Close raid, or close:<raid id> at closes_at): the card, the night's summary, the standings. Idempotent. */
export async function closeRaid(db: D1Database, api: BotApi | null, guildId: string, channelId: string | null, raidId: number, by: string, reason: 'officer' | 'auto', nowMs: number): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  const closed = await db
    .prepare(`UPDATE dkp_raid SET closed_at = ?1, closed_by = ?2, close_reason = ?3 WHERE id = ?4 AND guild_id = ?5 AND closed_at IS NULL AND (?3 = 'officer' OR closes_at <= ?1) RETURNING ${RAID_COLS}`)
    .bind(at, by, reason, raidId, guildId)
    .first<Raid>();
  if (!closed) return false;
  if (api && channelId) {
    const data = await cardData(db, closed);
    if (closed.message_id) await editIn(api, channelId, closed.message_id, cardMessage(data, guildId));
    const earners = new Set([...data.earned.values()].flat().map((e) => e.member_id));
    const points = data.kills.reduce((n, k) => n + k.points * (data.earned.get(k.id)?.length ?? 0), 0);
    await postIn(api, channelId, { content: RAID_COPY.summary(data.zone, data.kills.length, earners.size, points, reason) });
    await refreshStandings(db, api, guildId, channelId, [closed.pool, POOL_GUILD]);
  }
  return true;
}

/** Remove DKP mid-raid: the card shows the raid closed (src/dkp/setup.ts closed it in D1). */
export async function showRemoved(db: D1Database, api: BotApi, guildId: string, channelId: string | null, raidId: number) {
  const raid = await raidById(db, guildId, raidId);
  if (raid?.message_id && channelId) await editIn(api, channelId, raid.message_id, cardMessage(await cardData(db, raid), guildId));
}

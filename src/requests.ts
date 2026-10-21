// Craft requests (order 16, ITEM 2): a member asks for up to 5 items; each request is one private thread in the request
// channel (guild.request_channel_id) holding the requester and the opted-in crafters who can make the items.
//
// - Routing (routeItems) reuses the one tier decider (src/crafters.ts): a member is eligible for an item when one of
//   their live characters is Reliable (skill at or above the trivial, a reputation or discovery recipe only when marked
//   known) or the trivial is unknown (everyone with the tradeskill), and they opted in for that recipe's tradeskill
//   (craft_notify). The requester is never routed to. At send time, members who left the server or cannot view the
//   request channel are left out too (whoCanView): Discord shows no thread in a channel the member cannot see.
// - Status lives in the bot's first message (edited, never pinging) and in the thread name's prefix. Renames are
//   rate-limited; a refused rename leaves craft_request.thread_name behind and the */15 sweep catches it up.
// - Archived threads block buttons, edits and joins ("Users cannot edit messages, add reactions, use application
//   commands, or join archived threads"), so every edit unarchives first when Discord says the thread is archived, and
//   the sweep keeps open requests active (unarchive, or bump the auto-archive time as the board does).
// - Expiry: nothing claimed in 14 days, or no activity in 30 days, closes the request (audit request.expire). Activity is
//   the latest request.* audit row for the request: no column holds it.
import { now } from './access.ts';
import { budgetLeft, THREAD_ARCHIVED, UNKNOWN_CHANNEL, type BotApi } from './board/api.ts';
import { AUTO_ARCHIVE_MINUTES, archivesAt, BUMP_MINUTES, KEEP_ACTIVE_MS, type ThreadInfo } from './board/refresh.ts';
import { memberChannelBits, type Overwrite, type RoleBits } from './commands/setup.ts';
import { craftersSql, tierCrafters, type CrafterRow, type Tier } from './crafters.ts';
import { listMembers } from './departures.ts';
import { button, md, memberTag, mention, NO_PINGS, pingOnly, row, STYLE_DANGER, STYLE_PRIMARY, STYLE_SECONDARY, truncate, VIEW_CHANNEL, type AllowedMentions } from './discord.ts';
import { CORRECTED, correctionJoin, visibleTo } from './recipes.ts';

export const MAX_ITEMS = 5;
export const MAX_OPEN_PER_MEMBER = 5;
/** Crafters added to one thread, at most (each is one PUT; the send stays inside the 50-subrequest invocation). */
export const MAX_ADDED = 20;
export const MAX_QUANTITY = 1000;
export const NOTE_MAX = 300;
export const EXPIRE_UNCLAIMED_MS = 14 * 86_400_000;
export const EXPIRE_INACTIVE_MS = 30 * 86_400_000;
/** An unsent request older than this is discarded when its member starts a new one. */
export const UNSENT_MS = 86_400_000;
/** The tiers that make a member eligible to be routed a request (section A of order 16). */
export const ELIGIBLE_TIERS: readonly Tier[] = ['reliable', 'unknown'];
/** Discord's thread name limit ("1-100 character channel name"). */
const NAME_MAX = 100;
const CONTENT_MAX = 2000;

export const NO_REQUEST_CHANNEL = 'An admin needs to run `/guildcraft setup requests:` first.';

// ---------------------------------------------------------------- rows

export type ItemStatus = 'open' | 'claimed' | 'done' | 'cancelled';
export type CloseReason = 'done' | 'cancelled' | 'expired' | 'inactive' | 'discarded';

export interface RequestRow {
  id: number;
  guild_id: string;
  requester: string;
  note: string | null;
  status: 'unsent' | 'open' | 'closed';
  close_reason: CloseReason | null;
  thread_id: string | null;
  message_id: string | null;
  thread_name: string | null;
  created_at: string;
  /** The requester's main character's name now (not stored: names change). */
  main: string | null;
  /** The latest request.* audit row's time. */
  last_activity: string | null;
}

export interface ItemRow {
  request_id: number;
  position: number;
  item_id: number;
  name: string;
  quantity: number;
  status: ItemStatus;
  claimer: string | null;
  crafters_json: string | null;
}

const MAIN_SQL = `(SELECT name FROM character ch WHERE ch.guild_id = r.guild_id AND ch.owner_user_id = r.requester AND ch.deleted_at IS NULL ORDER BY ch.is_main DESC, ch.created_at, ch.id LIMIT 1)`;
const ACTIVITY_SQL = `(SELECT max(a.created_at) FROM audit_log a WHERE a.guild_id = r.guild_id AND a.target = 'request:' || r.id)`;
export const REQUEST_COLS = `r.id, r.guild_id, r.requester, r.note, r.status, r.close_reason, r.thread_id, r.message_id, r.thread_name, r.created_at, ${MAIN_SQL} AS main, ${ACTIVITY_SQL} AS last_activity`;
export const ITEMS_SQL = `SELECT q.request_id, q.position, q.item_id, i.name, q.quantity, q.status, q.claimer, q.crafters_json
  FROM craft_request_item q JOIN item i ON i.id = q.item_id WHERE q.request_id IN (SELECT value FROM json_each(?)) ORDER BY q.request_id, q.position`;

export const target = (id: number) => `request:${id}`;
export const crafters = (it: ItemRow): string[] => {
  try {
    const v = JSON.parse(it.crafters_json ?? '[]');
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

/** One request and its items, in one round trip. */
export async function loadRequest(db: D1Database, guildId: string, id: number): Promise<{ req: RequestRow; items: ItemRow[] } | null> {
  const [r, i] = await db.batch([
    db.prepare(`SELECT ${REQUEST_COLS} FROM craft_request r WHERE r.id = ? AND r.guild_id = ?`).bind(id, guildId),
    db.prepare(ITEMS_SQL).bind(JSON.stringify([id])),
  ]);
  const req = (r.results as RequestRow[])[0];
  return req ? { req, items: i.results as ItemRow[] } : null;
}

// ---------------------------------------------------------------- routing (the eligibility decision)

export interface Crafter {
  userId: string;
  /** The name saved at the member's last command. */
  member: string;
  characters: string[];
}

export interface ItemRoute {
  itemId: number;
  /** Eligible and opted in for the tradeskill: the members a request routes to (before the Discord checks). */
  eligible: Crafter[];
  /** Eligible by skill, but not opted in: shown to the requester to ask directly. */
  notOptedIn: Crafter[];
}

interface TierRecipeRow {
  id: number;
  tradeskill_id: number;
  trivial: number | null;
  acquisition: string;
}

/**
 * Who a request for these items routes to (D1 only, one batch): per item, the members with a live character in an
 * eligible tier (ELIGIBLE_TIERS, decided by src/crafters.ts crafterTier, never a second copy), active in the guild
 * (craftersSql), not the requester, split by whether they opted in for that recipe's tradeskill.
 */
export async function routeItems(db: D1Database, guildId: string, requester: string, itemIds: number[], window: number): Promise<ItemRoute[]> {
  const stmts = [
    db.prepare('SELECT discord_user_id, tradeskill_id FROM craft_notify WHERE guild_id = ?').bind(guildId),
    ...itemIds.flatMap((item) => [
      db
        .prepare(`SELECT r.id, r.tradeskill_id, ${CORRECTED.trivial} AS trivial, ${CORRECTED.acquisition} AS acquisition FROM recipe r ${correctionJoin('?2')} WHERE r.result_item_id = ?1 AND ${visibleTo('?2')}`)
        .bind(item, guildId),
      db.prepare(craftersSql()).bind(item, guildId),
    ]),
  ];
  const [notify, ...rest] = await db.batch(stmts);
  const opted = new Set((notify.results as { discord_user_id: string; tradeskill_id: number }[]).map((n) => `${n.discord_user_id}:${n.tradeskill_id}`));
  return itemIds.map((itemId, k) => {
    const recipes = rest[2 * k].results as TierRecipeRow[];
    const rows = rest[2 * k + 1].results as CrafterRow[];
    const eligible = new Map<string, Crafter>();
    const notOpted = new Map<string, Crafter>();
    for (const recipe of recipes) {
      const tiers = tierCrafters(rows, recipe, window);
      for (const tier of ELIGIBLE_TIERS)
        for (const r of tiers[tier]) {
          if (r.owner_user_id === requester) continue;
          const into = opted.has(`${r.owner_user_id}:${recipe.tradeskill_id}`) ? eligible : notOpted;
          const c = into.get(r.owner_user_id) ?? { userId: r.owner_user_id, member: r.member, characters: [] };
          if (!c.characters.includes(r.character)) c.characters.push(r.character);
          into.set(r.owner_user_id, c);
        }
    }
    for (const id of eligible.keys()) notOpted.delete(id);
    return { itemId, eligible: [...eligible.values()], notOptedIn: [...notOpted.values()] };
  });
}

/** Whether one member is eligible for one item now (a claim is re-checked with the same decision). */
export async function isEligible(db: D1Database, guildId: string, userId: string, itemId: number, requester: string, window: number): Promise<boolean> {
  if (userId === requester) return false;
  const [route] = await routeItems(db, guildId, requester, [itemId], window);
  return route.eligible.some((c) => c.userId === userId);
}

export interface ViewCheck {
  canView: Set<string>;
  cannotView: Set<string>;
  /** Not in the server's member list (left, or never joined). */
  notInServer: Set<string>;
}

/**
 * Who of `userIds` can view the request channel (VIEW_CHANNEL from roles and overwrites, src/commands/setup.ts
 * memberChannelBits), from the server's owner, the channel's overwrites, the roles and the member list: 3 calls plus
 * one per 1,000 members. A list that cannot be read is an error, never a guess.
 */
export async function whoCanView(api: BotApi, guildId: string, channelId: string, userIds: string[]): Promise<ViewCheck | { error: string }> {
  const guild = await api.call<{ owner_id?: string }>('GET', `/guilds/${guildId}`);
  const channel = await api.call<{ permission_overwrites?: Overwrite[] }>('GET', `/channels/${channelId}`);
  const roles = await api.call<RoleBits[]>('GET', `/guilds/${guildId}/roles`);
  if (!guild.ok || !channel.ok || !roles.ok) return { error: 'the channel or roles could not be read' };
  const members = await listMembers(api, guildId);
  if (!members.ok) return { error: members.why };
  const out: ViewCheck = { canView: new Set(), cannotView: new Set(), notInServer: new Set() };
  for (const id of userIds) {
    const memberRoles = members.roles.get(id);
    if (!memberRoles) out.notInServer.add(id);
    else if ((memberChannelBits(guildId, roles.body, channel.body.permission_overwrites ?? [], id, memberRoles, guild.body.owner_id) & VIEW_CHANNEL) === VIEW_CHANNEL) out.canView.add(id);
    else out.cannotView.add(id);
  }
  return out;
}

// ---------------------------------------------------------------- what the thread shows

export const PREFIX = { open: 'Open', claimed: 'Claimed', done: 'Done', cancelled: 'Cancelled' } as const;

export function prefixOf(req: Pick<RequestRow, 'status'>, items: Pick<ItemRow, 'status'>[]): string {
  if (req.status === 'closed') return items.some((i) => i.status === 'done') ? PREFIX.done : PREFIX.cancelled;
  return items.some((i) => i.status === 'claimed' || i.status === 'done') ? PREFIX.claimed : PREFIX.open;
}

/** "[Open] Copper Plate Breastplate ×1 +1 more · Testchar", cut to Discord's 100 characters (the item name shortens first). */
export function threadName(prefix: string, items: Pick<ItemRow, 'name' | 'quantity'>[], main: string | null): string {
  const head = `[${prefix}] `;
  const tail = `${items.length > 1 ? ` +${items.length - 1} more` : ''}${main ? ` · ${main}` : ''}`;
  const qty = ` ×${items[0]?.quantity ?? 1}`;
  const room = Math.max(12, NAME_MAX - head.length - tail.length - qty.length);
  return `${head}${truncate(items[0]?.name ?? 'Craft request', room)}${qty}${tail}`.slice(0, NAME_MAX);
}

/** Saved names of the members a request shows, for memberTag. */
export type Names = Map<string, string>;
const tag = (names: Names, id: string) => (names.has(id) ? memberTag(id, names.get(id)!) : mention(id));

const CLOSE_TEXT: Record<CloseReason, string> = {
  done: 'every item is done or cancelled',
  cancelled: 'cancelled',
  expired: 'nothing was claimed in 14 days',
  inactive: 'no activity in 30 days',
  discarded: 'discarded',
};

function itemLine(it: ItemRow, n: number, many: boolean, names: Names): string {
  const status =
    it.status === 'claimed' ? `Claimed by ${tag(names, it.claimer!)}` : it.status === 'done' ? `Done${it.claimer ? ` (${tag(names, it.claimer)})` : ''}` : it.status === 'cancelled' ? 'Cancelled' : 'Open';
  return `**${many ? `${n}. ` : ''}${md(it.name)}** ×${it.quantity} · ${status}`;
}

/** The first message: the items, quantities, note and, per item, the crafters added. Fits Discord's 2,000 characters. */
export function requestContent(req: RequestRow, items: ItemRow[], names: Names): string {
  const many = items.length > 1;
  const head = `## Craft request from ${tag(names, req.requester)}${req.main ? ` (${md(req.main)})` : ''}`;
  const note = req.note ? `**Note:** ${md(req.note)}` : null;
  const closed = req.status === 'closed' && req.close_reason ? `**Closed:** ${CLOSE_TEXT[req.close_reason]}.` : null;
  const help =
    req.status === 'closed' ? null : "-# A crafter presses **I'll craft this** to take an item (the requester is told), and **Done** when it's handed over. The requester can **Cancel**.";
  const build = (perItem: (it: ItemRow) => string | null, extra: string | null) =>
    [head, ...items.flatMap((it, k) => [itemLine(it, k + 1, many, names), perItem(it)]), extra, note, closed, help].filter(Boolean).join('\n');
  const full = build((it) => (crafters(it).length ? `Crafters: ${crafters(it).map((id) => tag(names, id)).join(', ')}` : null), null);
  if (full.length <= CONTENT_MAX) return full;
  // Too long: one list of everyone added, and a count per item.
  const all = [...new Set(items.flatMap(crafters))];
  return truncate(build((it) => `Crafters: ${crafters(it).length}`, `Crafters added: ${all.map((id) => mention(id)).join(' ')}`), CONTENT_MAX);
}

/** Request a craft, on /craft find's reply (private or posted): rqf:<item id>. */
export const FROM_FIND_PREFIX = 'rqf:';
export const ITEM_PREFIX = 'rqi:';
export type ItemAction = 'c' | 'd' | 'x';
const LABELS: Record<ItemAction, string> = { c: "I'll craft this", d: 'Done', x: 'Cancel' };

/** One row per item: I'll craft this, Done, Cancel (each disabled when it no longer applies); none once closed. */
export function requestComponents(req: RequestRow, items: ItemRow[]): unknown[] {
  if (req.status !== 'open') return [];
  const many = items.length > 1;
  return items.map((it) =>
    row(
      (['c', 'd', 'x'] as ItemAction[]).map((a) =>
        button(
          `${ITEM_PREFIX}${a}:${req.id}:${it.position}`,
          `${many ? `${it.position} · ` : ''}${LABELS[a]}`,
          a === 'c' ? STYLE_PRIMARY : a === 'x' ? STYLE_DANGER : STYLE_SECONDARY,
          a === 'c' ? it.status !== 'open' : a === 'd' ? it.status !== 'claimed' : it.status === 'done' || it.status === 'cancelled',
        ),
      ),
    ),
  );
}

export async function namesOf(db: D1Database, guildId: string, ids: string[]): Promise<Names> {
  if (!ids.length) return new Map();
  const { results } = await db
    .prepare('SELECT discord_user_id, display_name FROM member WHERE guild_id = ? AND discord_user_id IN (SELECT value FROM json_each(?))')
    .bind(guildId, JSON.stringify([...new Set(ids)]))
    .all<{ discord_user_id: string; display_name: string }>();
  return new Map(results.map((r) => [r.discord_user_id, r.display_name]));
}

export const involved = (req: RequestRow, items: ItemRow[]) => [req.requester, ...items.flatMap((i) => [...crafters(i), ...(i.claimer ? [i.claimer] : [])])];

// ---------------------------------------------------------------- keeping Discord in step

export interface SyncResult {
  /** The name Discord now has (null: unchanged from the row). */
  thread_name: string | null;
  message_id: string | null;
  errors: string[];
  renamed: boolean;
  rename_refused: boolean;
}

/** Edits or posts in a request thread; an archived thread (50083) is unarchived once, then the call is made again. */
async function inThread<T>(api: BotApi, thread: string, method: string, path: string, body: unknown, r: SyncResult) {
  let res = await api.call<T>(method, path, body);
  if (!res.ok && res.code === THREAD_ARCHIVED) {
    const u = await api.call('PATCH', `/channels/${thread}`, { archived: false });
    if (u.ok) res = await api.call<T>(method, path, body);
    else r.errors.push(`unarchive: ${u.status} ${u.code ?? ''}`.trim());
  }
  return res;
}

/**
 * Brings a request's thread in line with its rows: the first message edited (posted, with its pings, when it never
 * went out), then an optional notice (its own pings), then the name; a closed request's thread is locked and archived.
 * Edits ping nobody. A refused rename leaves the old name; the sweep tries again.
 */
export async function syncThread(api: BotApi, req: RequestRow, items: ItemRow[], names: Names, notice?: { content: string; ping: string[] }): Promise<SyncResult> {
  const r: SyncResult = { thread_name: null, message_id: req.message_id, errors: [], renamed: false, rename_refused: false };
  const thread = req.thread_id;
  if (!thread) return r;
  const body = (allowed: AllowedMentions) => ({ content: requestContent(req, items, names), components: requestComponents(req, items), allowed_mentions: allowed });
  if (req.message_id) {
    const e = await inThread(api, thread, 'PATCH', `/channels/${thread}/messages/${req.message_id}`, body(NO_PINGS), r);
    if (!e.ok) r.errors.push(`edit: ${e.status} ${e.code ?? ''}`.trim());
  } else {
    // The first message never went out (its send failed): post it now, pinging the crafters it lists.
    const p = await inThread<{ id: string }>(api, thread, 'POST', `/channels/${thread}/messages`, body(pingOnly([...new Set(items.flatMap(crafters))])), r);
    if (p.ok) r.message_id = p.body.id;
    else r.errors.push(`first message: ${p.status} ${p.code ?? ''}`.trim());
  }
  if (notice) {
    const n = await inThread(api, thread, 'POST', `/channels/${thread}/messages`, { content: notice.content, allowed_mentions: notice.ping.length ? pingOnly(notice.ping) : NO_PINGS }, r);
    if (!n.ok) r.errors.push(`notice: ${n.status} ${n.code ?? ''}`.trim());
  }
  const name = threadName(prefixOf(req, items), items, req.main);
  const closing = req.status === 'closed';
  if (name !== req.thread_name) {
    // An archived thread takes a rename together with archived:false.
    const u = await api.call('PATCH', `/channels/${thread}`, closing ? { name, archived: false } : { name });
    if (u.ok) {
      r.thread_name = name;
      r.renamed = true;
    } else {
      r.rename_refused = true;
      r.errors.push(`rename: ${u.status} ${u.code ?? ''}${u.skipped ? ` (${u.skipped})` : ''}`.trim());
    }
  }
  if (closing) {
    const l = await api.call('PATCH', `/channels/${thread}`, { locked: true, archived: true });
    if (!l.ok && l.code !== UNKNOWN_CHANNEL) r.errors.push(`close: ${l.status} ${l.code ?? ''}`.trim());
  }
  return r;
}

/** The row's view of Discord after a sync (thread_name and message_id). */
export const syncWrite = (db: D1Database, req: RequestRow, s: SyncResult) =>
  db.prepare('UPDATE craft_request SET thread_name = coalesce(?, thread_name), message_id = coalesce(?, message_id) WHERE id = ?').bind(s.thread_name, s.message_id, req.id);

/** An audit row written only when the statement just before it in the batch changed a row (a lost race records nothing). */
export function auditIfChanged(db: D1Database, guildId: string, actor: string, action: string, tgt: string, before: unknown, after: unknown): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1')
    .bind(guildId, actor, action, tgt, JSON.stringify({ before, after }), now());
}

// ---------------------------------------------------------------- closing

/** Statements that close a request (its open and claimed items cancelled), guarded so a request closes once. */
export function closeStatements(db: D1Database, req: RequestRow, reason: CloseReason, actor: string, action: string): D1PreparedStatement[] {
  const at = now();
  return [
    db.prepare("UPDATE craft_request_item SET status = 'cancelled' WHERE request_id = ? AND status IN ('open', 'claimed') AND EXISTS (SELECT 1 FROM craft_request WHERE id = ? AND status = 'open')").bind(req.id, req.id),
    db.prepare("UPDATE craft_request SET status = 'closed', close_reason = ?, closed_at = ? WHERE id = ? AND status = 'open'").bind(reason, at, req.id),
    auditIfChanged(db, req.guild_id, actor, action, target(req.id), null, { reason }),
  ];
}

// ---------------------------------------------------------------- the */15 sweep

export interface SweepResult {
  open: number;
  expired: number;
  unarchived: number;
  bumped: number;
  renamed: number;
  rename_refused: number;
  first_messages: number;
  errors: string[];
  rows_written: number;
}

/** Open requests, and closed ones whose thread name still lags: the only rows the sweep looks at (one query when idle). */
const SWEEP_SQL = `SELECT ${REQUEST_COLS} FROM craft_request r
  WHERE r.thread_id IS NOT NULL AND (r.status = 'open' OR (r.status = 'closed' AND r.closed_at > ?1 AND r.thread_name NOT LIKE '[${PREFIX.done}]%' AND r.thread_name NOT LIKE '[${PREFIX.cancelled}]%'))
  ORDER BY r.id LIMIT 50`;

const RESERVE = 3;

/**
 * Inside the 15-minute trigger, after the board: expires requests (nothing claimed in 14 days; no activity in 30), keeps
 * open threads from auto-archiving (the board's keep-active rule: unarchive an archived one, bump one due within
 * KEEP_ACTIVE_MS), posts a first message that never went out, and catches up refused renames. No message is posted to
 * keep a thread active. Stops before the invocation's call budget runs out; the rest waits for the next sweep.
 */
export async function sweepRequests(db: D1Database, api: BotApi, nowMs: number): Promise<SweepResult> {
  const r: SweepResult = { open: 0, expired: 0, unarchived: 0, bumped: 0, renamed: 0, rename_refused: 0, first_messages: 0, errors: [], rows_written: 0 };
  const { results: reqs } = await db.prepare(SWEEP_SQL).bind(new Date(nowMs - 7 * 86_400_000).toISOString()).all<RequestRow>();
  if (!reqs.length) return r;
  const canCall = (n: number) => budgetLeft(api.budget) >= n + RESERVE && Date.now() < api.budget.deadline;
  const [itemsRes, namesRes] = await db.batch([
    db.prepare(ITEMS_SQL).bind(JSON.stringify(reqs.map((q) => q.id))),
    db.prepare(`SELECT guild_id, discord_user_id, display_name FROM member WHERE guild_id IN (SELECT value FROM json_each(?))`).bind(JSON.stringify([...new Set(reqs.map((q) => q.guild_id))])),
  ]);
  const itemsOf = (id: number) => (itemsRes.results as ItemRow[]).filter((i) => i.request_id === id);
  const namesIn = (guild: string): Names =>
    new Map((namesRes.results as { guild_id: string; discord_user_id: string; display_name: string }[]).filter((n) => n.guild_id === guild).map((n) => [n.discord_user_id, n.display_name]));
  const active = new Map<string, Map<string, ThreadInfo> | null>();
  const writes: D1PreparedStatement[] = [];

  for (const req0 of reqs) {
    let req = req0;
    let items = itemsOf(req.id);
    if (req.status === 'open') r.open++;
    const names = namesIn(req.guild_id);
    let notice: { content: string; ping: string[] } | undefined;
    // Expiry: nothing claimed in 14 days, or no activity in 30.
    if (req.status === 'open') {
      const created = Date.parse(req.created_at);
      const last = Math.max(created, req.last_activity ? Date.parse(req.last_activity) : 0);
      const untouched = items.every((i) => i.status === 'open');
      const reason: CloseReason | null = untouched && nowMs - created >= EXPIRE_UNCLAIMED_MS ? 'expired' : nowMs - last >= EXPIRE_INACTIVE_MS ? 'inactive' : null;
      if (reason) {
        if (!canCall(4)) break;
        const res = await db.batch(closeStatements(db, req, reason, 'sweep', 'request.expire'));
        r.rows_written += res.reduce((n, x) => n + (x.meta.rows_written ?? 0), 0);
        if (res[1].meta.changes !== 1) continue;
        r.expired++;
        req = { ...req, status: 'closed', close_reason: reason };
        items = items.map((i) => (i.status === 'open' || i.status === 'claimed' ? { ...i, status: 'cancelled' as const } : i));
        notice = { content: reason === 'expired' ? 'This request closed itself: nothing was claimed in 14 days.' : 'This request closed itself after 30 days with no activity.', ping: [] };
      }
    }
    // Keep an open thread active (no message posted): the guild's active threads, read once per guild.
    if (req.status === 'open') {
      if (!active.has(req.guild_id)) {
        if (!canCall(1)) break;
        const a = await api.call<{ threads?: { id: string; flags?: number; last_message_id?: string | null; thread_metadata?: { archived?: boolean; archive_timestamp?: string; auto_archive_duration?: number } }[] }>(
          'GET',
          `/guilds/${req.guild_id}/threads/active`,
        );
        active.set(
          req.guild_id,
          a.ok
            ? new Map((a.body.threads ?? []).map((t) => [t.id, { id: t.id, archived: !!t.thread_metadata?.archived, flags: t.flags ?? 0, last_message_id: t.last_message_id, archive_timestamp: t.thread_metadata?.archive_timestamp, auto_archive_duration: t.thread_metadata?.auto_archive_duration }]))
            : null,
        );
      }
      const list = active.get(req.guild_id);
      const info = list?.get(req.thread_id!);
      if (list && (!info || info.archived)) {
        if (!canCall(1)) break;
        const u = await api.call('PATCH', `/channels/${req.thread_id}`, { archived: false });
        if (u.ok) r.unarchived++;
        else r.errors.push(`unarchive request ${req.id}: ${u.status} ${u.code ?? ''}`.trim());
      } else if (info) {
        const due = archivesAt(info);
        if (due !== null && due - nowMs <= KEEP_ACTIVE_MS) {
          if (!canCall(1)) break;
          const b = await api.call('PATCH', `/channels/${req.thread_id}`, { auto_archive_duration: info.auto_archive_duration === AUTO_ARCHIVE_MINUTES ? BUMP_MINUTES : AUTO_ARCHIVE_MINUTES });
          if (b.ok) r.bumped++;
          else r.errors.push(`keep active request ${req.id}: ${b.status} ${b.code ?? ''}`.trim());
        }
      }
    }
    // Catch up: a first message that never went out, a closing, or a name behind the rows.
    const lagging = threadName(prefixOf(req, items), items, req.main) !== req.thread_name;
    if (notice || !req.message_id || lagging) {
      if (!canCall(5)) break;
      const s = await syncThread(api, req, items, names, notice);
      if (!req.message_id && s.message_id) r.first_messages++;
      if (s.renamed) r.renamed++;
      if (s.rename_refused) r.rename_refused++;
      r.errors.push(...s.errors.map((e) => `request ${req.id}: ${e}`));
      if (s.thread_name || s.message_id !== req.message_id) writes.push(syncWrite(db, req, s));
    }
  }
  if (writes.length) {
    const res = await db.batch(writes);
    r.rows_written += res.reduce((n, x) => n + (x.meta.rows_written ?? 0), 0);
  }
  return r;
}

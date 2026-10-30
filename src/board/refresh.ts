// Keeping the roster board current (order 5, PRD FR-5):
// - a skill or character change marks its tradeskills dirty (markSkillsDirty / markCharacterDirty, in the
//   command's own write batch) and the same request rewrites them in ctx.waitUntil after the reply;
// - the 15-minute cron sweeps anything still dirty or missing; the nightly run re-renders every post;
// - a post whose content hash is unchanged is never edited.
//
// dirty: 0 = clean, 1 = marked by a change, 2 = claimed by a running refresh. A run claims 1 → 2 when it
// loads, and on success writes 0 only where the row is still 2, so a change made during the run stays 1.
// A run that dies leaves 2, which every later run still treats as dirty.
//
// Archived posts: members cannot reply in an archived post, and an edit there fails (50083), so an edit
// first sets archived:false (one extra call; only SEND_MESSAGES is needed for an unlocked thread), which
// also brings the post back from "Older Posts". The index post is pinned; a pinned post never auto-archives,
// and a run that finds it unpinned or archived pins it again.
//
// A→Z (order 6, ITEM 1.1; src/board/order.ts). With the forum sorted by creation date (newest first):
// - missing posts are created Z→A, and a run that fails or skips a create creates nothing after it, so
//   no post is ever created out of sequence;
// - the nightly run keeps every tradeskill post active, so none drops into "Older Posts": an archived post
//   is unarchived, and a post within KEEP_ACTIVE_MS of auto-archiving has its auto-archive time changed
//   (Discord counts that change as activity);
// - /guildcraft rebuild-board sets guild.board_rebuild_since. Until it is done, the posts older than it
//   are replaced Z→A (create first), then the old ones are deleted. A post with member messages
//   (message_count > 0) is never replaced or deleted (ORDER-RULES, order 6). A refresh after an ordinary
//   command creates and deletes nothing while a rebuild is in progress; a sweep or a rebuild run continues it.
import { now as isoNow, type WaitUntil } from '../access.ts';
import type { Ctx } from '../context.ts';
import { countD1, isolateSnapshot, type D1Call } from '../telemetry.ts';
import { isDevCopy, type Env } from '../env.ts';
import { BOARD_CALL_CAP, botApi, budgetLeft, THREAD_ARCHIVED, UNKNOWN_CHANNEL, UNKNOWN_MESSAGE, type ApiLogEntry, type BoardBudget, type BotApi } from './api.ts';
import { sourceOf, type BoardPostRow } from './data.ts';
import { FACTION_SHOWN, FACTIONS, TRADESKILLS, type BoardKind, type BoardName } from './kinds.ts';
import { boardInOrder, snowflakeAt, snowflakeMs } from './order.ts';
import { contentHash, type BoardMessage, type LineMode } from './render.ts';
import { isDepartureRun, runDepartures } from '../departures.ts';
import { guardDecay, isDecayGuardRun, rotate } from '../dkp/guard.ts';
import { STALE_GUILDS, sweepStale } from '../dkp/stale.ts';
import { usageAlerts } from '../usage.ts';
import { sweepRequests } from '../requests.ts';
import { sweepFinished, sweepStarted } from '../heartbeat.ts';

/** The forum post auto-archive setting at creation: 7 days, the longest Discord allows. */
export const AUTO_ARCHIVE_MINUTES = 10080;
/** The keep-active bump alternates between these two (Discord's allowed values include 4320 and 10080). */
export const BUMP_MINUTES = 4320;
/** The nightly run bumps any post that would auto-archive within this long (2 days: one missed night is covered). */
export const KEEP_ACTIVE_MS = 2 * 86_400_000;
/** Channel flag PINNED (1 << 1): only one post per forum can carry it. */
export const PINNED = 1 << 1;
/** Longer than either run's deadline, so a lease never lapses while its run is still calling Discord. */
const LEASE_MS = 90_000;
/** The nightly rebuild runs on the 15-minute trigger whose time falls in this UTC hour's first quarter (after the 07:30 import). */
export const NIGHTLY_HOUR_UTC = 8;
/** A run after a command must finish inside waitUntil's 30 seconds. */
export const AFTER_COMMAND_MS = 25_000;
/** A cron run may take longer (15 minutes of wall time); a minute is ample for one guild's posts. */
export const CRON_RUN_MS = 60_000;

export type Trigger = 'command' | 'sweep' | 'nightly' | 'rebuild';

export interface RefreshResult {
  /** Order 24: which board (src/board/kinds.ts). */
  board: BoardName;
  locked?: true;
  no_board?: true;
  created: number;
  edited: number;
  unarchived: number;
  skipped_unchanged: number;
  messages_added: number;
  messages_deleted: number;
  left_dirty: number;
  gone: number;
  index: 'created' | 'edited' | 'unchanged' | 'not_reached' | 'failed' | 'none';
  repinned: boolean;
  /** Order 6: keep-active bumps (auto-archive time changed). */
  bumped: number;
  /** Order 6, rebuild: old posts replaced by a new post, and old posts deleted. */
  replaced: number;
  deleted_old: number;
  /** Order 25: posts whose topic is no longer shown, edited to their one-line notice and archived (never deleted). */
  retired: number;
  /** Tradeskills whose post has member messages: never replaced or deleted (names are game data). */
  guarded: string[];
  rebuild: 'none' | 'in_progress' | 'done' | 'held';
  /** Whether the posts that exist show A→Z after this run (src/board/order.ts). */
  in_order: boolean;
  errors: string[];
}

const emptyResult = (board: BoardName): RefreshResult => ({
  board,
  created: 0, edited: 0, unarchived: 0, skipped_unchanged: 0, messages_added: 0, messages_deleted: 0, left_dirty: 0, gone: 0, index: 'none', repinned: false,
  bumped: 0, replaced: 0, deleted_old: 0, retired: 0, guarded: [], rebuild: 'none', in_order: true, errors: [],
});

// ---------------------------------------------------------------- marking dirty (inside a command's write batch)

/** The tradeskills' posts need rewriting. Also asks this request to rewrite them after its reply. */
export function markSkillsDirty(c: Ctx, skillIds: number[]): D1PreparedStatement {
  if (c.guild.board_channel_id) c.effects.board = true;
  return c.db
    .prepare(`UPDATE board_post SET dirty = 1 WHERE guild_id = ? AND tradeskill_id IN (SELECT value FROM json_each(?))`)
    .bind(c.guild.id, JSON.stringify(skillIds));
}

/** Every post that lists this character (a rename, a removal, a restore). */
export function markCharacterDirty(c: Ctx, characterId: number): D1PreparedStatement {
  if (c.guild.board_channel_id) c.effects.board = true;
  return c.db
    .prepare('UPDATE board_post SET dirty = 1 WHERE guild_id = ? AND tradeskill_id IN (SELECT tradeskill_id FROM character_skill WHERE character_id = ?)')
    .bind(c.guild.id, characterId);
}

// ---------------------------------------------------------------- one guild's refresh

/** A thread as Discord's thread lists return it (docs.discord.com/developers/resources/channel). */
export interface ThreadInfo {
  id: string;
  parent_id?: string;
  owner_id?: string;
  archived: boolean;
  flags: number;
  /** "number of messages (not including the initial message or deleted messages)". */
  message_count?: number;
  last_message_id?: string | null;
  archive_timestamp?: string;
  auto_archive_duration?: number;
}
type Threads = Map<string, ThreadInfo> | null;

type ApiThread = {
  id: string;
  parent_id?: string;
  owner_id?: string;
  flags?: number;
  message_count?: number;
  last_message_id?: string | null;
  thread_metadata?: { archived?: boolean; archive_timestamp?: string; auto_archive_duration?: number };
};

const threadMap = (threads: ApiThread[] | undefined): Map<string, ThreadInfo> =>
  new Map(
    (threads ?? []).map((t) => [
      t.id,
      {
        id: t.id, parent_id: t.parent_id, owner_id: t.owner_id, archived: !!t.thread_metadata?.archived, flags: t.flags ?? 0, message_count: t.message_count,
        last_message_id: t.last_message_id, archive_timestamp: t.thread_metadata?.archive_timestamp, auto_archive_duration: t.thread_metadata?.auto_archive_duration,
      },
    ]),
  );

/** The guild's active threads in one call: which of our posts are archived, and whether the index is pinned. */
async function activeThreads(api: BotApi, guildId: string): Promise<Threads> {
  const r = await api.call<{ threads?: ApiThread[] }>('GET', `/guilds/${guildId}/threads/active`);
  return r.ok ? threadMap(r.body.threads) : null;
}

/** Pages of 100 read for a rebuild: the factions board's posts auto-archive (order 24), so more than 100 can be archived. */
const ARCHIVED_PAGES = 3;

/**
 * The forum's archived posts (rebuild only: their message counts and owners), a page of 100 per call, newest archived first
 * ("ordered by archive_timestamp, in descending order"; `before` pages back). null if unread or still incomplete.
 */
async function archivedThreads(api: BotApi, forumId: string): Promise<Threads> {
  const all: ApiThread[] = [];
  let before = '';
  for (let page = 0; page < ARCHIVED_PAGES; page++) {
    const r = await api.call<{ threads?: ApiThread[]; has_more?: boolean }>('GET', `/channels/${forumId}/threads/archived/public?limit=100${before}`);
    if (!r.ok) return null;
    const threads = r.body.threads ?? [];
    all.push(...threads);
    const last = threads.at(-1)?.thread_metadata?.archive_timestamp;
    if (!r.body.has_more) return threadMap(all);
    if (!last) return null;
    before = `&before=${encodeURIComponent(last)}`;
  }
  return null;
}

/** null when unknown (the read failed); otherwise whether the thread is archived (absent from the active list). */
const isArchived = (active: Threads, threadId: string): boolean | null => (active ? !active.get(threadId) || active.get(threadId)!.archived : null);

/** When Discord will auto-archive an active thread: its last activity plus its auto-archive time. */
export function archivesAt(t: ThreadInfo): number | null {
  if (!t.auto_archive_duration) return null;
  const last = Math.max(t.archive_timestamp ? Date.parse(t.archive_timestamp) : 0, snowflakeMs(t.last_message_id ?? t.id));
  return last + t.auto_archive_duration * 60_000;
}

/** Order 22: the first-message line is on. The rollback sets 'clear' (src/board/render.ts LineMode). */
export const BOARD_LINE: LineMode = 'on';

/** Content only when the message carries it (the first message), on create and on edit; allowed_mentions always explicit. */
const body = (m: BoardMessage) => ({ ...(m.content !== undefined ? { content: m.content } : {}), embeds: m.embeds, allowed_mentions: m.allowed_mentions });

type PostOutcome = { row: Omit<BoardPostRow, 'dirty' | 'last_rendered_at'>; complete: boolean } | { gone: true } | { failed: true };

/** Creates a topic's forum post (a tradeskill's or a faction's): the first message with the thread, then any overflow messages. */
async function createPost(api: BotApi, forumId: string, skill: string, topicId: number, msgs: BoardMessage[], hash: string, r: RefreshResult): Promise<PostOutcome> {
  const made = await api.call<{ id: string; message?: { id: string } }>('POST', `/channels/${forumId}/threads`, {
    name: skill.slice(0, 100),
    auto_archive_duration: AUTO_ARCHIVE_MINUTES,
    message: body(msgs[0]),
  });
  if (!made.ok) {
    r.errors.push(`create ${skill}: ${made.status} ${made.code ?? ''} ${made.error}`.trim());
    return { failed: true };
  }
  r.created++;
  const thread = made.body.id;
  const ids = [made.body.message?.id ?? thread];
  for (const m of msgs.slice(1)) {
    const sent = await api.call<{ id: string }>('POST', `/channels/${thread}/messages`, body(m));
    if (!sent.ok) {
      r.errors.push(`overflow ${skill}: ${sent.status} ${sent.code ?? ''}`.trim());
      return { row: { topic_id: topicId, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: null }, complete: false };
    }
    ids.push(sent.body.id);
    r.messages_added++;
  }
  return { row: { topic_id: topicId, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: hash }, complete: true };
}

async function unarchive(api: BotApi, thread: string, r: RefreshResult): Promise<'ok' | 'gone' | 'failed'> {
  const u = await api.call('PATCH', `/channels/${thread}`, { archived: false });
  if (u.ok) {
    r.unarchived++;
    return 'ok';
  }
  return u.code === UNKNOWN_CHANNEL ? 'gone' : 'failed';
}

/** Rewrites an existing post: unarchive when archived, edit each bot-owned message, add or delete overflow messages. */
async function editPost(api: BotApi, post: BoardPostRow, skill: string, msgs: BoardMessage[], hash: string, archived: boolean | null, r: RefreshResult): Promise<PostOutcome> {
  const thread = post.thread_id;
  let ids: string[] = (() => {
    try {
      const v = JSON.parse(post.message_ids_json);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  })();
  if (!ids.length) ids = [thread];
  const partial = () => ({ row: { topic_id: post.topic_id, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: null }, complete: false });

  if (archived) {
    const u = await unarchive(api, thread, r);
    if (u === 'gone') return { gone: true };
    if (u === 'failed') {
      r.errors.push(`unarchive ${skill}: failed`);
      return { failed: true };
    }
  }
  const next: string[] = [];
  for (let i = 0; i < msgs.length; i++) {
    const id = ids[i];
    if (id) {
      let e = await api.call('PATCH', `/channels/${thread}/messages/${id}`, body(msgs[i]));
      if (!e.ok && e.code === THREAD_ARCHIVED && !archived) {
        // Archived since the active-threads read (or that read failed): unarchive, then edit once more.
        const u = await unarchive(api, thread, r);
        if (u === 'gone') return { gone: true };
        if (u === 'ok') e = await api.call('PATCH', `/channels/${thread}/messages/${id}`, body(msgs[i]));
      }
      if (e.ok) {
        next.push(id);
        continue;
      }
      if (e.code === UNKNOWN_CHANNEL || (i === 0 && e.code === UNKNOWN_MESSAGE)) return { gone: true };
      if (e.code !== UNKNOWN_MESSAGE) {
        r.errors.push(`edit ${skill}: ${e.status} ${e.code ?? ''}`.trim());
        ids = [...next, ...ids.slice(i)];
        return i === 0 ? { failed: true } : partial();
      }
      // An overflow message was deleted by someone: post a new one in its place.
    }
    const sent = await api.call<{ id: string }>('POST', `/channels/${thread}/messages`, body(msgs[i]));
    if (!sent.ok) {
      r.errors.push(`overflow ${skill}: ${sent.status} ${sent.code ?? ''}`.trim());
      ids = [...next, ...ids.slice(i + 1)];
      return partial();
    }
    next.push(sent.body.id);
    r.messages_added++;
  }
  for (const extra of ids.slice(msgs.length)) {
    const d = await api.call('DELETE', `/channels/${thread}/messages/${extra}`);
    if (!d.ok && d.code !== UNKNOWN_MESSAGE) {
      ids = [...next, ...ids.slice(ids.indexOf(extra))];
      r.errors.push(`delete overflow ${skill}: ${d.status} ${d.code ?? ''}`.trim());
      return partial();
    }
    r.messages_deleted++;
  }
  ids = next;
  r.edited++;
  return { row: { topic_id: post.topic_id, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: hash }, complete: true };
}

/** Calls kept back for the index (edit + pin) and the final D1 write. */
const RESERVE = 3;
/** A sweep's calls before its first post: the heartbeat, out-of-date cards, the sweep query, the run's batch, the active threads. */
const SWEEP_OVERHEAD = 5;
/** Order 33: the guilds with out-of-date cards take turns by the sweep, not by the day. */
const SWEEP_PERIOD_MS = 900_000;
/** Order 30: the posts a sweep can make (one call each), for the building line when this run made none to measure by. */
export const postsPerSweep = (k: BoardKind) => BOARD_CALL_CAP - SWEEP_OVERHEAD - RESERVE - (k === FACTIONS ? FACTIONS_FLOOR : 0);

/**
 * Refreshes one guild's board: missing posts are created (Z→A), dirty ones (all of them when `all`)
 * re-rendered and edited when their hash changed, then the index. The nightly run (`all`) first keeps every
 * post active; a rebuild in progress replaces old posts, then deletes them. Stops before the call budget or
 * the deadline runs out; whatever it did not reach stays dirty (or missing, or old) for the next run.
 */
export async function refreshGuildBoard(
  db: D1Database,
  api: BotApi,
  guildId: string,
  opts: { all?: boolean; nowMs?: number; trigger?: Trigger; line?: LineMode; kind?: BoardKind; floor?: number } = {},
): Promise<RefreshResult> {
  const line = opts.line ?? BOARD_LINE;
  // Order 24: which board (src/board/kinds.ts); its own columns and posts table, the same machinery.
  const k = opts.kind ?? TRADESKILLS;
  const r = emptyResult(k.name);
  const nowMs = opts.nowMs ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const lease = `${new Date(nowMs + LEASE_MS).toISOString()}#${crypto.randomUUID().slice(0, 8)}`;
  const src = sourceOf(k);

  // One round trip: take the lease, read everything, claim the dirty rows (only if the lease was taken).
  const results = await db.batch([
    db
      .prepare(`UPDATE guild SET ${k.lock} = ? WHERE id = ? AND ${k.channel} IS NOT NULL AND (${k.lock} IS NULL OR ${k.lock} < ?)`)
      .bind(lease, guildId, at),
    ...src.statements(db, guildId),
    db
      .prepare(`UPDATE ${k.table} SET dirty = 2 WHERE guild_id = ?1 AND dirty <> 0 AND EXISTS (SELECT 1 FROM guild WHERE id = ?1 AND ${k.lock} = ?2)`)
      .bind(guildId, lease),
  ]);
  const data = src.fromResults(results.slice(1, -1));
  if (!data?.guild.board_channel_id) return { ...r, no_board: true };
  if (results[0].meta.changes !== 1) return { ...r, locked: true };
  const forum = data.guild.board_channel_id;

  // The rebuild (order 6): posts whose thread predates board_rebuild_since are old.
  const since = data.guild.board_rebuild_since;
  const sinceSf = since ? snowflakeAt(Date.parse(since)) : null;
  const isOld = (thread: string) => sinceSf !== null && BigInt(thread) < sinceSf;
  // A refresh after an ordinary command never creates while a rebuild is in progress.
  const mayCreate = !(since && opts.trigger === 'command');
  const rebuilding = !!since && mayCreate;
  if (since) r.rebuild = mayCreate ? 'in_progress' : 'held';

  const work = data.topics.filter((t) => {
    const p = data.posts.get(t.id);
    return opts.all || !p || p.dirty !== 0 || data.stale(t.id) || (rebuilding && isOld(p.thread_id));
  });
  const needActive = work.some((t) => data.posts.has(t.id)) || data.retiring.length > 0 || !!data.guild.board_index_thread_id || rebuilding;
  const active = needActive ? await activeThreads(api, guildId) : null;
  const archivedList = rebuilding ? await archivedThreads(api, forum) : null;
  // Without both lists the rebuild cannot tell member messages apart, so this run replaces and deletes nothing.
  const rebuildBlind = rebuilding && (active === null || archivedList === null);
  if (rebuildBlind) r.errors.push('rebuild: thread lists unread; nothing replaced this run');
  const infoOf = (thread: string) => active?.get(thread) ?? archivedList?.get(thread);

  // Posts with member messages are never replaced (ORDER-RULES, order 6).
  const guarded = new Set<number>();
  if (rebuilding)
    for (const t of data.topics) {
      const p = data.posts.get(t.id);
      if (p && isOld(p.thread_id) && (infoOf(p.thread_id)?.message_count ?? 0) > 0) {
        guarded.add(t.id);
        r.guarded.push(t.name);
      }
    }

  const writes: D1PreparedStatement[] = [];
  const upsert = (row: Omit<BoardPostRow, 'dirty' | 'last_rendered_at'>, complete: boolean) =>
    db
      .prepare(
        `INSERT INTO ${k.table} (guild_id, ${k.key}, thread_id, message_ids_json, content_hash, dirty, last_rendered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(guild_id, ${k.key}) DO UPDATE SET thread_id = excluded.thread_id, message_ids_json = excluded.message_ids_json,
           content_hash = excluded.content_hash, last_rendered_at = excluded.last_rendered_at,
           dirty = CASE WHEN excluded.dirty = 1 OR ${k.table}.dirty = 1 THEN 1 ELSE 0 END`,
      )
      .bind(guildId, row.topic_id, row.thread_id, row.message_ids_json, row.content_hash, complete ? 0 : 1, at);
  const leaveDirty = (topicId: number) => {
    r.left_dirty++;
    if (data.posts.has(topicId)) writes.push(db.prepare(`UPDATE ${k.table} SET dirty = 1 WHERE guild_id = ? AND ${k.key} = ?`).bind(guildId, topicId));
  };
  const forget = (topicId: number, thread: string) =>
    writes.push(db.prepare(`DELETE FROM ${k.table} WHERE guild_id = ? AND ${k.key} = ? AND thread_id = ?`).bind(guildId, topicId, thread));
  const threads = new Map<number, string>([...data.posts].map(([id, p]) => [id, p.thread_id]));
  const unarchivedNow = new Set<string>();
  /** Posts found deleted in Discord by the keep-active step: forgotten below, recreated by the next run. */
  const goneNow = new Set<number>();
  // Order 24: `floor` calls are left for the work after this board (the request sweep), whatever this board needs.
  const floor = opts.floor ?? 0;
  const canCall = (n: number) => budgetLeft(api.budget) - floor >= n && Date.now() < api.budget.deadline;

  // Keep active (nightly, boards that keep their posts active): an archived post is unarchived; one close to
  // auto-archiving gets its archive time changed.
  if (opts.all && k.nightly && active && !since)
    for (const t of data.topics) {
      const p = data.posts.get(t.id);
      if (!p) continue;
      const info = active.get(p.thread_id);
      const due = info ? archivesAt(info) : null;
      const archived = !info || info.archived;
      if (!archived && (due === null || due - nowMs > KEEP_ACTIVE_MS)) continue;
      if (!canCall(1 + RESERVE)) break;
      if (archived) {
        const u = await unarchive(api, p.thread_id, r);
        if (u === 'ok') unarchivedNow.add(p.thread_id);
        else if (u === 'gone') goneNow.add(t.id);
        continue;
      }
      const next = info!.auto_archive_duration === AUTO_ARCHIVE_MINUTES ? BUMP_MINUTES : AUTO_ARCHIVE_MINUTES;
      const b = await api.call('PATCH', `/channels/${p.thread_id}`, { auto_archive_duration: next });
      if (b.ok) r.bumped++;
      else r.errors.push(`keep active ${t.name}: ${b.status} ${b.code ?? ''}`.trim());
    }

  let stopped = false;
  // Once a create fails or is skipped, nothing is created after it in this run: posts are only ever created Z→A.
  let createStopped = false;
  for (const t of [...work].reverse()) {
    const post = data.posts.get(t.id);
    if (post && goneNow.has(t.id)) {
      r.gone++;
      threads.delete(t.id);
      forget(t.id, post.thread_id);
      continue;
    }
    const msgs = data.render(t, nowMs, line);
    const hash = await contentHash(msgs);
    const replace = !!post && rebuilding && isOld(post.thread_id) && !guarded.has(t.id);
    if (!post || replace) {
      if (!mayCreate || createStopped || (replace && rebuildBlind)) {
        if (post && post.dirty !== 0) leaveDirty(t.id);
        else if (!post) r.left_dirty++;
        continue;
      }
      if (stopped || !canCall(msgs.length + RESERVE)) {
        stopped = createStopped = true;
        leaveDirty(t.id);
        continue;
      }
      const out = await createPost(api, forum, t.name, t.id, msgs, hash, r);
      if ('failed' in out || 'gone' in out) {
        createStopped = true;
        leaveDirty(t.id);
        continue;
      }
      if (replace) r.replaced++;
      threads.set(t.id, out.row.thread_id);
      writes.push(upsert(out.row, out.complete));
      if (!out.complete) r.left_dirty++;
      continue;
    }
    if (post.content_hash === hash) {
      r.skipped_unchanged++;
      writes.push(upsert(post, true));
      continue;
    }
    const archived = unarchivedNow.has(post.thread_id) ? false : isArchived(active, post.thread_id);
    const need = msgs.length + (archived ? 1 : 0) + Math.max(0, JSON.parse(post.message_ids_json).length - msgs.length);
    if (stopped || !canCall(need + RESERVE)) {
      stopped = true;
      leaveDirty(t.id);
      continue;
    }
    const out = await editPost(api, post, t.name, msgs, hash, archived, r);
    if ('gone' in out) {
      // The post was deleted in Discord: forget it, and the next run creates it again.
      r.gone++;
      threads.delete(t.id);
      forget(t.id, post.thread_id);
    } else if ('failed' in out) {
      leaveDirty(t.id);
    } else {
      threads.set(t.id, out.row.thread_id);
      writes.push(upsert(out.row, out.complete));
      if (!out.complete) r.left_dirty++;
    }
  }

  // Order 25: retire the posts of topics no longer shown: edit to the one-line notice (unarchiving first when archived),
  // then archive. The row and the thread are kept, so a rebuild never deletes them (they stay referenced) and a topic
  // shown again is edited back by the loop above (its hash differs from the notice's).
  for (const t of data.retiring) {
    const post = data.posts.get(t.id)!;
    const msgs = [t.notice];
    const hash = await contentHash(msgs);
    if (post.content_hash === hash) {
      // The notice is already there. Only a thread known to be still active gets one more archive call (review: never
      // the edit again, so a refused archive costs one call when the post is next due, not an edit every sweep).
      if (isArchived(active, post.thread_id) === false && !stopped && canCall(1 + RESERVE)) {
        const a = await api.call('PATCH', `/channels/${post.thread_id}`, { archived: true });
        if (a.ok) r.retired++;
        else r.errors.push(`archive ${t.name}: ${a.status} ${a.code ?? ''}`.trim());
      } else r.skipped_unchanged++;
      writes.push(upsert(post, true));
      continue;
    }
    const archived = isArchived(active, post.thread_id);
    const need = 2 + (archived ? 1 : 0) + Math.max(0, JSON.parse(post.message_ids_json).length - 1);
    if (stopped || !canCall(need + RESERVE)) {
      stopped = true;
      leaveDirty(t.id);
      continue;
    }
    const out = await editPost(api, post, t.name, msgs, hash, archived, r);
    if ('gone' in out) {
      r.gone++;
      threads.delete(t.id);
      forget(t.id, post.thread_id);
      continue;
    }
    if ('failed' in out) {
      leaveDirty(t.id);
      continue;
    }
    // Modify Channel (thread): archived true "requires the MANAGE_THREADS permission" (src/permissions.ts, board PATCH).
    // An incomplete edit stays dirty and is redone. A refused archive is logged, and the post keeps its notice
    // (review: no retry loop; the hash-match path above retries the archive alone when the post is next due).
    if (!out.complete) {
      writes.push(upsert(out.row, false));
      r.left_dirty++;
      continue;
    }
    const a = await api.call('PATCH', `/channels/${post.thread_id}`, { archived: true });
    if (a.ok) r.retired++;
    else r.errors.push(`archive ${t.name}: ${a.status} ${a.code ?? ''}`.trim());
    writes.push(upsert(out.row, true));
  }

  // The rebuild's second half: once every unguarded post is new, delete the old ones. An old post is a
  // bot-owned thread in this forum, older than the rebuild, that no row references, with no member messages.
  if (rebuilding && !rebuildBlind) {
    const remaining = data.topics.filter((t) => !guarded.has(t.id) && (!threads.get(t.id) || isOld(threads.get(t.id)!))).length;
    if (remaining === 0) {
      const referenced = new Set([...threads.values(), data.guild.board_index_thread_id].filter(Boolean) as string[]);
      // The bot's own user id, read from a thread it is known to own (the index or any post).
      const botId = [...referenced].map((id) => infoOf(id)?.owner_id).find(Boolean);
      const listed = [...(active?.values() ?? []), ...(archivedList?.values() ?? [])];
      const old = botId ? listed.filter((x) => x.parent_id === forum && x.owner_id === botId && !referenced.has(x.id) && isOld(x.id)) : [];
      let left = 0;
      for (const x of old) {
        if ((x.message_count ?? 1) !== 0) {
          left++;
          r.errors.push(`old post kept: it has member messages (${x.message_count ?? 'unknown'})`);
          continue;
        }
        if (!canCall(1 + RESERVE)) {
          left++;
          continue;
        }
        const d = await api.call('DELETE', `/channels/${x.id}`);
        if (d.ok || d.code === UNKNOWN_CHANNEL) r.deleted_old++;
        else {
          left++;
          r.errors.push(`delete old post: ${d.status} ${d.code ?? ''}`.trim());
        }
      }
      if (!botId) r.errors.push("rebuild: could not tell which threads are the bot's; old posts not deleted");
      else if (left === 0) {
        r.rebuild = 'done';
        writes.push(db.prepare(`UPDATE guild SET ${k.rebuild} = NULL WHERE id = ? AND ${k.rebuild} = ?`).bind(guildId, since));
      }
    }
  }
  r.in_order = boardInOrder(data.topics, (id) => threads.get(id));

  // The index: created (and pinned) once, edited when its links or counts changed or any post was written.
  const wrote = r.created + r.edited + r.gone + r.retired > 0;
  // Order 30: the building line's pace is what this run really made (rate limits included), else what a sweep can make.
  const idx = data.index((id) => threads.get(id) ?? null, nowMs, line, r.created || postsPerSweep(k));
  const idxHash = await contentHash(idx.hashable);
  let indexThread = data.guild.board_index_thread_id;
  let indexMessage = data.guild.board_index_message_id;
  let indexHash = data.guild.board_index_hash;
  const canCallIndex = (n: number) => canCall(n + 1);

  if (indexThread && indexMessage) {
    const info = active?.get(indexThread);
    const unpinned = active !== null && (!info || info.archived || (info.flags & PINNED) === 0);
    if (unpinned && canCallIndex(1)) {
      const p = await api.call('PATCH', `/channels/${indexThread}`, { archived: false, flags: PINNED });
      if (p.ok) r.repinned = true;
      else if (p.code === UNKNOWN_CHANNEL) indexThread = indexMessage = indexHash = null;
      else r.errors.push(`re-pin index: ${p.status} ${p.code ?? ''}`.trim());
    }
    if (indexThread && indexMessage && (wrote || idxHash !== indexHash)) {
      if (!canCallIndex(1)) {
        r.index = 'not_reached';
        // Order 30: no saved hash asks the next sweep for this edit (SWEEP_SQL), so a finished board never keeps its building line.
        indexHash = null;
      } else {
        const e = await api.call('PATCH', `/channels/${indexThread}/messages/${indexMessage}`, body(idx.message));
        if (e.ok) {
          r.index = 'edited';
          indexHash = idxHash;
        } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) indexThread = indexMessage = indexHash = null;
        else {
          r.index = 'failed';
          // Order 30: a passing failure is owed to the next sweep (no saved hash). A refusal is not (review: no retry
          // loop): it keeps a hash, so a lost forum stays idle, and the next post written tries the edit again.
          indexHash = e.status === 0 || e.status === 429 || e.status >= 500 ? null : (indexHash ?? idxHash);
          r.errors.push(`edit index: ${e.status} ${e.code ?? ''}`.trim());
        }
      }
    } else if (indexThread) r.index = 'unchanged';
  }
  if (!indexThread || !indexMessage) {
    if (!canCallIndex(2)) r.index = 'not_reached';
    else {
      const made = await api.call<{ id: string; message?: { id: string } }>('POST', `/channels/${forum}/threads`, {
        name: k.indexTitle,
        auto_archive_duration: AUTO_ARCHIVE_MINUTES,
        message: body(idx.message),
      });
      if (made.ok) {
        r.index = 'created';
        indexThread = made.body.id;
        indexMessage = made.body.message?.id ?? made.body.id;
        indexHash = idxHash;
        const p = await api.call('PATCH', `/channels/${indexThread}`, { flags: PINNED });
        if (!p.ok) r.errors.push(`pin index: ${p.status} ${p.code ?? ''}`.trim());
      } else {
        r.index = 'failed';
        r.errors.push(`create index: ${made.status} ${made.code ?? ''} ${made.error}`.trim());
      }
    }
  }

  // One round trip: the rows, the index, and the lease released.
  writes.push(
    db
      .prepare(`UPDATE guild SET ${k.indexThread} = ?, ${k.indexMessage} = ?, ${k.indexHash} = ?, ${k.lock} = NULL WHERE id = ? AND ${k.lock} = ?`)
      .bind(indexThread, indexMessage, indexHash, guildId, lease),
  );
  await db.batch(writes);
  return r;
}

// ---------------------------------------------------------------- the entry points

export interface BoardRunLog {
  gc: 'board';
  trigger: Trigger;
  guilds: number;
  d1_calls: number;
  discord_calls: number;
  calls: ApiLogEntry[];
  results: RefreshResult[];
  err: string | null;
}

/**
 * After a command's reply (inside the same waitUntil): rewrite this guild's dirty posts. `rebuild`: /guildcraft
 * rebuild-board's own run. `discordCalls` (order 19): Discord calls the handler already made in this invocation.
 */
export async function refreshAfterCommand(
  env: Env,
  guildId: string,
  d1Calls: D1Call[],
  opts: { rebuild?: boolean; discordCalls?: number; tradeskills?: boolean; factions?: boolean } = {},
): Promise<BoardRunLog> {
  const budget: BoardBudget = { d1: () => d1Calls.length, discord: opts.discordCalls ?? 0, cap: BOARD_CALL_CAP, deadline: Date.now() + AFTER_COMMAND_MS };
  const trigger: Trigger = opts.rebuild ? 'rebuild' : 'command';
  const log: BoardRunLog = { gc: 'board', trigger, guilds: 1, d1_calls: 0, discord_calls: 0, calls: [], results: [], err: null };
  if (!env.DISCORD_BOT_TOKEN) return { ...log, err: 'DISCORD_BOT_TOKEN not set' };
  const api = botApi(env.DISCORD_BOT_TOKEN, budget);
  const d1Before = d1Calls.length;
  // Order 24: the boards the command asked for, the tradeskill board first (it keeps priority on the budget).
  const kinds = [...(opts.tradeskills !== false ? [TRADESKILLS] : []), ...(opts.factions ? [FACTIONS] : [])];
  try {
    for (const kind of kinds) {
      // The tradeskill board runs as it always has (its own canCall checks bound it); the factions board only on what is left.
      if (kind === FACTIONS && budgetLeft(budget) < RESERVE + 3) break;
      log.results.push(await refreshGuildBoard(env.DB, api, guildId, { trigger, kind }));
    }
  } catch (e) {
    log.err = e instanceof Error ? e.message : String(e);
  }
  return { ...log, d1_calls: d1Calls.length - d1Before, discord_calls: budget.discord - (opts.discordCalls ?? 0), calls: api.log };
}

/** Whether the 15-minute trigger at this time is the nightly rebuild. */
export const isNightly = (scheduledTime: number) => {
  const d = new Date(scheduledTime);
  return d.getUTCHours() === NIGHTLY_HOUR_UTC && d.getUTCMinutes() < 15;
};

/**
 * Boards with something to do, one row per guild and board, in one query (an idle sweep makes three D1 calls: the
 * heartbeat, out-of-date cards and this). The tradeskill boards come first (they keep priority on the budget):
 * - tradeskills: dirty or missing posts, no index, an index edit still owed (order 30: no saved hash), a rebuild in
 *   progress (every board, nightly);
 * - factions (order 24): dirty, stale (the import changed a faction after its post was rendered) or missing posts, no
 *   index, an index edit still owed, a rebuild in progress, or (order 25) a post to retire: its faction no longer shown,
 *   and changed or dirty since its last render. Never every board at night (FACTIONS.nightly).
 * Order 26: it runs 96 times a day per copy, so it answers from indexes (migrations/0020). Shown-and-dirty, shown-and-stale
 * and to-retire (not shown, and dirty or stale) together are "any post dirty or stale", whether its faction is shown or
 * not: one probe of faction_post_dirty, and the factions changed since the guild's oldest render (faction_changed) joined
 * to their posts. Missing posts stay an exact count against the shown factions, built once per run (`shown`). Idle, with
 * one guild's two boards live on the real data: 1,202 rows read per run before, 629 after (scripts/bench/sweep-reads.ts).
 */
export const SWEEP_SQL = `WITH shown(id) AS MATERIALIZED (SELECT f.id FROM faction f WHERE ${FACTION_SHOWN})
SELECT g.id, 'tradeskills' AS board FROM guild g WHERE g.board_channel_id IS NOT NULL AND (?1 = 1 OR g.board_index_message_id IS NULL OR g.board_index_hash IS NULL OR g.board_rebuild_since IS NOT NULL
  OR EXISTS (SELECT 1 FROM board_post p WHERE p.guild_id = g.id AND p.dirty <> 0)
  OR (SELECT count(*) FROM board_post p WHERE p.guild_id = g.id) < (SELECT count(*) FROM tradeskill))
UNION ALL
SELECT g.id, 'factions' AS board FROM guild g WHERE g.${FACTIONS.channel} IS NOT NULL AND (g.${FACTIONS.indexMessage} IS NULL OR g.${FACTIONS.indexHash} IS NULL OR g.${FACTIONS.rebuild} IS NOT NULL
  OR EXISTS (SELECT 1 FROM faction_post p WHERE p.guild_id = g.id AND p.dirty <> 0)
  OR EXISTS (SELECT 1 FROM faction f CROSS JOIN faction_post p ON p.guild_id = g.id AND p.faction_id = f.id
     WHERE f.changed_at > coalesce((SELECT q.last_rendered_at FROM faction_post q WHERE q.guild_id = g.id ORDER BY q.last_rendered_at LIMIT 1), '')
       AND f.changed_at > coalesce(p.last_rendered_at, ''))
  OR (SELECT count(*) FROM faction_post p WHERE p.guild_id = g.id AND +p.faction_id IN (SELECT id FROM shown)) < (SELECT count(*) FROM shown))
ORDER BY board DESC, id`;

/**
 * Order 24 (ITEM 2), the split of one invocation's 40 calls: the tradeskill boards first (every guild, as before), then
 * the factions boards on what is left, stopping while FACTIONS_FLOOR calls remain: the request sweep's RESERVE + 3 and
 * the dev copy's usage warning's 3, which run after the boards. Whatever a board cannot reach stays dirty or missing.
 */
export const FACTIONS_FLOOR = RESERVE + 3 + 3;

/**
 * The scheduled handler (one 15-minute trigger): sweeps dirty and missing posts and continues a rebuild;
 * at NIGHTLY_HOUR_UTC it re-renders every post and keeps them active. Logs one line with its own first-query
 * timing (order 5, ITEM 2: an idle-gap sample every 15 minutes from the same binding path as the interactions).
 */
export async function scheduled(controller: { scheduledTime: number; cron?: string }, env: Env, _ctx?: WaitUntil): Promise<BoardRunLog & Record<string, unknown>> {
  const isolate = isolateSnapshot();
  const counted = countD1(env.DB);
  const nightly = isNightly(controller.scheduledTime);
  const budget: BoardBudget = { d1: () => counted.calls.length, discord: 0, cap: BOARD_CALL_CAP, deadline: Date.now() + CRON_RUN_MS };
  const log: BoardRunLog = { gc: 'board', trigger: nightly ? 'nightly' : 'sweep', guilds: 0, d1_calls: 0, discord_calls: 0, calls: [], results: [], err: null };
  let first: D1Call | undefined;
  let api: BotApi | null = null;
  // Order 20 (ITEM 1): the heartbeat, before any other work. It is now the run's first query after an idle gap, so its
  // timing is logged as heartbeat_ms (order 5's idle-gap sample); first_query_ms stays the sweep's own query.
  let heartbeat: D1Call | undefined;
  try {
    await sweepStarted(counted.db, controller.scheduledTime, isoNow()).run();
    heartbeat = counted.calls.at(-1);
  } catch (e) {
    console.error('heartbeat start failed', e instanceof Error ? e.message : String(e));
  }
  // Order 7: in its own slot (08:15–08:29 UTC) the departure run goes first, on the same 40-call budget; the
  // sweep below gets what is left (it needs RESERVE + 3) and anything it cannot reach stays dirty.
  /** The departure run's calls, so the board line below counts the sweep's own. */
  let before = { d1: 0, discord: 0, log: 0 };
  if (isDepartureRun(controller.scheduledTime) && env.DISCORD_BOT_TOKEN) {
    api = botApi(env.DISCORD_BOT_TOKEN, budget);
    let line: Record<string, unknown> = { gc: 'departures', results: [] };
    try {
      const results = await runDepartures(counted.db, api, {});
      // No names or ids in the log: counts and reasons only.
      line = { gc: 'departures', results: results.map(({ guild: _g, would_mark, ...r }) => ({ ...r, would_mark: would_mark.length })) };
    } catch (e) {
      line.err = e instanceof Error ? e.message : String(e);
    }
    console.log(JSON.stringify({ ...line, d1_calls: counted.calls.length, discord_calls: budget.discord, calls: api.log.slice() }));
    before = { d1: counted.calls.length, discord: budget.discord, log: api.log.length };
  }
  // Order 30 (ITEM 4): in its own slot (09:00–09:14 UTC), first, so a busy board can't starve it: one D1 read, then one
  // Durable Object request per DKP-on guild, each counted as a call. It logs only when there are guilds to check.
  if (isDecayGuardRun(controller.scheduledTime)) {
    try {
      const r = await guardDecay({ ...env, DB: counted.db }, rotate(budgetLeft(budget) - 2, controller.scheduledTime)); // its read and the sweep's
      budget.discord += r.checked;
      if (r.checked) console.log(JSON.stringify({ gc: 'dkp-guard', trigger: 'cron', ...r }));
    } catch (e) {
      console.error('dkp decay guard failed', e instanceof Error ? e.message : String(e));
    }
    before = { d1: counted.calls.length, discord: budget.discord, log: api?.log.length ?? 0 };
  }
  // Order 33: out-of-date cards. One D1 read; one Durable Object request per guild with a flag, each counted as a call, and
  // no Discord call here: each guild's object redraws its own cards, on its own invocations.
  try {
    const r = await sweepStale({ ...env, DB: counted.db }, rotate(Math.max(0, Math.min(STALE_GUILDS, budgetLeft(budget) - 2)), controller.scheduledTime, SWEEP_PERIOD_MS));
    budget.discord += r.asked;
    if (r.cards) console.log(JSON.stringify({ gc: 'stale-cards', ...r }));
  } catch (e) {
    console.error('stale card sweep failed', e instanceof Error ? e.message : String(e));
  }
  try {
    const { results } = await counted.db.prepare(SWEEP_SQL).bind(nightly ? 1 : 0).all<{ id: string; board: BoardName }>();
    first = counted.calls.at(-1);
    log.guilds = new Set(results.map((g) => g.id)).size;
    if (results.length && !env.DISCORD_BOT_TOKEN) log.err = 'DISCORD_BOT_TOKEN not set';
    else if (results.length) {
      api ??= botApi(env.DISCORD_BOT_TOKEN!, budget);
      for (const g of results) {
        // Order 24: the factions boards run on what the tradeskill boards left, keeping FACTIONS_FLOOR for the work after them.
        const factions = g.board === 'factions';
        if (budgetLeft(budget) < (factions ? FACTIONS_FLOOR : 0) + RESERVE + 3) break;
        log.results.push(
          await refreshGuildBoard(counted.db, api, g.id, factions ? { trigger: log.trigger, kind: FACTIONS, floor: FACTIONS_FLOOR } : { all: nightly, trigger: log.trigger }),
        );
      }
    }
  } catch (e) {
    log.err = e instanceof Error ? e.message : String(e);
  }
  const line = {
    ...log,
    cron: controller.cron ?? null,
    d1_calls: counted.calls.length - before.d1,
    discord_calls: budget.discord - before.discord,
    calls: (api?.log ?? []).slice(before.log),
    // ITEM 2: the sweep's own first query, with the isolate's state before it.
    first_query_ms: first?.ms ?? null,
    first_sql_ms: first?.sql_ms ?? null,
    first_rows_read: first?.rows_read ?? null,
    heartbeat_ms: heartbeat?.ms ?? null,
    ...isolate,
  };
  console.log(JSON.stringify(line));
  // Order 16: craft requests, on what the board left of the budget: expiry, keep-active, and renames that were refused.
  // One D1 query when there is nothing open; its own log line only when it found something.
  if (env.DISCORD_BOT_TOKEN && budgetLeft(budget) >= RESERVE + 3) {
    api ??= botApi(env.DISCORD_BOT_TOKEN, budget);
    const mark = { d1: counted.calls.length, discord: budget.discord, log: api.log.length };
    let req: Record<string, unknown> = { gc: 'requests' };
    try {
      const r = await sweepRequests(counted.db, api, controller.scheduledTime);
      req = r.open || r.errors.length || r.renamed || r.rename_refused ? { gc: 'requests', ...r } : {};
    } catch (e) {
      req.err = e instanceof Error ? e.message : String(e);
    }
    if (req.gc) console.log(JSON.stringify({ ...req, d1_calls: counted.calls.length - mark.d1, discord_calls: budget.discord - mark.discord, calls: api.log.slice(mark.log) }));
  }
  // Order 8 (ITEM 2.4): the usage warning, after the sweep (so the sweep's first query stays the run's first after an
  // idle gap, order 5): one read per run; it posts only when a metric's state changes (src/usage.ts). It needs a read,
  // a post and a write; whatever the sweep left dirty waits for the next run either way.
  // Order 11 (override 1): the dev copy only. Production posts no usage warning in any guild's channel; its operator
  // alarm is the usage job's failed run (scripts/usage/level-alarm.ts).
  if (isDevCopy(env.GUILDCRAFT_COPY) && env.DISCORD_BOT_TOKEN && budgetLeft(budget) >= 3) {
    api ??= botApi(env.DISCORD_BOT_TOKEN, budget);
    const mark = { d1: counted.calls.length, discord: budget.discord, log: api.log.length };
    let usage: Record<string, unknown> = { gc: 'usage-alert' };
    try {
      usage = { ...(await usageAlerts(counted.db, api, env.GUILDCRAFT_COPY, controller.scheduledTime)) };
    } catch (e) {
      usage.err = e instanceof Error ? e.message : String(e);
    }
    console.log(JSON.stringify({ ...usage, d1_calls: counted.calls.length - mark.d1, discord_calls: budget.discord - mark.discord, calls: api.log.slice(mark.log) }));
  }
  // Order 20: the finish, last. One call past the budget checks above: at most BOARD_CALL_CAP + 1, under the 50 subrequests.
  try {
    await sweepFinished(counted.db, controller.scheduledTime, isoNow()).run();
  } catch (e) {
    console.error('heartbeat finish failed', e instanceof Error ? e.message : String(e));
  }
  return line;
}

/**
 * A minute before the request: a post created after it must never read as old, even if Discord's clock runs
 * behind ours (an old-looking new post would be replaced again). Old posts are hours old, so the margin costs nothing.
 */
const CLOCK_MARGIN_MS = 60_000;

/** /guildcraft rebuild-board: asks for the rebuild (the refresh after the reply starts it). A rebuild already in progress keeps its start. */
export function requestRebuild(db: D1Database, guildId: string, nowMs = Date.parse(isoNow()), kind: BoardKind = TRADESKILLS): D1PreparedStatement {
  return db
    .prepare(`UPDATE guild SET ${kind.rebuild} = coalesce(${kind.rebuild}, ?) WHERE id = ? AND ${kind.channel} IS NOT NULL`)
    .bind(new Date(nowMs - CLOCK_MARGIN_MS).toISOString(), guildId);
}

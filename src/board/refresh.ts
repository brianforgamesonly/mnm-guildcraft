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
import { boardFromResults, boardStatements, type BoardData, type BoardPostRow } from './data.ts';
import { boardInOrder, snowflakeAt, snowflakeMs } from './order.ts';
import { contentHash, INDEX_TITLE, renderIndex, renderSkillPost, type BoardMessage } from './render.ts';
import { isDepartureRun, runDepartures } from '../departures.ts';
import { usageAlerts } from '../usage.ts';
import { sweepRequests } from '../requests.ts';

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
  /** Tradeskills whose post has member messages: never replaced or deleted (names are game data). */
  guarded: string[];
  rebuild: 'none' | 'in_progress' | 'done' | 'held';
  /** Whether the posts that exist show A→Z after this run (src/board/order.ts). */
  in_order: boolean;
  errors: string[];
}

const emptyResult = (): RefreshResult => ({
  created: 0, edited: 0, unarchived: 0, skipped_unchanged: 0, messages_added: 0, messages_deleted: 0, left_dirty: 0, gone: 0, index: 'none', repinned: false,
  bumped: 0, replaced: 0, deleted_old: 0, guarded: [], rebuild: 'none', in_order: true, errors: [],
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

/** The forum's archived posts in one call (rebuild only: their message counts and owners). null if unread or incomplete. */
async function archivedThreads(api: BotApi, forumId: string): Promise<Threads> {
  const r = await api.call<{ threads?: ApiThread[]; has_more?: boolean }>('GET', `/channels/${forumId}/threads/archived/public?limit=100`);
  return r.ok && !r.body.has_more ? threadMap(r.body.threads) : null;
}

/** null when unknown (the read failed); otherwise whether the thread is archived (absent from the active list). */
const isArchived = (active: Threads, threadId: string): boolean | null => (active ? !active.get(threadId) || active.get(threadId)!.archived : null);

/** When Discord will auto-archive an active thread: its last activity plus its auto-archive time. */
export function archivesAt(t: ThreadInfo): number | null {
  if (!t.auto_archive_duration) return null;
  const last = Math.max(t.archive_timestamp ? Date.parse(t.archive_timestamp) : 0, snowflakeMs(t.last_message_id ?? t.id));
  return last + t.auto_archive_duration * 60_000;
}

const body = (m: BoardMessage) => ({ embeds: m.embeds, allowed_mentions: m.allowed_mentions });

type PostOutcome = { row: Omit<BoardPostRow, 'dirty' | 'last_rendered_at'>; complete: boolean } | { gone: true } | { failed: true };

/** Creates a tradeskill's forum post: the first message with the thread, then any overflow messages. */
async function createPost(api: BotApi, forumId: string, skill: string, tradeskillId: number, msgs: BoardMessage[], hash: string, r: RefreshResult): Promise<PostOutcome> {
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
      return { row: { tradeskill_id: tradeskillId, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: null }, complete: false };
    }
    ids.push(sent.body.id);
    r.messages_added++;
  }
  return { row: { tradeskill_id: tradeskillId, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: hash }, complete: true };
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
  const partial = () => ({ row: { tradeskill_id: post.tradeskill_id, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: null }, complete: false });

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
  return { row: { tradeskill_id: post.tradeskill_id, thread_id: thread, message_ids_json: JSON.stringify(ids), content_hash: hash }, complete: true };
}

/** Calls kept back for the index (edit + pin) and the final D1 write. */
const RESERVE = 3;

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
  opts: { all?: boolean; nowMs?: number; trigger?: Trigger } = {},
): Promise<RefreshResult> {
  const r = emptyResult();
  const nowMs = opts.nowMs ?? Date.now();
  const at = new Date(nowMs).toISOString();
  const lease = `${new Date(nowMs + LEASE_MS).toISOString()}#${crypto.randomUUID().slice(0, 8)}`;

  // One round trip: take the lease, read everything, claim the dirty rows (only if the lease was taken).
  const results = await db.batch([
    db
      .prepare('UPDATE guild SET board_lock_until = ? WHERE id = ? AND board_channel_id IS NOT NULL AND (board_lock_until IS NULL OR board_lock_until < ?)')
      .bind(lease, guildId, at),
    ...boardStatements(db, guildId),
    db
      .prepare('UPDATE board_post SET dirty = 2 WHERE guild_id = ?1 AND dirty <> 0 AND EXISTS (SELECT 1 FROM guild WHERE id = ?1 AND board_lock_until = ?2)')
      .bind(guildId, lease),
  ]);
  const data = boardFromResults(results.slice(1, 5));
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

  const work = data.tradeskills.filter((t) => {
    const p = data.posts.get(t.id);
    return opts.all || !p || p.dirty !== 0 || (rebuilding && isOld(p.thread_id));
  });
  const needActive = work.some((t) => data.posts.has(t.id)) || !!data.guild.board_index_thread_id || rebuilding;
  const active = needActive ? await activeThreads(api, guildId) : null;
  const archivedList = rebuilding ? await archivedThreads(api, forum) : null;
  // Without both lists the rebuild cannot tell member messages apart, so this run replaces and deletes nothing.
  const rebuildBlind = rebuilding && (active === null || archivedList === null);
  if (rebuildBlind) r.errors.push('rebuild: thread lists unread; nothing replaced this run');
  const infoOf = (thread: string) => active?.get(thread) ?? archivedList?.get(thread);

  // Posts with member messages are never replaced (ORDER-RULES, order 6).
  const guarded = new Set<number>();
  if (rebuilding)
    for (const t of data.tradeskills) {
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
        `INSERT INTO board_post (guild_id, tradeskill_id, thread_id, message_ids_json, content_hash, dirty, last_rendered_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(guild_id, tradeskill_id) DO UPDATE SET thread_id = excluded.thread_id, message_ids_json = excluded.message_ids_json,
           content_hash = excluded.content_hash, last_rendered_at = excluded.last_rendered_at,
           dirty = CASE WHEN excluded.dirty = 1 OR board_post.dirty = 1 THEN 1 ELSE 0 END`,
      )
      .bind(guildId, row.tradeskill_id, row.thread_id, row.message_ids_json, row.content_hash, complete ? 0 : 1, at);
  const leaveDirty = (tradeskillId: number) => {
    r.left_dirty++;
    if (data.posts.has(tradeskillId)) writes.push(db.prepare('UPDATE board_post SET dirty = 1 WHERE guild_id = ? AND tradeskill_id = ?').bind(guildId, tradeskillId));
  };
  const threads = new Map<number, string>([...data.posts].map(([id, p]) => [id, p.thread_id]));
  const unarchivedNow = new Set<string>();
  /** Posts found deleted in Discord by the keep-active step: forgotten below, recreated by the next run. */
  const goneNow = new Set<number>();
  const canCall = (n: number) => budgetLeft(api.budget) >= n && Date.now() < api.budget.deadline;

  // Keep active (nightly): an archived post is unarchived; one close to auto-archiving gets its archive time changed.
  if (opts.all && active && !since)
    for (const t of data.tradeskills) {
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
      writes.push(db.prepare('DELETE FROM board_post WHERE guild_id = ? AND tradeskill_id = ? AND thread_id = ?').bind(guildId, t.id, post.thread_id));
      continue;
    }
    const lines = data.lines.get(t.id) ?? [];
    const msgs = renderSkillPost(t.name, lines, data.guild.stale_days, nowMs);
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
      writes.push(db.prepare('DELETE FROM board_post WHERE guild_id = ? AND tradeskill_id = ? AND thread_id = ?').bind(guildId, t.id, post.thread_id));
    } else if ('failed' in out) {
      leaveDirty(t.id);
    } else {
      threads.set(t.id, out.row.thread_id);
      writes.push(upsert(out.row, out.complete));
      if (!out.complete) r.left_dirty++;
    }
  }

  // The rebuild's second half: once every unguarded post is new, delete the old ones. An old post is a
  // bot-owned thread in this forum, older than the rebuild, that no row references, with no member messages.
  if (rebuilding && !rebuildBlind) {
    const remaining = data.tradeskills.filter((t) => !guarded.has(t.id) && (!threads.get(t.id) || isOld(threads.get(t.id)!))).length;
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
        writes.push(db.prepare('UPDATE guild SET board_rebuild_since = NULL WHERE id = ? AND board_rebuild_since = ?').bind(guildId, since));
      }
    }
  }
  r.in_order = boardInOrder(data.tradeskills, (id) => threads.get(id));

  // The index: created (and pinned) once, edited when its links or counts changed or any post was written.
  const wrote = r.created + r.edited + r.gone > 0;
  const idx = renderIndex(
    data.tradeskills.map((t) => ({ skill: t.name, thread_id: threads.get(t.id) ?? null, lines: (data.lines.get(t.id) ?? []).length })),
    nowMs,
  );
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
      if (!canCallIndex(1)) r.index = 'not_reached';
      else {
        const e = await api.call('PATCH', `/channels/${indexThread}/messages/${indexMessage}`, body(idx.message));
        if (e.ok) {
          r.index = 'edited';
          indexHash = idxHash;
        } else if (e.code === UNKNOWN_CHANNEL || e.code === UNKNOWN_MESSAGE) indexThread = indexMessage = indexHash = null;
        else {
          r.index = 'failed';
          indexHash = null;
          r.errors.push(`edit index: ${e.status} ${e.code ?? ''}`.trim());
        }
      }
    } else if (indexThread) r.index = 'unchanged';
  }
  if (!indexThread || !indexMessage) {
    if (!canCallIndex(2)) r.index = 'not_reached';
    else {
      const made = await api.call<{ id: string; message?: { id: string } }>('POST', `/channels/${forum}/threads`, {
        name: INDEX_TITLE,
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
      .prepare('UPDATE guild SET board_index_thread_id = ?, board_index_message_id = ?, board_index_hash = ?, board_lock_until = NULL WHERE id = ? AND board_lock_until = ?')
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
export async function refreshAfterCommand(env: Env, guildId: string, d1Calls: D1Call[], opts: { rebuild?: boolean; discordCalls?: number } = {}): Promise<BoardRunLog> {
  const budget: BoardBudget = { d1: () => d1Calls.length, discord: opts.discordCalls ?? 0, cap: BOARD_CALL_CAP, deadline: Date.now() + AFTER_COMMAND_MS };
  const trigger: Trigger = opts.rebuild ? 'rebuild' : 'command';
  const log: BoardRunLog = { gc: 'board', trigger, guilds: 1, d1_calls: 0, discord_calls: 0, calls: [], results: [], err: null };
  if (!env.DISCORD_BOT_TOKEN) return { ...log, err: 'DISCORD_BOT_TOKEN not set' };
  const api = botApi(env.DISCORD_BOT_TOKEN, budget);
  const d1Before = d1Calls.length;
  try {
    log.results.push(await refreshGuildBoard(env.DB, api, guildId, { trigger }));
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

/** Guilds with a board that has something to do: dirty or missing posts, no index, a rebuild in progress (every board, nightly). */
const SWEEP_SQL = `SELECT g.id FROM guild g WHERE g.board_channel_id IS NOT NULL AND (?1 = 1 OR g.board_index_message_id IS NULL OR g.board_rebuild_since IS NOT NULL
  OR EXISTS (SELECT 1 FROM board_post p WHERE p.guild_id = g.id AND p.dirty <> 0)
  OR (SELECT count(*) FROM board_post p WHERE p.guild_id = g.id) < (SELECT count(*) FROM tradeskill)) ORDER BY g.id`;

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
  try {
    const { results } = await counted.db.prepare(SWEEP_SQL).bind(nightly ? 1 : 0).all<{ id: string }>();
    first = counted.calls.at(-1);
    log.guilds = results.length;
    if (results.length && !env.DISCORD_BOT_TOKEN) log.err = 'DISCORD_BOT_TOKEN not set';
    else if (results.length) {
      api ??= botApi(env.DISCORD_BOT_TOKEN!, budget);
      for (const g of results) {
        if (budgetLeft(budget) < RESERVE + 3) break;
        log.results.push(await refreshGuildBoard(counted.db, api, g.id, { all: nightly, trigger: log.trigger }));
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
  return line;
}

/**
 * A minute before the request: a post created after it must never read as old, even if Discord's clock runs
 * behind ours (an old-looking new post would be replaced again). Old posts are hours old, so the margin costs nothing.
 */
const CLOCK_MARGIN_MS = 60_000;

/** /guildcraft rebuild-board: asks for the rebuild (the refresh after the reply starts it). A rebuild already in progress keeps its start. */
export function requestRebuild(db: D1Database, guildId: string, nowMs = Date.parse(isoNow())): D1PreparedStatement {
  return db
    .prepare('UPDATE guild SET board_rebuild_since = coalesce(board_rebuild_since, ?) WHERE id = ? AND board_channel_id IS NOT NULL')
    .bind(new Date(nowMs - CLOCK_MARGIN_MS).toISOString(), guildId);
}

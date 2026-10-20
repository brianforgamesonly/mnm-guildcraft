// A fake Discord bot API holding one server's forum channels and threads (order 5: the roster board).
// It answers as Discord documents (docs.discord.com/developers/resources/channel, topics/threads):
// creating a forum post returns the thread with a nested message; an archived thread refuses message edits
// and posts with 50083; PATCH archived:false unarchives; PINNED (1 << 1) is one per forum; GET
// /guilds/{id}/threads/active lists unarchived threads only.
// Order 6: ids are snowflakes carrying their creation time (shifted by `clockOffsetMs`, so a test can make
// posts that are hours old); threads carry owner_id, message_count (messages after the first, not deleted),
// last_message_id, archive_timestamp and auto_archive_duration; changing the auto-archive time or the archived
// state counts as activity; GET /channels/{forum}/threads/archived/public lists archived posts.
import { APP_ID, botApi, GUILD, webhookCalls } from './discord.ts';

export const FORUM = '600000000000000001';
export const TEXT_CHANNEL = '600000000000000002';
export const MEMBER = '100000000000000009';
const PINNED = 2;
const EPOCH = 1420070400000n;

export interface FakeThread {
  id: string;
  parent: string;
  name: string;
  owner: string;
  archived: boolean;
  flags: number;
  autoArchive: number;
  archiveTimestamp: string;
  messages: Map<string, any>;
}

export interface FakeCall {
  method: string;
  path: string;
  body: any;
  /** Webhook (reply delivery) calls made before this call: shows a reply went out first. */
  webhooksBefore: number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function fakeForum() {
  let last = 0n;
  const threads = new Map<string, FakeThread>();
  const calls: FakeCall[] = [];
  const state = {
    threads,
    calls,
    /** Added to the clock for new ids and activity times (negative: in the past). */
    clockOffsetMs: 0,
    /** Return this status (and code) for calls matching the predicate; `times` how often (default always). */
    failures: [] as { match: (c: FakeCall) => boolean; status: number; code?: number; body?: unknown; times?: number }[],
    /** Answers for the permission fallback (GET channel / roles / member). */
    channelOverwrites: [] as unknown[],
    roles: [] as { id: string; permissions: string }[],
    botRoles: [] as string[],
    /** Thread posts in a forum, oldest first. */
    posts: (parent = FORUM) => [...threads.values()].filter((t) => t.parent === parent),
    /** As a creation-date sort shows them: newest first, the pinned post on top. */
    display: (parent = FORUM) =>
      state
        .posts(parent)
        .sort((a, b) => ((b.flags & PINNED) - (a.flags & PINNED)) || (BigInt(b.id) > BigInt(a.id) ? 1 : -1))
        .map((t) => t.name),
    byName: (name: string) => [...threads.values()].find((t) => t.name === name),
    text: (t: FakeThread | undefined) => (t ? [...t.messages.values()].flatMap((m) => (m.embeds ?? []).map((e: any) => `${e.title ?? ''}\n${e.description ?? ''}\n${e.footer?.text ?? ''}`)).join('\n') : ''),
    discordCalls: () => calls.length,
    /** A member replies in a post. */
    memberReply: (t: FakeThread) => t.messages.set(id(), { content: 'a member reply', author: MEMBER }),
    /** A member's own post in the forum. */
    memberPost: (name: string) => {
      const t = thread(FORUM, name, MEMBER, 4320);
      t.messages.set(id(), { content: 'hello' });
      return t;
    },
    nowMs: () => Date.now() + state.clockOffsetMs,
    snowflake: (ms: number) => String((BigInt(Math.floor(ms)) - EPOCH) << 22n),
  };
  function id() {
    const at = (BigInt(Math.floor(state.nowMs())) - EPOCH) << 22n;
    last = at > last ? at : last + 1n;
    return String(last);
  }
  function thread(parent: string, name: string, owner: string, autoArchive: number): FakeThread {
    const t: FakeThread = { id: id(), parent, name, owner, archived: false, flags: 0, autoArchive, archiveTimestamp: new Date(state.nowMs()).toISOString(), messages: new Map() };
    threads.set(t.id, t);
    return t;
  }
  const apiThread = (t: FakeThread) => ({
    id: t.id, parent_id: t.parent, owner_id: t.owner, name: t.name, flags: t.flags, message_count: Math.max(0, t.messages.size - 1), last_message_id: [...t.messages.keys()].at(-1) ?? null,
    thread_metadata: { archived: t.archived, archive_timestamp: t.archiveTimestamp, auto_archive_duration: t.autoArchive },
  });

  botApi.handle = (method, fullPath, body) => {
    const call: FakeCall = { method, path: fullPath, body, webhooksBefore: webhookCalls.length };
    calls.push(call);
    const f = state.failures.find((x) => x.match(call) && (x.times === undefined || x.times > 0));
    if (f) {
      if (f.times !== undefined) f.times--;
      return json(f.status, f.body ?? { code: f.code ?? 0, message: 'fake failure' });
    }
    const path = fullPath.split('?')[0];
    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === `/guilds/${GUILD}/threads/active`) return json(200, { threads: [...threads.values()].filter((t) => !t.archived).map(apiThread), members: [] });
    if (method === 'GET' && (m = path.match(/^\/channels\/(\d+)\/threads\/archived\/public$/)))
      return json(200, { threads: [...threads.values()].filter((t) => t.archived && t.parent === m![1]).map(apiThread), members: [], has_more: false });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json(200, { id: GUILD, name: 'The Test Guild' });
    if (method === 'GET' && path === `/channels/${FORUM}`) return json(200, { id: FORUM, type: 15, permission_overwrites: state.channelOverwrites });
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json(200, state.roles);
    if (method === 'GET' && (m = path.match(/^\/guilds\/\d+\/members\/(\d+)$/))) return json(200, { roles: state.botRoles });
    if (method === 'POST' && (m = path.match(/^\/channels\/(\d+)\/threads$/))) {
      const t = thread(m[1], body.name, APP_ID, body.auto_archive_duration ?? 4320);
      const msg = id();
      t.messages.set(msg, body.message);
      return json(201, { ...apiThread(t), type: 11, message: { id: msg } });
    }
    if ((m = path.match(/^\/channels\/(\d+)\/messages(?:\/(\d+))?$/))) {
      const t = threads.get(m[1]);
      if (!t) return json(404, { code: 10003, message: 'Unknown Channel' });
      if (t.archived && method !== 'DELETE') return json(400, { code: 50083, message: 'Thread is archived' });
      if (method === 'POST') {
        const msg = id();
        t.messages.set(msg, body);
        return json(200, { id: msg });
      }
      if (!t.messages.has(m[2])) return json(404, { code: 10008, message: 'Unknown Message' });
      if (method === 'PATCH') {
        t.messages.set(m[2], body);
        return json(200, { id: m[2] });
      }
      if (method === 'DELETE') {
        t.messages.delete(m[2]);
        return new Response(null, { status: 204 });
      }
    }
    if ((m = path.match(/^\/channels\/(\d+)$/))) {
      const t = threads.get(m[1]);
      if (!t) return json(404, { code: 10003, message: 'Unknown Channel' });
      if (method === 'DELETE') {
        threads.delete(t.id);
        return json(200, { id: t.id });
      }
      if (method === 'PATCH') {
        if (body.archived !== undefined && body.archived !== t.archived) {
          t.archived = body.archived;
          t.archiveTimestamp = new Date(state.nowMs()).toISOString();
          if (t.archived) t.flags &= ~PINNED; // "archiving that thread will unset the flag"
        }
        if (body.auto_archive_duration !== undefined && body.auto_archive_duration !== t.autoArchive) {
          t.autoArchive = body.auto_archive_duration;
          t.archiveTimestamp = new Date(state.nowMs()).toISOString(); // a changed auto-archive time is activity
        }
        if (body.flags !== undefined) {
          if (body.flags & PINNED) for (const o of threads.values()) if (o.parent === t.parent) o.flags &= ~PINNED;
          t.flags = body.flags;
        }
        return json(200, apiThread(t));
      }
    }
    return json(404, { code: 0, message: `fake: no route for ${method} ${fullPath}` });
  };
  return state;
}

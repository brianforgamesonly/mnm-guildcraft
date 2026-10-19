// A fake Discord bot API holding one server's forum channels and threads (order 5: the roster board).
// It answers as Discord documents (docs.discord.com/developers/resources/channel, topics/threads):
// creating a forum post returns the thread with a nested message; an archived thread refuses message edits
// and posts with 50083; PATCH archived:false unarchives; PINNED (1 << 1) is one per forum; GET
// /guilds/{id}/threads/active lists unarchived threads only.
import { botApi, GUILD, webhookCalls } from './discord.ts';

export const FORUM = '600000000000000001';
export const TEXT_CHANNEL = '600000000000000002';
const PINNED = 2;

export interface FakeThread {
  id: string;
  parent: string;
  name: string;
  archived: boolean;
  flags: number;
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
  let next = 10_000_000_000_000_000n;
  const id = () => String(++next);
  const threads = new Map<string, FakeThread>();
  const calls: FakeCall[] = [];
  const state = {
    threads,
    calls,
    /** Return this status (and code) for calls matching the predicate; `times` how often (default always). */
    failures: [] as { match: (c: FakeCall) => boolean; status: number; code?: number; body?: unknown; times?: number }[],
    /** Answers for the permission fallback (GET channel / roles / member). */
    channelOverwrites: [] as unknown[],
    roles: [] as { id: string; permissions: string }[],
    botRoles: [] as string[],
    /** Thread posts in a forum, newest last. */
    posts: (parent = FORUM) => [...threads.values()].filter((t) => t.parent === parent),
    byName: (name: string) => [...threads.values()].find((t) => t.name === name),
    text: (t: FakeThread | undefined) => (t ? [...t.messages.values()].flatMap((m) => (m.embeds ?? []).map((e: any) => `${e.title ?? ''}\n${e.description ?? ''}\n${e.footer?.text ?? ''}`)).join('\n') : ''),
    discordCalls: () => calls.length,
  };

  botApi.handle = (method, path, body) => {
    const call: FakeCall = { method, path, body, webhooksBefore: webhookCalls.length };
    calls.push(call);
    const f = state.failures.find((x) => x.match(call) && (x.times === undefined || x.times > 0));
    if (f) {
      if (f.times !== undefined) f.times--;
      return json(f.status, f.body ?? { code: f.code ?? 0, message: 'fake failure' });
    }
    let m: RegExpMatchArray | null;
    if (method === 'GET' && path === `/guilds/${GUILD}/threads/active`)
      return json(200, { threads: [...threads.values()].filter((t) => !t.archived).map((t) => ({ id: t.id, parent_id: t.parent, flags: t.flags, thread_metadata: { archived: false } })), members: [] });
    if (method === 'GET' && path === `/guilds/${GUILD}`) return json(200, { id: GUILD, name: 'The Test Guild' });
    if (method === 'GET' && path === `/channels/${FORUM}`) return json(200, { id: FORUM, type: 15, permission_overwrites: state.channelOverwrites });
    if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return json(200, state.roles);
    if (method === 'GET' && (m = path.match(/^\/guilds\/\d+\/members\/(\d+)$/))) return json(200, { roles: state.botRoles });
    if (method === 'POST' && (m = path.match(/^\/channels\/(\d+)\/threads$/))) {
      const t: FakeThread = { id: id(), parent: m[1], name: body.name, archived: false, flags: 0, messages: new Map() };
      const msg = id();
      t.messages.set(msg, body.message);
      threads.set(t.id, t);
      return json(201, { id: t.id, type: 11, parent_id: m[1], name: t.name, message: { id: msg } });
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
        if (body.archived !== undefined) {
          t.archived = body.archived;
          if (t.archived) t.flags &= ~PINNED; // "archiving that thread will unset the flag"
        }
        if (body.flags !== undefined) {
          if (body.flags & PINNED) for (const o of threads.values()) if (o.parent === t.parent) o.flags &= ~PINNED;
          t.flags = body.flags;
        }
        return json(200, { id: t.id, flags: t.flags, thread_metadata: { archived: t.archived } });
      }
    }
    return json(404, { code: 0, message: `fake: no route for ${method} ${path}` });
  };
  return state;
}

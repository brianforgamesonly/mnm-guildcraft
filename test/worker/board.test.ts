// Order 5, ITEM 1.1: the roster board (PRD FR-5), against a fake Discord forum (test/fake-forum.ts).
// The live board does not exist until a server admin runs setup; these tests are the local verification, and the
// live checks (the sweep on dev, a real archived-post edit) are order 6's.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { BOARD_CALL_CAP, routeOf } from '../../src/board/api.ts';
import { renderSkillPost, type BoardLine } from '../../src/board/render.ts';
import { isNightly, PINNED } from '../../src/board/refresh.ts';
import { BOARD_PERMISSIONS } from '../../src/commands/setup.ts';
import { EMBED_LIMITS, embedChars } from '../../src/discord.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, exchange, GUILD, seen, spyOnFetch, submit, webhook, webhookCalls } from '../discord.ts';
import { FORUM, fakeForum, TEXT_CHANNEL } from '../fake-forum.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const ANN = '100000000000000001';
const BO = '100000000000000002';
const admin = as(ANN, { permissions: ADMIN, nick: 'Ann' });
const bo = as(BO, { nick: 'Bo' });
const ALL_BOARD_PERMS = String(BOARD_PERMISSIONS.reduce((b, [bit]) => b | bit, 0n));

let forum: ReturnType<typeof fakeForum>;
let logs: string[];

beforeEach(async () => {
  await reset();
  webhook.reset();
  spyOnFetch();
  forum = fakeForum();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  botApi.reset();
  vi.restoreAllMocks();
});

/** /guildcraft setup board:<channel>, with the channel as Discord resolves it. */
const setupBoard = (channel = FORUM, type = 15, app_permissions: string | null = ALL_BOARD_PERMS) => {
  const i = cmd(admin, 'guildcraft', 'setup', { board: channel }) as any;
  i.data.resolved = { channels: { [channel]: { id: channel, name: 'crafting-roster', type, permissions: ADMIN, ...(app_permissions === null ? {} : { app_permissions }) } } };
  return exchange(i, TOKEN);
};
/** What the member sees for a command. */
const reply = async (p: ReturnType<typeof exchange>) => {
  const { ack, calls } = await p;
  return seen(ack, calls);
};

/** The live shape: Ann's Testchar, Blacksmithing 25. */
async function liveShape() {
  await exchange(cmd(admin, 'character', 'add', { name: 'Testchar', class: 'clr', level: 12 }), TOKEN);
  await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }), TOKEN);
}

const boardLines = () => logs.filter((l) => l.startsWith('{"gc":"board"')).map((l) => JSON.parse(l));
const runCron = async (scheduledTime = Date.parse('2026-10-20T12:15:00Z')) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime, cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
  await waitOnExecutionContext(ctx);
  return boardLines().at(-1)!;
};
const post = (skill: string) => forum.byName(skill);
const skillCount = async () => count('tradeskill');

describe('/guildcraft setup board: checks, then builds', () => {
  it('refuses a channel that is not a forum, and names each missing permission; nothing is saved', async () => {
    let r = await reply(setupBoard(TEXT_CHANNEL, 0));
    expect(r.data.content).toMatch(/is not a forum channel/);
    r = await reply(setupBoard(FORUM, 15, String(1n << 10n)));
    expect(r.data.content).toContain('Nothing was changed');
    for (const name of ['Send Messages (Create Posts)', 'Send Messages in Threads', 'Embed Links', 'Read Message History', 'Manage Threads']) expect(r.data.content).toContain(name);
    expect(r.data.content).not.toContain('View Channel');
    expect((await one<{ b: string | null }>('SELECT board_channel_id AS b FROM guild')).b).toBeNull();
    expect(forum.calls.filter((c) => c.path !== `/guilds/${GUILD}`)).toEqual([]); // only the guild-name lookup
  });

  it('reads app_permissions from the resolved channel: no permission calls are made', async () => {
    await setupBoard();
    expect(forum.calls.filter((c) => c.method === 'GET' && !c.path.endsWith('/threads/active') && c.path !== `/guilds/${GUILD}`)).toEqual([]);
  });

  it('without app_permissions it computes them from roles and overwrites (3 GETs), and still names what is missing', async () => {
    forum.roles = [{ id: GUILD, permissions: String(1n << 10n) }, { id: '500000000000000001', permissions: ALL_BOARD_PERMS }];
    forum.botRoles = ['500000000000000001'];
    forum.channelOverwrites = [{ id: '500000000000000001', type: 0, allow: '0', deny: String(1n << 34n) }];
    expect((await reply(setupBoard(FORUM, 15, null))).data.content).toContain('**Manage Threads (Manage Posts, to pin the index)**');
    expect(forum.calls.filter((c) => c.path !== `/guilds/${GUILD}`).map((c) => c.method + ' ' + c.path.replace(/\d{5,}/g, '{id}')).sort()).toEqual([
      'GET /channels/{id}', 'GET /guilds/{id}/members/{id}', 'GET /guilds/{id}/roles',
    ]);
  });

  it('first build: one post per tradeskill titled with the skill name only, then a pinned index; the reply says how many', async () => {
    await liveShape();
    const n = await skillCount();
    const { ack, calls } = await setupBoard();
    expect(seen(ack, calls).data.content).toContain(`Building the board now: ${n} tradeskill posts plus a pinned index post.`);
    const names = (await all<{ name: string }>('SELECT name FROM tradeskill ORDER BY name')).map((t) => t.name);
    expect(forum.posts().map((t) => t.name).sort()).toEqual([...names, 'Index: how to get listed'].sort());
    const bs = forum.text(post('Blacksmithing'));
    expect(bs).toContain('1 character (1 member), ranked by skill level.');
    expect(bs).toContain('**1.** **Testchar** · Ann · 25');
    const index = post('Index: how to get listed')!;
    expect(index.flags & PINNED).toBe(PINNED);
    expect(forum.text(index)).toContain(`<#${post('Blacksmithing')!.id}> · 1 character`);
    expect(forum.text(index)).toMatch(/How to get listed[\s\S]*`\/character add`[\s\S]*Last refresh: <t:\d+:f>/);
    expect(await count('board_post', 'dirty <> 0')).toBe(0);
    // Calls made by the whole invocation (setup's D1 work, its delivery, the build) stay under the cap.
    const run = boardLines()[0];
    expect(run.trigger).toBe('command');
    expect(run.discord_calls).toBe(n + 2); // n creates, the index, its pin
  });
});

describe('refresh paths', () => {
  beforeEach(async () => {
    await liveShape();
    await setupBoard();
    forum.calls.length = 0;
  });

  it('/craft set: the reply is delivered first, then the post is edited in the same request', async () => {
    const { ack, calls } = await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 30 }), TOKEN);
    expect(seen(ack, calls).data.content).toContain('Blacksmithing set to **30** (was 25)');
    expect(forum.text(post('Blacksmithing'))).toContain('**Testchar** · Ann · 30');
    const edits = forum.calls.filter((c) => c.method === 'PATCH' && c.path.includes('/messages/'));
    expect(edits.length).toBe(2); // the post and the index (its count did not change, but a post was written)
    // The reply's webhook call was already recorded when the first board edit went out.
    expect(edits[0].webhooksBefore).toBeGreaterThan(webhookCalls.indexOf(calls.at(-1)!));
    expect(await count('board_post', 'dirty <> 0')).toBe(0);
    // ITEM 2: every interaction line carries the isolate's state and D1's own timings.
    const line = JSON.parse(logs.filter((l) => l.startsWith('{"gc":"interaction"')).at(-1)!);
    expect(line).toHaveProperty('isolate_first_request', false);
    expect(line.ms_since_last_d1_in_isolate).toBeTypeOf('number');
    expect(line.d1_duration).toHaveLength(line.q);
    expect(line.rows_read).toHaveLength(line.q);
  });

  it('an unchanged post is not edited (content hash)', async () => {
    await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }), TOKEN);
    expect(forum.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(boardLines().at(-1).results[0].skipped_unchanged).toBe(1);
  });

  it('/craft update (modal) and /character remove mark their tradeskills; removed characters and departed members never appear', async () => {
    const ch = await one<{ id: number }>("SELECT id FROM character WHERE name = 'Testchar'");
    const tailoring = await one<{ id: number }>("SELECT id FROM tradeskill WHERE name = 'Tailoring'");
    await exchange(submit(admin, `updm:${ch.id}`, { [`lvl:${tailoring.id}`]: '40' }), TOKEN);
    expect(forum.text(post('Tailoring'))).toContain('**Testchar** · Ann · 40');
    await exchange(cmd(bo, 'character', 'add', { name: 'Bochar' }), TOKEN);
    await exchange(cmd(bo, 'craft', 'set', { skill: 'Tailoring', level: 10 }), TOKEN);
    expect(forum.text(post('Tailoring'))).toContain('2 characters (2 members)');
    await exchange(cmd(admin, 'character', 'remove', { name: 'Testchar' }), TOKEN);
    expect(forum.text(post('Tailoring'))).not.toContain('Testchar');
    expect(forum.text(post('Blacksmithing'))).toContain('No one in the guild has recorded Blacksmithing yet');
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(BO).run();
    await env.DB.prepare('UPDATE board_post SET dirty = 1').run();
    await runCron();
    expect(forum.text(post('Tailoring'))).not.toContain('Bochar');
  });

  it('a failed edit leaves the post dirty; the 15-minute sweep (scheduled handler) rewrites it', async () => {
    forum.failures.push({ match: (c) => c.method === 'PATCH' && c.path.includes('/messages/'), status: 500, times: 1 });
    const { ack, calls } = await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 31 }), TOKEN);
    expect(seen(ack, calls).data.content).toContain('set to **31**');
    expect(await count('board_post', 'dirty <> 0')).toBe(1);
    expect(forum.text(post('Blacksmithing'))).toContain('· 25');
    const run = await runCron();
    expect(run.trigger).toBe('sweep');
    expect(run.results[0], JSON.stringify(run)).toMatchObject({ edited: 1 });
    expect(forum.text(post('Blacksmithing'))).toContain('· 31');
    expect(await count('board_post', 'dirty <> 0')).toBe(0);
  });

  it('a sweep with nothing dirty makes one D1 query and no Discord calls', async () => {
    const run = await runCron();
    expect(run).toMatchObject({ guilds: 0, d1_calls: 1, discord_calls: 0 });
    expect(run.first_query_ms).toBeTypeOf('number');
    expect(run).toHaveProperty('isolate_first_request');
    expect(run).toHaveProperty('ms_since_last_d1_in_isolate');
  });

  it('nightly rebuild (the 08:00 UTC trigger) re-renders every post, edits none that are unchanged, and re-pins an unpinned index', async () => {
    expect(isNightly(Date.parse('2026-10-20T08:00:00Z'))).toBe(true);
    expect(isNightly(Date.parse('2026-10-20T08:15:00Z'))).toBe(false);
    post('Index: how to get listed')!.flags = 0;
    const run = await runCron(Date.parse('2026-10-20T08:00:00Z'));
    expect(run.trigger).toBe('nightly');
    expect(run.results[0]).toMatchObject({ skipped_unchanged: await skillCount(), edited: 0, repinned: true, index: 'unchanged' });
    expect(post('Index: how to get listed')!.flags & PINNED).toBe(PINNED);
    expect(forum.calls.filter((c) => c.path.includes('/messages/'))).toEqual([]);
  });

  it('the nightly marks a skill stale after stale_days, and the post shows it', async () => {
    await env.DB.prepare("UPDATE character_skill SET updated_at = '2026-01-01T00:00:00Z'").run();
    await runCron(Date.parse('2026-10-20T08:05:00Z'));
    expect(forum.text(post('Blacksmithing'))).toMatch(/Testchar\*\* · Ann · 25 · \*stale\*[\s\S]*stale = not updated in 60 days/);
  });
});

describe('archived posts', () => {
  beforeEach(async () => {
    await liveShape();
    await setupBoard();
    forum.calls.length = 0;
  });

  it('an archived post is unarchived (PATCH archived:false), then edited: one extra call', async () => {
    post('Blacksmithing')!.archived = true;
    await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 33 }), TOKEN);
    const id = post('Blacksmithing')!.id;
    const seq = forum.calls.map((c) => `${c.method} ${c.path === `/channels/${id}` ? 'thread' : c.path.startsWith(`/channels/${id}/messages`) ? 'post message' : c.path.replace(/\d{5,}/g, '{id}')}`);
    expect(seq.slice(0, 3)).toEqual(['GET /guilds/{id}/threads/active', 'PATCH thread', 'PATCH post message']);
    expect(forum.calls[1].body).toEqual({ archived: false });
    expect(post('Blacksmithing')!.archived).toBe(false);
    expect(forum.text(post('Blacksmithing'))).toContain('· 33');
  });

  it('archived after the active-threads read: the edit gets 50083, unarchives, and edits once more', async () => {
    forum.failures.push({ match: (c) => c.method === 'PATCH' && c.path.includes('/messages/'), status: 400, code: 50083, times: 1 });
    await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 34 }), TOKEN);
    expect(forum.text(post('Blacksmithing'))).toContain('· 34');
    expect(boardLines().at(-1).results[0].unarchived).toBe(1);
  });

  it('a post deleted in Discord is forgotten, and the next sweep creates it again', async () => {
    forum.threads.delete(post('Blacksmithing')!.id);
    await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 35 }), TOKEN);
    expect(boardLines().at(-1).results[0].gone).toBe(1);
    await runCron();
    expect(forum.text(post('Blacksmithing'))).toContain('· 35');
    expect(await count('board_post')).toBe(await skillCount());
  });
});

describe('limits', () => {
  it('a first build larger than the call cap stops under it; the rest stays for the sweep, which finishes it', async () => {
    await reset(Array.from({ length: 45 }, (_, i) => `Skill ${String(i).padStart(2, '0')}`));
    await setupBoard();
    const first = boardLines()[0];
    expect(first.discord_calls + first.d1_calls).toBeLessThanOrEqual(BOARD_CALL_CAP);
    const made = forum.posts().length;
    expect(made).toBeLessThan(46);
    let runs = 0;
    while (forum.posts().length < 46 && runs++ < 5) {
      const r = await runCron();
      expect(r.discord_calls + r.d1_calls, 'one invocation').toBeLessThanOrEqual(BOARD_CALL_CAP);
    }
    expect(forum.posts().length).toBe(46);
    expect(await count('board_post')).toBe(45);
    expect(forum.text(post('Index: how to get listed'))).not.toContain('post coming');
  });

  it('a 429 is waited out (retry_after) and retried once', async () => {
    forum.failures.push({ match: (c) => c.method === 'POST' && c.path.endsWith('/threads'), status: 429, body: { retry_after: 0.02, global: false, message: 'rate limited' }, times: 1 });
    await setupBoard();
    expect(forum.posts().length).toBe((await skillCount()) + 1);
  });

  it('a refresh that finds the lease held leaves the posts dirty', async () => {
    await setupBoard();
    await env.DB.prepare("UPDATE guild SET board_lock_until = '2999-01-01T00:00:00Z'").run();
    await exchange(cmd(admin, 'character', 'add', { name: 'Testchar' }), TOKEN);
    await exchange(cmd(admin, 'craft', 'set', { skill: 'Blacksmithing', level: 5 }), TOKEN);
    expect(boardLines().at(-1).results[0].locked).toBe(true);
    expect(await count('board_post', 'dirty <> 0')).toBe(1);
  });

  it('rate-limit routes keep the major parameter and template the rest', () => {
    expect(routeOf('PATCH', '/channels/123456/messages/789012')).toBe('PATCH /channels/123456/messages/{id}');
  });
});

describe('overflow into bot-owned follow-up messages', () => {
  const lines = (n: number): BoardLine[] =>
    Array.from({ length: n }, (_, i) => ({ tradeskill_id: 1, character: `Character${String(i).padStart(3, '0')}`, owner_user_id: String(i % 40), member: `Member Name ${i % 40}`, level: 300 - i, updated_at: '2026-10-19T00:00:00Z' }));

  it('each message stays within Discord embed limits', () => {
    for (const n of [0, 1, 150, 400]) {
      const msgs = renderSkillPost('Blacksmithing', lines(n), 60, Date.parse('2026-10-19T12:00:00Z'));
      for (const m of msgs) {
        expect(embedChars(m.embeds)).toBeLessThanOrEqual(EMBED_LIMITS.total);
        expect(m.embeds.length).toBeLessThanOrEqual(EMBED_LIMITS.embeds);
        for (const e of m.embeds) expect((e.description ?? '').length).toBeLessThanOrEqual(EMBED_LIMITS.description);
      }
      const text = msgs.flatMap((m) => m.embeds.map((e) => e.description)).join('\n');
      for (let i = 0; i < n; i++) expect(text).toContain(`**${i + 1}.** **Character${String(i).padStart(3, '0')}**`);
      if (n === 400) expect(msgs.length).toBeGreaterThan(1);
    }
  });

  it('a long list grows into follow-up messages, and they are deleted when it shrinks', async () => {
    await liveShape();
    await setupBoard();
    // ~31 characters a line: 250 lines are about 7,800 embed characters, more than one message's 6,000.
    const many = Array.from({ length: 250 }, (_, i) => `Alt${String(i).padStart(3, '0')}`);
    await env.DB.batch(
      many.flatMap((name, i) => [
        env.DB.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, created_at, updated_at) VALUES (?, ?, ?, ?, '2026-10-19', '2026-10-19')").bind(GUILD, ANN, name, name.toLowerCase()),
        env.DB.prepare("INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) SELECT id, (SELECT id FROM tradeskill WHERE name = 'Brewing'), ?, '2026-10-19T00:00:00Z', ? FROM character WHERE name = ?").bind(300 - i, ANN, name),
      ]),
    );
    await env.DB.prepare('UPDATE board_post SET dirty = 1').run();
    const grown = await runCron();
    expect(grown.results[0], JSON.stringify(grown)).toMatchObject({ messages_added: 1 });
    const ids = JSON.parse((await one<{ m: string }>("SELECT message_ids_json AS m FROM board_post WHERE tradeskill_id = (SELECT id FROM tradeskill WHERE name = 'Brewing')")).m);
    expect(ids.length).toBeGreaterThan(1);
    expect(post('Brewing')!.messages.size).toBe(ids.length);
    await env.DB.prepare("DELETE FROM character_skill WHERE character_id IN (SELECT id FROM character WHERE name LIKE 'Alt%')").run();
    await env.DB.prepare('UPDATE board_post SET dirty = 1').run();
    await runCron();
    expect(post('Brewing')!.messages.size).toBe(1);
    expect(forum.text(post('Brewing'))).toContain('No one in the guild has recorded Brewing yet');
  });
});

describe('/guildcraft status', () => {
  it('shows the data version, the last import with warnings, the board, and no backup or usage figures yet', async () => {
    await liveShape();
    await env.DB.prepare(
      "INSERT INTO data_import (source, source_version, status, started_at, finished_at, warnings) VALUES ('test', 'abc1234 / 2026-10-19T07:00:00Z', 'ok', '2026-10-19T07:30:00Z', '2026-10-19T07:31:00Z', '[1,2,3]')",
    ).run();
    let r = await reply(exchange(cmd(admin, 'guildcraft', 'status'), TOKEN));
    expect(r.data.content).toContain('**Roster board:** not set up');
    await setupBoard();
    r = await reply(exchange(cmd(admin, 'guildcraft', 'status'), TOKEN));
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('**Data version:** `abc1234 / 2026-10-19T07:00:00Z`');
    expect(r.data.content).toMatch(/\*\*Last import:\*\* <t:\d+:f> \(<t:\d+:R>\) · ok · 3 warnings/);
    expect(r.data.content).toMatch(new RegExp(`\\*\\*Roster board:\\*\\* <#${FORUM}> · 5 of 5 posts · last refresh <t:\\d+:f> \\(<t:\\d+:R>\\) · 0 waiting to refresh`));
    expect(r.data.content).toContain('**Backup:** none yet');
    expect(r.data.content).toContain('**Usage against the free-tier limits:** no figures yet');
  });

  it('is admin only', async () => {
    const r = await reply(exchange(cmd(bo, 'guildcraft', 'status'), TOKEN));
    expect(r.data.content).toMatch(/Only server admins/);
  });
});

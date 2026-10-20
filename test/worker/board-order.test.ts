// Order 6, ITEM 1.1–1.2: the board in A→Z order, against the fake forum (test/fake-forum.ts). The forum's
// default sort is creation date, newest first (the server admin sets it), so posts created Z→A show A→Z from the top.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { BOARD_CALL_CAP } from '../../src/board/api.ts';
import { boardInOrder, snowflakeAt, snowflakeMs } from '../../src/board/order.ts';
import { KEEP_ACTIVE_MS } from '../../src/board/refresh.ts';
import { NAME_ORDER, nocase } from '../../src/collation.ts';
import { BOARD_PERMISSIONS } from '../../src/commands/setup.ts';
import { discordLagMs } from '../../src/telemetry.ts';
import { all, one, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, exchange, seen, spyOnFetch, webhook } from '../discord.ts';
import { FORUM, fakeForum } from '../fake-forum.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const admin = as('100000000000000001', { permissions: ADMIN, nick: 'Ann' });
const ALL_BOARD_PERMS = String(BOARD_PERMISSIONS.reduce((b, [bit]) => b | bit, 0n));
const INDEX = 'Index: how to get listed';
const HOUR = 3_600_000;

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

const setupBoard = () => {
  const i = cmd(admin, 'guildcraft', 'setup', { board: FORUM }) as any;
  i.data.resolved = { channels: { [FORUM]: { id: FORUM, name: 'crafting-roster', type: 15, permissions: ADMIN, app_permissions: ALL_BOARD_PERMS } } };
  return exchange(i, TOKEN);
};
const reply = async (p: ReturnType<typeof exchange>) => {
  const { ack, calls } = await p;
  return seen(ack, calls).data.content as string;
};
const boardLines = () => logs.filter((l) => l.startsWith('{"gc":"board"')).map((l) => JSON.parse(l));
const runCron = async (scheduledTime = Date.parse('2026-10-20T12:15:00Z')) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime, cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
  await waitOnExecutionContext(ctx);
  return boardLines().at(-1)!;
};
const skillsAZ = async () => (await all<{ name: string }>(`SELECT name FROM tradeskill ORDER BY ${NAME_ORDER}`)).map((t) => t.name);
const status = () => reply(exchange(cmd(admin, 'guildcraft', 'status'), TOKEN));
const rebuild = () => reply(exchange(cmd(admin, 'guildcraft', 'rebuild-board'), TOKEN));

describe('one collation: SQLite NOCASE, mirrored in JS', () => {
  it('orders exactly as ORDER BY name COLLATE NOCASE, including case, punctuation and non-ASCII names', async () => {
    const names = ['beta', 'Alpha', 'alpha2', 'Zebra', 'zeta', 'Éclair', 'eclair', 'Ärger', '_under', 'Brewing', 'brewing two', '10 Forge', '9 Forge'];
    await reset(names);
    const sql = (await all<{ name: string }>(`SELECT name FROM tradeskill ORDER BY ${NAME_ORDER}`)).map((r) => r.name);
    expect([...names].sort(nocase)).toEqual(sql);
  });
});

describe('creation order and the out-of-order flag', () => {
  it('a first build creates the posts Z→A, so the forum shows the index, then A→Z; status says A→Z', async () => {
    await setupBoard();
    const az = await skillsAZ();
    expect(forum.display()).toEqual([INDEX, ...az]);
    expect(boardLines()[0].results[0].in_order).toBe(true);
    expect(await status()).toContain('**Board order:** A→Z');
  });

  it('a build split across invocations stays in order (the second run continues Z→A)', async () => {
    await reset(Array.from({ length: 45 }, (_, i) => `Skill ${String(i).padStart(2, '0')}`));
    await setupBoard();
    let runs = 0;
    while (forum.posts().length < 46 && runs++ < 5) await runCron();
    expect(forum.display()).toEqual([INDEX, ...(await skillsAZ())]);
  });

  it('a failed create stops further creates; the next run resumes with that same tradeskill', async () => {
    forum.failures.push({ match: (c) => c.method === 'POST' && c.path.endsWith('/threads') && c.body?.name === 'Brewing', status: 500, times: 1 });
    await setupBoard();
    // Z→A: Tailoring, Fletching were made; Brewing failed; Blacksmithing and Alchemy were not attempted.
    expect(forum.posts().map((t) => t.name).filter((n) => n !== INDEX)).toEqual(['Tailoring', 'Fletching']);
    await runCron();
    expect(forum.display()).toEqual([INDEX, ...(await skillsAZ())]);
  });

  it('a tradeskill arriving later gets its post (on top), and status says out of order', async () => {
    await setupBoard();
    await env.DB.prepare("INSERT INTO tradeskill (name, kind, sort_order) VALUES ('Cooking', 'crafting', 9)").run();
    const run = await runCron();
    expect(run.results[0]).toMatchObject({ created: 1, in_order: false });
    expect(forum.display()[1]).toBe('Cooking');
    expect(await status()).toContain('**Board order:** out of order — run `/guildcraft rebuild-board`');
  });

  it('out of order is derived from the snowflakes: in order when thread age follows the reverse of name order', () => {
    const skills = [{ id: 1, name: 'Alchemy' }, { id: 2, name: 'Brewing' }, { id: 3, name: 'Cooking' }];
    expect(boardInOrder(skills, (id) => ({ 1: '300', 2: '200', 3: '100' })[id])).toBe(true);
    expect(boardInOrder(skills, (id) => ({ 1: '300', 2: '200', 3: '400' })[id])).toBe(false);
    expect(boardInOrder(skills, (id) => ({ 1: '300', 3: '100' })[id])).toBe(true); // a missing post is skipped
    expect(snowflakeMs(String(snowflakeAt(Date.parse('2026-10-20T00:00:00Z'))))).toBe(Date.parse('2026-10-20T00:00:00Z'));
  });
});

describe('/guildcraft rebuild-board', () => {
  /** A board whose posts were created an hour ago: every post predates the rebuild. */
  async function oldBoard() {
    forum.clockOffsetMs = -HOUR;
    await setupBoard();
    forum.clockOffsetMs = 0;
  }

  it('recreates every post Z→A (new first), then deletes the old ones; status says A→Z; the marker is cleared', async () => {
    await oldBoard();
    const old = new Set(forum.posts().filter((t) => t.name !== INDEX).map((t) => t.id));
    const member = forum.memberPost('Looking for a smith');
    const text = await rebuild();
    expect(text).toContain('in A→Z order');
    const run = boardLines().at(-1);
    expect(run.trigger).toBe('rebuild');
    const az = await skillsAZ();
    expect(run.results[0]).toMatchObject({ replaced: az.length, deleted_old: az.length, rebuild: 'done', in_order: true, guarded: [] });
    expect(run.d1_calls + run.discord_calls).toBeLessThanOrEqual(BOARD_CALL_CAP);
    expect(forum.posts().some((t) => old.has(t.id))).toBe(false);
    expect(forum.display()).toEqual([INDEX, ...az, member.name]);
    // New posts were all created before any old one was deleted.
    const seq = forum.calls.filter((c) => (c.method === 'POST' && c.path.endsWith('/threads')) || (c.method === 'DELETE' && /^\/channels\/\d+$/.test(c.path))).map((c) => c.method);
    expect(seq.lastIndexOf('POST')).toBeLessThan(seq.indexOf('DELETE'));
    expect((await one<{ s: string | null }>('SELECT board_rebuild_since AS s FROM guild')).s).toBeNull();
    expect(await status()).toContain('**Board order:** A→Z');
    // The index links the new posts.
    expect(forum.text(forum.byName(INDEX))).toContain(`<#${forum.byName('Alchemy')!.id}>`);
  });

  it('a post with member replies is never replaced or deleted; status then says out of order', async () => {
    await oldBoard();
    const brewing = forum.byName('Brewing')!;
    forum.memberReply(brewing);
    await rebuild();
    const run = boardLines().at(-1);
    expect(run.results[0]).toMatchObject({ guarded: ['Brewing'], rebuild: 'done' });
    expect(forum.threads.get(brewing.id)).toBeDefined();
    expect(forum.posts().filter((t) => t.name === 'Brewing')).toHaveLength(1);
    expect(await status()).toContain('out of order');
  });

  it('spanning invocations: a run cut short continues in the next one, still Z→A, and nothing is deleted early', async () => {
    await oldBoard();
    // Thread creation is rate limited after two creates (longer than the run may wait).
    let creates = 0;
    forum.failures.push({ match: (c) => c.method === 'POST' && c.path.endsWith('/threads') && ++creates > 2, status: 429, body: { retry_after: 60, global: false, message: 'rate limited' }, times: 1 });
    await rebuild();
    const first = boardLines().at(-1).results[0];
    expect(first).toMatchObject({ replaced: 2, deleted_old: 0, rebuild: 'in_progress' });
    // An ordinary command meanwhile creates nothing.
    await exchange(cmd(admin, 'character', 'add', { name: 'Testchar' }), TOKEN);
    const posts = forum.calls.length;
    await exchange(cmd(admin, 'craft', 'set', { skill: 'Alchemy', level: 5 }), TOKEN);
    expect(boardLines().at(-1).results[0].rebuild).toBe('held');
    expect(forum.calls.slice(posts).filter((c) => c.method === 'POST' && c.path.endsWith('/threads'))).toEqual([]);
    // The sweep continues it.
    const run = await runCron();
    expect(run.results[0]).toMatchObject({ rebuild: 'done' });
    expect(forum.display()).toEqual([INDEX, ...(await skillsAZ())]);
  });

  it('needs a board, and is admin only', async () => {
    expect(await rebuild()).toContain('There is no roster board yet');
    expect(await reply(exchange(cmd(as('100000000000000002', { nick: 'Bo' }), 'guildcraft', 'rebuild-board'), TOKEN))).toMatch(/Only server admins/);
  });
});

describe('keep active (nightly)', () => {
  it('a post within 2 days of auto-archiving gets its auto-archive time changed; an archived one is unarchived', async () => {
    forum.clockOffsetMs = -6 * 24 * HOUR; // created 6 days ago, auto-archive 7 days: due in 1 day
    await setupBoard();
    forum.clockOffsetMs = 0;
    forum.byName('Alchemy')!.archived = true;
    const run = await runCron(Date.parse('2026-10-20T08:00:00Z'));
    const n = (await skillsAZ()).length;
    expect(run.results[0]).toMatchObject({ bumped: n - 1, unarchived: 1 });
    expect(forum.posts().filter((t) => t.name !== INDEX).every((t) => !t.archived)).toBe(true);
    expect(forum.byName('Blacksmithing')!.autoArchive).toBe(4320);
    expect(forum.byName(INDEX)!.autoArchive).toBe(10080); // the pinned index never archives: never bumped
    // A post bumped tonight is not bumped again tomorrow unless due.
    const again = await runCron(Date.parse('2026-10-21T08:00:00Z'));
    expect(again.results[0].bumped).toBe(0);
    expect(KEEP_ACTIVE_MS).toBe(2 * 24 * HOUR);
  });

  it('worst case, 16 tradeskills all due and all changed, stays under the 40-call cap', async () => {
    await reset(Array.from({ length: 16 }, (_, i) => `Skill ${String(i).padStart(2, '0')}`));
    forum.clockOffsetMs = -6 * 24 * HOUR;
    await setupBoard();
    forum.clockOffsetMs = 0;
    await env.DB.prepare('UPDATE board_post SET content_hash = NULL').run();
    const run = await runCron(Date.parse('2026-10-20T08:00:00Z'));
    expect(run.results[0]).toMatchObject({ bumped: 16, edited: 16, left_dirty: 0, index: 'edited' });
    expect(run.d1_calls + run.discord_calls).toBeLessThanOrEqual(BOARD_CALL_CAP);
    logs.push(`worst case nightly: ${run.d1_calls} D1 + ${run.discord_calls} Discord`);
    expect(run.d1_calls + run.discord_calls).toBe(37);
  });
});

describe('discord_lag_ms (ITEM 2)', () => {
  it('is the time from the interaction id (a snowflake) to receipt', () => {
    const id = String(snowflakeAt(Date.parse('2026-10-20T00:33:32.000Z')));
    expect(discordLagMs(id, Date.parse('2026-10-20T00:33:32.250Z'))).toBe(250);
    expect(discordLagMs(undefined, 1)).toBeNull();
  });
});

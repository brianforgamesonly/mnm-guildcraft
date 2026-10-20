// Order 12 (ITEM 3): what production shows guilds, captured at 2b204aa (before the OperatorText restructuring) with
// fixed data and a fixed clock: /guildcraft status in every branch, the departure notes it shows, and the departure
// notice. Each runs as production and with GUILDCRAFT_COPY unset (which counts as production, src/env.ts). The
// snapshots (__snapshots__/production-snapshot.test.ts.snap) were written by the unchanged code; after the change the
// outputs must match them byte for byte. CI never writes a snapshot (vitest --ci), so a missing one fails.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOARD_CALL_CAP, botApi as makeApi } from '../../src/board/api.ts';
import { departuresForGuild, MAX_NOTICES, noticeMessage } from '../../src/departures.ts';
import { reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, GUILD, send, spyOnFetch, webhook } from '../discord.ts';

const NOW = Date.parse('2026-10-21T06:00:00Z');
const H = 3_600_000;
const iso = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();
const REVIEW = '600000000000000010';
const BOARD = '600000000000000020';
const VAULT = '600000000000000030';
const ANN = '100000000000000001';
const admin = as(ANN, { permissions: ADMIN, nick: 'Ann' });
const COPIES = [
  ['production', { env: { DISCORD_BOT_TOKEN: 'test-bot-token', GUILDCRAFT_COPY: 'production' } }],
  ['unset', { env: { DISCORD_BOT_TOKEN: 'test-bot-token', GUILDCRAFT_COPY: undefined } }],
] as const;

/** The fake server's member list and review channel. */
let server: { members: string[]; failStatus?: number; postStatus?: number };
beforeEach(async () => {
  await reset();
  await env.DB.batch(['usage_daily', 'backup_status', 'data_import'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  webhook.reset();
  spyOnFetch();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  server = { members: [ANN] };
  botApi.handle = (method, path) => {
    if (method === 'GET' && /^\/guilds\/\d+\/members\?/.test(path)) {
      if (server.failStatus) return new Response(JSON.stringify({ message: 'Missing Access', code: 50001 }), { status: server.failStatus });
      return new Response(JSON.stringify(server.members.map((id) => ({ user: { id } }))), { status: 200 });
    }
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) {
      if (server.postStatus) return new Response(JSON.stringify({ message: 'Missing Access', code: 50001 }), { status: server.postStatus });
      return new Response(JSON.stringify({ id: '555000000000000001' }), { status: 200 });
    }
    if (method === 'GET' && /^\/guilds\/\d+$/.test(path)) return new Response(JSON.stringify({ name: 'Test Guild' }), { status: 200 });
    return new Response(JSON.stringify({ message: 'not faked', code: 0 }), { status: 404 });
  };
  // The guild row (and Ann as a member), then fixed times wherever status reads one.
  await send(cmd(admin, 'guildcraft', 'setup'), COPIES[0][1]);
});
afterEach(() => {
  botApi.reset();
  vi.restoreAllMocks();
});

const status = async (opts: (typeof COPIES)[number][1]) => (await send(cmd(admin, 'guildcraft', 'status'), opts)).data.content as string;
const run = (sql: string, ...binds: unknown[]) => env.DB.prepare(sql).bind(...binds).run();
const importRow = (status: string, at: string, error: string | null = null, warnings = '[1]') =>
  run("INSERT INTO data_import (source, source_version, status, warnings, error, started_at, finished_at) VALUES ('test', 'v2026.10.19', ?, ?, ?, ?, ?)", status, warnings, error, at, at);
const backupRow = (result: string, at: string, o: { error?: string; size?: number; token?: string | null } = {}) =>
  run('INSERT INTO backup_status (started_at, finished_at, result, error, size_bytes, token_expires) VALUES (?, ?, ?, ?, ?, ?)', at, at, result, o.error ?? null, o.size ?? null, o.token === undefined ? '2027-10-20' : o.token);
const usageRow = (metric: string, day: string, value: number) =>
  run('INSERT OR REPLACE INTO usage_daily (day, metric, value, measured_at) VALUES (?, ?, ?, ?)', day, metric, value, iso(1));
const channels = (o: { board?: boolean; review?: boolean; vault?: boolean }) =>
  run('UPDATE guild SET board_channel_id = ?, review_channel_id = ?, vault_channel_id = ?', o.board ? BOARD : null, o.review ? REVIEW : null, o.vault ? VAULT : null);
const member = (id: string, status = 'active') =>
  run("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, ?, '2026-10-20T00:00:00Z')", GUILD, id, `M${id.slice(-3)}`, status);
const api = (cap = BOARD_CALL_CAP) => makeApi('test-bot-token', { d1: () => 0, discord: 0, cap, deadline: NOW + 60_000 });
const guildRow = async () => (await env.DB.prepare('SELECT id, review_channel_id FROM guild').first<{ id: string; review_channel_id: string | null }>())!;

/** Every branch of /guildcraft status: the seed that reaches it. */
const BRANCHES: [string, () => Promise<unknown>][] = [
  ['none yet', async () => {}],
  ['ok', async () => {
    await channels({ board: true, review: true, vault: true });
    await importRow('ok', iso(22));
    await backupRow('ok', iso(2), { size: 2_500_000 });
    await usageRow('d1_rows_read', '2026-10-20', 612_000);
    await usageRow('workers_requests', '2026-10-20', 1_200);
    await run("INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) VALUES (?, 'system', 'departures.run', ?, ?, ?)", GUILD, `guild:${GUILD}`, JSON.stringify({ marked: 1, stopped: null }), iso(21));
  }],
  ['failed', async () => {
    await importRow('ok', iso(46));
    await importRow('failed', iso(22), 'D1 HTTP 500: 7500 internal');
    await backupRow('ok', iso(26));
    await backupRow('failed', iso(2), { error: 'push refused: 403' });
  }],
  ['failed without detail', async () => {
    await importRow('failed', iso(22), null);
    await backupRow('failed', iso(2));
  }],
  ['overdue', async () => {
    await importRow('ok', iso(22));
    await backupRow('ok', iso(37), { size: 900, token: 'unknown' });
  }],
  ['dry run newer than import', async () => {
    await importRow('ok', iso(22));
    await importRow('dry-run', iso(3), null, '[1,2,3,4]');
    await backupRow('ok', iso(2), { token: null });
  }],
  ['latest nightly run', async () => {
    await importRow('ok', iso(46));
    await importRow('refused', iso(22), 'row count fell 40% (2000 → 1200)');
  }],
  ['latest nightly run failed, no real import', async () => {
    await importRow('failed', iso(22), 'source unreachable');
  }],
  ['board set, unset review and vault', async () => {
    await channels({ board: true });
    await run("INSERT INTO board_post (guild_id, tradeskill_id, thread_id, message_ids_json, content_hash, dirty, last_rendered_at) SELECT ?, id, '700000000000000001', '[\"700000000000000002\"]', 'h', 1, ? FROM tradeskill WHERE name = 'Alchemy'", GUILD, iso(5));
  }],
];

describe('production status: every branch, as at 2b204aa', () => {
  for (const [name, seed] of BRANCHES)
    for (const [copy, opts] of COPIES)
      it(`${name} (${copy})`, async () => {
        await seed();
        expect(await status(opts)).toMatchSnapshot();
      });
});

/** Every departure note the nightly run can leave for status to show. */
const NOTES: [string, () => Promise<void>][] = [
  ['list unread (a skipped page)', async () => void (await departuresForGuild(env.DB, api(0), await guildRow(), { nowMs: NOW }))],
  ['list refused', async () => {
    server.failStatus = 403;
    await departuresForGuild(env.DB, api(), await guildRow(), { nowMs: NOW });
  }],
  ['the ceiling', async () => {
    for (let k = 10; k < 20; k++) await member(`1000000000000000${k}`);
    await departuresForGuild(env.DB, api(), await guildRow(), { nowMs: NOW });
  }],
  ['no review channel', async () => {
    await member('100000000000000002');
    await departuresForGuild(env.DB, api(), await guildRow(), { nowMs: NOW });
  }],
  ['more tomorrow', async () => {
    await channels({ review: true });
    for (let k = 10; k < 22; k++) await member(`3000000000000000${k}`);
    for (let k = 10; k < 50; k++) await member(`4000000000000000${k}`);
    server.members = [ANN, ...Array.from({ length: 40 }, (_, k) => `4000000000000000${k + 10}`)];
    await departuresForGuild(env.DB, api(), await guildRow(), { nowMs: NOW });
  }],
  ['the review channel refused a notice', async () => {
    await channels({ review: true });
    await member('100000000000000002');
    server.postStatus = 403;
    await departuresForGuild(env.DB, api(), await guildRow(), { nowMs: NOW });
  }],
];

describe('production departure notes in status, as at 2b204aa', () => {
  for (const [name, seed] of NOTES)
    for (const [copy, opts] of COPIES)
      it(`${name} (${copy})`, async () => {
        await seed();
        expect((await status(opts)).split('\n').find((l) => l.startsWith('**Departures:**'))).toMatchSnapshot();
      });
  it(`the notice itself (posted in the review channel; at most ${MAX_NOTICES} a night)`, () => {
    expect(noticeMessage('100000000000000002', 'Bo', [{ id: 1, name: 'Bochar', class: 'WIZ', level: 30 }])).toMatchSnapshot();
    expect(noticeMessage('100000000000000003', null, [])).toMatchSnapshot();
  });
});

// Order 8 (ITEMs 1–3; PRD FR-8): /guildcraft status's last data update (test updates apart), Backup line and Usage
// section, and the usage warning (usage_daily → state → the cron's one line in the review channel) against a fake
// Discord. Never a live post. Order 11: the operator-only lines and the channel warning are the dev copy's only (the
// tests run as the dev environment); production's usage alarm is the usage job's (scripts/usage/level-alarm.ts).
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { BOARD_CALL_CAP, botApi as makeApi } from '../../src/board/api.ts';
import { FREE_LIMITS, METRICS } from '../../src/limits.ts';
import { alertText, ofLimit, tokenExpiryText, usageAlerts, usageLines } from '../../src/usage.ts';
import { judgesLevel, levelChanges, levelSummary, type DayFigure } from '../../scripts/usage/level-alarm.ts';
import { all, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, GUILD, send, spyOnFetch, webhook } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const PROD = { env: { ...TOKEN.env, GUILDCRAFT_COPY: 'production' } };
const UNSET = { env: { ...TOKEN.env, GUILDCRAFT_COPY: undefined } };
const REVIEW = '600000000000000010';
const admin = as('100000000000000001', { permissions: ADMIN, nick: 'Ann' });
const NOW = Date.parse('2026-10-21T06:00:00Z');
const H = 3_600_000;

let posted: { channel: string; body: any }[];
beforeEach(async () => {
  await reset();
  await env.DB.batch(['usage_daily', 'backup_status'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  webhook.reset();
  spyOnFetch();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  posted = [];
  botApi.handle = (method, path, body) => {
    const msg = path.match(/^\/channels\/(\d+)\/messages$/);
    if (method === 'POST' && msg) {
      posted.push({ channel: msg[1], body });
      return new Response(JSON.stringify({ id: '555000000000000001' }), { status: 200 });
    }
    if (method === 'GET' && /^\/guilds\/\d+$/.test(path)) return new Response(JSON.stringify({ name: 'Test Guild' }), { status: 200 });
    return new Response(JSON.stringify({ message: 'not faked', code: 0 }), { status: 404 });
  };
});
afterEach(() => {
  botApi.reset();
  vi.restoreAllMocks();
});

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const usage = (rows: [string, string, number][], measured = new Date(NOW - H).toISOString()) =>
  env.DB.batch(rows.map(([metric, d, value]) => env.DB.prepare('INSERT OR REPLACE INTO usage_daily (day, metric, value, measured_at) VALUES (?, ?, ?, ?)').bind(d, metric, value, measured)));
const imports = (rows: [string, string][]) =>
  env.DB.batch(rows.map(([status, at]) => env.DB.prepare("INSERT INTO data_import (source, source_version, status, warnings, started_at, finished_at) VALUES ('test', 'v', ?, ?, ?, ?)").bind(status, status === 'dry-run' ? '[1,2,3,4]' : '[1]', at, at)));
const status = async (opts = TOKEN) => (await send(cmd(admin, 'guildcraft', 'status'), opts)).data.content as string;
const api = () => makeApi('test-bot-token', { d1: () => 0, discord: 0, cap: BOARD_CALL_CAP, deadline: Date.now() + 60_000 });
const withReview = () => env.DB.prepare('UPDATE guild SET review_channel_id = ?').bind(REVIEW).run();
const alerts = async () => all<{ target: string; detail_json: string }>("SELECT target, detail_json FROM audit_log WHERE action = 'usage.alert' ORDER BY id");

describe('/guildcraft status: the last data update', () => {
  it("shows the last real import, never a newer dry run as if it were one (the operator's check of order 7)", async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN); // creates the guild row
    await imports([['ok', '2026-10-19T07:31:00Z'], ['dry-run', '2026-10-19T21:39:50Z']]);
    const s = await status();
    expect(s).toMatch(/\*\*Last data update:\*\* <t:1792395060:f> \(<t:\d+:R>\) · 1 warning · ok\n/);
    expect(s).not.toMatch(/Last data update:[^\n]*dry-run/);
    expect(s).toMatch(/\*\*Last test update:\*\* <t:\d+:f> \(<t:\d+:R>\) \(no changes saved\) · 4 warnings/);
  });
  it('drops the test-update line once a real import is newer', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await imports([['dry-run', '2026-10-19T21:39:50Z'], ['failed', '2026-10-20T07:31:00Z']]);
    const s = await status();
    expect(s).toMatch(/\*\*Last data update:\*\* <t:\d+:f> \(<t:\d+:R>\) · 1 warning · failed/);
    expect(s).not.toContain('Last test update');
  });

  it('order 9: a refusal is never the last import, but status shows it while it is the newest nightly run', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await imports([['ok', '2026-10-19T07:31:00Z'], ['refused', '2026-10-20T07:31:00Z']]);
    const s = await status();
    expect(s).toMatch(/\*\*Last data update:\*\* <t:1792395060:f> \(<t:\d+:R>\) · 1 warning · ok/);
    expect(s).toMatch(/\*\*Latest nightly run:\*\* <t:\d+:f> \(<t:\d+:R>\) · \*\*refused\*\*/);
    await imports([['ok', '2026-10-21T07:31:00Z']]);
    expect(await status()).not.toContain('Latest nightly run');
  });
});

describe('/guildcraft status: backup and usage', () => {
  it('shows the backup line with the token expiry, and marks it overdue after 36 hours', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    const fresh = new Date(Date.now() - 2 * H).toISOString();
    await env.DB.prepare("INSERT INTO backup_status (started_at, finished_at, result, size_bytes, token_expires) VALUES (?, ?, 'ok', 2500000, '2027-10-20')").bind(fresh, fresh).run();
    let s = await status();
    expect(s).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · token expires 2027-10-20 · 2\.5 MB\n/);
    const old = new Date(Date.now() - 37 * H).toISOString();
    await env.DB.prepare('UPDATE backup_status SET finished_at = ?').bind(old).run();
    s = await status();
    expect(s).toContain('**overdue**: no backup in over 36 hours');
  });
  it('a failed latest run says so, keeps the last good time, and an unread expiry shows the owner\'s no-expiry note', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    const t = (h: number) => new Date(Date.now() - h * H).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO backup_status (started_at, finished_at, result, token_expires) VALUES (?, ?, 'ok', 'unknown')").bind(t(26), t(26)),
      env.DB.prepare("INSERT INTO backup_status (started_at, finished_at, result, error, token_expires) VALUES (?, ?, 'failed', 'push refused', 'unknown')").bind(t(2), t(2)),
    ]);
    expect(await status()).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · token: no expiry \(owner's note\) · latest run <t:\d+:f> \*\*failed\*\*: push refused/);
  });
  it('order 10: status says which copy answered (the tests run as the dev environment)', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    expect(await status()).toMatch(/^## GuildCraft status\n\*\*Copy:\*\* dev\n/);
  });
  it('the token text: a read expiry wins; without one, the note decides', () => {
    expect(tokenExpiryText('2027-10-20T00:00:00.000Z')).toBe('token expires 2027-10-20');
    expect(tokenExpiryText('unknown')).toBe("token: no expiry (owner's note)");
    expect(tokenExpiryText(null, 'unset')).toBe('token expires unknown');
  });
  it('shows each metric as N of LIMIT (P%) for the last full day, with the 7-day peak', async () => {
    const now = Date.now();
    await usage(
      [
        ['workers_requests', day(now - 1 * 86_400_000), 1_200],
        ['workers_requests', day(now - 3 * 86_400_000), 4_000],
        ['workers_requests', day(now - 9 * 86_400_000), 90_000], // outside the window
        ['d1_rows_read', day(now - 86_400_000), 612_000],
        ['d1_storage_bytes', day(now - 86_400_000), 9_400_000],
      ],
      new Date(now - H).toISOString(),
    );
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    const s = await status();
    expect(s).toContain(`- Commands and lookups: 1,200 of 100,000 (1.2%) on ${day(now - 86_400_000)} · 7-day peak 4,000 of 100,000 (4.0%) (${day(now - 3 * 86_400_000)}, 2 days measured)`);
    expect(s).toContain('- Records read: 612,000 of 5,000,000 (12%)');
    expect(s).toContain('- Stored data: 9.4 MB of 5.00 GB (0.2%)');
    expect(s).toContain('- Records written: not measured');
    expect(s).not.toContain('overdue');
  });
  it('marks the usage figures overdue after 36 hours', () => {
    const lines = usageLines([{ metric: 'workers_requests', day: '2026-10-19', value: 5, measured_at: new Date(NOW - 37 * H).toISOString() }], NOW);
    expect(lines[0]).toContain('**figures overdue** (not measured in 36 hours)');
  });
  it('every limit names its docs page (the hand-kept list, src/limits.ts)', () => {
    for (const m of METRICS) expect(FREE_LIMITS[m].source).toMatch(/^https:\/\/developers\.cloudflare\.com\//);
    expect(ofLimit('d1_rows_written', 0)).toBe('0 of 100,000 (0.0%)');
  });
});

describe('the usage warning (mocked Discord)', () => {
  it('posts one line when a metric goes over 10%, records it, and posts nothing more while the state holds', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000], ['workers_requests', '2026-10-20', 900]]);
    let log = await usageAlerts(env.DB, api(), NOW);
    expect(log).toMatchObject({ guilds: 1, posted: 1, errors: [] });
    expect(posted).toEqual([{ channel: REVIEW, body: { content: alertText('d1_rows_read', { metric: 'd1_rows_read', day: '2026-10-20', value: 612_000, measured_at: '' }, 'over'), allowed_mentions: { parse: [] } } }]);
    expect(posted[0].body.content).toContain('612,000 of 5,000,000 (12%)');
    expect((await alerts()).map((a) => [a.target, JSON.parse(a.detail_json).state])).toEqual([['usage:d1_rows_read', 'over']]);
    // The next cron runs, and the next day still over: nothing new.
    log = await usageAlerts(env.DB, api(), NOW + 15 * 60_000);
    await usage([['d1_rows_read', '2026-10-21', 700_000]], new Date(NOW + 23 * H).toISOString());
    log = await usageAlerts(env.DB, api(), NOW + 24 * H);
    expect(log.posted).toBe(0);
    expect(posted).toHaveLength(1);
  });
  it('posts "back under" on the change down, but not twice in one UTC day', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    await usageAlerts(env.DB, api(), NOW);
    // Same day: the figure is corrected under 10%; the change waits for the next UTC day.
    await usage([['d1_rows_read', '2026-10-20', 1_000]]);
    expect((await usageAlerts(env.DB, api(), NOW + H)).posted).toBe(0);
    expect((await usageAlerts(env.DB, api(), NOW + 24 * H)).posted).toBe(1);
    expect(posted[1].body.content).toContain('back under the 10% target');
    expect((await alerts()).map((a) => JSON.parse(a.detail_json).state)).toEqual(['over', 'under']);
  });
  it('posts nothing for figures under 10%, for stale figures, or without a review channel', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    expect((await usageAlerts(env.DB, api(), NOW)).guilds).toBe(0); // no review channel
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]], new Date(NOW - 37 * H).toISOString());
    expect(await usageAlerts(env.DB, api(), NOW)).toMatchObject({ posted: 0, stale: 1 });
    await usage([['d1_rows_read', '2026-10-20', 1_000]]);
    expect((await usageAlerts(env.DB, api(), NOW)).posted).toBe(0);
    expect(posted).toEqual([]);
  });
  it('a refused post keeps the old state and is retried the next UTC day, not every 15 minutes', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    const ok = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'POST' ? new Response(JSON.stringify({ message: 'Missing Access', code: 50001 }), { status: 403 }) : ok(m, p, b));
    expect((await usageAlerts(env.DB, api(), NOW)).errors).toEqual(['usage alert: HTTP 403 code 50001']);
    expect((await alerts()).map((a) => JSON.parse(a.detail_json))).toMatchObject([{ state: 'under', failed: 403, wanted: 'over' }]);
    botApi.handle = ok;
    expect((await usageAlerts(env.DB, api(), NOW + 15 * 60_000)).posted).toBe(0);
    expect((await usageAlerts(env.DB, api(), NOW + 24 * H)).posted).toBe(1);
    expect(posted).toHaveLength(1);
  });
  it('leaves the calls it is told to keep for what runs after it', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    const tight = makeApi('test-bot-token', { d1: () => 0, discord: 0, cap: 7, deadline: Date.now() + 60_000 });
    expect((await usageAlerts(env.DB, tight, NOW, 6)).posted).toBe(0);
    expect(posted).toEqual([]);
  });
  it('runs inside the */15 cron (job → usage_daily → cron → one line)', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['workers_requests', day(Date.now() - 86_400_000), 15_000]], new Date().toISOString());
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
    await waitOnExecutionContext(ctx);
    expect(posted.map((p) => p.channel)).toEqual([REVIEW]);
    expect(posted[0].body.content).toContain('**Commands and lookups** was 15,000 of 100,000 (15%)');
    expect(GUILD).toBeTruthy();
  });
  it('order 11: the production cron posts no usage warning in any channel', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['workers_requests', day(Date.now() - 86_400_000), 15_000]], new Date().toISOString());
    for (const copy of ['production', undefined]) {
      const ctx = createExecutionContext();
      await worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '*/15 * * * *' }), { ...env, ...TOKEN.env, GUILDCRAFT_COPY: copy } as any, ctx);
      await waitOnExecutionContext(ctx);
    }
    expect(posted).toEqual([]);
    expect(await alerts()).toEqual([]);
  });
});

// ---------------------------------------------------------------- order 11: operator-only lines

describe('/guildcraft status: production omits the operator-only lines; dev keeps them', () => {
  const seed = async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await imports([['ok', '2026-10-19T07:31:00Z'], ['failed', '2026-10-20T07:31:00Z'], ['dry-run', '2026-10-20T21:39:50Z']]);
    await env.DB.prepare("UPDATE data_import SET error = 'D1 HTTP 500: 7500 internal' WHERE status = 'failed'").run();
    const t = (h: number) => new Date(Date.now() - h * H).toISOString();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO backup_status (started_at, finished_at, result, token_expires) VALUES (?, ?, 'ok', '2027-10-20')").bind(t(26), t(26)),
      env.DB.prepare("INSERT INTO backup_status (started_at, finished_at, result, error, token_expires) VALUES (?, ?, 'failed', 'push refused: 403', '2027-10-20')").bind(t(2), t(2)),
    ]);
    await usage([['d1_rows_read', day(Date.now() - 86_400_000), 612_000]], new Date(Date.now() - H).toISOString());
  };
  it('dev: the copy marker, the test update, raw errors, the token and the usage section', async () => {
    await seed();
    const s = await status();
    expect(s).toMatch(/^## GuildCraft status\n\*\*Copy:\*\* dev\n/);
    expect(s).toMatch(/\*\*Last data update:\*\* <t:\d+:f> \(<t:\d+:R>\) · 1 warning · failed: D1 HTTP 500: 7500 internal\n/);
    expect(s).toContain('**Last test update:**');
    expect(s).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · token expires 2027-10-20 · latest run <t:\d+:f> \*\*failed\*\*: push refused: 403\n/);
    expect(s).toContain('**Usage against the free-tier limits**');
  });
  for (const [name, opts] of [['production', PROD], ['unset (counts as production)', UNSET]] as const)
    it(`${name}: none of them, and a failure names the next step instead of the raw error`, async () => {
      await seed();
      const s = await status(opts);
      expect(s).toMatch(/^## GuildCraft status\n\*\*Data version:\*\*/);
      expect(s).toMatch(/\*\*Last data update:\*\* <t:\d+:f> \(<t:\d+:R>\) · 1 warning · failed\. If this repeats, tell Joegandomi\.\n/);
      expect(s).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · latest run <t:\d+:f> \*\*failed\*\*\. If this repeats, tell Joegandomi\.$/);
      for (const hidden of ['**Copy:**', 'Last test update', 'token', '7500 internal', 'push refused', 'Usage against', 'free-tier', 'Records read']) expect(s).not.toContain(hidden);
    });
});

// ---------------------------------------------------------------- order 11: the usage job's level alarm

describe('the usage-level alarm (the production run of the usage job)', () => {
  const READ = 5_000_000; // d1_rows_read's Free limit
  const fig = (day: string, share: number): DayFigure => ({ metric: 'd1_rows_read', day, value: Math.round(READ * share) });
  const judge = (rows: DayFigure[], yesterday: string) => levelSummary(levelChanges(rows, yesterday));

  it('crossing up fails once; the unchanged state the next day passes', () => {
    const rows = [fig('2026-10-18', 0.02), fig('2026-10-19', 0.12)];
    const first = judge(rows, '2026-10-19');
    expect(first.failed).toBe(true);
    expect(first.line).toBe('usage level: over the 10% target: Records read 12.0% on 2026-10-19');
    const next = judge([...rows, fig('2026-10-20', 0.13)], '2026-10-20');
    expect(next.failed).toBe(false);
    expect(next.line).toContain('still over (already reported): Records read 13.0% on 2026-10-20');
  });
  it('dropping back under is a state change reported in the summary, and passes', () => {
    const r = judge([fig('2026-10-19', 0.12), fig('2026-10-20', 0.03)], '2026-10-20');
    expect(r.failed).toBe(false);
    expect(r.line).toBe('usage level: back under 10%: Records read 3.0% on 2026-10-20');
  });
  it('under and staying under passes; no earlier day counts as under; a metric without yesterday is not judged again', () => {
    expect(judge([fig('2026-10-19', 0.01), fig('2026-10-20', 0.02)], '2026-10-20')).toEqual({ failed: false, line: 'usage level: every metric under 10%' });
    expect(judge([fig('2026-10-20', 0.5)], '2026-10-20').failed).toBe(true);
    // Yesterday's figure missing (storage lands late): the older crossing was judged on its own day, not again.
    expect(judge([fig('2026-10-18', 0.02), fig('2026-10-19', 0.12)], '2026-10-20').failed).toBe(false);
  });
  it('only the production run judges it: the dev run never fails on it (the figures are account-wide)', () => {
    expect(judgesLevel('production')).toBe(true);
    expect(judgesLevel('dev')).toBe(false);
  });
  it('per metric: one metric crossing fails even while another stays over', () => {
    const w = (day: string, v: number): DayFigure => ({ metric: 'workers_requests', day, value: v });
    const r = judge([fig('2026-10-19', 0.12), fig('2026-10-20', 0.12), w('2026-10-19', 1_000), w('2026-10-20', 20_000)], '2026-10-20');
    expect(r.failed).toBe(true);
    expect(r.line).toBe('usage level: over the 10% target: Commands and lookups 20.0% on 2026-10-20; still over (already reported): Records read 12.0% on 2026-10-20');
  });
});

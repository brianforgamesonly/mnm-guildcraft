// Order 8 (ITEMs 1–3; PRD FR-8): /guildcraft status's last data update (test updates apart), Backup line and Usage
// section, and the usage warning (usage_daily → state → the cron's one line in the review channel) against a fake
// Discord. Never a live post. Order 11: the operator-only lines and the channel warning are the dev copy's only (the
// tests run as the dev environment); production's usage alarm is the usage job's (scripts/usage/level-alarm.ts).
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { BOARD_CALL_CAP, botApi as makeApi } from '../../src/board/api.ts';
import { FREE_LIMITS, METRICS } from '../../src/limits.ts';
import { render } from '../../src/operator-text.ts';
import { alertText, ofLimit, tokenExpiryText, usageAlerts, usageLines } from '../../src/usage.ts';
import { judgesLevel, levelChanges, levelSummary, type DayFigure } from '../../scripts/usage/level-alarm.ts';
import { byShape, dbLabel, figureLine, queryShape, redact, topBy } from '../../scripts/usage/queries.ts';
import { causeLines, errorAnnotation } from '../../scripts/usage/cause.ts';
import { all, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, GUILD, send, spyOnFetch, webhook } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const PROD = { env: { ...TOKEN.env, GUILDCRAFT_COPY: 'production' } };
const UNSET = { env: { ...TOKEN.env, GUILDCRAFT_COPY: undefined } };
const REVIEW = '600000000000000010';
const admin = as('100000000000000001', { permissions: ADMIN, nick: 'Ann' });
const NOW = Date.parse('2026-10-21T06:00:00Z');
const DEV = 'dev';
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
    expect(s).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · 2\.5 MB\n\*\*Backup token:\*\* expires 2027-10-20\n/);
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
    expect(await status()).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · latest run <t:\d+:f> \*\*failed\*\*: push refused\. If this repeats, tell Joegandomi\.\n\*\*Backup token:\*\* no expiry \(owner's note\)\n/);
  });
  it('order 10: status says which copy answered (the tests run as the dev environment)', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    expect(await status()).toMatch(/^## GuildCraft status\n\*\*Copy:\*\* dev\n/);
  });
  it('the token text: a read expiry wins; without one, the note decides', () => {
    // Order 12, ITEM 2: the three wordings of the token's own line.
    expect(tokenExpiryText('2027-10-20T00:00:00.000Z')).toBe('expires 2027-10-20');
    expect(tokenExpiryText('unknown')).toBe("no expiry (owner's note)");
    expect(tokenExpiryText(null, 'unset')).toBe('expiry unknown');
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
    expect(render(DEV, lines)).toContain('**figures overdue** (not measured in 36 hours)');
    expect(render('production', lines)).toBe('');
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
    let log = await usageAlerts(env.DB, api(), DEV, NOW);
    expect(log).toMatchObject({ guilds: 1, posted: 1, errors: [] });
    expect(posted).toEqual([{ channel: REVIEW, body: { content: render(DEV, [alertText('d1_rows_read', { metric: 'd1_rows_read', day: '2026-10-20', value: 612_000, measured_at: '' }, 'over')]), allowed_mentions: { parse: [] } } }]);
    expect(posted[0].body.content).toContain('612,000 of 5,000,000 (12%)');
    expect((await alerts()).map((a) => [a.target, JSON.parse(a.detail_json).state])).toEqual([['usage:d1_rows_read', 'over']]);
    // The next cron runs, and the next day still over: nothing new.
    log = await usageAlerts(env.DB, api(), DEV, NOW + 15 * 60_000);
    await usage([['d1_rows_read', '2026-10-21', 700_000]], new Date(NOW + 23 * H).toISOString());
    log = await usageAlerts(env.DB, api(), DEV, NOW + 24 * H);
    expect(log.posted).toBe(0);
    expect(posted).toHaveLength(1);
  });
  it('posts "back under" on the change down, but not twice in one UTC day', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    await usageAlerts(env.DB, api(), DEV, NOW);
    // Same day: the figure is corrected under 10%; the change waits for the next UTC day.
    await usage([['d1_rows_read', '2026-10-20', 1_000]]);
    expect((await usageAlerts(env.DB, api(), DEV, NOW + H)).posted).toBe(0);
    expect((await usageAlerts(env.DB, api(), DEV, NOW + 24 * H)).posted).toBe(1);
    expect(posted[1].body.content).toContain('back under the 10% target');
    expect((await alerts()).map((a) => JSON.parse(a.detail_json).state)).toEqual(['over', 'under']);
  });
  it('posts nothing for figures under 10%, for stale figures, or without a review channel', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    expect((await usageAlerts(env.DB, api(), DEV, NOW)).guilds).toBe(0); // no review channel
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]], new Date(NOW - 37 * H).toISOString());
    expect(await usageAlerts(env.DB, api(), DEV, NOW)).toMatchObject({ posted: 0, stale: 1 });
    await usage([['d1_rows_read', '2026-10-20', 1_000]]);
    expect((await usageAlerts(env.DB, api(), DEV, NOW)).posted).toBe(0);
    expect(posted).toEqual([]);
  });
  it('a refused post keeps the old state and is retried the next UTC day, not every 15 minutes', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    const ok = botApi.handle!;
    botApi.handle = (m, p, b) => (m === 'POST' ? new Response(JSON.stringify({ message: 'Missing Access', code: 50001 }), { status: 403 }) : ok(m, p, b));
    expect((await usageAlerts(env.DB, api(), DEV, NOW)).errors).toEqual(['usage alert: HTTP 403 code 50001']);
    expect((await alerts()).map((a) => JSON.parse(a.detail_json))).toMatchObject([{ state: 'under', failed: 403, wanted: 'over' }]);
    botApi.handle = ok;
    expect((await usageAlerts(env.DB, api(), DEV, NOW + 15 * 60_000)).posted).toBe(0);
    expect((await usageAlerts(env.DB, api(), DEV, NOW + 24 * H)).posted).toBe(1);
    expect(posted).toHaveLength(1);
  });
  it('leaves the calls it is told to keep for what runs after it', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    const tight = makeApi('test-bot-token', { d1: () => 0, discord: 0, cap: 7, deadline: Date.now() + 60_000 });
    expect((await usageAlerts(env.DB, tight, DEV, NOW, 6)).posted).toBe(0);
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
  it('order 12: usageAlerts itself posts and records nothing outside dev (the line is OperatorText)', async () => {
    await send(cmd(admin, 'guildcraft', 'setup'), TOKEN);
    await withReview();
    await usage([['d1_rows_read', '2026-10-20', 612_000]]);
    for (const copy of ['production', undefined]) expect((await usageAlerts(env.DB, api(), copy, NOW)).posted).toBe(0);
    expect(posted).toEqual([]);
    expect(await alerts()).toEqual([]);
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
    // Order 12: dev shows what production shows plus the operator's segments (the raw error before the next step).
    expect(s).toMatch(/\*\*Last data update:\*\* <t:\d+:f> \(<t:\d+:R>\) · 1 warning · failed: D1 HTTP 500: 7500 internal\. If this repeats, tell Joegandomi\.\n/);
    expect(s).toContain('**Last test update:**');
    expect(s).toMatch(/\*\*Backup:\*\* last <t:\d+:f> · latest run <t:\d+:f> \*\*failed\*\*: push refused: 403\. If this repeats, tell Joegandomi\.\n\*\*Backup token:\*\* expires 2027-10-20\n/);
    expect(s.split('\n').find((l) => l.startsWith('**Backup:**'))).not.toContain('token');
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
  // `held`: the newest day usage_daily held for d1_rows_read before the run; the run judges only days after it.
  const judge = (rows: DayFigure[], held: string | undefined) => levelSummary(levelChanges(rows, { d1_rows_read: held }));

  it('crossing up fails once; the unchanged state the next day passes', () => {
    const rows = [fig('2026-10-18', 0.02), fig('2026-10-19', 0.12)];
    const first = judge(rows, '2026-10-18');
    expect(first.failed).toBe(true);
    expect(first.line).toBe('usage level: over the 10% target: Records read 12.0% on 2026-10-19');
    const next = judge([...rows, fig('2026-10-20', 0.13)], '2026-10-19');
    expect(next.failed).toBe(false);
    expect(next.line).toContain('still over (already reported): Records read 13.0% on 2026-10-20');
  });
  it('dropping back under is a state change reported in the summary, and passes', () => {
    const r = judge([fig('2026-10-19', 0.12), fig('2026-10-20', 0.03)], '2026-10-19');
    expect(r.failed).toBe(false);
    expect(r.line).toBe('usage level: back under 10%: Records read 3.0% on 2026-10-20');
  });
  it('under and staying under passes; no earlier day counts as under; a day already held is not judged again', () => {
    expect(judge([fig('2026-10-19', 0.01), fig('2026-10-20', 0.02)], '2026-10-19')).toEqual({ failed: false, line: 'usage level: every metric under 10%' });
    expect(judge([fig('2026-10-20', 0.5)], undefined).failed).toBe(true);
    // Nothing new since the last run (a figure that lands late): the crossing was judged by the run that wrote it.
    expect(judge([fig('2026-10-18', 0.02), fig('2026-10-19', 0.12)], '2026-10-19')).toEqual({ failed: false, line: 'usage level: every metric under 10%' });
  });
  it('a crossing on a day no run judged (a dropped run, a failed measurement) is judged by the next run', () => {
    // The run for 10-19 never wrote; the next run writes 10-19 (crossed up) and 10-20 (still over).
    const r = judge([fig('2026-10-18', 0.02), fig('2026-10-19', 0.12), fig('2026-10-20', 0.13)], '2026-10-18');
    expect(r.failed).toBe(true);
    expect(r.line).toBe('usage level: over the 10% target: Records read 12.0% on 2026-10-19');
  });
  it('only the production run judges it: the dev run never fails on it (the figures are account-wide)', () => {
    expect(judgesLevel('production')).toBe(true);
    expect(judgesLevel('dev')).toBe(false);
  });
  it('per metric: one metric crossing fails even while another stays over', () => {
    const w = (day: string, v: number): DayFigure => ({ metric: 'workers_requests', day, value: v });
    const r = levelSummary(
      levelChanges([fig('2026-10-19', 0.12), fig('2026-10-20', 0.12), w('2026-10-19', 1_000), w('2026-10-20', 20_000)], { d1_rows_read: '2026-10-19', workers_requests: '2026-10-19' }),
    );
    expect(r.failed).toBe(true);
    expect(r.line).toBe('usage level: over the 10% target: Commands and lookups 20.0% on 2026-10-20; still over (already reported): Records read 12.0% on 2026-10-20');
  });
});

// ---------------------------------------------------------------- order 26: what read the rows (public log safe)

describe('order 26: D1 statements as a public log may show them', () => {
  it('every literal becomes ?, so statements differing only in values share a shape', () => {
    expect(queryShape("SELECT * FROM item WHERE name = 'Rusty ''Sword''' AND id = 42 AND x > -1.5e3")).toBe('SELECT * FROM item WHERE name = ? AND id = ? AND x > ?');
    expect(queryShape("INSERT INTO t (a, b) VALUES ('x', 1), ('y', 2),\n ('z', 3)")).toBe('INSERT INTO t (a, b) VALUES (?, …), …');
    expect(queryShape('SELECT a FROM t WHERE id IN (?1, ?2, ?3) AND b = ?')).toBe('SELECT a FROM t WHERE id IN (?, …) AND b = ?');
    expect(queryShape("SELECT x'00ff', t1.c2 FROM t1 LIMIT 10")).toBe('SELECT ?, t1.c2 FROM t1 LIMIT ?');
    // The dataset's cut-off statements: an unterminated literal, and NULLs inside the VALUES tuples.
    expect(queryShape("INSERT INTO item (a, b, c) VALUES (?, NULL, ?), (?, ?, NULL), (?, ?, 'https://example.org/wi")).toBe('INSERT INTO item (a, b, c) VALUES (?, …), …, (?, ?, ?…');
    // The review's cases: hex and leading-dot numbers, and comments (ad-hoc SQL lands in the same dataset).
    expect(queryShape('SELECT a FROM t WHERE id = 0x1F AND r > .5 /* Joe secret */ -- note 7\n LIMIT 1')).toBe('SELECT a FROM t WHERE id = ? AND r > ? LIMIT ?');
    expect(queryShape('SELECT count(*) FROM "audit_log"')).toBe('SELECT count(*) FROM "audit_log"');
  });
  it('an error text loses account ids, database ids and long numeric ids', () => {
    expect(redact('D1 b37d930b-5137-4cdc-9dca-65abe10e327d in 0123456789abcdef0123456789abcdef, guild 123456789012345678')).toBe('D1 <id> in <id>, guild <id>');
  });
  it('a database is named only dev, production or other', () => {
    const copies = [{ name: 'dev', databaseId: 'd' }, { name: 'production', databaseId: 'p' }, { name: 'staging', databaseId: 's' }];
    expect(['d', 'p', 's', 'x'].map((id) => dbLabel(id, copies))).toEqual(['dev', 'production', 'other', 'other']);
  });
  it('merges by shape, then ranks by the metric with runs and rows per run', () => {
    const f = (shape: string, rowsRead: number, count: number) => ({ day: '2026-10-27', db: 'production' as const, shape: queryShape(shape), rowsRead, rowsWritten: 0, count });
    const top = topBy(byShape([f('SELECT a FROM t WHERE id = 1', 100, 1), f('SELECT a FROM t WHERE id = 2', 300, 3), f('SELECT b FROM u', 50, 1)]), 'rowsRead', 1);
    expect(top.map((r) => figureLine(r, 'rowsRead'))).toEqual(['400 rows read · 4 runs · 100/run · SELECT a FROM t WHERE id = ?']);
  });
});

describe('order 26: a failing usage-level alarm says what caused it', () => {
  // 2026-10-27 as order 26 measured it (run 40677515025): CI's zone benches reading the dev copy.
  const day = '2026-10-27';
  const perDb = [
    { at: day, db: 'dev' as const, rowsRead: 3_778_164, rowsWritten: 4_279 },
    { at: day, db: 'production' as const, rowsRead: 191_024, rowsWritten: 4_249 },
    { at: '2026-10-26', db: 'dev' as const, rowsRead: 99_908, rowsWritten: 320 },
  ];
  const q = (shape: string, rowsRead: number, count: number) => ({ day, db: 'dev' as const, shape, rowsRead, rowsWritten: 0, count });
  const top = [
    q('SELECT id, name FROM item WHERE slot_mask <> ? AND (source_mask & ?) = ? AND EXISTS (SELECT ? FROM json_each(item.origin_json))', 1_753_717, 267),
    q('SELECT id, name FROM item WHERE slot_mask <> ? AND (class_mask & (? << (SELECT bit FROM game_class WHERE code = ?))) <> ?', 1_139_512, 350),
    q('SELECT id, name FROM item WHERE origin_json IS NOT NULL ORDER BY id', 303_294, 54),
  ];
  const runs = [
    { name: 'ci', event: 'pull_request', createdAt: '2026-10-27T20:11:45Z' },
    { name: 'ci', event: 'pull_request', createdAt: '2026-10-27T22:35:16Z' },
    { name: 'import', event: 'schedule', createdAt: '2026-10-27T08:08:39Z' },
    { name: 'import', event: 'workflow_dispatch', createdAt: '2026-10-27T20:26:23Z' },
    { name: 'backup', event: 'schedule', createdAt: '2026-10-27T11:11:07Z' },
    { name: 'usage', event: 'schedule', createdAt: '2026-10-28T06:18:13Z' },
  ];
  const crossing = { metric: 'd1_rows_read' as const, day, value: 3_969_188 };

  it('names the day, the database, the top 3 statements and the day\'s workflow runs', () => {
    expect(causeLines(crossing, perDb, top, runs)).toEqual([
      'Records read 79.4% on UTC day 2026-10-27; this mail arrives the morning after.',
      'By database: dev 3,778,164 (95.2%) · production 191,024 (4.8%).',
      'Top 3 statements:',
      '  1. dev: 1,753,717 rows read · 267 runs · 6,568/run · SELECT id, name FROM item WHERE slot_mask <> ? AND (source_mask & ?) = ? AND EXISTS (SELECT ? FROM json_each(item.origin_json))',
      '  2. dev: 1,139,512 rows read · 350 runs · 3,256/run · SELECT id, name FROM item WHERE slot_mask <> ? AND (class_mask & (? << (SELECT bit FROM game_class WHERE code = ?))) <> ?',
      '  3. dev: 303,294 rows read · 54 runs · 5,617/run · SELECT id, name FROM item WHERE origin_json IS NOT NULL ORDER BY id',
      'Workflow runs that UTC day (5): ci ×2 (pull_request; 20:11–22:35) · import ×2 (schedule, workflow_dispatch; 08:08–20:26) · backup ×1 (schedule; 11:11).',
    ]);
  });
  it('one annotation carries every line (the runner\'s %0A escaping); a part it could not read is named, not fatal', () => {
    const a = errorAnnotation('Usage level: what caused it', causeLines(crossing, 'HTTP 500', top.slice(0, 1), 'GITHUB_TOKEN or GITHUB_REPOSITORY not set'));
    expect(a).toContain('::error title=Usage level%3A what caused it::Records read 79.4%25 on UTC day 2026-10-27; this mail arrives the morning after.%0ABy database: not read (HTTP 500).%0ATop 1 statements:');
    expect(a.endsWith('%0AWorkflow runs that UTC day: not read (GITHUB_TOKEN or GITHUB_REPOSITORY not set).')).toBe(true);
    expect(a).not.toMatch(/[\r\n]/);
  });
  it('a metric without D1 figures says so; nothing names a database other than dev, production or other', () => {
    const lines = causeLines({ metric: 'workers_requests', day, value: 20_000 }, perDb, top, runs);
    expect(lines[1]).toBe('Per-database and per-statement figures exist for D1 rows read and written only.');
    expect(causeLines(crossing, perDb, top, runs).join('\n')).not.toMatch(/mnm-guildcraft|[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

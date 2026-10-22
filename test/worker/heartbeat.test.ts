// Order 20 (ITEM 1): every cron invocation leaves one sweep_run row, written before the sweep's work, with finished_at
// set only when the run got to its end.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { sweepFinished, sweepStarted } from '../../src/heartbeat.ts';
import { all, reset } from '../db.ts';
import { spyOnFetch } from '../discord.ts';

const SLOT = Date.parse('2026-10-22T12:15:00Z');

let errors: string[];
let logs: string[];
beforeEach(async () => {
  await reset();
  spyOnFetch();
  errors = [];
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void errors.push(a.map(String).join(' ')));
});
afterEach(() => vi.restoreAllMocks());

const runCron = async (db: D1Database = env.DB, scheduledTime = SLOT) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime, cron: '*/15 * * * *' }), { ...env, DB: db, DISCORD_BOT_TOKEN: 'test-bot-token' } as any, ctx);
  await waitOnExecutionContext(ctx);
};
const rows = () => all<{ scheduled_ms: number; started_at: string; finished_at: string | null }>('SELECT * FROM sweep_run ORDER BY scheduled_ms');

/** env.DB, except that statements matching `fail` throw. */
const failing = (fail: RegExp): D1Database =>
  new Proxy(env.DB, {
    get(target, prop) {
      if (prop === 'prepare')
        return (sql: string) => {
          if (!fail.test(sql)) return target.prepare(sql);
          const boom = { bind: () => boom, run: () => Promise.reject(new Error('injected')), all: () => Promise.reject(new Error('injected')), first: () => Promise.reject(new Error('injected')) };
          return boom;
        };
      const v = Reflect.get(target, prop);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });

it('a sweep writes its slot at the start and its finish at the end', async () => {
  await runCron();
  const [r] = await rows();
  expect(r.scheduled_ms).toBe(SLOT);
  expect(r.started_at).toMatch(/^2\d{3}-/);
  expect(r.finished_at).not.toBeNull();
  expect(Date.parse(r.finished_at!)).toBeGreaterThanOrEqual(Date.parse(r.started_at));
});

it('a sweep whose own work fails is still recorded as having run', async () => {
  // The sweep's guild query fails; the run carries on to its end.
  await runCron(failing(/FROM guild g WHERE g.board_channel_id/));
  const r = await rows();
  expect(r.map((x) => x.scheduled_ms)).toEqual([SLOT]);
  expect(r[0].finished_at).not.toBeNull();
});

it('a run that never reaches its end stays unfinished (finished_at NULL)', async () => {
  await runCron(failing(/UPDATE sweep_run SET finished_at/));
  const r = await rows();
  expect(r).toHaveLength(1);
  expect(r[0].finished_at).toBeNull();
});

it('a repeat invocation for the same slot keeps one row; the next slot adds one', async () => {
  await runCron();
  const first = (await rows())[0];
  await runCron();
  await runCron(env.DB, SLOT + 15 * 60_000);
  const r = await rows();
  expect(r.map((x) => x.scheduled_ms)).toEqual([SLOT, SLOT + 15 * 60_000]);
  expect(r[0].started_at).toBe(first.started_at);
});

it('the cost, measured: the start and the finish write 1 row each (no index), a repeat start writes 0', async () => {
  const start = await sweepStarted(env.DB, SLOT, '2026-10-22T12:15:01.000Z').run();
  const again = await sweepStarted(env.DB, SLOT, '2026-10-22T12:15:02.000Z').run();
  const finish = await sweepFinished(env.DB, SLOT, '2026-10-22T12:15:03.000Z').run();
  expect([start.meta.rows_written, again.meta.rows_written, finish.meta.rows_written]).toEqual([1, 0, 1]);
  // 96 slots a day: 192 rows written a day per copy.
});

it('a failed heartbeat write never stops the sweep', async () => {
  await runCron(failing(/sweep_run/));
  expect(await rows()).toHaveLength(0);
  expect(errors.some((e) => e.startsWith('heartbeat start failed'))).toBe(true);
  expect(errors.some((e) => e.startsWith('heartbeat finish failed'))).toBe(true);
  // The sweep itself ran and logged its line, without an error of its own.
  const board = logs.filter((l) => l.startsWith('{"gc":"board"')).map((l) => JSON.parse(l));
  expect(board).toHaveLength(1);
  expect(board[0]).toMatchObject({ trigger: 'sweep', err: null, heartbeat_ms: null });
});

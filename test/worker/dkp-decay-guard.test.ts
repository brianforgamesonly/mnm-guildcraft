// Order 30 (ITEM 4): a guild with DKP on always has exactly one decay item. DkpTimers.ensureDecay is the one function; the
// cron's daily slot and the post-deploy route find the guilds. In workerd, on the real Durable Object and D1.
import { createExecutionContext, createScheduledController, env, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import worker from '../../src/index.ts';
import { DECAY_KEY, WEEK_MS } from '../../src/dkp/due.ts';
import { GUARD_PATH, isDecayGuardRun, rotate, signGuard, verifyGuard } from '../../src/dkp/guard.ts';
import { timersOf } from '../../src/dkp/timers.ts';
import { reset } from '../db.ts';

const TOKEN = 'test-bot-token';
const withToken = { ...env, DISCORD_BOT_TOKEN: TOKEN } as never;
let n = 0;
/** A fresh guild per test: Durable Object storage outlives reset(). */
const newGuild = async (enabled: 0 | 1 = 1) => {
  const g = `90000000000000${String(++n).padStart(4, '0')}`;
  await env.DB.prepare("INSERT INTO guild (id, name, created_at) VALUES (?, 'g', '2026-10-30T00:00:00Z')").bind(g).run();
  await env.DB.prepare("INSERT INTO dkp_guild (guild_id, enabled, channel_id, command_id, changed_at, changed_by) VALUES (?, ?, 'c', 'x', '2026-10-30T00:00:00Z', 'u')").bind(g, enabled).run();
  return g;
};
const setEnabled = (g: string, on: 0 | 1) => env.DB.prepare('UPDATE dkp_guild SET enabled = ? WHERE guild_id = ?').bind(on, g).run();
const alarmOf = (g: string) => runInDurableObject(timersOf(env, g), (_o, s) => s.storage.getAlarm());

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
});

describe('ensureDecay', () => {
  it('a guild with DKP on and no item gets one, a week out, with the alarm at it and the object knowing its guild', async () => {
    const g = await newGuild();
    const before = Date.now();
    expect(await timersOf(env, g).ensureDecay(g)).toBe('added');
    const list = await timersOf(env, g).list();
    expect(Object.keys(list)).toEqual([DECAY_KEY]);
    expect(list[DECAY_KEY]).toBeGreaterThanOrEqual(before + WEEK_MS);
    expect(await alarmOf(g)).toBe(list[DECAY_KEY]);
    expect(await runInDurableObject(timersOf(env, g), (_o, s) => s.storage.get('!guild'))).toBe(g);
  });

  it('a guild that has one keeps exactly one, its time unchanged, and costs no D1 read', async () => {
    const g = await newGuild();
    await timersOf(env, g).ensureDecay(g);
    const first = await timersOf(env, g).list();
    await setEnabled(g, 0); // the kept path never asks D1: with it off and the item there, it still answers kept
    expect(await timersOf(env, g).ensureDecay(g)).toBe('kept');
    await setEnabled(g, 1);
    expect(await timersOf(env, g).ensureDecay(g)).toBe('kept');
    expect(await timersOf(env, g).list()).toEqual(first);
  });

  it('a guild with DKP off, or no DKP row, gets none', async () => {
    const off = await newGuild(0);
    expect(await timersOf(env, off).ensureDecay(off)).toBe('off');
    expect(await timersOf(env, off).list()).toEqual({});
    expect(await alarmOf(off)).toBe(null);
    expect(await timersOf(env, 'nobody').ensureDecay('nobody')).toBe('off');
  });

  it('a dry run writes nothing and says so', async () => {
    const g = await newGuild();
    expect(await timersOf(env, g).ensureDecay(g, true)).toBe('would-add');
    expect(await timersOf(env, g).list()).toEqual({});
    expect(await alarmOf(g)).toBe(null);
  });

  it('after Remove DKP there is none; a sweep that listed the guild before Remove committed leaves none', async () => {
    const g = await newGuild();
    await timersOf(env, g).ensureDecay(g);
    // The sweep has read "on" from D1; Remove DKP then commits and cancels; the sweep's call arrives last.
    await setEnabled(g, 0);
    await timersOf(env, g).cancel();
    expect(await timersOf(env, g).list()).toEqual({});
    expect(await timersOf(env, g).ensureDecay(g)).toBe('off');
    expect(await timersOf(env, g).list()).toEqual({});
  });

  it('Remove DKP landing during the D1 read: its cancel waits for the write, then clears the item', async () => {
    const g = await newGuild();
    const stub = timersOf(env, g);
    // The object's D1 read answers "on", then holds until the test lets it go (flags, not promises: the two sides run in
    // different request contexts).
    const gate = { parked: false, released: false };
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await (runInDurableObject as unknown as (s: unknown, f: (o: any) => void) => Promise<void>)(stub, (o) => {
      const real = o.env.DB;
      const held = (sql: string) => ({
        bind: (...a: unknown[]) => ({
          first: async () => {
            const row = await real.prepare(sql).bind(...a).first();
            gate.parked = true;
            while (!gate.released) await pause(5);
            return row;
          },
        }),
      });
      o.env = { ...o.env, DB: { prepare: held } };
    });
    const ensuring = stub.ensureDecay(g);
    while (!gate.parked) await pause(5);
    await setEnabled(g, 0);
    let cancelled = false;
    const cancelling = stub.cancel().then(() => void (cancelled = true));
    await pause(100);
    expect(cancelled).toBe(false);
    gate.released = true;
    expect(await ensuring).toBe('added');
    await cancelling;
    expect(await stub.list()).toEqual({});
    expect(await alarmOf(g)).toBe(null);
  });

  it('review: an item that lost its alarm gets it back, its time unchanged', async () => {
    const g = await newGuild();
    const stub = timersOf(env, g);
    await stub.ensureDecay(g);
    const first = await stub.list();
    await runInDurableObject(stub, (_o, s) => s.storage.deleteAlarm());
    expect(await stub.ensureDecay(g, true)).toBe('kept');
    expect(await alarmOf(g)).toBe(null); // a dry run writes nothing
    expect(await stub.ensureDecay(g)).toBe('kept');
    expect(await alarmOf(g)).toBe(first[DECAY_KEY]);
    expect(await stub.list()).toEqual(first);
  });

  it('an earlier alarm (an auction close) is kept when the decay item is added; a later one gives way to the decay item', async () => {
    const g = await newGuild();
    const stub = timersOf(env, g);
    const close = Date.now() + 3_600_000;
    await stub.schedule(g, [{ key: 'auction:1', due: close }]);
    await stub.ensureDecay(g);
    expect(await alarmOf(g)).toBe(close);
    expect(Object.keys(await stub.list()).sort()).toEqual(['auction:1', DECAY_KEY].sort());
    await stub.cancel(['auction:1']);
    expect(await alarmOf(g)).toBe((await stub.list())[DECAY_KEY]);
  });
});

describe('the guard', () => {
  const NINE = Date.parse('2026-10-30T09:00:00Z');
  const cron = async (scheduledTime: number) => {
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime, cron: '*/15 * * * *' }), withToken, ctx);
    await waitOnExecutionContext(ctx);
  };

  it('the cron\'s daily slot wakes an object with no alarm and no presses; every other slot leaves it', async () => {
    expect([NINE, NINE + 14 * 60_000].map(isDecayGuardRun)).toEqual([true, true]);
    expect([NINE - 60_000, NINE + 15 * 60_000].map(isDecayGuardRun)).toEqual([false, false]);
    const g = await newGuild();
    await cron(NINE + 15 * 60_000);
    expect(await timersOf(env, g).list()).toEqual({});
    await cron(NINE);
    expect(Object.keys(await timersOf(env, g).list())).toEqual([DECAY_KEY]);
    const off = await newGuild(0);
    await cron(NINE);
    expect(await timersOf(env, off).list()).toEqual({});
  });

  it('when guilds outnumber the calls, the daily start moves on and every guild is reached', () => {
    const ids = ['a', 'b', 'c', 'd', 'e'];
    expect(rotate(39, 0)(ids)).toEqual(ids);
    const seen = new Set<string>();
    for (let day = 0; day < 5; day++) rotate(2, day * 86_400_000)(ids).forEach((id) => seen.add(id));
    expect([...seen].sort()).toEqual(ids);
  });

  const post = async (query: string, headers: Record<string, string>) => {
    const ctx = createExecutionContext();
    const res = await worker.fetch(new Request(`https://x${GUARD_PATH}?${query}`, { method: 'POST', headers }), withToken, ctx);
    await waitOnExecutionContext(ctx);
    return res;
  };
  const signedHeaders = async (dry: boolean, offset: number, time = Math.floor(Date.now() / 1000), token = TOKEN) => ({ 'X-Guard-Time': String(time), 'X-Guard-Signature': await signGuard(token, time, dry, offset) });

  it('the route: dry run first, then the seed, counts only; a second run keeps it', async () => {
    const g = await newGuild();
    const dry = await post('dry=1&offset=0', await signedHeaders(true, 0));
    expect(await dry.json()).toEqual({ guilds: 1, checked: 1, counts: { kept: 0, added: 0, 'would-add': 1, off: 0, failed: 0 }, next: null });
    expect(await timersOf(env, g).list()).toEqual({});
    expect(await (await post('dry=0&offset=0', await signedHeaders(false, 0))).json()).toMatchObject({ counts: { added: 1 } });
    expect(await (await post('dry=0&offset=0', await signedHeaders(false, 0))).json()).toMatchObject({ counts: { added: 0, kept: 1 } });
  });

  it('the route refuses no signature, a wrong token, an old time, and a signature for another request', async () => {
    await newGuild();
    const old = Math.floor(Date.now() / 1000) - 600;
    expect((await post('dry=0&offset=0', {})).status).toBe(401);
    expect((await post('dry=0&offset=0', await signedHeaders(false, 0, undefined, 'other'))).status).toBe(401);
    expect((await post('dry=0&offset=0', await signedHeaders(false, 0, old))).status).toBe(401);
    expect((await post('dry=0&offset=0', await signedHeaders(true, 0))).status).toBe(401);
    expect((await post('dry=0&offset=-1', await signedHeaders(false, -1))).status).toBe(401);
    expect(await verifyGuard(TOKEN, NaN, false, 0, 'x', Date.now())).toBe(false);
  });
});

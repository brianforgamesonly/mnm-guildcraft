// Order 27 (ITEM 3, override 5 of order 10's production resources): things that close on time. One Durable Object per
// guild (SQLite-backed: "Workers Free plan can only create and access SQLite-backed Durable Objects"). Its due-list lives
// in its storage, one key per item (value: due, epoch ms), and its single alarm ("Each Durable Object is able to schedule
// a single alarm at a time") is set to the earliest. "Alarms have guaranteed at-least-once execution", so every handler
// is idempotent: it acts only while D1 still says the item is due (src/dkp/due.ts). It never writes sweep_run and never
// touches the health check. Order 30: the cron's daily slot calls ensureDecay here (src/dkp/guard.ts), and nothing else.
//
// Items: lapse:<pending id> (an approval's lapse), check:<kill id> (a Kill roll call window), close:<raid id> (auto-close),
// render:<raid id> (a coalesced card edit, at the pace Discord's last answer allows: src/dkp/pace.ts). Order 29:
// auction:<id> (an auction closes, by its timer only), acard:<id> (an auction card's coalesced, paced edit). Keys starting
// with "!" are the object's own state (its guild, each card's pace), never items.
//
// Order 32 (override 2): the Events module's items share this due-list. Every Events kind starts "ev" (src/events/due.ts),
// and each module removes only its own items: Remove DKP module clears everything else, Remove Events module clears "ev".
//
// Order 33: a card edit that fails is flagged out of date (src/dkp/stale.ts). Its item is retried as before, and when those
// run out the flag stays, so the 15-minute cron asks this object for the redraw (the cron's only other call here).
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import { budgetLeft } from '../board/api.ts';
import { countD1 } from '../telemetry.ts';
import { DECAY_KEY, runDue, timerApi, WEEK_MS } from './due.ts';
import type { EnsureResult } from './guard.ts';
import { afterEdit, nextEditAt, START, type Pace } from './pace.ts';
import { CardEditRefused, clearStale, isCardItem, markStale } from './stale.ts';

const GUILD_KEY = '!guild';
const paceKey = (key: string) => `!pace:${key}`;
/** Card edits, each paced by its own message's last answer. */
const paced = isCardItem;
const isItem = (k: string) => !k.startsWith('!');
/** Order 32: an Events item; every other item is DKP's. A card's pace follows its item. */
export const isEventsItem = (k: string) => k.startsWith('ev');
const paceItem = (k: string) => (k.startsWith('!pace:') ? k.slice('!pace:'.length) : null);
/** Storage's limit per get, put and delete call: "up to 128 keys" (developers.cloudflare.com/durable-objects/api/storage-api). */
const STORAGE_KEYS = 128;
/** Items handled per alarm; the rest stay due and the alarm is set again at once (each run is its own invocation). */
export const PER_ALARM = 8;
/** A handler that failed is tried again this much later, up to MAX_TRIES. */
const RETRY_MS = 30_000;
const MAX_TRIES = 5;

interface Item {
  due: number;
  tries?: number;
  /** Order 33: the sweep asked for this redraw: one try, and it only edits. A real change to the card clears this. */
  stale?: boolean;
  /** Order 33: this card is flagged out of date, so a success clears the flag. */
  flagged?: boolean;
  /** Order 33: how far a chunked send has got (src/events/dm.ts). */
  cursor?: string;
}

export class DkpTimers extends DurableObject<Env> {
  /** The item alarm() is running. */
  private running: string | null = null;

  /** Sets each item to its due time; an item already due earlier keeps the earlier time (coalescing). A card edit is paced. */
  async schedule(guildId: string, items: { key: string; due: number; later?: boolean; stale?: boolean }[]): Promise<void> {
    const s = this.ctx.storage;
    // Order 32: Add Events module re-arms every open event at once, which can pass storage's limit per call.
    for (let n = 0; n < items.length; n += STORAGE_KEYS - 1) {
      const part = items.slice(n, n + STORAGE_KEYS - 1);
      const keys = part.map((i) => i.key);
      const have = await s.get<Item>(keys);
      const paces = await s.get<Pace>(keys.filter(paced).map(paceKey));
      const put: Record<string, Item | string> = {};
      if ((await s.get<string>(GUILD_KEY)) !== guildId) put[GUILD_KEY] = guildId;
      for (const i of part) {
        const due = paced(i.key) ? nextEditAt(paces.get(paceKey(i.key)) ?? START, i.due) : i.due;
        const was = have.get(i.key);
        // `later`: replace even with a later time. An item running now keeps its old time, so a change that lands during
        // the run (a D1 or Discord wait lets this in) gets a time of its own, and alarm() keeps the item for another edit.
        // Review of PR A: only a sweep's own request is stale; a real change landing on it keeps order 32's repost.
        const stale = !!i.stale && (!was || !!was.stale);
        const flagged = !!(i.stale || was?.flagged);
        if (!was || i.later || due < was.due || i.key === this.running || flagged !== !!was.flagged || stale !== !!was.stale)
          put[i.key] = { due: i.key === this.running ? Math.max(due, was!.due + 1) : was && !i.later ? Math.min(due, was.due) : due, ...(stale ? { stale } : {}), ...(flagged ? { flagged } : {}), ...(was?.cursor !== undefined && !i.later ? { cursor: was.cursor } : {}) };
      }
      if (Object.keys(put).length) await s.put(put);
    }
    await this.arm();
  }

  /** Removes these items; with no keys, every DKP item and its pace (Remove DKP module). Events items stay (order 32). */
  async cancel(keys?: string[]): Promise<void> {
    if (keys) await this.ctx.storage.delete(keys);
    else await this.clear((item) => !isEventsItem(item));
    await this.arm();
  }

  /** Order 32: every Events item and its pace (Remove Events module). DKP's items, decay:week among them, stay. */
  async cancelEvents(): Promise<void> {
    await this.clear(isEventsItem);
    await this.arm();
  }

  private async clear(mine: (item: string) => boolean): Promise<void> {
    const s = this.ctx.storage;
    const keys = [...(await s.list()).keys()].filter((k) => (isItem(k) ? mine(k) : paceItem(k) !== null && mine(paceItem(k)!)));
    for (let n = 0; n < keys.length; n += STORAGE_KEYS) await s.delete(keys.slice(n, n + STORAGE_KEYS));
  }

  /**
   * Order 30: the one function that keeps "DKP on means exactly one decay item". The fixed key rules out a second copy; an
   * item already there keeps its time (the usual path: one storage read, no D1). Only when it is missing does the object
   * ask D1, which holds the on/off flag, and then writes the item a week out and re-arms to the earliest item, so an
   * earlier alarm stands. A D1 call is not storage, so an input gate would let Remove DKP's cancel() run during it and the
   * write below would outlive the cancel: blockConcurrencyWhile holds that cancel until after the write, and it clears
   * the item. If the read says off, Remove DKP has committed, so nothing is written. "If the callback throws an exception,
   * the object will be terminated and reset", hence the catch.
   */
  async ensureDecay(guildId: string, dry = false): Promise<EnsureResult> {
    const s = this.ctx.storage;
    if (await s.get<Item>(DECAY_KEY)) {
      // Review: an item with no alarm would never run. Re-arming keeps its time; storage calls alone, so nothing interleaves.
      if (!dry && (await s.getAlarm()) === null) await this.arm();
      return 'kept';
    }
    return this.ctx.blockConcurrencyWhile(async (): Promise<EnsureResult> => {
      try {
        const row = await this.env.DB.prepare('SELECT enabled FROM dkp_guild WHERE guild_id = ?').bind(guildId).first<{ enabled: number }>();
        if (row?.enabled !== 1) return 'off';
        if (await s.get<Item>(DECAY_KEY)) return 'kept';
        if (dry) return 'would-add';
        await s.put<Item | string>({ [GUILD_KEY]: guildId, [DECAY_KEY]: { due: Date.now() + WEEK_MS } });
        await this.arm();
        return 'added';
      } catch (e) {
        console.error('dkp ensureDecay failed', e instanceof Error ? e.message : String(e));
        return 'failed';
      }
    });
  }

  /** The due-list, for tests and the cost bench. */
  async list(): Promise<Record<string, number>> {
    const all = await this.ctx.storage.list<Item | string>();
    return Object.fromEntries([...all].filter(([k]) => isItem(k)).map(([k, v]) => [k, (v as Item).due]));
  }

  /** The alarm at the earliest item, only when it differs from the one set (each setAlarm() is a row written). */
  private async arm(): Promise<void> {
    const s = this.ctx.storage;
    const items = [...(await s.list<Item | string>())].filter(([k]) => isItem(k)).map(([, v]) => (v as Item).due);
    if (!items.length) {
      if ((await s.getAlarm()) !== null) await s.deleteAlarm();
      return;
    }
    const at = Math.min(...items);
    if ((await s.getAlarm()) !== at) await s.setAlarm(at);
  }

  private async flag(db: D1Database, guildId: string, key: string, e: unknown): Promise<void> {
    try {
      await markStale(db, guildId, key, e instanceof CardEditRefused ? e : { status: 0 }).run();
    } catch (err) {
      console.error('stale card flag failed', key, err instanceof Error ? err.message : String(err));
    }
  }

  private async unflag(db: D1Database, guildId: string, key: string): Promise<void> {
    try {
      await clearStale(db, guildId, key).run();
    } catch (err) {
      console.error('stale card clear failed', key, err instanceof Error ? err.message : String(err));
    }
  }

  async alarm(): Promise<void> {
    const s = this.ctx.storage;
    const guildId = await s.get<string>(GUILD_KEY);
    const now = Date.now();
    const due = [...(await s.list<Item | string>())]
      .filter(([k, v]) => isItem(k) && (v as Item).due <= now)
      .sort((a, b) => (a[1] as Item).due - (b[1] as Item).due)
      .slice(0, PER_ALARM) as [string, Item][];
    // One budget for the whole invocation (review of PR A): every item's D1 and Discord calls share it, D1 counted.
    const counted = countD1(this.env.DB);
    const env = { ...this.env, DB: counted.db };
    const api = timerApi(env, now, () => counted.calls.length);
    for (const [key, item] of due) {
      // Items left when the budget runs low stay due; the alarm below is set again at once for them.
      if (api && budgetLeft(api.budget) < 8) break;
      let r: Awaited<ReturnType<typeof runDue>> = null;
      this.running = key;
      try {
        const save = async (cursor: string) => {
          item.cursor = cursor;
          await s.put(key, item);
        };
        r = guildId ? await runDue(env, guildId, key, item.due, now, api, { stale: item.stale, cursor: item.cursor, save }) : null;
        // Inside the try (review of PR A): this D1 wait lets a press in, and `running` must still send it a time of its own.
        if (api && guildId && paced(key) && item.flagged && !r?.skip) await this.unflag(env.DB, guildId, key);
      } catch (e) {
        console.error('dkp timer failed', key, e instanceof Error ? e.message : String(e));
        const card = paced(key) && guildId;
        // Order 33: a card is never dropped. The flag is set on its first failure, so the sweep has it whatever follows.
        if (card) await this.flag(env.DB, guildId, key, e);
        const flagged = card ? { flagged: true } : {};
        // A 429 waits for its retry_after, and costs no try.
        if (card && e instanceof CardEditRefused && e.waitMs !== null) {
          const at = Date.now();
          await s.put(paceKey(key), afterEdit((await s.get<Pace>(paceKey(key))) ?? START, at, { retryAfter: e.waitMs / 1000 }));
          await s.put(key, { ...item, ...flagged, due: at + e.waitMs });
          continue;
        }
        const tries = (item.tries ?? 0) + 1;
        // The sweep's redraw has one try: the next sweep is its retry.
        if (tries < MAX_TRIES && !item.stale) {
          await s.put(key, { due: Date.now() + RETRY_MS, tries, ...flagged, ...(item.cursor === undefined ? {} : { cursor: item.cursor }) });
          continue;
        }
        if ((await s.get<Item>(key))?.due === item.due) await s.delete(key);
        continue;
      } finally {
        this.running = null;
      }
      if (r?.headers && paced(key)) {
        const pace = afterEdit((await s.get<Pace>(paceKey(key))) ?? START, Date.now(), r.headers);
        await s.put(paceKey(key), pace);
        console.log(JSON.stringify({ gc: 'dkp-card-edit', remaining: r.headers.remaining ?? null, reset_after: r.headers.resetAfter ?? null, retry_after: r.headers.retryAfter ?? null, gap_ms: pace.gap }));
      }
      if (r?.again !== undefined) await s.put(key, { due: r.again, ...(item.cursor === undefined ? {} : { cursor: item.cursor }) });
      // A change landed during this run: its edit is still to come.
      else if ((await s.get<Item>(key))?.due === item.due) await s.delete(key);
      if (r?.schedule?.length) await this.schedule(guildId!, r.schedule);
    }
    await this.arm();
  }
}

/** The guild's timer object (one per guild, by name). */
export const timersOf = (env: Env, guildId: string) => env.DKP_TIMERS.get(env.DKP_TIMERS.idFromName(guildId));

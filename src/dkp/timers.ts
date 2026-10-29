// Order 27 (ITEM 3, override 5 of order 10's production resources): things that close on time. One Durable Object per
// guild (SQLite-backed: "Workers Free plan can only create and access SQLite-backed Durable Objects"). Its due-list lives
// in its storage, one key per item (value: due, epoch ms), and its single alarm ("Each Durable Object is able to schedule
// a single alarm at a time") is set to the earliest. "Alarms have guaranteed at-least-once execution", so every handler
// is idempotent: it acts only while D1 still says the item is due (src/dkp/due.ts). It never writes sweep_run and never
// touches the cron or the health check.
//
// Items: lapse:<pending id> (an approval's 24 hours), and, from PR B, check:<kill id>, close:<raid id>, render:<raid id>.
import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env.ts';
import { runDue } from './due.ts';

const GUILD_KEY = '!guild';
/** Items handled per alarm; the rest stay due and the alarm is set again at once (each run is its own invocation). */
export const PER_ALARM = 8;
/** A handler that failed is tried again this much later, up to MAX_TRIES. */
const RETRY_MS = 30_000;
const MAX_TRIES = 5;

interface Item {
  due: number;
  tries?: number;
}

export class DkpTimers extends DurableObject<Env> {
  /** Sets each item to its due time; an item already due earlier keeps the earlier time (coalescing). */
  async schedule(guildId: string, items: { key: string; due: number; later?: boolean }[]): Promise<void> {
    const s = this.ctx.storage;
    const keys = items.map((i) => i.key);
    const have = await s.get<Item>(keys);
    const put: Record<string, Item | string> = {};
    if ((await s.get<string>(GUILD_KEY)) !== guildId) put[GUILD_KEY] = guildId;
    for (const i of items) {
      const was = have.get(i.key);
      // `later`: replace even with a later time (a check-again window an officer restarted).
      if (!was || i.later || i.due < was.due) put[i.key] = { due: i.due };
    }
    if (Object.keys(put).length) await s.put(put);
    await this.arm();
  }

  /** Removes items (all of them, with no keys: Remove DKP). */
  async cancel(keys?: string[]): Promise<void> {
    const s = this.ctx.storage;
    if (keys) await s.delete(keys);
    else {
      await s.deleteAll();
      await s.deleteAlarm();
      return;
    }
    await this.arm();
  }

  /** The due-list, for tests and the cost bench. */
  async list(): Promise<Record<string, number>> {
    const all = await this.ctx.storage.list<Item | string>();
    return Object.fromEntries([...all].filter(([k]) => k !== GUILD_KEY).map(([k, v]) => [k, (v as Item).due]));
  }

  /** The alarm at the earliest item, only when it differs from the one set (each setAlarm() is a row written). */
  private async arm(): Promise<void> {
    const s = this.ctx.storage;
    const items = [...(await s.list<Item | string>())].filter(([k]) => k !== GUILD_KEY).map(([, v]) => (v as Item).due);
    if (!items.length) {
      if ((await s.getAlarm()) !== null) await s.deleteAlarm();
      return;
    }
    const at = Math.min(...items);
    if ((await s.getAlarm()) !== at) await s.setAlarm(at);
  }

  async alarm(): Promise<void> {
    const s = this.ctx.storage;
    const guildId = await s.get<string>(GUILD_KEY);
    const now = Date.now();
    const due = [...(await s.list<Item | string>())]
      .filter(([k, v]) => k !== GUILD_KEY && (v as Item).due <= now)
      .sort((a, b) => (a[1] as Item).due - (b[1] as Item).due)
      .slice(0, PER_ALARM) as [string, Item][];
    for (const [key, item] of due) {
      let again: number | null = null;
      try {
        again = guildId ? await runDue(this.env, guildId, key, item.due, now) : null;
      } catch (e) {
        console.error('dkp timer failed', key, e instanceof Error ? e.message : String(e));
        const tries = (item.tries ?? 0) + 1;
        if (tries < MAX_TRIES) {
          await s.put(key, { due: Date.now() + RETRY_MS, tries });
          continue;
        }
      }
      // A handler may ask to run again later (a card edit held back by Discord's rate limit).
      if (again !== null) await s.put(key, { due: again });
      else await s.delete(key);
    }
    await this.arm();
  }
}

/** The guild's timer object (one per guild, by name). */
export const timersOf = (env: Env, guildId: string) => env.DKP_TIMERS.get(env.DKP_TIMERS.idFromName(guildId));

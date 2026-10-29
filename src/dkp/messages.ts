// Order 27: the bot's own messages in GC-DKP (standings, approval cards, change notices). Every create and every edit sends
// allowed_mentions that pings nobody (override 9; order 16's memberTag); the bot pins nothing. Order 27's override 2 of
// order 9: every message the bot posted in GC-DKP may be edited in place, whatever caused the edit.
import { budgetLeft, UNKNOWN_MESSAGE, type BotApi } from '../board/api.ts';
import { button, memberTag, NO_PINGS, row, truncate, type Embed } from '../discord.ts';
import { DKP_COPY } from './copy.ts';
import { dkpRead, POOL_GUILD, type Standing } from './ledger.ts';

export interface Message {
  content?: string;
  embeds?: Embed[];
  components?: unknown[];
}

/** Posts in GC-DKP; returns the new message's id, or null. */
export async function postIn(api: BotApi, channelId: string, m: Message): Promise<string | null> {
  const r = await api.call<{ id: string }>('POST', `/channels/${channelId}/messages`, { ...m, allowed_mentions: NO_PINGS });
  return r.ok ? r.body.id : null;
}

/** Edits one of the bot's messages in GC-DKP. 'gone' when Discord no longer has it. */
export async function editIn(api: BotApi, channelId: string, messageId: string, m: Message): Promise<'ok' | 'gone' | 'failed'> {
  const r = await api.call('PATCH', `/channels/${channelId}/messages/${messageId}`, { ...m, allowed_mentions: NO_PINGS });
  return r.ok ? 'ok' : r.code === UNKNOWN_MESSAGE ? 'gone' : 'failed';
}

/** A pool's name: the guild pool, or its zone's name (the key when the zone is gone). */
export async function poolNames(db: D1Database, pools: string[]): Promise<Map<string, string>> {
  const { results } = await db.prepare('SELECT key, name FROM zone WHERE key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(pools)).all<{ key: string; name: string }>();
  const names = new Map(results.map((r) => [r.key, r.name]));
  return new Map(pools.map((p) => [p, p === POOL_GUILD ? DKP_COPY.guildPool : (names.get(p) ?? p)]));
}

/** How many members a standings message names; the rest are counted, with Full standings (privately, paged). */
export const STANDINGS_TOP = 15;
export const FULL_PAGE = 25;
export const FULL_STANDINGS_PREFIX = 'dkpfs:';

export const standingLine = (s: Standing, rank: number) => `${rank}. ${memberTag(s.member_id, s.name)}: **${s.balance}**${s.status === 'left' ? DKP_COPY.frozen : ''}`;

export function standingsMessage(pool: string, name: string, list: Standing[]): Message {
  const top = list.slice(0, STANDINGS_TOP).map((s, i) => standingLine(s, i + 1));
  const more = list.length - top.length;
  return {
    embeds: [{ title: truncate(DKP_COPY.standingsTitle(name), 256), description: [...(top.length ? top : [DKP_COPY.nobody]), ...(more > 0 ? ['', DKP_COPY.standingsMore(more)] : [])].join('\n') }],
    components: [row([button(`${FULL_STANDINGS_PREFIX}${pool}:0`, DKP_COPY.fullStandings)])],
  };
}

/**
 * Posts or edits the standings message of each pool given (one message per pool, its id in dkp_pool). Two D1 statements
 * plus one Discord call per pool. Stops when the invocation's budget is spent; a skipped pool is refreshed next time.
 */
export async function refreshStandings(db: D1Database, api: BotApi, guildId: string, channelId: string, pools: string[]): Promise<void> {
  if (!pools.length) return;
  const [{ standings }, names, saved] = await Promise.all([
    dkpRead(db, guildId, { pools }),
    poolNames(db, pools),
    db.prepare('SELECT pool, message_id FROM dkp_pool WHERE guild_id = ? AND pool IN (SELECT value FROM json_each(?))').bind(guildId, JSON.stringify(pools)).all<{ pool: string; message_id: string | null }>(),
  ]);
  const ids = new Map(saved.results.map((r) => [r.pool, r.message_id]));
  for (const pool of pools) {
    if (budgetLeft(api.budget) < 2) return;
    const m = standingsMessage(pool, names.get(pool)!, standings.get(pool) ?? []);
    const id = ids.get(pool);
    const edited = id ? await editIn(api, channelId, id, m) : 'gone';
    if (edited !== 'gone') continue;
    const posted = await postIn(api, channelId, m);
    if (posted)
      await db
        .prepare('INSERT INTO dkp_pool (guild_id, pool, message_id, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (guild_id, pool) DO UPDATE SET message_id = ?3')
        .bind(guildId, pool, posted, new Date().toISOString())
        .run();
  }
}

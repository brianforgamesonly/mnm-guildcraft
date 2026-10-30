// Order 29 (ITEM 6): wishlists (docs/PRD.md "Order 29: spending points"). Public within the server (order 29's override 4:
// officers see them when items drop), at most the wishlist size each. Adding an item is the member's opt-in to a direct
// message when an auction opens for it (override 3 of order 16's pings rule); the nudges themselves are src/dkp/auction.ts.
//
// Costs (D1 statements; Discord calls), besides the interaction's own reply:
//   add: guild, state, member row, item, count, upsert: 6 D1; 0.   remove: guild, state, member row, delete: 4 D1; 0.
//   show: guild, state, member row, the list: 4 D1; 0.   Autocomplete: 1 statement a keystroke (order 3).
import { now } from '../access.ts';
import { ephemeral, memberTag, optString, truncate } from '../discord.ts';
import type { DkpRun } from './commands.ts';
import { WISHLIST_COPY as W } from './copy.ts';

/** A member's wishlist, A→Z (for show, and remove's autocomplete). */
export const WISHLIST_SQL = `SELECT i.name, w.character FROM dkp_wishlist w JOIN item i ON i.id = w.item_id WHERE w.guild_id = ?1 AND w.member_id = ?2 ORDER BY i.name COLLATE NOCASE`;
/** Who wishes for an item in this server (dkp_wishlist_by_item). */
export const WISHERS_SQL = 'SELECT member_id FROM dkp_wishlist WHERE guild_id = ?1 AND item_id = ?2';
export const CHARACTER_MAX = 40;

const itemByName = (db: D1Database, typed: string) => db.prepare('SELECT id, name FROM item WHERE name_key = lower(?)').bind(typed.trim()).first<{ id: number; name: string }>();

/** /dkp wishlist add item: character: (members). */
export const wishlistAdd: DkpRun = async (c, opts, d) => {
  const typed = optString(opts, 'item') ?? '';
  const item = await itemByName(c.db, typed);
  if (!item) return ephemeral(W.noItem(truncate(typed, 100)));
  const character = (optString(opts, 'character') ?? '').trim().slice(0, CHARACTER_MAX) || null;
  const max = d.settings.wishlist_size;
  // The size is checked inside the insert (a second add at the same moment cannot pass it); an item already listed updates.
  const res = await c.db
    .prepare(
      `INSERT INTO dkp_wishlist (guild_id, member_id, item_id, character, added_at) SELECT ?1, ?2, ?3, ?4, ?5
       WHERE EXISTS (SELECT 1 FROM dkp_wishlist WHERE guild_id = ?1 AND member_id = ?2 AND item_id = ?3) OR (SELECT count(*) FROM dkp_wishlist WHERE guild_id = ?1 AND member_id = ?2) < ?6
       ON CONFLICT (guild_id, member_id, item_id) DO UPDATE SET character = ?4`,
    )
    .bind(c.guild.id, c.userId, item.id, character, now(), max)
    .run();
  if (!res.meta.changes) return ephemeral(W.full(max));
  const n = await c.db.prepare('SELECT count(*) AS n FROM dkp_wishlist WHERE guild_id = ? AND member_id = ?').bind(c.guild.id, c.userId).first<{ n: number }>();
  return ephemeral(`${W.added(item.name, character, n?.n ?? 1, max)}\n${W.optIn}`);
};

/** /dkp wishlist remove item: (members, their own). */
export const wishlistRemove: DkpRun = async (c, opts) => {
  const typed = optString(opts, 'item') ?? '';
  const item = await itemByName(c.db, typed);
  const res = item ? await c.db.prepare('DELETE FROM dkp_wishlist WHERE guild_id = ? AND member_id = ? AND item_id = ?').bind(c.guild.id, c.userId, item.id).run() : null;
  return ephemeral(res?.meta.changes ? W.removed(item!.name) : W.notListed(truncate(typed, 100)));
};

/** /dkp wishlist show member: (anyone in the server: wishlists are guild-public). */
export const wishlistShow: DkpRun = async (c, opts, d) => {
  const member = optString(opts, 'member') ?? c.userId;
  const [{ results }, who] = await Promise.all([
    c.db.prepare(WISHLIST_SQL).bind(c.guild.id, member).all<{ name: string; character: string | null }>(),
    c.db.prepare('SELECT display_name FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, member).first<{ display_name: string }>(),
  ]);
  const name = who?.display_name ?? c.resolved?.users?.[member]?.username ?? member;
  const lines = results.map((r) => W.line(r.name, r.character));
  return ephemeral('', {
    embeds: [{ title: truncate(W.title(name, results.length, d.settings.wishlist_size), 256), description: truncate([memberTag(member, name), '', ...(lines.length ? lines : [W.empty])].join('\n'), 4096) }],
  });
};

/** remove's autocomplete: the caller's own wishlist (one statement). */
export async function ownWishlist(db: D1Database, guildId: string, member: string, typed: string): Promise<string[]> {
  const { results } = await db.prepare(WISHLIST_SQL).bind(guildId, member).all<{ name: string }>();
  const t = typed.toLowerCase();
  return results.map((r) => r.name).filter((n) => n.toLowerCase().includes(t)).slice(0, 25);
}

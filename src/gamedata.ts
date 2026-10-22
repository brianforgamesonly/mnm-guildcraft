// Lists of game things that change only on import (order 3, ITEM 3.2): tradeskills, classes, and the
// items that are a recipe result. Each list is held in a module-level cache, keyed by the latest
// completed import (data_import id and source_version).
//
// How the cache goes stale, and how it refreshes: every read sends ONE statement. It always returns the
// current import key, and returns the list rows only when that key differs from the cached one. So the
// first request after an import completes (status 'ok') reloads the list; an isolate never serves a list
// older than the latest completed import. A key of NULL (no completed import yet) is never trusted.
import { nocase } from './collation.ts';
import { FINISHED_IMPORT } from './import-status.ts';

/** The latest completed import (ok, or partial: order 13), as "<id>:<source_version>". */
const IMPORT_KEY = `(SELECT id || ':' || source_version FROM data_import WHERE ${FINISHED_IMPORT} ORDER BY id DESC LIMIT 1)`;

const LISTS = {
  skills: 'SELECT name FROM tradeskill',
  classes: 'SELECT code AS name FROM game_class WHERE item_count > 0',
  // Shared recipes only: the cache is per isolate, across guilds. Guild-private recipes arrive in order 5.
  items: 'SELECT DISTINCT i.name FROM recipe r JOIN item i ON i.id = r.result_item_id WHERE r.active = 1 AND r.guild_id IS NULL',
  // Order 9: one entry per recipe, as "item␟tradeskill␟trivial␟id" (unit separator), so an item with several recipes
  // offers each one (src/commands/autocomplete.ts). The imported trivial: a guild's correction shows on /craft find.
  recipes: `SELECT i.name || char(31) || t.name || char(31) || ifnull(r.trivial, '') || char(31) || r.id AS name
    FROM recipe r JOIN item i ON i.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id WHERE r.active = 1 AND r.guild_id IS NULL`,
  // Order 17: the zones (/zone name, /gear find zone), written by the same import.
  zones: 'SELECT name FROM zone WHERE active = 1',
  // Order 18: every item (/item name), a shared recipe's result ending in char(31) so the choice can say it is craftable.
  allItems: `SELECT i.name || CASE WHEN EXISTS (SELECT 1 FROM recipe r WHERE r.result_item_id = i.id AND r.active = 1 AND r.guild_id IS NULL) THEN char(31) ELSE '' END AS name FROM item i`,
} as const;
export type GameList = keyof typeof LISTS;

const NEVER = '\u0000no-import';
const cache = new Map<GameList, { key: string; names: string[] }>();

/**
 * The statement: the import key, then the list only when ?1 (the cached key) differs. The check sits in
 * LIMIT, evaluated once, so a warm read stops before scanning the list. In a WHERE clause it would be
 * tested per row and read the whole list on every keystroke (measured: rows_read 42 for 40 skills).
 */
export const gameListSql = (list: GameList) =>
  `SELECT 'k' AS t, ${IMPORT_KEY} AS name UNION ALL SELECT * FROM (SELECT 'n', name FROM (${LISTS[list]}) LIMIT CASE WHEN ?1 IS NOT ${IMPORT_KEY} THEN -1 ELSE 0 END)`;

/** One D1 statement: the list from cache when the import is unchanged, otherwise freshly read. */
export async function gameList(db: D1Database, list: GameList): Promise<string[]> {
  const held = cache.get(list);
  const { results } = await db
    .prepare(gameListSql(list))
    .bind(held?.key ?? NEVER)
    .all<{ t: string; name: string | null }>();
  const key = results.find((r) => r.t === 'k')?.name ?? null;
  if (held && key !== null && key === held.key) return held.names;
  const names = results.filter((r) => r.t === 'n' && r.name !== null).map((r) => r.name!).sort(nocase);
  if (key !== null) cache.set(list, { key, names });
  else cache.delete(list);
  return names;
}

// /gear find's search (work order 13, ITEM 3): one D1 statement per page, reading the gear index (item_gear, partial on
// slot_mask <> 0) for the class, slot and source filters. No writes: the only row a search adds is its read audit row
// ('gear.find', src/interactions.ts).
import { ANY, statSql, TOTAL_STATS_SQL, type GearQuery } from './options.ts';
import { REMOVED_BIT, SLOTS, SOURCES } from './vocab.ts';

export const PAGE_SIZE = 10;

/** One filter: its SQL term and its binding. `label` names it in the zero-results message. */
export interface Filter {
  label: string;
  sql: string;
  binds: unknown[];
}

/**
 * The query's filters. Bitmask tests read the gear index's entries; class uses game_class.bit (ALL is -1, every bit).
 *   class: the class's bit is set (an unknown code matches nothing). slot: the item holds that slot token.
 *   min_ac: ac >= n (no AC never matches). min_ratio: ratio >= n (no ratio never matches: no damage, or delay 0 or missing).
 *   stats: each chosen value > 0. source: the source's bit is set.
 */
export function filters(q: GearQuery): Filter[] {
  const f: Filter[] = [];
  if (q.cls !== ANY)
    f.push({ label: `class: ${q.cls}`, sql: '(class_mask & (1 << (SELECT bit FROM game_class WHERE code = ? AND item_count > 0))) <> 0', binds: [q.cls] });
  if (q.slot) f.push({ label: `slot: ${q.slot}`, sql: '(slot_mask & ?) <> 0', binds: [1 << SLOTS.indexOf(q.slot)] });
  if (q.weaponType) f.push({ label: `weapon_type: ${q.weaponType}`, sql: 'skill = ?', binds: [q.weaponType] });
  if (q.minAc !== undefined) f.push({ label: `min_ac: ${q.minAc}`, sql: 'ac >= ?', binds: [q.minAc] });
  if (q.minRatio !== undefined) f.push({ label: `min_ratio: ${q.minRatio}`, sql: 'ratio >= ?', binds: [q.minRatio] });
  for (const s of q.stats) f.push({ label: `stat: ${s.label}`, sql: `${statSql(s)} > 0`, binds: [] });
  if (q.source) f.push({ label: `source: ${q.source}`, sql: '(source_mask & ?) <> 0', binds: [1 << SOURCES.indexOf(q.source)] });
  return f;
}

/** Every search starts from gear that is not tagged Removed Items: the gear index's own condition, then the flag. */
const BASE = `slot_mask <> 0 AND (source_mask & ${REMOVED_BIT}) = 0`;

export interface GearRow {
  id: number;
  name: string;
  slot: string | null;
  stats_json: string | null;
  origin_json: string | null;
  wiki_url: string | null;
  icon_url: string | null;
  source: string;
  ac: number | null;
  ratio: number | null;
  class_mask: number;
  source_mask: number;
  sort_value: number | string | null;
  total_stats: number;
  total: number;
}

export const GEAR_COLS = 'id, name, slot, stats_json, origin_json, wiki_url, icon_url, source, ac, ratio, class_mask, source_mask';

/**
 * One page: sorted by the sort (highest first, Name A→Z), then AC, then total stats, then name; items without the sorted
 * value last. `total` is the match count (a window over the filtered rows, before LIMIT).
 */
export function searchStatement(db: D1Database, q: GearQuery, page: number): D1PreparedStatement {
  const fs = filters(q);
  const dir = q.sort.asc ? 'ASC' : 'DESC';
  const sql = `SELECT ${GEAR_COLS}, ${q.sort.sql} AS sort_value, ${TOTAL_STATS_SQL} AS total_stats, count(*) OVER () AS total
    FROM item WHERE ${[BASE, ...fs.map((x) => x.sql)].join(' AND ')}
    ORDER BY sort_value ${dir} NULLS LAST, ac DESC NULLS LAST, total_stats DESC, name COLLATE NOCASE
    LIMIT ${PAGE_SIZE} OFFSET ?`;
  return db.prepare(sql).bind(...fs.flatMap((x) => x.binds), page * PAGE_SIZE);
}

/**
 * With zero matches: for each filter, how many items match all the others. The filter whose removal matches the most
 * removed the most. One scan of the gear index entries (plus the item rows the stat filters read).
 */
export function relaxStatement(db: D1Database, q: GearQuery): { stmt: D1PreparedStatement; labels: string[] } | null {
  const fs = filters(q);
  if (!fs.length) return null;
  const cols = fs.map((_, i) => {
    const others = fs.filter((__, j) => j !== i);
    return `sum(${others.length ? others.map((x) => `(${x.sql})`).join(' AND ') : '1'}) AS f${i}`;
  });
  const binds = fs.flatMap((_, i) => fs.filter((__, j) => j !== i).flatMap((x) => x.binds));
  return { stmt: db.prepare(`SELECT ${cols.join(', ')} FROM item WHERE ${BASE}`).bind(...binds), labels: fs.map((x) => x.label) };
}

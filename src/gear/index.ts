// Order 36, ITEM 5 (ROOT for the summary's cost): every gear item, read once per import and kept in the Worker's memory.
//
// /gear upgrades compares every gear item a class can use in 17 slots. Read from D1 per request, that is a scan of the gear
// index (order 13 measured 6,260 rows_read for one search over all gear, src/gear/search.ts), over the order's 5,000-row
// line. Items change only when an import writes them, so the list is cached at module level, keyed by the newest
// data_import row (its id, status and finish time: a new run, and its end, each change the key). A request reads that one
// row; the list is read again only when the key changes or the isolate is new. Nothing is cached with no import row (a new
// database), or while the newest row has no finish time (review fix: an import still running, or one killed before it
// could record its end, keeps writing items under an unchanged key, so each request reads the list afresh until a run
// finishes). The tests' reset() writes a finished row each time, so each test gets a fresh key.
//
// Order 38 (ITEM 3): the list is read packed. Returned as 3,156 rows of 36 columns, D1's binding turned every value into an
// object property in the Worker (its toJson and helper: 28.6% of a cold Find upgrades' CPU in the local workerd profile, 50
// runs). GEAR_INDEX_PACKED_SQL has D1 build each item as a JSON array and return them as a few rows of one text column each,
// which the Worker parses natively (JSON.parse) and reads by position: 14.3% after, cold p50 −9% on the same machine. The
// rest of that share is the response's size, not its rows. D1 reads 6,312 rows for it (the GROUP BY sorts), once per isolate
// per import. The items, their values and their order are those of GEAR_INDEX_SQL (test/worker/upgrades.test.ts).
// Each group's items are also bucketed once per index (`slotItems`), so a slot's comparison walks only the items that fit it.
import { SLOT_GROUPS, STAT_EXPRS, STAT_VECTOR_SQL, vectorAt, vectorOf, type GearItem } from './score.ts';
import type { SlotToken } from './slots.ts';
import { bitOf, isTwoHanded, SLOTS } from './vocab.ts';

export const VERSION_SQL = "SELECT id || ':' || status || ':' || coalesce(finished_at, '') AS v FROM data_import ORDER BY id DESC LIMIT 1";
/** Every gear item, its stats already a vector (STAT_VECTOR_SQL: D1 reads the JSON, so the Worker parses none). */
export const GEAR_INDEX_SQL = `SELECT id, name, name_key, slot_mask, class_mask, race_mask, source_mask, gone_at, handed, wiki_url,
    level_low, level_high, level_kind, level_kinds, ${STAT_VECTOR_SQL} FROM item WHERE slot_mask <> 0`;

/** The packed row's fields, in order; then the 22 stat values (STAT_EXPRS). */
const PACKED_COLS = ['id', 'name', 'name_key', 'slot_mask', 'class_mask', 'race_mask', 'source_mask', 'gone_at', 'handed', 'wiki_url', 'level_low', 'level_high', 'level_kind', 'level_kinds'] as const;
const STATS_AT = PACKED_COLS.length;
/** Item ids per returned row: 70–233 KB of text each on 2026-11-06's data, far under D1's 2,000,000-byte row limit. */
export const PACKED_CHUNK = 1000;
export const GEAR_INDEX_PACKED_SQL = `SELECT json_group_array(json_array(${PACKED_COLS.join(', ')}, ${STAT_EXPRS.join(', ')})) AS chunk
  FROM item WHERE slot_mask <> 0 GROUP BY id / ${PACKED_CHUNK}`;
/**
 * The order GEAR_INDEX_SQL's rows come in on D1 (its plan: SCAN item USING INDEX item_gear, keyed slot_mask, class_mask,
 * source_mask, then rowid = id), restored in the Worker, so the list is exactly the row read's whatever order the chunks
 * arrive in. (A window function could number them in SQL, but D1 then read 12,625 rows for 3,156 items.)
 */
const byGearOrder = (a: GearItem, b: GearItem) => a.slotMask - b.slotMask || a.classMask - b.classMask || a.sourceMask - b.sourceMask || a.id - b.id;
export const CLASS_BITS_SQL = 'SELECT code, bit FROM game_class WHERE item_count > 0 AND bit IS NOT NULL';
export const RACE_BITS_SQL = 'SELECT code, bit FROM game_race WHERE item_count > 0 AND bit IS NOT NULL';

export interface GearIndex {
  version: string | null;
  items: GearItem[];
  byKey: Map<string, GearItem>;
  classBits: Map<string, number>;
  raceBits: Map<string, number>;
  /** Order 38: each slot group's items (slot_mask fits the group's slot), in `items` order. */
  slotItems: Map<SlotToken, GearItem[]>;
  /** D1 rows_read for building it (0 when it came from memory). */
  rowsRead: number;
}

/** The items a slot group's comparison walks: those that fit its slot, in index order (compareGroup filters the same way). */
export const itemsFor = (idx: Pick<GearIndex, 'slotItems' | 'items'>, token: SlotToken): readonly GearItem[] => idx.slotItems.get(token) ?? idx.items;

interface Row {
  id: number;
  name: string;
  name_key: string;
  slot_mask: number;
  class_mask: number;
  race_mask: number;
  source_mask: number;
  gone_at: string | null;
  handed: string | null;
  wiki_url: string | null;
  level_low: number | null;
  level_high: number | null;
  level_kind: string | null;
  level_kinds: string | null;
}

let cached: GearIndex | null = null;
/** Tests only: forget the cached list. */
export const clearGearIndex = () => {
  cached = null;
};

export const toItem = (r: Row): GearItem => ({
  id: r.id,
  name: r.name,
  key: r.name_key,
  slotMask: Number(r.slot_mask),
  classMask: Number(r.class_mask),
  raceMask: Number(r.race_mask),
  sourceMask: Number(r.source_mask),
  gone: r.gone_at !== null,
  twoHanded: isTwoHanded(r.handed),
  // Order 36 follow-up: item names in the lists link to the wiki, only an https address (order 17's rule for wiki links).
  wiki: typeof r.wiki_url === 'string' && r.wiki_url.startsWith('https://') ? r.wiki_url : null,
  levelLow: r.level_low,
  levelHigh: r.level_high,
  levelKind: r.level_kind,
  levelKinds: r.level_kinds,
  v: vectorOf(r as unknown as Record<string, unknown>),
});

/** One packed item (GEAR_INDEX_PACKED_SQL), read by position: the same GearItem toItem makes from its row. */
export const fromPacked = (a: readonly unknown[]): GearItem => {
  const n = (i: number) => a[i] as number | null;
  const s = (i: number) => a[i] as string | null;
  const wiki = s(9);
  return {
    id: Number(n(0)),
    name: s(1)!,
    key: s(2)!,
    slotMask: Number(n(3)),
    classMask: Number(n(4)),
    raceMask: Number(n(5)),
    sourceMask: Number(n(6)),
    gone: s(7) !== null,
    twoHanded: isTwoHanded(s(8)),
    wiki: typeof wiki === 'string' && wiki.startsWith('https://') ? wiki : null,
    levelLow: n(10),
    levelHigh: n(11),
    levelKind: s(12),
    levelKinds: s(13),
    v: vectorAt(a, STATS_AT),
  };
};

/** Every packed chunk's items, in the row read's order (byGearOrder). */
export function unpack(chunks: readonly string[]): GearItem[] {
  return chunks.flatMap((c) => (JSON.parse(c) as unknown[][]).map(fromPacked)).sort(byGearOrder);
}

/** Each slot group's items, in list order (the same slot test as compareGroup's). */
export function bucket(list: readonly GearItem[]): Map<SlotToken, GearItem[]> {
  const out = new Map<SlotToken, GearItem[]>();
  for (const g of SLOT_GROUPS) {
    const bit = bitOf(SLOTS, g.token);
    out.set(g.token, list.filter((it) => (it.slotMask & bit) !== 0));
  }
  return out;
}

/** The index for this version: from memory when the key matches, else read (one batch of three statements). */
export async function gearIndex(db: D1Database, version: string | null): Promise<GearIndex> {
  const cacheable = version !== null && !version.endsWith(':');
  if (cacheable && cached?.version === version) return { ...cached, rowsRead: 0 };
  const [items, classes, races] = await db.batch([db.prepare(GEAR_INDEX_PACKED_SQL), db.prepare(CLASS_BITS_SQL), db.prepare(RACE_BITS_SQL)]);
  const list = unpack((items.results as { chunk: string }[]).map((r) => r.chunk));
  const idx: GearIndex = {
    version,
    items: list,
    byKey: new Map(list.map((it) => [it.key, it])),
    classBits: new Map((classes.results as { code: string; bit: number }[]).map((r) => [r.code, Number(r.bit)])),
    raceBits: new Map((races.results as { code: string; bit: number }[]).map((r) => [r.code, Number(r.bit)])),
    slotItems: bucket(list),
    rowsRead: [items, classes, races].reduce((n, r) => n + (r.meta?.rows_read ?? 0), 0),
  };
  if (cacheable) cached = idx;
  return idx;
}

/** Order 38: the gear index's state for the request log ("held" for the version it was read for, or "empty"). */
export const gearIndexState = (): string => (cached ? `held:${cached.version}` : 'empty');

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
// Order 38 (ITEM 3): each slot group's items are bucketed once per index (`slotItems`, `itemsFor`), so a slot's comparison
// walks only the items that fit it rather than all 3,156 (17 groups × every item before): warm Find upgrades p50 −10% in
// the local workerd profile (50 runs, same machine). Reading the index packed as JSON was tried and measured: D1's binding
// share fell, but parsing took it back (cold p50 −2%, within noise), so it was not kept.
import { SLOT_GROUPS, STAT_VECTOR_SQL, vectorOf, type GearItem } from './score.ts';
import type { SlotToken } from './slots.ts';
import { bitOf, isTwoHanded, SLOTS } from './vocab.ts';

export const VERSION_SQL = "SELECT id || ':' || status || ':' || coalesce(finished_at, '') AS v FROM data_import ORDER BY id DESC LIMIT 1";
/** Every gear item, its stats already a vector (STAT_VECTOR_SQL: D1 reads the JSON, so the Worker parses none). */
export const GEAR_INDEX_SQL = `SELECT id, name, name_key, slot_mask, class_mask, race_mask, source_mask, gone_at, handed, wiki_url,
    level_low, level_high, level_kind, level_kinds, ${STAT_VECTOR_SQL} FROM item WHERE slot_mask <> 0`;
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

/** Each slot group's items, in list order (the same slot test as compareGroup's). */
export function bucket(list: readonly GearItem[]): Map<SlotToken, GearItem[]> {
  const out = new Map<SlotToken, GearItem[]>();
  for (const g of SLOT_GROUPS) {
    const bit = bitOf(SLOTS, g.token);
    out.set(g.token, list.filter((it) => (it.slotMask & bit) !== 0));
  }
  return out;
}

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

/** The index for this version: from memory when the key matches, else read (one batch of three statements). */
export async function gearIndex(db: D1Database, version: string | null): Promise<GearIndex> {
  const cacheable = version !== null && !version.endsWith(':');
  if (cacheable && cached?.version === version) return { ...cached, rowsRead: 0 };
  const [items, classes, races] = await db.batch([db.prepare(GEAR_INDEX_SQL), db.prepare(CLASS_BITS_SQL), db.prepare(RACE_BITS_SQL)]);
  const list = (items.results as Row[]).map(toItem);
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

/** Order 38: the gear index's state for the request log ("held:<version>" or "empty"). */
export const gearIndexState = (): string => (cached ? `held:${cached.version}` : 'empty');

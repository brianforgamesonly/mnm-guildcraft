// Import core: structure check, plan, SQL. Pure TypeScript — no Node or Workers APIs — so the
// nightly Action (scripts/import/run.ts) and the Workers-pool tests run exactly this code.
//
// Rules applied here (docs/ORDER-RULES.md, Data):
// - tradeskills and game classes are derived from the data, never typed by hand;
// - a value the source does not hold is stored as NULL (trivial), never guessed;
// - recipes that disappear upstream are deactivated (active = 0), never deleted;
// - only changed rows are written: every upsert carries a "differs" guard, so D1 reports
//   rows_written = 0 for a re-run on unchanged data.

import { ALARM_IMPORT, isFailing, type ImportStatus } from '../../src/import-status.ts';
import { ALL_CLASSES, QUEST_CATEGORIES, REMOVED_BIT, REMOVED_CATEGORY, RESISTS, SLOTS, SOURCES, STATS, WEAPON_TYPES, type Source } from '../../src/gear/vocab.ts';

export const SOURCE = 'mnm-tools/wiki.json';

// ---------------------------------------------------------------- database port

export interface StatementMeta {
  rows_written: number;
  changes: number;
}

export interface Db {
  all<T>(sql: string): Promise<T[]>;
  /** Runs statements in order; returns one meta per statement, in the same order. */
  run(statements: string[]): Promise<StatementMeta[]>;
}

// ---------------------------------------------------------------- source shape

export interface WikiComponent {
  qty: number;
  item: string;
}
export interface WikiRecipe {
  tradeskill: string;
  result: WikiComponent;
  components: WikiComponent[];
  trivial: number | null;
  trivialUnconfirmed?: boolean;
  fromItemPage?: boolean;
}

/** Problems that do not stop an import; stored in data_import.warnings as a JSON list. */
export type Warning =
  | { kind: 'unknown_field'; path: string; count: number }
  | { kind: 'scroll'; tradeskill: string; result: string; product: string; decision: string }
  | { kind: 'placeholder_result'; tradeskill: string; result: string }
  | { kind: 'unmatched_component_names'; count: number; names: string[] }
  // Order 13: class tokens that match no game_class code (joined codes, typos), kept in stats_json and given no class bit.
  | { kind: 'unrecognised_class_tokens'; tokens: { token: string; items: number }[] }
  // Order 13: a value the data holds that a /gear find choice list lacks (or a class list change): re-register commands.
  | { kind: 'vocab_drift'; list: 'class' | 'slot' | 'weapon_type' | 'stat' | 'resist'; values: { value: string; items: number }[]; note: string }
  // Order 13: the run stopped at the write ceiling; the rest is written by the next run (the differs guards resume it).
  | { kind: 'write_ceiling'; ceiling: number; written: number; deferredStatements: number; deferredBound: number };

// The source's fields as of mnm-tools e19cc75 (2026-10-19). A field outside these lists is a
// warning, not a failure, so the next source change names itself in data_import.warnings.
const KNOWN_FIELDS = {
  top: ['generatedAt', 'items', 'mobs', 'nodes', 'recipes'],
  recipe: ['tradeskill', 'result', 'components', 'trivial', 'trivialUnconfirmed', 'fromItemPage'],
  component: ['item', 'qty'],
  item: ['ac', 'categories', 'class', 'container', 'delay', 'dmg', 'effect', 'flags', 'from', 'fromImport', 'fromTrade',
    'handed', 'harvestedBy', 'hasPage', 'haste', 'hp', 'hpRegen', 'icon', 'iconId', 'instr', 'mana', 'manaRegen', 'race',
    'resists', 'size', 'skill', 'slot', 'soldBy', 'stats', 'statsV', 'tradeskills', 'weight', 'wikiOnly', 'wikiZones'],
  // Order 13: as of mnm-tools 7b17117 (2026-10-20). Kept: title, level, race, class, image, zone, loot.
  mob: ['ac', 'class', 'hasPage', 'hp', 'image', 'imageFile', 'level', 'loot', 'race', 'special', 'title', 'zone'],
} as const;

/** A component name the source uses for "not known": counted on the recipe, never stored as an item. */
export const PLACEHOLDER_KEY = 'unknown';
export const isPlaceholder = (name: string) => name.trim().toLowerCase() === PLACEHOLDER_KEY;
export type WikiItem = Record<string, unknown> & {
  icon?: string | null;
  slot?: string | null;
  tradeskills?: string[];
  harvestedBy?: string;
};
export interface WikiMob {
  title?: string | null;
  level?: string | number | null;
  race?: string | null;
  class?: string | null;
  image?: string | null;
  zone?: string | null;
  loot?: string[] | null;
}
export interface WikiData {
  generatedAt: string;
  items: Record<string, WikiItem>;
  recipes: WikiRecipe[];
  nodes: Record<string, { yields?: { section?: string }[] }>;
  mobs: Record<string, WikiMob>;
}

export class StructureError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`structure check failed: ${problems.slice(0, 10).join('; ')}${problems.length > 10 ? ` (+${problems.length - 10} more)` : ''}`);
    this.problems = problems;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && !v.includes('\u0000');
const isPosInt = (v: unknown): v is number => Number.isInteger(v) && (v as number) > 0;
const isNullish = (v: unknown) => v === undefined || v === null;

/**
 * Checks top-level keys and the recipe and item shapes. Throws StructureError; never partially accepts.
 * Fields outside KNOWN_FIELDS are appended to `warnings` (counted per path), never a failure.
 */
export function checkStructure(raw: unknown, warnings: Warning[] = []): WikiData {
  const p: string[] = [];
  if (!isObj(raw)) throw new StructureError(['top level is not an object']);
  const unknown = new Map<string, number>();
  const note = (obj: Record<string, unknown>, known: readonly string[], path: string) => {
    for (const k of Object.keys(obj)) if (!known.includes(k)) unknown.set(`${path}.${k}`, (unknown.get(`${path}.${k}`) ?? 0) + 1);
  };
  const flush = () => {
    for (const [path, count] of [...unknown].sort()) warnings.push({ kind: 'unknown_field', path, count });
    unknown.clear();
  };
  note(raw, KNOWN_FIELDS.top, '$');
  if (typeof raw.generatedAt !== 'string' || Number.isNaN(Date.parse(raw.generatedAt))) p.push('generatedAt is not an ISO date string');
  if (!isObj(raw.items) || Object.keys(raw.items).length === 0) p.push('items is not a non-empty object');
  if (!Array.isArray(raw.recipes) || raw.recipes.length === 0) p.push('recipes is not a non-empty array');
  if (!isObj(raw.nodes)) p.push('nodes is not an object');
  if (!isObj(raw.mobs)) p.push('mobs is not an object');
  if (p.length) {
    flush();
    throw new StructureError(p);
  }

  (raw.recipes as unknown[]).forEach((r, i) => {
    const at = `recipes[${i}]`;
    if (!isObj(r)) return void p.push(`${at} is not an object`);
    note(r, KNOWN_FIELDS.recipe, '$.recipes[]');
    if (!isName(r.tradeskill)) p.push(`${at}.tradeskill is not a name`);
    if (!isObj(r.result) || !isName(r.result.item) || !isPosInt(r.result.qty)) p.push(`${at}.result is not {qty>0, item}`);
    else note(r.result, KNOWN_FIELDS.component, '$.recipes[].result');
    if (!('trivial' in r) || !(r.trivial === null || (Number.isInteger(r.trivial) && (r.trivial as number) >= 0)))
      p.push(`${at}.trivial is not a non-negative integer or null`);
    if (r.trivialUnconfirmed !== undefined && typeof r.trivialUnconfirmed !== 'boolean') p.push(`${at}.trivialUnconfirmed is not a boolean`);
    if (!Array.isArray(r.components) || r.components.length === 0) p.push(`${at}.components is not a non-empty array`);
    else
      r.components.forEach((c, j) => {
        if (!isObj(c) || !isName(c.item) || !isPosInt(c.qty)) p.push(`${at}.components[${j}] is not {qty>0, item}`);
        else note(c, KNOWN_FIELDS.component, '$.recipes[].components[]');
      });
  });
  for (const [name, it] of Object.entries(raw.items as Record<string, unknown>)) {
    const at = `items[${JSON.stringify(name)}]`;
    if (!isName(name)) p.push(`${at} has an invalid name`);
    if (!isObj(it)) {
      p.push(`${at} is not an object`);
      continue;
    }
    note(it, KNOWN_FIELDS.item, '$.items[]');
    for (const k of ['icon', 'slot'] as const)
      if (it[k] !== undefined && it[k] !== null && typeof it[k] !== 'string') p.push(`${at}.${k} is not a string or null`);
    if (it.tradeskills !== undefined && !(Array.isArray(it.tradeskills) && it.tradeskills.every(isName)))
      p.push(`${at}.tradeskills is not an array of names`);
    if (it.harvestedBy !== undefined && it.harvestedBy !== null && !isName(it.harvestedBy)) p.push(`${at}.harvestedBy is not a name`);
    // Order 13: the fields the gear finder reads.
    for (const k of ['class', 'skill', 'handed'] as const)
      if (!isNullish(it[k]) && typeof it[k] !== 'string') p.push(`${at}.${k} is not a string or null`);
    for (const k of ['ac', 'dmg', 'delay', 'hp', 'mana', 'haste', 'hpRegen', 'manaRegen'] as const)
      if (!isNullish(it[k]) && typeof it[k] !== 'number') p.push(`${at}.${k} is not a number or null`);
    for (const k of ['from', 'wikiZones', 'categories', 'flags'] as const)
      if (!isNullish(it[k]) && !(Array.isArray(it[k]) && (it[k] as unknown[]).every((v) => typeof v === 'string'))) p.push(`${at}.${k} is not a list of strings`);
    for (const k of ['stats', 'resists'] as const)
      if (!isNullish(it[k]) && !(isObj(it[k]) && Object.values(it[k]).every((v) => typeof v === 'number'))) p.push(`${at}.${k} is not an object of numbers`);
    if (!isNullish(it.soldBy) && !(isObj(it.soldBy) && Array.isArray(it.soldBy.vendors) && it.soldBy.vendors.every((v) => typeof v === 'string')))
      p.push(`${at}.soldBy is not {base, shady, vendors[]}`);
  }
  for (const [key, m] of Object.entries(raw.mobs as Record<string, unknown>)) {
    const at = `mobs[${JSON.stringify(key)}]`;
    if (!isName(key)) p.push(`${at} has an invalid key`);
    if (!isObj(m)) {
      p.push(`${at} is not an object`);
      continue;
    }
    note(m, KNOWN_FIELDS.mob, '$.mobs[]');
    for (const k of ['title', 'race', 'class', 'image', 'zone'] as const)
      if (!isNullish(m[k]) && typeof m[k] !== 'string') p.push(`${at}.${k} is not a string or null`);
    if (!isNullish(m.level) && typeof m.level !== 'string' && typeof m.level !== 'number') p.push(`${at}.level is not text or null`);
    if (!isNullish(m.loot) && !(Array.isArray(m.loot) && m.loot.every((v) => typeof v === 'string'))) p.push(`${at}.loot is not a list of strings`);
  }
  flush();
  if (p.length) throw new StructureError(p);
  return raw as unknown as WikiData;
}

// ---------------------------------------------------------------- derivations

export const nameKey = (name: string): string => name.toLowerCase();

/** Crafting skills = union of every recipe's tradeskill and every item's tradeskills (derived, never typed). */
export function deriveCraftingSkills(data: WikiData): string[] {
  const s = new Set<string>();
  for (const r of data.recipes) s.add(r.tradeskill);
  for (const it of Object.values(data.items)) for (const t of it.tradeskills ?? []) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b, 'en'));
}

/**
 * Gathering candidates — reported only, never inserted (CHECKLIST A6 is the operator's open question).
 * Proposed rule: a nodes key that has its own skill page (a "Getting Started" section), plus every
 * item.harvestedBy value, minus the crafting skills. Resource nodes (Ore/Wood sections) drop out.
 */
export function deriveGatheringCandidates(data: WikiData, crafting: string[]): string[] {
  const s = new Set<string>();
  for (const [k, v] of Object.entries(data.nodes))
    if ((v.yields ?? []).some((y) => y.section === 'Getting Started')) s.add(k);
  for (const it of Object.values(data.items)) if (it.harvestedBy) s.add(it.harvestedBy);
  for (const c of crafting) s.delete(c);
  return [...s].sort();
}

/** Share of the items carrying a class value that a code must appear on to be kept. */
export const CLASS_MIN_SHARE = 0.01;
const CLASS_ALL = 'ALL';
const CLASS_NONE = 'NONE';
const CLASS_IGNORED = new Set([CLASS_ALL, CLASS_NONE]);

/**
 * An item's class text as tokens (order 13): wiki markup removed ("<br>", and a cut-off "SHD<"), split on whitespace
 * and commas, upper-cased. Joined codes ("INQNEC") and typos stay whole: they are never split or guessed.
 */
export const classTokens = (text: string): string[] =>
  text
    .replace(/<[^>]*>/g, ' ')
    .split(/[\s,]+/)
    .map((t) => t.replace(/<.*$/s, '').toUpperCase())
    .filter(Boolean);

export interface ClassDerivation {
  /** Items whose class is a non-empty string (the denominator). */
  carrying: number;
  kept: { code: string; item_count: number }[];
  /** Codes below CLASS_MIN_SHARE, with the items carrying them. */
  dropped: { code: string; items: number }[];
  /** Tokens that yield no code: ALL and NONE. */
  ignored: { token: string; items: number }[];
}

/**
 * The game's classes, derived from items' class tokens (never typed; classTokens), dropping ALL and NONE, and keeping
 * a code carried by at least CLASS_MIN_SHARE of the items that carry a class. Counts are items, not token occurrences.
 */
export function deriveClasses(data: WikiData): ClassDerivation {
  let carrying = 0;
  const codes = new Map<string, number>();
  const ignored = new Map<string, number>();
  for (const it of Object.values(data.items)) {
    if (typeof it.class !== 'string' || it.class.trim() === '') continue;
    carrying++;
    const seen = new Set<string>();
    for (const code of classTokens(it.class)) {
      if (CLASS_IGNORED.has(code)) ignored.set(code, (ignored.get(code) ?? 0) + 1);
      else seen.add(code);
    }
    for (const c of seen) codes.set(c, (codes.get(c) ?? 0) + 1);
  }
  const min = carrying * CLASS_MIN_SHARE;
  const byCount = [...codes].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  return {
    carrying,
    kept: byCount.filter(([, n]) => n >= min).map(([code, item_count]) => ({ code, item_count })),
    dropped: byCount.filter(([, n]) => n < min).map(([code, items]) => ({ code, items })),
    ignored: [...ignored].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en')).map(([token, items]) => ({ token, items })),
  };
}

// The PRD's stats_json set (docs/PRD-schema.sql item.stats_json) plus the other combat fields the source holds.
const STAT_KEYS = ['ac', 'dmg', 'delay', 'skill', 'handed', 'hp', 'mana', 'hpRegen', 'manaRegen', 'haste',
  'stats', 'resists', 'effect', 'weight', 'size', 'class', 'race', 'flags'] as const;

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isObj(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

const isEmpty = (v: unknown) =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (isObj(v) && Object.keys(v).length === 0);

export function statsJson(it: WikiItem): string | null {
  const out: Record<string, unknown> = {};
  for (const k of STAT_KEYS) if (!isEmpty(it[k])) out[k] = it[k];
  return Object.keys(out).length ? stableStringify(out) : null;
}

// ---------------------------------------------------------------- gear (order 13)

// Where an item comes from, as the source records it (item.origin_json): kept whole, read by /gear find's source line.
const ORIGIN_KEYS = ['from', 'wikiZones', 'soldBy', 'categories'] as const;

export function originJson(it: WikiItem): string | null {
  const out: Record<string, unknown> = {};
  for (const k of ORIGIN_KEYS) if (!isEmpty(it[k])) out[k] = it[k];
  return Object.keys(out).length ? stableStringify(out) : null;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
export const slotTokens = (slot: string | null | undefined): string[] => (slot ?? '').trim().toUpperCase().split(/\s+/).filter(Boolean);

/**
 * An item's sources (order 13, ITEM 2), derived on every import and never typed by hand:
 *   Drop: from or wikiZones is present. Crafted: the result of an active recipe. Vendor: soldBy is present.
 *   Quest: a category in QUEST_CATEGORIES. Unknown: none of these.
 * The "Removed Items" category adds REMOVED_BIT, which is not a source.
 */
export function sourceMask(it: WikiItem, crafted: boolean): number {
  const cats = strings(it.categories);
  const has: Record<Source, boolean> = {
    Drop: strings(it.from).length > 0 || strings(it.wikiZones).length > 0,
    Crafted: crafted,
    Vendor: !isEmpty(it.soldBy),
    Quest: cats.some((c) => (QUEST_CATEGORIES as readonly string[]).includes(c)),
    Unknown: false,
  };
  has.Unknown = !SOURCES.some((s) => has[s]);
  let mask = 0;
  SOURCES.forEach((s, i) => {
    if (has[s]) mask |= 1 << i;
  });
  return cats.includes(REMOVED_CATEGORY) ? mask | REMOVED_BIT : mask;
}

export function slotMask(it: WikiItem): number {
  let mask = 0;
  for (const t of slotTokens(it.slot)) {
    const i = (SLOTS as readonly string[]).indexOf(t);
    if (i >= 0) mask |= 1 << i;
  }
  return mask;
}

/**
 * class_mask: ALL anywhere means every class (-1). Otherwise the bit of each token that is a kept game_class code;
 * NONE, no class, and unrecognised tokens add no bit, so such an item matches only "Any".
 */
export function classMask(it: WikiItem, bits: Map<string, number>): number {
  if (typeof it.class !== 'string') return 0;
  const tokens = classTokens(it.class);
  if (tokens.includes(CLASS_ALL)) return ALL_CLASSES;
  let mask = 0;
  for (const t of tokens) {
    const b = bits.get(t);
    if (b !== undefined) mask |= 1 << b;
  }
  return mask;
}

/** Highest bit a class may take: masks are handled as 32-bit signed integers in the Worker, and -1 means ALL. */
export const MAX_CLASS_BIT = 30;

/**
 * Each kept class's bit. A code keeps the bit it was given (even while not kept, so a bit is never reused); a newly kept
 * code takes the next free bit, in code order. A new class therefore never changes another class's bit.
 */
export function assignClassBits(kept: string[], existing: Map<string, { item_count: number; bit: number | null }>): Map<string, number> {
  const bits = new Map<string, number>();
  let next = Math.max(-1, ...[...existing.values()].map((c) => c.bit ?? -1)) + 1;
  for (const code of [...kept].sort()) {
    const held = existing.get(code)?.bit;
    if (held !== null && held !== undefined) bits.set(code, held);
    else {
      if (next > MAX_CLASS_BIT) throw new Error(`no class bit left for ${code}: bits 0..${MAX_CLASS_BIT} are taken`);
      bits.set(code, next++);
    }
  }
  return bits;
}

export interface MobRow {
  key: string;
  title: string;
  level: string | null;
  race: string | null;
  class: string | null;
  image_url: string | null;
  zones_json: string | null;
  loot_json: string | null;
}

/** "[[Tomb of the Last Wyrmsbane]]" or "Night Harbor, Shaded Dunes": link text kept, comma lists split, repeats dropped. */
export function mobZones(zone: string | null | undefined): string[] {
  if (typeof zone !== 'string') return [];
  const text = zone.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1');
  return [...new Set(text.split(',').map((z) => z.trim()).filter(Boolean))];
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);

export function mobRow(key: string, m: WikiMob): MobRow {
  const zones = mobZones(m.zone);
  const loot = strings(m.loot);
  return {
    key,
    title: text(m.title) ?? key,
    level: text(m.level),
    race: text(m.race),
    class: text(m.class),
    image_url: text(m.image),
    zones_json: zones.length ? JSON.stringify(zones) : null,
    loot_json: loot.length ? JSON.stringify(loot) : null,
  };
}

// ---------------------------------------------------------------- plan

export interface ItemRow {
  name: string;
  name_key: string;
  icon_url: string | null;
  slot: string | null;
  stats_json: string | null;
  /** The item's wiki page, only when the source marks hasPage (order 3, 1.2: fills the existing column). */
  wiki_url: string | null;
  source: 'wiki';
  // Order 13 (migrations/0010_gear.sql).
  class_mask: number;
  slot_mask: number;
  source_mask: number;
  origin_json: string | null;
}
type StoredItem = Omit<ItemRow, 'name_key' | 'source'> & { source: string };
const ITEM_FIELDS = ['name', 'icon_url', 'slot', 'stats_json', 'wiki_url', 'class_mask', 'slot_mask', 'source_mask', 'origin_json'] as const;
/** The one comparison the dry run's prediction and the statements' row filter share. */
export const itemDiffers = (o: StoredItem | undefined, it: ItemRow) => !o || o.source !== 'wiki' || ITEM_FIELDS.some((f) => o[f] !== it[f]);

type StoredMob = MobRow & { active: number };
const MOB_FIELDS = ['key', 'title', 'level', 'race', 'class', 'image_url', 'zones_json', 'loot_json'] as const;
export const mobDiffers = (o: StoredMob | undefined, m: MobRow) => !o || o.active !== 1 || MOB_FIELDS.some((f) => o[f] !== m[f]);

/** The wiki link as mnm-tools builds it (mnmdb/app.js:179-180). Checked live in order 3: 21 of 21 sampled pages 200, no redirect. */
export const WIKI_BASE = 'https://monstersandmemories.miraheze.org/wiki/';
export const wikiUrl = (name: string) => WIKI_BASE + encodeURIComponent(name.replace(/ /g, '_'));
export interface PlannedRecipe {
  source_key: string;
  tradeskill: string;
  result_key: string;
  result_qty: number;
  trivial: number | null;
  /** 1 when the source marks the trivial as unconfirmed (recipe.trivial_unconfirmed). */
  trivial_unconfirmed: number;
  /** Source component rows named "Unknown" (recipe.unknown_components); never stored as components. */
  unknown_components: number;
  components: Map<string, number>; // item name_key -> qty
}
interface ExistingRecipe {
  source_key: string;
  variant: number;
  active: boolean;
  tradeskill: string;
  result_key: string;
  result_qty: number;
  trivial: number | null;
  trivial_unconfirmed: number;
  unknown_components: number;
  components: Map<string, number>;
}
export interface ExistingState {
  tradeskills: Map<string, { kind: string; sort_order: number }>;
  items: Map<string, StoredItem>;
  recipes: Map<string, ExistingRecipe>; // by source_key, source = 'wiki' only
  activeWikiRecipes: number;
  classes: Map<string, { item_count: number; bit: number | null }>; // game_class code (item_count 0 = no longer kept)
  mobs: Map<string, StoredMob>; // by lower(key)
  /** Indexes per table, from the live schema: each written row can also write one entry in each (the write bound). */
  indexes: Record<string, number>;
}

/** Order 13's summary of gear (items with a slot): sources, overlaps, classes, and how from-names meet the mobs. */
export interface GearSummary {
  gear: number;
  removed: number;
  bySource: Record<Source, number>;
  /** Each combination of sources, as "Drop+Crafted", with its count. */
  combinations: Record<string, number>;
  /** Gear whose class text yields no class bit (no class, NONE, or only unrecognised tokens): matches only "Any". */
  classMaskZero: number;
  slotMaskZero: number;
  unrecognisedClassTokens: { token: string; items: number }[];
  /** Distinct from-names on gear, and how many match a mob by key, or (failing that) by title; case-insensitive. */
  fromNames: number;
  fromMatchKey: number;
  fromMatchTitle: number;
}

export interface Plan {
  tradeskills: { name: string; sort_order: number }[];
  items: ItemRow[];
  stubs: { name: string; name_key: string }[];
  recipes: PlannedRecipe[];
  deactivate: string[];
  componentDeletes: { source_key: string; item_keys: string[] }[];
  gatheringCandidates: string[];
  sourceRecipes: number;
  duplicatesCollapsed: number;
  itemNameCollisions: number;
  caseOnlyMatches: number;
  scrolls: { skipped: number; adopted: number };
  warnings: Warning[];
  classes: ClassDerivation;
  /** Stored codes that no longer meet the class rule: set to item_count 0, never deleted. */
  classDeactivate: string[];
  /** Each kept code's bit in item.class_mask (assignClassBits). */
  classBits: Map<string, number>;
  mobs: MobRow[];
  /** Stored active mobs missing upstream: set active = 0, never deleted (by key). */
  mobDeactivate: string[];
  gear: GearSummary;
}

/** A recipe's identity within its (tradeskill, result) group, excluding the variant number. */
export const groupKey = (tradeskill: string, resultKey: string) => `${tradeskill}|${resultKey}`;
export const sourceKey = (group: string, variant: number) => `${group}|${variant}`;

function parseSourceKey(k: string): { group: string; variant: number } {
  const i = k.lastIndexOf('|');
  return { group: k.slice(0, i), variant: Number(k.slice(i + 1)) };
}

function signature(r: {
  result_qty: number;
  trivial: number | null;
  trivial_unconfirmed: number;
  unknown_components: number;
  components: Map<string, number>;
}): string {
  const comps = [...r.components.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([r.result_qty, r.trivial, r.trivial_unconfirmed, r.unknown_components, comps]);
}

const SCROLL = /^Recipe:\s*/;
/** "Recipe: Net Arrow (x20)" -> "Net Arrow". */
export const scrollProduct = (result: string) => result.replace(SCROLL, '').replace(/\s*\(x\d+\)\s*$/, '').trim();

/**
 * Variant rule (source_key = "<tradeskill>|<result name_key>|<variant>").
 * Within a (tradeskill, result) group, each incoming recipe keeps the variant of the stored recipe
 * it matches, so a variant is stable when components change:
 *   1. identical recipes (same result qty, trivial and components) are matched first;
 *   2. the rest are paired greedily by most shared component items (ties: source order, then lowest
 *      variant), so a single-recipe group always keeps variant 1 whatever its components become;
 *   3. unmatched incoming recipes get max(stored variant in the group, active or not) + 1, in source order;
 *   4. unmatched stored recipes are deactivated, never deleted; a recipe that comes back reuses its key.
 * Exact duplicate source entries carry no information and are collapsed to one recipe (counted).
 */
export function assignVariants(
  group: string,
  incoming: Omit<PlannedRecipe, 'source_key'>[],
  stored: ExistingRecipe[],
): { planned: PlannedRecipe[]; unmatched: ExistingRecipe[] } {
  const assigned = new Map<number, number>(); // incoming index -> variant
  const free = new Set(stored);
  incoming.forEach((r, i) => {
    const sig = signature(r);
    const hit = [...free].filter((s) => signature(s) === sig).sort((a, b) => a.variant - b.variant)[0];
    if (hit) {
      assigned.set(i, hit.variant);
      free.delete(hit);
    }
  });
  const pairs: { i: number; s: ExistingRecipe; score: number }[] = [];
  incoming.forEach((r, i) => {
    if (assigned.has(i)) return;
    for (const s of free) pairs.push({ i, s, score: [...r.components.keys()].filter((k) => s.components.has(k)).length });
  });
  pairs.sort((a, b) => b.score - a.score || a.i - b.i || a.s.variant - b.s.variant);
  for (const { i, s } of pairs) {
    if (assigned.has(i) || !free.has(s)) continue;
    assigned.set(i, s.variant);
    free.delete(s);
  }
  let next = Math.max(0, ...stored.map((s) => s.variant));
  const planned = incoming.map((r, i) => {
    const v = assigned.get(i) ?? ++next;
    return { ...r, source_key: sourceKey(group, v) };
  });
  return { planned, unmatched: [...free] };
}

export function buildPlan(data: WikiData, existing: ExistingState): Plan {
  const crafting = deriveCraftingSkills(data);

  // Items: name_key is UNIQUE; on a case-only collision keep the first name in sorted order.
  const items = new Map<string, ItemRow>();
  let itemNameCollisions = 0;
  for (const name of Object.keys(data.items).sort()) {
    const key = nameKey(name);
    if (items.has(key)) {
      itemNameCollisions++;
      continue;
    }
    const it = data.items[name];
    items.set(key, {
      name,
      name_key: key,
      icon_url: typeof it.icon === 'string' && it.icon ? it.icon : null,
      slot: typeof it.slot === 'string' && it.slot ? it.slot : null,
      stats_json: statsJson(it),
      wiki_url: it.hasPage === true ? wikiUrl(name) : null,
      source: 'wiki',
      // Set below, once the recipes (Crafted) and the class bits are known.
      class_mask: 0,
      slot_mask: 0,
      source_mask: 0,
      origin_json: originJson(it),
    });
  }

  const warnings: Warning[] = [];

  // "Recipe: <product>" results are recipe scrolls, not crafted goods. A scroll is skipped when its
  // product already has a recipe; adopted as the product's recipe when the product has an item record
  // and no recipe (the scroll is the only evidence); otherwise skipped. Every decision is logged.
  const scrolls = { skipped: 0, adopted: 0 };
  const plainResults = new Set(data.recipes.filter((r) => !SCROLL.test(r.result.item)).map((r) => nameKey(r.result.item)));
  const effective: WikiRecipe[] = [];
  for (const r of data.recipes) {
    if (isPlaceholder(r.result.item)) {
      warnings.push({ kind: 'placeholder_result', tradeskill: r.tradeskill, result: r.result.item });
      continue;
    }
    if (!SCROLL.test(r.result.item)) {
      effective.push(r);
      continue;
    }
    const product = scrollProduct(r.result.item);
    const pk = nameKey(product);
    let decision: string;
    if (plainResults.has(pk)) {
      decision = 'skipped: the product already has a recipe';
      scrolls.skipped++;
    } else if (items.has(pk)) {
      decision = "adopted as the product's recipe";
      scrolls.adopted++;
      effective.push({ ...r, result: { ...r.result, item: items.get(pk)!.name } });
      plainResults.add(pk);
    } else {
      decision = 'skipped: the product has no item record';
      scrolls.skipped++;
    }
    warnings.push({ kind: 'scroll', tradeskill: r.tradeskill, result: r.result.item, product, decision });
  }

  const unmatched = [...new Set(data.recipes.flatMap((r) => r.components.map((c) => c.item)))].filter((n) => !items.has(nameKey(n))).sort();
  if (unmatched.length) warnings.push({ kind: 'unmatched_component_names', count: unmatched.length, names: unmatched });

  // Stub items: names a recipe references that have no item record (FKs need a row). Placeholders are not items.
  const stubs = new Map<string, { name: string; name_key: string }>();
  let caseOnlyMatches = 0;
  const caseOnlySeen = new Set<string>();
  const refs = effective.flatMap((r) => [r.result.item, ...r.components.map((c) => c.item)]).filter((n) => !isPlaceholder(n));
  for (const name of refs) {
    const key = nameKey(name);
    if (items.has(key)) {
      if (!(name in data.items) && !caseOnlySeen.has(name)) {
        caseOnlySeen.add(name);
        caseOnlyMatches++;
      }
      continue;
    }
    if (!stubs.has(key)) stubs.set(key, { name, name_key: key });
  }

  // Recipes: collapse exact duplicates, then assign variants per group.
  const groups = new Map<string, Omit<PlannedRecipe, 'source_key'>[]>();
  const seen = new Set<string>();
  let duplicatesCollapsed = 0;
  for (const r of effective) {
    // Placeholder rows are counted, not stored. recipe_component's key is (recipe, item): a real item
    // listed twice in one recipe would be one row with the quantities added (0 such recipes in e19cc75;
    // its only repeats were placeholders).
    const components = new Map<string, number>();
    let unknown_components = 0;
    for (const c of r.components) {
      if (isPlaceholder(c.item)) unknown_components++;
      else components.set(nameKey(c.item), (components.get(nameKey(c.item)) ?? 0) + c.qty);
    }
    const rec = {
      tradeskill: r.tradeskill,
      result_key: nameKey(r.result.item),
      result_qty: r.result.qty,
      trivial: r.trivial,
      trivial_unconfirmed: r.trivialUnconfirmed === true ? 1 : 0,
      unknown_components,
      components,
    };
    const g = groupKey(rec.tradeskill, rec.result_key);
    const sig = `${g}|${signature(rec)}`;
    if (seen.has(sig)) {
      duplicatesCollapsed++;
      continue;
    }
    seen.add(sig);
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(rec);
  }
  const storedByGroup = new Map<string, ExistingRecipe[]>();
  for (const s of existing.recipes.values()) {
    const g = parseSourceKey(s.source_key).group;
    if (!storedByGroup.has(g)) storedByGroup.set(g, []);
    storedByGroup.get(g)!.push(s);
  }
  const recipes: PlannedRecipe[] = [];
  const deactivate: string[] = [];
  for (const [g, incoming] of groups) {
    const { planned, unmatched } = assignVariants(g, incoming, storedByGroup.get(g) ?? []);
    recipes.push(...planned);
    deactivate.push(...unmatched.filter((u) => u.active).map((u) => u.source_key));
  }
  for (const [g, stored] of storedByGroup)
    if (!groups.has(g)) deactivate.push(...stored.filter((s) => s.active).map((s) => s.source_key));

  const componentDeletes: Plan['componentDeletes'] = [];
  for (const r of recipes) {
    const old = existing.recipes.get(r.source_key);
    if (!old) continue;
    const gone = [...old.components.keys()].filter((k) => !r.components.has(k));
    if (gone.length) componentDeletes.push({ source_key: r.source_key, item_keys: gone });
  }

  const classes = deriveClasses(data);
  const keptCodes = new Set(classes.kept.map((c) => c.code));
  const classDeactivate = [...existing.classes].filter(([code, c]) => c.item_count > 0 && !keptCodes.has(code)).map(([code]) => code).sort();
  const classBits = assignClassBits([...keptCodes], existing.classes);

  // Order 13: each wiki item's masks. Crafted = the result of an active recipe in this plan.
  const crafted = new Set(recipes.map((r) => r.result_key));
  const unrecognised = new Map<string, number>();
  const drift = { slot: new Map<string, number>(), weapon_type: new Map<string, number>(), stat: new Map<string, number>(), resist: new Map<string, number>() };
  const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const row of items.values()) {
    const it = data.items[row.name];
    row.class_mask = classMask(it, classBits);
    row.slot_mask = slotMask(it);
    row.source_mask = sourceMask(it, crafted.has(row.name_key));
    if (typeof it.class === 'string')
      for (const t of new Set(classTokens(it.class))) if (!CLASS_IGNORED.has(t) && !classBits.has(t)) bump(unrecognised, t);
    for (const t of new Set(slotTokens(it.slot))) if (!(SLOTS as readonly string[]).includes(t)) bump(drift.slot, t);
    if (typeof it.skill === 'string' && !(WEAPON_TYPES as readonly string[]).includes(it.skill)) bump(drift.weapon_type, it.skill);
    if (isObj(it.stats)) for (const k of Object.keys(it.stats)) if (!(STATS as readonly string[]).includes(k)) bump(drift.stat, k);
    if (isObj(it.resists)) for (const k of Object.keys(it.resists)) if (!(RESISTS as readonly string[]).includes(k)) bump(drift.resist, k);
  }
  const counted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'en'));
  if (unrecognised.size) warnings.push({ kind: 'unrecognised_class_tokens', tokens: counted(unrecognised).map(([token, items]) => ({ token, items })) });
  for (const [list, m] of Object.entries(drift) as [keyof typeof drift, Map<string, number>][])
    if (m.size)
      warnings.push({ kind: 'vocab_drift', list, values: counted(m).map(([value, items]) => ({ value, items })), note: `not in src/gear/vocab.ts: add it there and re-register commands` });
  const newCodes = [...keptCodes].filter((c) => !((existing.classes.get(c)?.item_count ?? 0) > 0));
  if (existing.classes.size && (newCodes.length || classDeactivate.length))
    warnings.push({
      kind: 'vocab_drift',
      list: 'class',
      values: [...newCodes.map((c) => ({ value: `+${c}`, items: classes.kept.find((k) => k.code === c)!.item_count })), ...classDeactivate.map((c) => ({ value: `-${c}`, items: 0 }))],
      note: 'the class list changed: re-register commands so /gear find offers it',
    });

  // Order 13: mobs. name key is case-insensitive (mob.key COLLATE NOCASE); on a case-only collision keep the first.
  const mobs = new Map<string, MobRow>();
  for (const key of Object.keys(data.mobs).sort()) if (!mobs.has(nameKey(key))) mobs.set(nameKey(key), mobRow(key, data.mobs[key]));
  const mobDeactivate = [...existing.mobs].filter(([k, m]) => m.active === 1 && !mobs.has(k)).map(([, m]) => m.key).sort();

  const gearRows = [...items.values()].filter((r) => slotTokens(data.items[r.name].slot).length > 0);
  const bySource = Object.fromEntries(SOURCES.map((s) => [s, 0])) as Record<Source, number>;
  const combinations: Record<string, number> = {};
  const gearUnrecognised = new Map<string, number>();
  const fromNames = new Set<string>();
  for (const r of gearRows) {
    const names = SOURCES.filter((_, i) => r.source_mask & (1 << i));
    for (const s of names) bySource[s]++;
    combinations[names.join('+')] = (combinations[names.join('+')] ?? 0) + 1;
    const it = data.items[r.name];
    if (typeof it.class === 'string')
      for (const t of new Set(classTokens(it.class))) if (!CLASS_IGNORED.has(t) && !classBits.has(t)) bump(gearUnrecognised, t);
    for (const f of strings(it.from)) fromNames.add(nameKey(f));
  }
  const titles = new Set([...mobs.values()].map((m) => nameKey(m.title)));
  const fromMatchKey = [...fromNames].filter((f) => mobs.has(f)).length;
  const fromMatchTitle = [...fromNames].filter((f) => !mobs.has(f) && titles.has(f)).length;
  const gear: GearSummary = {
    gear: gearRows.length,
    removed: gearRows.filter((r) => r.source_mask & REMOVED_BIT).length,
    bySource,
    combinations,
    classMaskZero: gearRows.filter((r) => r.class_mask === 0).length,
    slotMaskZero: gearRows.filter((r) => r.slot_mask === 0).length,
    unrecognisedClassTokens: counted(gearUnrecognised).map(([token, items]) => ({ token, items })),
    fromNames: fromNames.size,
    fromMatchKey,
    fromMatchTitle,
  };

  return {
    classes,
    classDeactivate,
    classBits,
    mobs: [...mobs.values()],
    mobDeactivate,
    gear,
    tradeskills: crafting.map((name, i) => ({ name, sort_order: i + 1 })),
    items: [...items.values()],
    stubs: [...stubs.values()],
    recipes,
    deactivate: deactivate.sort(),
    componentDeletes,
    gatheringCandidates: deriveGatheringCandidates(data, crafting),
    sourceRecipes: data.recipes.length,
    duplicatesCollapsed,
    itemNameCollisions,
    caseOnlyMatches,
    scrolls,
    warnings,
  };
}

// ---------------------------------------------------------------- predicted changes (dry run)

export interface Predicted {
  tradeskill: { insert: number; update: number };
  item: { insert: number; update: number };
  stub: { insert: number };
  recipe: { insert: number; update: number; deactivate: number };
  recipe_component: { insert: number; update: number; delete: number };
  game_class: { insert: number; update: number; deactivate: number };
  mob: { insert: number; update: number; deactivate: number };
}

export function predict(plan: Plan, ex: ExistingState): Predicted {
  const p: Predicted = {
    tradeskill: { insert: 0, update: 0 },
    item: { insert: 0, update: 0 },
    stub: { insert: 0 },
    recipe: { insert: 0, update: 0, deactivate: plan.deactivate.length },
    recipe_component: { insert: 0, update: 0, delete: plan.componentDeletes.reduce((n, d) => n + d.item_keys.length, 0) },
    game_class: { insert: 0, update: 0, deactivate: plan.classDeactivate.length },
    mob: { insert: 0, update: 0, deactivate: plan.mobDeactivate.length },
  };
  for (const c of plan.classes.kept) {
    const o = ex.classes.get(c.code);
    if (o === undefined) p.game_class.insert++;
    else if (o.item_count !== c.item_count || o.bit !== plan.classBits.get(c.code)) p.game_class.update++;
  }
  for (const m of plan.mobs) {
    const o = ex.mobs.get(nameKey(m.key));
    if (!o) p.mob.insert++;
    else if (mobDiffers(o, m)) p.mob.update++;
  }
  for (const t of plan.tradeskills) {
    const o = ex.tradeskills.get(t.name);
    if (!o) p.tradeskill.insert++;
    else if (o.kind !== 'crafting' || o.sort_order !== t.sort_order) p.tradeskill.update++;
  }
  for (const it of plan.items) {
    const o = ex.items.get(it.name_key);
    if (!o) p.item.insert++;
    else if (itemDiffers(o, it)) p.item.update++;
  }
  for (const s of plan.stubs) if (!ex.items.has(s.name_key)) p.stub.insert++;
  for (const r of plan.recipes) {
    const o = ex.recipes.get(r.source_key);
    if (!o) p.recipe.insert++;
    else if (
      !o.active || o.tradeskill !== r.tradeskill || o.result_key !== r.result_key || o.result_qty !== r.result_qty || o.trivial !== r.trivial ||
      o.trivial_unconfirmed !== r.trivial_unconfirmed || o.unknown_components !== r.unknown_components
    )
      p.recipe.update++;
    for (const [k, q] of r.components) {
      const oq = o?.components.get(k);
      if (oq === undefined) p.recipe_component.insert++;
      else if (oq !== q) p.recipe_component.update++;
    }
  }
  return p;
}

// ---------------------------------------------------------------- SQL

const lit = (v: string | number | null): string => {
  if (v === null) return 'NULL';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`non-finite number ${v}`);
    return String(v);
  }
  return `'${v.replaceAll("'", "''")}'`;
};

const chunk = <T>(xs: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

/**
 * The game-data tables the import writes: every Statement names one, and import.test.ts checks each statement's SQL
 * writes exactly the table it names. The backup's must-hold-rows rule reads this list (scripts/backup/lib.ts).
 */
export const IMPORT_TABLES = ['tradeskill', 'item', 'recipe', 'recipe_component', 'game_class', 'mob'] as const;
export type Table = (typeof IMPORT_TABLES)[number];
/** Everything the import writes: the game data and its own record of each run (data_import, runImport below). */
export const IMPORT_WRITES = [...IMPORT_TABLES, 'data_import'] as const;
export interface Statement {
  table: Table;
  sql: string;
  /** Most rows it can write: its rows, each with one entry in every index on its table (D1 counts index writes). */
  bound: number;
}

const ROWS_PER_STATEMENT = 40;

/** Order 13, section D: rows a run may write, index writes included. A run stops before a group that would pass it. */
export const WRITE_CEILING = 40_000;

/**
 * The import's statements in groups, in write order. A run that reaches the write ceiling stops between groups, never
 * inside one, and never skips ahead (a later group can depend on an earlier one: recipes name items). Each item and mob
 * row is written whole by one statement; the recipes and their components are one group.
 * With `ex`, item and mob rows that would not change are left out (itemDiffers / mobDiffers, as the dry run predicts);
 * the statements' own "differs" guards still apply, so a re-run on unchanged data writes 0 rows.
 */
export function buildGroups(plan: Plan, importedAt: string, ex?: ExistingState): Statement[][] {
  const groups: Statement[][] = [];
  const at = lit(importedAt);
  const bound = (table: Table, rows: number) => rows * (1 + (ex?.indexes[table] ?? 0));
  const stmt = (table: Table, rows: number, sql: string): Statement => ({ table, sql, bound: bound(table, rows) });

  groups.push(
    chunk(plan.tradeskills, ROWS_PER_STATEMENT).map((rows) =>
      stmt(
        'tradeskill',
        rows.length,
        `INSERT INTO tradeskill (name, kind, sort_order) VALUES ${rows.map((t) => `(${lit(t.name)}, 'crafting', ${t.sort_order})`).join(', ')} ` +
          `ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, sort_order = excluded.sort_order ` +
          `WHERE tradeskill.kind IS NOT excluded.kind OR tradeskill.sort_order IS NOT excluded.sort_order`,
      ),
    ),
  );
  // Classes before items: an item's class_mask names bits that game_class holds. Bits are never reassigned.
  groups.push([
    ...chunk(plan.classes.kept, ROWS_PER_STATEMENT).map((rows) =>
      stmt(
        'game_class',
        rows.length,
        `INSERT INTO game_class (code, item_count, bit) VALUES ${rows.map((c) => `(${lit(c.code)}, ${c.item_count}, ${lit(plan.classBits.get(c.code) ?? null)})`).join(', ')} ` +
          `ON CONFLICT(code) DO UPDATE SET item_count = excluded.item_count, bit = excluded.bit ` +
          `WHERE game_class.item_count IS NOT excluded.item_count OR game_class.bit IS NOT excluded.bit`,
      ),
    ),
    ...chunk(plan.classDeactivate, ROWS_PER_STATEMENT).map((codes) =>
      stmt('game_class', codes.length, `UPDATE game_class SET item_count = 0 WHERE item_count <> 0 AND code IN (${codes.map(lit).join(', ')})`),
    ),
  ]);
  const items = ex ? plan.items.filter((i) => itemDiffers(ex.items.get(i.name_key), i)) : plan.items;
  for (const rows of chunk(items, ROWS_PER_STATEMENT))
    groups.push([
      stmt(
        'item',
        rows.length,
        `INSERT INTO item (name, name_key, icon_url, slot, stats_json, wiki_url, source, imported_at, class_mask, slot_mask, source_mask, origin_json) VALUES ` +
          rows
            .map(
              (i) =>
                `(${lit(i.name)}, ${lit(i.name_key)}, ${lit(i.icon_url)}, ${lit(i.slot)}, ${lit(i.stats_json)}, ${lit(i.wiki_url)}, 'wiki', ${at}, ` +
                `${i.class_mask}, ${i.slot_mask}, ${i.source_mask}, ${lit(i.origin_json)})`,
            )
            .join(', ') +
          ` ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, icon_url = excluded.icon_url, slot = excluded.slot, ` +
          `stats_json = excluded.stats_json, wiki_url = excluded.wiki_url, source = excluded.source, imported_at = excluded.imported_at, ` +
          `class_mask = excluded.class_mask, slot_mask = excluded.slot_mask, source_mask = excluded.source_mask, origin_json = excluded.origin_json ` +
          `WHERE item.name IS NOT excluded.name OR item.icon_url IS NOT excluded.icon_url OR item.slot IS NOT excluded.slot ` +
          `OR item.stats_json IS NOT excluded.stats_json OR item.wiki_url IS NOT excluded.wiki_url OR item.source IS NOT excluded.source ` +
          `OR item.class_mask IS NOT excluded.class_mask OR item.slot_mask IS NOT excluded.slot_mask ` +
          `OR item.source_mask IS NOT excluded.source_mask OR item.origin_json IS NOT excluded.origin_json`,
      ),
    ]);
  // Stub rows are only created, never overwritten: a stored record (wiki or stub) always wins.
  const stubs = ex ? plan.stubs.filter((s) => !ex.items.has(s.name_key)) : plan.stubs;
  for (const rows of chunk(stubs, ROWS_PER_STATEMENT))
    groups.push([
      stmt(
        'item',
        rows.length,
        `INSERT INTO item (name, name_key, source, imported_at) VALUES ` + rows.map((s) => `(${lit(s.name)}, ${lit(s.name_key)}, 'stub', ${at})`).join(', ') + ` ON CONFLICT(name_key) DO NOTHING`,
      ),
    ]);
  const out: Statement[] = [];
  groups.push(out);
  const recipeId = (k: string) => `(SELECT id FROM recipe WHERE source_key = ${lit(k)})`;
  const itemId = (k: string) => `(SELECT id FROM item WHERE name_key = ${lit(k)})`;
  for (const rows of chunk(plan.recipes, ROWS_PER_STATEMENT))
    out.push({
      bound: bound('recipe', rows.length),
      table: 'recipe',
      sql:
        `INSERT INTO recipe (source_key, tradeskill_id, result_item_id, result_qty, trivial, trivial_unconfirmed, unknown_components, source, active, imported_at) VALUES ` +
        rows
          .map(
            (r) =>
              `(${lit(r.source_key)}, (SELECT id FROM tradeskill WHERE name = ${lit(r.tradeskill)}), ${itemId(r.result_key)}, ${r.result_qty}, ` +
              `${lit(r.trivial)}, ${lit(r.trivial_unconfirmed)}, ${lit(r.unknown_components)}, 'wiki', 1, ${at})`,
          )
          .join(', ') +
        ` ON CONFLICT(source_key) DO UPDATE SET tradeskill_id = excluded.tradeskill_id, result_item_id = excluded.result_item_id, ` +
        `result_qty = excluded.result_qty, trivial = excluded.trivial, trivial_unconfirmed = excluded.trivial_unconfirmed, ` +
        `unknown_components = excluded.unknown_components, active = 1, imported_at = excluded.imported_at ` +
        `WHERE recipe.source = 'wiki' AND (recipe.tradeskill_id IS NOT excluded.tradeskill_id OR recipe.result_item_id IS NOT excluded.result_item_id ` +
        `OR recipe.result_qty IS NOT excluded.result_qty OR recipe.trivial IS NOT excluded.trivial ` +
        `OR recipe.trivial_unconfirmed IS NOT excluded.trivial_unconfirmed OR recipe.unknown_components IS NOT excluded.unknown_components ` +
        `OR recipe.active IS NOT 1)`,
    });
  const comps = plan.recipes.flatMap((r) => [...r.components].map(([k, q]) => ({ r: r.source_key, k, q })));
  for (const rows of chunk(comps, ROWS_PER_STATEMENT))
    out.push(
      stmt(
        'recipe_component',
        rows.length,
        `INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES ` +
          rows.map((c) => `(${recipeId(c.r)}, ${itemId(c.k)}, ${c.q})`).join(', ') +
          ` ON CONFLICT(recipe_id, item_id) DO UPDATE SET qty = excluded.qty WHERE recipe_component.qty IS NOT excluded.qty`,
      ),
    );
  for (const d of plan.componentDeletes)
    out.push(
      stmt(
        'recipe_component',
        d.item_keys.length,
        `DELETE FROM recipe_component WHERE recipe_id = ${recipeId(d.source_key)} AND item_id IN (${d.item_keys.map(itemId).join(', ')})`,
      ),
    );
  for (const keys of chunk(plan.deactivate, ROWS_PER_STATEMENT))
    out.push(stmt('recipe', keys.length, `UPDATE recipe SET active = 0 WHERE source = 'wiki' AND active = 1 AND source_key IN (${keys.map(lit).join(', ')})`));
  const mobs = ex ? plan.mobs.filter((m) => mobDiffers(ex.mobs.get(nameKey(m.key)), m)) : plan.mobs;
  for (const rows of chunk(mobs, ROWS_PER_STATEMENT))
    groups.push([
      stmt(
        'mob',
        rows.length,
        `INSERT INTO mob (key, title, level, race, class, image_url, zones_json, loot_json, active) VALUES ` +
          rows
            .map((m) => `(${lit(m.key)}, ${lit(m.title)}, ${lit(m.level)}, ${lit(m.race)}, ${lit(m.class)}, ${lit(m.image_url)}, ${lit(m.zones_json)}, ${lit(m.loot_json)}, 1)`)
            .join(', ') +
          ` ON CONFLICT(key) DO UPDATE SET key = excluded.key, title = excluded.title, level = excluded.level, race = excluded.race, class = excluded.class, ` +
          `image_url = excluded.image_url, zones_json = excluded.zones_json, loot_json = excluded.loot_json, active = 1 ` +
          // key and title are NOCASE columns: compared as written, so a case change is written (as mobDiffers sees it).
          `WHERE mob.key IS NOT excluded.key COLLATE BINARY OR mob.title IS NOT excluded.title COLLATE BINARY OR mob.level IS NOT excluded.level OR mob.race IS NOT excluded.race ` +
          `OR mob.class IS NOT excluded.class OR mob.image_url IS NOT excluded.image_url OR mob.zones_json IS NOT excluded.zones_json ` +
          `OR mob.loot_json IS NOT excluded.loot_json OR mob.active IS NOT 1`,
      ),
    ]);
  for (const keys of chunk(plan.mobDeactivate, ROWS_PER_STATEMENT))
    groups.push([stmt('mob', keys.length, `UPDATE mob SET active = 0 WHERE active = 1 AND key IN (${keys.map(lit).join(', ')})`)]);
  return groups.filter((g) => g.length > 0);
}

export const buildStatements = (plan: Plan, importedAt: string, ex?: ExistingState): Statement[] => buildGroups(plan, importedAt, ex).flat();

// ---------------------------------------------------------------- existing state

export async function loadExisting(db: Db): Promise<ExistingState> {
  const ts = await db.all<{ name: string; kind: string; sort_order: number }>('SELECT name, kind, sort_order FROM tradeskill');
  const its = await db.all<StoredItem & { name_key: string }>(
    'SELECT name, name_key, icon_url, slot, stats_json, wiki_url, source, class_mask, slot_mask, source_mask, origin_json FROM item',
  );
  const ms = await db.all<StoredMob>('SELECT key, title, level, race, class, image_url, zones_json, loot_json, active FROM mob');
  // The live schema's indexes per table (the write bound): every index, partial or not, counts.
  const idx = await db.all<{ t: string; n: number }>("SELECT tbl_name AS t, count(*) AS n FROM sqlite_master WHERE type = 'index' GROUP BY tbl_name");
  const rs = await db.all<{
    source_key: string; active: number; tradeskill: string; result_key: string; result_qty: number; trivial: number | null;
    trivial_unconfirmed: number; unknown_components: number; item_key: string | null; qty: number | null;
  }>(
    `SELECT r.source_key, r.active, t.name AS tradeskill, ri.name_key AS result_key, r.result_qty, r.trivial,
            r.trivial_unconfirmed, r.unknown_components, ci.name_key AS item_key, c.qty
     FROM recipe r JOIN tradeskill t ON t.id = r.tradeskill_id JOIN item ri ON ri.id = r.result_item_id
     LEFT JOIN recipe_component c ON c.recipe_id = r.id LEFT JOIN item ci ON ci.id = c.item_id
     WHERE r.source = 'wiki'`,
  );
  const cls = await db.all<{ code: string; item_count: number; bit: number | null }>('SELECT code, item_count, bit FROM game_class');
  const recipes = new Map<string, ExistingRecipe>();
  for (const row of rs) {
    let r = recipes.get(row.source_key);
    if (!r) {
      r = {
        source_key: row.source_key,
        variant: parseSourceKey(row.source_key).variant,
        active: row.active === 1,
        tradeskill: row.tradeskill,
        result_key: row.result_key,
        result_qty: row.result_qty,
        trivial: row.trivial,
        // Read back as integers so the comparison with the plan is exact (second run writes 0).
        trivial_unconfirmed: Number(row.trivial_unconfirmed),
        unknown_components: Number(row.unknown_components),
        components: new Map(),
      };
      recipes.set(row.source_key, r);
    }
    if (row.item_key !== null && row.qty !== null) r.components.set(row.item_key, row.qty);
  }
  return {
    tradeskills: new Map(ts.map((t) => [t.name, { kind: t.kind, sort_order: t.sort_order }])),
    // Masks read back as integers so the comparison with the plan is exact (second run writes 0).
    items: new Map(
      its.map(({ name_key, ...i }) => [name_key, { ...i, class_mask: Number(i.class_mask), slot_mask: Number(i.slot_mask), source_mask: Number(i.source_mask) }]),
    ),
    recipes,
    activeWikiRecipes: [...recipes.values()].filter((r) => r.active).length,
    classes: new Map(cls.map((c) => [c.code, { item_count: Number(c.item_count), bit: c.bit === null ? null : Number(c.bit) }])),
    mobs: new Map(ms.map((m) => [nameKey(m.key), { ...m, active: Number(m.active) }])),
    indexes: Object.fromEntries(idx.map((r) => [r.t, Number(r.n)])),
  };
}

// ---------------------------------------------------------------- run

export interface ImportOptions {
  /** Commit SHA of the source file, resolved at run time. */
  sourceSha: string;
  now: () => string;
  /** Plan and predict only. Writes nothing but its own completed data_import row (status 'dry-run'). */
  dryRun?: boolean;
  /** Refuse a real write while data_import holds no completed dry-run row (the remote database). */
  requireDryRun?: boolean;
  /** Rows this run may write (default WRITE_CEILING). */
  writeCeiling?: number;
}

export interface ImportResult {
  status: Exclude<ImportStatus, 'running'>;
  sourceVersion: string;
  error?: string;
  counts?: {
    sourceItems: number;
    items: number;
    stubItems: number;
    sourceRecipes: number;
    recipes: number;
    duplicatesCollapsed: number;
    recipesWithVariantAbove1: number;
    components: number;
    tradeskills: { crafting: number; gathering: number };
    trivialKnown: number;
    itemNameCollisions: number;
    caseOnlyMatches: number;
    deactivated: number;
    trivialUnconfirmed: number;
    unknownComponentRows: number;
    scrolls: { skipped: number; adopted: number };
  };
  /** Also stored as JSON in data_import.warnings. */
  warnings?: Warning[];
  /** The class list written to game_class, and what the rule dropped. */
  classes?: ClassDerivation;
  gatheringCandidates?: string[];
  predicted?: Predicted;
  /** D1 response metadata summed per table (absent on dry runs and failures). */
  written?: Record<Table, { statements: number; rows_written: number; changes: number }>;
  /** Order 13: gear sources, overlaps, classes and mob matches. */
  gear?: GearSummary;
  /** Every row the run wrote (D1 rows_written, index writes included), its own data_import rows too. */
  rowsWritten?: number;
  /** Dry run: the most rows the planned statements could write (rows × (1 + indexes on their table)). */
  writeBound?: number;
  ceiling?: number;
}

/**
 * The alarm's state before the run that just finished: the newest earlier row in the alarm state (src/import-status.ts).
 * Every real run (ok, failed, refused) has written its own row by then, so that row is skipped. null: no earlier run.
 */
export async function previousImportFailing(db: Db): Promise<boolean | null> {
  const [prior] = await db.all<{ status: string }>(`SELECT status FROM data_import WHERE ${ALARM_IMPORT} ORDER BY id DESC LIMIT 1 OFFSET 1`);
  return prior ? isFailing(prior.status) : null;
}

/** Refuse a run that would deactivate most of the stored recipes (or mobs): a truncated source looks like this. */
const MIN_RECIPE_RATIO = 0.5;
/** Statements sent per D1 call while the write ceiling is not near (each call is measured before the next). */
const GROUP_BATCH = 50;

export async function runImport(db: Db, raw: unknown, opts: ImportOptions): Promise<ImportResult> {
  const startedAt = opts.now();
  const generatedAt = isObj(raw) && typeof raw.generatedAt === 'string' ? raw.generatedAt : 'unknown';
  const sourceVersion = `${opts.sourceSha} / ${generatedAt}`;
  const warnings: Warning[] = [];
  const warningsJson = () => (warnings.length ? lit(JSON.stringify(warnings)) : 'NULL');
  const fail = async (error: string): Promise<ImportResult> => {
    if (!opts.dryRun)
      await db.run([
        `INSERT INTO data_import (source, source_version, status, error, warnings, started_at, finished_at) VALUES (${lit(SOURCE)}, ${lit(sourceVersion)}, 'failed', ${lit(error.slice(0, 2000))}, ${warningsJson()}, ${lit(startedAt)}, ${lit(opts.now())})`,
      ]);
    return { status: 'failed', sourceVersion, error, warnings };
  };

  // The first real write to a database (e.g. by the nightly cron) must follow a dispatched dry run.
  if (!opts.dryRun && opts.requireDryRun) {
    const [row] = await db.all<{ n: number }>("SELECT count(*) AS n FROM data_import WHERE status = 'dry-run' AND finished_at IS NOT NULL");
    if (!row || row.n === 0) {
      // Order 9: a refused run leaves its own row, so the alarm can compare one refusal with the next.
      const error = 'no completed dry run in data_import: dispatch the import with dry_run first';
      await db.run([
        `INSERT INTO data_import (source, source_version, status, error, started_at, finished_at) VALUES (${lit(SOURCE)}, ${lit(sourceVersion)}, 'refused', ${lit(error)}, ${lit(startedAt)}, ${lit(opts.now())})`,
      ]);
      return { status: 'refused', sourceVersion, error };
    }
  }

  let data: WikiData;
  try {
    data = checkStructure(raw, warnings);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }

  const existing = await loadExisting(db);
  const plan = buildPlan(data, existing);
  warnings.push(...plan.warnings);
  if (existing.activeWikiRecipes > 0 && plan.recipes.length < existing.activeWikiRecipes * MIN_RECIPE_RATIO)
    return fail(`implausible drop: ${plan.recipes.length} recipes against ${existing.activeWikiRecipes} active stored`);
  const activeMobs = [...existing.mobs.values()].filter((m) => m.active === 1).length;
  if (activeMobs > 0 && plan.mobs.length < activeMobs * MIN_RECIPE_RATIO)
    return fail(`implausible drop: ${plan.mobs.length} mobs against ${activeMobs} active stored`);

  const counts: NonNullable<ImportResult['counts']> = {
    sourceItems: Object.keys(data.items).length,
    items: plan.items.length,
    stubItems: plan.stubs.length,
    sourceRecipes: plan.sourceRecipes,
    recipes: plan.recipes.length,
    duplicatesCollapsed: plan.duplicatesCollapsed,
    recipesWithVariantAbove1: plan.recipes.filter((r) => parseSourceKey(r.source_key).variant > 1).length,
    components: plan.recipes.reduce((n, r) => n + r.components.size, 0),
    tradeskills: { crafting: plan.tradeskills.length, gathering: 0 },
    trivialKnown: plan.recipes.filter((r) => r.trivial !== null).length,
    itemNameCollisions: plan.itemNameCollisions,
    caseOnlyMatches: plan.caseOnlyMatches,
    deactivated: plan.deactivate.length,
    trivialUnconfirmed: plan.recipes.filter((r) => r.trivial_unconfirmed === 1).length,
    unknownComponentRows: plan.recipes.reduce((n, r) => n + r.unknown_components, 0),
    scrolls: plan.scrolls,
  };
  const predicted = predict(plan, existing);
  if (opts.dryRun) {
    await db.run([
      `INSERT INTO data_import (source, source_version, items, recipes, status, warnings, started_at, finished_at) VALUES (${lit(SOURCE)}, ${lit(sourceVersion)}, ${counts.items + counts.stubItems}, ${counts.recipes}, 'dry-run', ${warningsJson()}, ${lit(startedAt)}, ${lit(opts.now())})`,
    ]);
    const bound = buildGroups(plan, startedAt, existing).flat().reduce((n, s) => n + s.bound, 0);
    return {
      status: 'dry-run',
      sourceVersion,
      counts,
      warnings,
      classes: plan.classes,
      gear: plan.gear,
      gatheringCandidates: plan.gatheringCandidates,
      predicted,
      writeBound: bound,
      ceiling: opts.writeCeiling ?? WRITE_CEILING,
    };
  }

  const [opened] = await db.run([
    `INSERT INTO data_import (source, source_version, status, warnings, started_at) VALUES (${lit(SOURCE)}, ${lit(sourceVersion)}, 'running', ${warningsJson()}, ${lit(startedAt)})`,
  ]);
  const runRow = `(SELECT max(id) FROM data_import WHERE status = 'running' AND started_at = ${lit(startedAt)})`;
  const written = Object.fromEntries(IMPORT_TABLES.map((t) => [t, { statements: 0, rows_written: 0, changes: 0 }])) as NonNullable<ImportResult['written']>;
  // Order 13, section D: spent counts every row this run writes, its own data_import rows included. A group runs only
  // when spent plus the group's bound stays within the ceiling; groups are sent together while their bounds fit.
  const ceiling = opts.writeCeiling ?? WRITE_CEILING;
  const CLOSE_BOUND = 1 + (existing.indexes.data_import ?? 0); // the closing data_import UPDATE
  let spent = opened.rows_written;
  const groups = buildGroups(plan, startedAt, existing);
  let next = 0;
  try {
    while (next < groups.length) {
      const batch: Statement[] = [];
      let bound = 0;
      while (next < groups.length) {
        const g = groups[next];
        const b = g.reduce((n, s) => n + s.bound, 0);
        if (spent + bound + b + CLOSE_BOUND > ceiling) break;
        batch.push(...g);
        bound += b;
        next++;
        if (batch.length >= GROUP_BATCH) break;
      }
      if (!batch.length) break; // the next group does not fit what is left: stop here, resume on the next run
      const metas = await db.run(batch.map((s) => s.sql));
      if (metas.length !== batch.length) throw new Error(`D1 returned ${metas.length} results for ${batch.length} statements`);
      metas.forEach((m, i) => {
        const w = written[batch[i].table];
        w.statements++;
        w.rows_written += m.rows_written;
        w.changes += m.changes;
        spent += m.rows_written;
      });
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.run([`UPDATE data_import SET status = 'failed', error = ${lit(error.slice(0, 2000))}, finished_at = ${lit(opts.now())} WHERE id = ${runRow}`]);
    return { status: 'failed', sourceVersion, error, counts, warnings, predicted, written };
  }
  const deferred = groups.slice(next).flat();
  if (deferred.length) {
    const deferredBound = deferred.reduce((n, s) => n + s.bound, 0);
    if (next === 0 && groups[0].reduce((n, s) => n + s.bound, 0) > ceiling) {
      // A group larger than the whole ceiling would never be written: fail loudly instead of stalling every night.
      const error = `write ceiling ${ceiling} is below the first group's bound; nothing written`;
      await db.run([`UPDATE data_import SET status = 'failed', error = ${lit(error)}, finished_at = ${lit(opts.now())} WHERE id = ${runRow}`]);
      return { status: 'failed', sourceVersion, error, counts, warnings, predicted, written };
    }
    warnings.push({ kind: 'write_ceiling', ceiling, written: spent, deferredStatements: deferred.length, deferredBound });
  }
  const status = deferred.length ? 'partial' : 'ok';
  const [closed] = await db.run([
    `UPDATE data_import SET status = '${status}', items = ${counts.items + counts.stubItems}, recipes = ${counts.recipes}, warnings = ${warningsJson()}, finished_at = ${lit(opts.now())} WHERE id = ${runRow}`,
  ]);
  spent += closed.rows_written;
  return {
    status,
    sourceVersion,
    counts,
    warnings,
    classes: plan.classes,
    gear: plan.gear,
    gatheringCandidates: plan.gatheringCandidates,
    predicted,
    written,
    rowsWritten: spent,
    ceiling,
  };
}

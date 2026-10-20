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
  | { kind: 'unmatched_component_names'; count: number; names: string[] };

// The source's fields as of mnm-tools e19cc75 (2026-10-19). A field outside these lists is a
// warning, not a failure, so the next source change names itself in data_import.warnings.
const KNOWN_FIELDS = {
  top: ['generatedAt', 'items', 'mobs', 'nodes', 'recipes'],
  recipe: ['tradeskill', 'result', 'components', 'trivial', 'trivialUnconfirmed', 'fromItemPage'],
  component: ['item', 'qty'],
  item: ['ac', 'categories', 'class', 'container', 'delay', 'dmg', 'effect', 'flags', 'from', 'fromImport', 'fromTrade',
    'handed', 'harvestedBy', 'hasPage', 'haste', 'hp', 'hpRegen', 'icon', 'iconId', 'instr', 'mana', 'manaRegen', 'race',
    'resists', 'size', 'skill', 'slot', 'soldBy', 'stats', 'statsV', 'tradeskills', 'weight', 'wikiOnly', 'wikiZones'],
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
export interface WikiData {
  generatedAt: string;
  items: Record<string, WikiItem>;
  recipes: WikiRecipe[];
  nodes: Record<string, { yields?: { section?: string }[] }>;
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
 * Gathering candidates — reported only, never inserted (CHECKLIST A6 is Brian's open question).
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
const CLASS_IGNORED = new Set(['ALL', 'NONE']);

export interface ClassDerivation {
  /** Items whose class is a non-empty string (the denominator). */
  carrying: number;
  kept: { code: string; item_count: number }[];
  /** Codes below CLASS_MIN_SHARE, with the items carrying them. */
  dropped: { code: string; items: number }[];
  /** Raw tokens that yield no code: ALL, NONE, or nothing left before a '<'. */
  ignored: { token: string; items: number }[];
}

/**
 * The game's classes, derived from items' class tokens (never typed): upper-case each token, cut it
 * at the first '<' (wiki markup such as "SHD<br>"), drop ALL and NONE, and keep a code carried by at
 * least CLASS_MIN_SHARE of the items that carry a class. Counts are items, not token occurrences.
 */
export function deriveClasses(data: WikiData): ClassDerivation {
  let carrying = 0;
  const codes = new Map<string, number>();
  const ignored = new Map<string, number>();
  for (const it of Object.values(data.items)) {
    if (typeof it.class !== 'string' || it.class.trim() === '') continue;
    carrying++;
    const seen = new Set<string>();
    for (const token of it.class.split(/\s+/)) {
      if (!token) continue;
      const code = token.toUpperCase().replace(/<.*$/s, '');
      if (!code || CLASS_IGNORED.has(code)) ignored.set(token, (ignored.get(token) ?? 0) + 1);
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
}

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
  items: Map<string, { name: string; icon_url: string | null; slot: string | null; stats_json: string | null; wiki_url: string | null; source: string }>;
  recipes: Map<string, ExistingRecipe>; // by source_key, source = 'wiki' only
  activeWikiRecipes: number;
  classes: Map<string, number>; // game_class code -> item_count (0 = no longer kept)
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
  const classDeactivate = [...existing.classes].filter(([code, n]) => n > 0 && !keptCodes.has(code)).map(([code]) => code).sort();

  return {
    classes,
    classDeactivate,
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
}

export function predict(plan: Plan, ex: ExistingState): Predicted {
  const p: Predicted = {
    tradeskill: { insert: 0, update: 0 },
    item: { insert: 0, update: 0 },
    stub: { insert: 0 },
    recipe: { insert: 0, update: 0, deactivate: plan.deactivate.length },
    recipe_component: { insert: 0, update: 0, delete: plan.componentDeletes.reduce((n, d) => n + d.item_keys.length, 0) },
    game_class: { insert: 0, update: 0, deactivate: plan.classDeactivate.length },
  };
  for (const c of plan.classes.kept) {
    const o = ex.classes.get(c.code);
    if (o === undefined) p.game_class.insert++;
    else if (o !== c.item_count) p.game_class.update++;
  }
  for (const t of plan.tradeskills) {
    const o = ex.tradeskills.get(t.name);
    if (!o) p.tradeskill.insert++;
    else if (o.kind !== 'crafting' || o.sort_order !== t.sort_order) p.tradeskill.update++;
  }
  for (const it of plan.items) {
    const o = ex.items.get(it.name_key);
    if (!o) p.item.insert++;
    else if (o.name !== it.name || o.icon_url !== it.icon_url || o.slot !== it.slot || o.stats_json !== it.stats_json || o.wiki_url !== it.wiki_url || o.source !== 'wiki')
      p.item.update++;
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

export type Table = 'tradeskill' | 'item' | 'recipe' | 'recipe_component' | 'game_class';
export interface Statement {
  table: Table;
  sql: string;
}

const ROWS_PER_STATEMENT = 40;

export function buildStatements(plan: Plan, importedAt: string): Statement[] {
  const out: Statement[] = [];
  const at = lit(importedAt);
  for (const rows of chunk(plan.tradeskills, ROWS_PER_STATEMENT))
    out.push({
      table: 'tradeskill',
      sql:
        `INSERT INTO tradeskill (name, kind, sort_order) VALUES ${rows.map((t) => `(${lit(t.name)}, 'crafting', ${t.sort_order})`).join(', ')} ` +
        `ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, sort_order = excluded.sort_order ` +
        `WHERE tradeskill.kind IS NOT excluded.kind OR tradeskill.sort_order IS NOT excluded.sort_order`,
    });
  for (const rows of chunk(plan.items, ROWS_PER_STATEMENT))
    out.push({
      table: 'item',
      sql:
        `INSERT INTO item (name, name_key, icon_url, slot, stats_json, wiki_url, source, imported_at) VALUES ` +
        rows.map((i) => `(${lit(i.name)}, ${lit(i.name_key)}, ${lit(i.icon_url)}, ${lit(i.slot)}, ${lit(i.stats_json)}, ${lit(i.wiki_url)}, 'wiki', ${at})`).join(', ') +
        ` ON CONFLICT(name_key) DO UPDATE SET name = excluded.name, icon_url = excluded.icon_url, slot = excluded.slot, ` +
        `stats_json = excluded.stats_json, wiki_url = excluded.wiki_url, source = excluded.source, imported_at = excluded.imported_at ` +
        `WHERE item.name IS NOT excluded.name OR item.icon_url IS NOT excluded.icon_url OR item.slot IS NOT excluded.slot ` +
        `OR item.stats_json IS NOT excluded.stats_json OR item.wiki_url IS NOT excluded.wiki_url OR item.source IS NOT excluded.source`,
    });
  // Stub rows are only created, never overwritten: a stored record (wiki or stub) always wins.
  for (const rows of chunk(plan.stubs, ROWS_PER_STATEMENT))
    out.push({
      table: 'item',
      sql:
        `INSERT INTO item (name, name_key, source, imported_at) VALUES ` +
        rows.map((s) => `(${lit(s.name)}, ${lit(s.name_key)}, 'stub', ${at})`).join(', ') +
        ` ON CONFLICT(name_key) DO NOTHING`,
    });
  const recipeId = (k: string) => `(SELECT id FROM recipe WHERE source_key = ${lit(k)})`;
  const itemId = (k: string) => `(SELECT id FROM item WHERE name_key = ${lit(k)})`;
  for (const rows of chunk(plan.recipes, ROWS_PER_STATEMENT))
    out.push({
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
    out.push({
      table: 'recipe_component',
      sql:
        `INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES ` +
        rows.map((c) => `(${recipeId(c.r)}, ${itemId(c.k)}, ${c.q})`).join(', ') +
        ` ON CONFLICT(recipe_id, item_id) DO UPDATE SET qty = excluded.qty WHERE recipe_component.qty IS NOT excluded.qty`,
    });
  for (const d of plan.componentDeletes)
    out.push({
      table: 'recipe_component',
      sql: `DELETE FROM recipe_component WHERE recipe_id = ${recipeId(d.source_key)} AND item_id IN (${d.item_keys.map(itemId).join(', ')})`,
    });
  for (const keys of chunk(plan.deactivate, ROWS_PER_STATEMENT))
    out.push({
      table: 'recipe',
      sql: `UPDATE recipe SET active = 0 WHERE source = 'wiki' AND active = 1 AND source_key IN (${keys.map(lit).join(', ')})`,
    });
  for (const rows of chunk(plan.classes.kept, ROWS_PER_STATEMENT))
    out.push({
      table: 'game_class',
      sql:
        `INSERT INTO game_class (code, item_count) VALUES ${rows.map((c) => `(${lit(c.code)}, ${c.item_count})`).join(', ')} ` +
        `ON CONFLICT(code) DO UPDATE SET item_count = excluded.item_count WHERE game_class.item_count IS NOT excluded.item_count`,
    });
  for (const codes of chunk(plan.classDeactivate, ROWS_PER_STATEMENT))
    out.push({
      table: 'game_class',
      sql: `UPDATE game_class SET item_count = 0 WHERE item_count <> 0 AND code IN (${codes.map(lit).join(', ')})`,
    });
  return out;
}

// ---------------------------------------------------------------- existing state

export async function loadExisting(db: Db): Promise<ExistingState> {
  const ts = await db.all<{ name: string; kind: string; sort_order: number }>('SELECT name, kind, sort_order FROM tradeskill');
  const its = await db.all<{ name: string; name_key: string; icon_url: string | null; slot: string | null; stats_json: string | null; wiki_url: string | null; source: string }>(
    'SELECT name, name_key, icon_url, slot, stats_json, wiki_url, source FROM item',
  );
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
  const cls = await db.all<{ code: string; item_count: number }>('SELECT code, item_count FROM game_class');
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
    items: new Map(its.map((i) => [i.name_key, i])),
    recipes,
    activeWikiRecipes: [...recipes.values()].filter((r) => r.active).length,
    classes: new Map(cls.map((c) => [c.code, Number(c.item_count)])),
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
}

/**
 * The alarm's state before the run that just finished: the newest earlier row in the alarm state (src/import-status.ts).
 * Every real run (ok, failed, refused) has written its own row by then, so that row is skipped. null: no earlier run.
 */
export async function previousImportFailing(db: Db): Promise<boolean | null> {
  const [prior] = await db.all<{ status: string }>(`SELECT status FROM data_import WHERE ${ALARM_IMPORT} ORDER BY id DESC LIMIT 1 OFFSET 1`);
  return prior ? isFailing(prior.status) : null;
}

/** Refuse a run that would deactivate most of the stored recipes: a truncated source looks like this. */
const MIN_RECIPE_RATIO = 0.5;

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
    return { status: 'dry-run', sourceVersion, counts, warnings, classes: plan.classes, gatheringCandidates: plan.gatheringCandidates, predicted };
  }

  await db.run([
    `INSERT INTO data_import (source, source_version, status, warnings, started_at) VALUES (${lit(SOURCE)}, ${lit(sourceVersion)}, 'running', ${warningsJson()}, ${lit(startedAt)})`,
  ]);
  const runRow = `(SELECT max(id) FROM data_import WHERE status = 'running' AND started_at = ${lit(startedAt)})`;
  const statements = buildStatements(plan, startedAt);
  const written = {
    tradeskill: { statements: 0, rows_written: 0, changes: 0 },
    item: { statements: 0, rows_written: 0, changes: 0 },
    recipe: { statements: 0, rows_written: 0, changes: 0 },
    recipe_component: { statements: 0, rows_written: 0, changes: 0 },
    game_class: { statements: 0, rows_written: 0, changes: 0 },
  };
  try {
    const metas = await db.run(statements.map((s) => s.sql));
    if (metas.length !== statements.length) throw new Error(`D1 returned ${metas.length} results for ${statements.length} statements`);
    metas.forEach((m, i) => {
      const w = written[statements[i].table];
      w.statements++;
      w.rows_written += m.rows_written;
      w.changes += m.changes;
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.run([`UPDATE data_import SET status = 'failed', error = ${lit(error.slice(0, 2000))}, finished_at = ${lit(opts.now())} WHERE id = ${runRow}`]);
    return { status: 'failed', sourceVersion, error, counts, warnings, predicted };
  }
  await db.run([
    `UPDATE data_import SET status = 'ok', items = ${counts.items + counts.stubItems}, recipes = ${counts.recipes}, finished_at = ${lit(opts.now())} WHERE id = ${runRow}`,
  ]);
  return { status: 'ok', sourceVersion, counts, warnings, classes: plan.classes, gatheringCandidates: plan.gatheringCandidates, predicted, written };
}

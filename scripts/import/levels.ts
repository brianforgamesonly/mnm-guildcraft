// Order 35 (docs/PRD.md "Gear upgrades"): an item's level, derived on every import, never typed. Pure TypeScript, computed
// in memory from tables the import has already read once (wiki.json's items, mobs and recipes; the zone plan's NPCs, zones
// and zone names; the wiki snapshot's quest bucket). No D1 query per item or component.
//
// Kinds, each worked out separately, then the primary one chosen (PRIMARY_ORDER):
//   mob            the item's dropping creatures with a parseable level (a creature's level: its mob row's when that
//                  parses, else its NPC rows' by name, case-insensitive). Low = the lowest low, high = the highest high.
//   zone           no dropping creature has a level, but their zones do (mob zones through zone_name, NPC rows' own zone).
//   vendor         sold by a vendor (soldBy). Level 0: "any level".
//   harvest        harvested (harvestedBy). Level 0: "any level".
//   crafted        a recipe result whose chosen recipe has a source for every component: the recipe's highest component level.
//   crafted_floor  a recipe result with no such recipe: the highest known component level is a floor (high NULL), or NULL.
//   quest          a quest reward (a Quest category, or a reward line of the snapshot's quest bucket); the lowest
//                  quest_min_level of the quests that reward it, when one is recorded.
//   unknown        none of these.
// A dropping creature is any name the data links to the item as a drop: the item's `from` list, a mob whose loot names it,
// an NPC row whose loot names it. Nothing is matched by anything but the name, case-insensitive.

import { questionReading, UNKNOWN_TOP, type QuestionReading } from '../../src/level-text.ts';
import { MOB_ZONES_SOURCE } from '../../src/zone/names.ts';

export const LEVEL_FLOOR = 1;
export const LEVEL_CEILING = 80;
/** A recipe chain is followed this many components deep; a component past it (or in a cycle) has no source. */
export const MAX_DEPTH = 6;

export const KINDS = ['mob', 'zone', 'vendor', 'harvest', 'crafted', 'crafted_floor', 'quest', 'unknown'] as const;
export type Kind = (typeof KINDS)[number];
/** Ties between kinds with the same level go in this order; kinds with no level come after every kind with one. */
export const PRIMARY_ORDER: readonly Kind[] = ['mob', 'vendor', 'harvest', 'crafted', 'crafted_floor', 'quest', 'zone'];

export interface Range {
  low: number;
  /** null: open-ended ("N+", a crafted floor). */
  high: number | null;
}

// ---------------------------------------------------------------- parsing level text

export interface Parsed {
  range: Range | null;
  /** Integers from LEVEL_FLOOR to LEVEL_CEILING read from the text (more than two is reported). */
  integers: number;
}

/**
 * Level text as recorded ("3 - 10", "31-33", "~15", "Lv 5+", "[[Zone 2]] 10"): [[…]] links (their text too) and anything
 * in parentheses are removed first; then every integer from 1 to 80 is read; low = the smallest, high = the largest; an
 * integer followed by "+" makes high open (NULL). Text with no such integer is no level.
 * Order 41 (override 1 of docs/PRD.md's parsing rule): a top bound written only as question marks ("1 - ??", "5 - ?",
 * "15-?", "18-???": src/level-text.ts UNKNOWN_TOP) is unknown, so high is open (NULL), as "N+" does. A text of only
 * question marks has no integer, so it stays no level. A number followed by "?" ("15?", "42-44?") parses as before.
 */
export function parseLevel(text: string | number | null | undefined): Parsed {
  if (text === null || text === undefined) return { range: null, integers: 0 };
  let t = String(text).replace(/\[\[[^\]]*\]\]/g, ' ');
  for (let prev = ''; prev !== t; ) {
    prev = t;
    t = t.replace(/\([^()]*\)/g, ' ');
  }
  const found: { n: number; plus: boolean }[] = [];
  for (const m of t.matchAll(/(\d+)(\s*\+)?/g)) {
    const n = Number(m[1]);
    if (n >= LEVEL_FLOOR && n <= LEVEL_CEILING) found.push({ n, plus: m[2] !== undefined });
  }
  if (!found.length) return { range: null, integers: 0 };
  const ns = found.map((f) => f.n);
  const open = found.some((f) => f.plus) || UNKNOWN_TOP.test(t.trim());
  return { range: { low: Math.min(...ns), high: open ? null : Math.max(...ns) }, integers: found.length };
}

/** The union of ranges: the lowest low, the highest high (open if any is open). */
function union(rs: Range[]): Range | null {
  if (!rs.length) return null;
  return { low: Math.min(...rs.map((r) => r.low)), high: rs.some((r) => r.high === null) ? null : Math.max(...rs.map((r) => r.high as number)) };
}

// ---------------------------------------------------------------- input and output

export interface LevelInput {
  /** Every wiki item, by name_key. */
  items: { key: string; from: string[]; sold: boolean; harvested: boolean; questCategory: boolean }[];
  mobs: { key: string; title: string; level: string | null; zones: string[]; loot: string[] }[];
  npcs: { name: string; zone_key: string; level: string | null; loot: string[] }[];
  zones: { key: string; level: string | null }[];
  zoneNames: { source: string; name: string; zone_key: string | null }[];
  recipes: { result_key: string; components: Map<string, number>; unknown_components: number; id: number | null; source_key: string }[];
  quests: { title: string; minLevel: unknown; rewards: string[] }[];
}

export interface ItemLevel {
  level_low: number | null;
  level_high: number | null;
  level_kind: Kind;
  level_kinds: string;
}

/** What ITEM 3 reports, over the gear (items with a slot) the caller names. */
export interface LevelSummary {
  gear: number;
  /** Gear by primary kind. */
  byKind: Record<Kind, number>;
  /** Gear by primary kind, those with a level only. */
  byKindWithLevel: Record<Kind, number>;
  crafted: { results: number; full: number; floor: number; none: number };
  quest: { rewards: number; withLevel: number; withoutLevel: number };
  /** Section A's comparison: gear that is no recipe result. */
  nonCrafted: { items: number; mobLevel: number; dropNoLevel: number; noSource: number; vendorOnly: number };
  /** Level texts (mob, NPC, zone) with more than two integers, as parsed. */
  manyIntegers: { text: string; count: number; low: number; high: number | null }[];
  /** Level texts that did not parse, with how many rows hold each. */
  unparsed: { text: string; count: number }[];
  /**
   * Order 41: every level text (mob, NPC, zone) holding a question mark, with how many rows hold it and how it is read
   * (src/level-text.ts questionReading). A form nobody has ruled on shows up here as 'as recorded'.
   */
  questionMarks: { text: string; count: number; reading: QuestionReading }[];
  /** The components with no source in crafted gear's chosen recipes, by how many gear items' recipes hold them. */
  missingComponents: { key: string; items: number }[];
}

interface Result {
  kinds: Map<Kind, Range | null>;
  primary: { kind: Kind; range: Range | null };
  /** Deepest component level below this item (0: no recipe followed). */
  height: number;
  /** A cycle or the depth limit cut something off: the result depends on where it was asked from, so it is not kept. */
  cut: boolean;
  /** The chosen recipe's components with no source (for the summary). */
  missing: string[];
  /** The chosen recipe (its source_key), when the item is a recipe result. Not stored; returned for tests and part 2. */
  recipe: string | null;
}

const rank = (k: Kind) => {
  const i = PRIMARY_ORDER.indexOf(k);
  return i < 0 ? PRIMARY_ORDER.length : i;
};

/** The kinds in primary order: those with a level by lowest low, ties by PRIMARY_ORDER; then those without, by PRIMARY_ORDER. */
export function orderKinds(kinds: Map<Kind, Range | null>): Kind[] {
  return [...kinds.keys()].sort((a, b) => {
    const ra = kinds.get(a) ?? null;
    const rb = kinds.get(b) ?? null;
    if (ra && rb) return ra.low - rb.low || rank(a) - rank(b);
    if (ra) return -1;
    if (rb) return 1;
    return rank(a) - rank(b);
  });
}

const choose = (kinds: Map<Kind, Range | null>): { kind: Kind; range: Range | null } => {
  const [first] = orderKinds(kinds);
  return first ? { kind: first, range: kinds.get(first) ?? null } : { kind: 'unknown', range: null };
};

// ---------------------------------------------------------------- creatures (order 37: shared with the drop line)

/**
 * The import passes loot as lists. The Worker (src/gear/sources.ts) passes each row's loot_json as stored, so it never
 * parses every row's loot to draw one page: a row is parsed only when its text holds the item's name (lower-cased; a name
 * holding `"` or `\`, which JSON escapes, parses every row), and then matched exactly, as the lists are.
 */
type Loot = string[] | { json: string | null; lower?: string | null };
export interface CreatureInput {
  mobs: (Omit<LevelInput['mobs'][number], 'loot'> & { loot: Loot })[];
  npcs: (Omit<LevelInput['npcs'][number], 'loot'> & { loot: Loot })[];
  zoneNames: LevelInput['zoneNames'];
}

/** Where a creature is, and its level there: a mob row's zones (each at the mob's level), or each NPC row's zone. */
export interface Spot {
  zone_key: string;
  range: Range | null;
}

export interface CreatureIndex {
  /** A creature's level by lower-cased name: its mob row's when that parses, else the union of its NPC rows' (order 35). */
  level: (name: string) => Range | null;
  /** The zone keys a creature is in: its mob row's zones through zone_name (mobs' source), and its NPC rows' zones. */
  zones: (name: string) => string[];
  /** Where it is: the mob row's zones when the mob row's own level is the level, else the NPC rows (zone, level). */
  spots: (name: string) => Spot[];
  /** Every creature the data links to an item as a drop, lower-cased: its `from` list, then mobs and NPCs whose loot names it. */
  creaturesOf: (itemKey: string, from: string[]) => string[];
  /** A creature's name as the data writes it: a mob's title, else an NPC row's name. */
  display: (name: string) => string | undefined;
  /** Its mob row's own level, when that parses: then its NPC rows decide nothing (level, spots). */
  mobLevel: (name: string) => Range | null;
}

/**
 * Order 35's creature rules, in one place, so the import's item level and /gear upgrades' drop line read the same creatures
 * the same way (order 37, ITEM 1). `parse` is order 35's level parser (parseLevel); the import passes a counting wrapper.
 * Nothing is matched by anything but the name, case-insensitive.
 */
export function creatureIndex(
  input: CreatureInput,
  parse: (text: string | null) => Range | null = (t) => parseLevel(t).range,
  /** The import parses every level once, up front, so its summary counts every level text (order 35's report). */
  eager = false,
): CreatureIndex {
  const lower = (s: string) => s.toLowerCase();
  type Mob = CreatureInput['mobs'][number];
  type Npc = CreatureInput['npcs'][number];
  const mobZoneKey = new Map(input.zoneNames.filter((n) => n.source === MOB_ZONES_SOURCE && n.zone_key).map((n) => [n.name, n.zone_key as string]));
  const mobByKey = new Map(input.mobs.map((m) => [lower(m.key), m]));
  const mobByTitle = new Map<string, Mob>();
  for (const m of input.mobs) if (!mobByTitle.has(lower(m.title))) mobByTitle.set(lower(m.title), m);
  const npcsByName = new Map<string, Npc[]>();
  for (const n of input.npcs) {
    const k = lower(n.name);
    if (!npcsByName.has(k)) npcsByName.set(k, []);
    npcsByName.get(k)!.push(n);
  }
  // Each row's level is parsed once (parse is order 35's parser, or the import's counting wrapper of it).
  const parsed = new Map<Mob | Npc, Range | null>();
  const levelOf = (row: Mob | Npc) => {
    if (!parsed.has(row)) parsed.set(row, parse(row.level));
    return parsed.get(row) ?? null;
  };
  if (eager) {
    for (const m of input.mobs) levelOf(m);
    for (const n of input.npcs) levelOf(n);
  }
  const mobOf = (name: string) => mobByKey.get(name) ?? mobByTitle.get(name);
  const level = (name: string): Range | null => {
    const mob = mobOf(name);
    const own = mob ? levelOf(mob) : null;
    if (own) return own;
    return union((npcsByName.get(name) ?? []).map(levelOf).filter((r): r is Range => r !== null));
  };
  const zones = (name: string): string[] => {
    const mob = mobOf(name);
    const keys = new Set<string>();
    for (const z of mob?.zones ?? []) {
      const k = mobZoneKey.get(z);
      if (k) keys.add(k);
    }
    for (const n of npcsByName.get(name) ?? []) keys.add(n.zone_key);
    return [...keys];
  };
  const spots = (name: string): Spot[] => {
    const mob = mobOf(name);
    const own = mob ? levelOf(mob) : null;
    const mobSpots = () => [...new Set((mob?.zones ?? []).map((z) => mobZoneKey.get(z)).filter((k): k is string => !!k))].map((zone_key) => ({ zone_key, range: own }));
    if (mob && own) return mobSpots();
    const npcs = (npcsByName.get(name) ?? []).map((n) => ({ zone_key: n.zone_key, range: levelOf(n) }));
    // No level anywhere and no NPC rows: the mob row's own zones.
    return npcs.length ? npcs : mobSpots();
  };
  // Loot naming an item: mobs (by key), then NPC rows (by name), in the data's order, each name lower-cased.
  const owners: { loot: Loot; who: string }[] = [...input.mobs.map((m) => ({ loot: m.loot, who: m.key })), ...input.npcs.map((n) => ({ loot: n.loot, who: n.name }))];
  const lowerText = new Map<(typeof owners)[number], string>();
  const lootedBy = (itemKey: string): string[] => {
    const out: string[] = [];
    const escaped = itemKey.includes('"') || itemKey.includes('\\');
    for (const o of owners) {
      let list: string[];
      if (Array.isArray(o.loot)) list = o.loot;
      else {
        const json = o.loot.json;
        if (!json) continue;
        if (!escaped) {
          // The caller may pass the text already lower-cased (src/gear/sources.ts keeps it per import).
          if (!lowerText.has(o)) lowerText.set(o, o.loot.lower ?? json.toLowerCase());
          if (!lowerText.get(o)!.includes(itemKey)) continue;
        }
        const v = JSON.parse(json) as unknown;
        list = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      }
      if (list.some((l) => lower(l) === itemKey)) out.push(lower(o.who));
    }
    return out;
  };
  // Eager input (the import's lists) builds the reverse map once; raw JSON is looked up per item.
  let looted: Map<string, string[]> | null = null;
  if (input.mobs.every((m) => Array.isArray(m.loot)) && input.npcs.every((n) => Array.isArray(n.loot))) {
    looted = new Map();
    for (const o of owners)
      for (const l of o.loot as string[]) {
        const k = lower(l);
        if (!looted.has(k)) looted.set(k, []);
        looted.get(k)!.push(lower(o.who));
      }
  }
  const creaturesOf = (itemKey: string, from: string[]) => [...new Set([...from.map(lower), ...(looted ? looted.get(itemKey) ?? [] : lootedBy(itemKey))])];
  const display = (name: string) => mobOf(name)?.title ?? npcsByName.get(name)?.[0]?.name;
  const mobLevel = (name: string) => {
    const mob = mobOf(name);
    return mob ? levelOf(mob) : null;
  };
  return { level, zones, spots, creaturesOf, display, mobLevel };
}

// ---------------------------------------------------------------- the computation

export function computeLevels(input: LevelInput, gearKeys: Set<string>): { levels: Map<string, ItemLevel>; summary: LevelSummary; recipes: Map<string, string> } {
  const lower = (s: string) => s.toLowerCase();
  const texts = new Map<string, number>();
  const many = new Map<string, { count: number; range: Range }>();
  const questions = new Map<string, number>();
  const parseCounted = (text: string | null): Range | null => {
    if (text === null) return null;
    if (text.includes('?')) questions.set(text, (questions.get(text) ?? 0) + 1);
    const p = parseLevel(text);
    if (!p.range) texts.set(text, (texts.get(text) ?? 0) + 1);
    else if (p.integers > 2) many.set(text, { count: (many.get(text)?.count ?? 0) + 1, range: p.range });
    return p.range;
  };

  // Zones: their levels.
  const zoneLevel = new Map(input.zones.map((z) => [z.key, parseCounted(z.level)]));

  // Creatures by lower-cased name: the mob row (by key, then title), and every NPC row with that name (creatureIndex, shared
  // with /gear upgrades' drop line, order 37).
  const creatures = creatureIndex(input, parseCounted, true);
  const creatureLevel = creatures.level;
  const creatureZones = creatures.zones;

  // Drops: every creature name the data links to an item (its from list, and loot naming it).
  const drops = new Map(input.items.map((it) => [it.key, new Set(creatures.creaturesOf(it.key, it.from))]));

  // Quests: the lowest recorded minimum level of the quests that reward each item (exact name, case-insensitive).
  const questMin = new Map<string, number | null>();
  for (const q of input.quests) {
    const lv = typeof q.minLevel === 'number' && Number.isInteger(q.minLevel) && q.minLevel >= LEVEL_FLOOR && q.minLevel <= LEVEL_CEILING ? q.minLevel : null;
    for (const r of q.rewards) {
      const k = lower(r.trim());
      const had = questMin.get(k);
      questMin.set(k, had === undefined ? lv : had === null ? lv : lv === null ? had : Math.min(had, lv));
    }
  }

  const itemByKey = new Map(input.items.map((it) => [it.key, it]));
  const recipesOf = new Map<string, LevelInput['recipes']>();
  for (const r of input.recipes) {
    if (!recipesOf.has(r.result_key)) recipesOf.set(r.result_key, []);
    recipesOf.get(r.result_key)!.push(r);
  }

  /** The kinds that do not depend on recipes. */
  const baseKinds = new Map<string, Map<Kind, Range | null>>();
  const base = (key: string): Map<Kind, Range | null> => {
    const hit = baseKinds.get(key);
    if (hit) return hit;
    const kinds = new Map<Kind, Range | null>();
    const it = itemByKey.get(key);
    const creatures = [...(drops.get(key) ?? [])];
    const mob = union(creatures.map(creatureLevel).filter((r): r is Range => r !== null));
    if (mob) kinds.set('mob', mob);
    else if (creatures.length) {
      const zone = union([...new Set(creatures.flatMap(creatureZones))].map((z) => zoneLevel.get(z) ?? null).filter((r): r is Range => r !== null));
      if (zone) kinds.set('zone', zone);
    }
    if (it?.sold) kinds.set('vendor', { low: 0, high: 0 });
    if (it?.harvested) kinds.set('harvest', { low: 0, high: 0 });
    const q = questMin.get(key);
    if (it?.questCategory || q !== undefined) kinds.set('quest', q === undefined || q === null ? null : { low: q, high: q });
    baseKinds.set(key, kinds);
    return kinds;
  };

  const memo = new Map<string, Result>();
  const compCount = (r: LevelInput['recipes'][number]) => r.components.size + r.unknown_components;
  const byTie = (a: { r: LevelInput['recipes'][number] }, b: { r: LevelInput['recipes'][number] }) =>
    compCount(a.r) - compCount(b.r) || (a.r.id ?? Number.MAX_SAFE_INTEGER) - (b.r.id ?? Number.MAX_SAFE_INTEGER) || (a.r.source_key < b.r.source_key ? -1 : a.r.source_key > b.r.source_key ? 1 : 0);

  const levelOf = (key: string, stack: string[]): Result => {
    const depth = stack.length - 1;
    const kept = memo.get(key);
    if (kept && depth + kept.height <= MAX_DEPTH) return kept;
    const kinds = new Map(base(key));
    let cut = false;
    let height = 0;
    let missing: string[] = [];
    let chosen: string | null = null;
    const recipes = recipesOf.get(key) ?? [];
    if (recipes.length) {
      const scored = recipes.map((r) => {
        let known: number[] = [];
        const miss: string[] = [];
        let floor = false;
        for (let i = 0; i < r.unknown_components; i++) miss.push('(Unknown component)');
        for (const c of r.components.keys()) {
          if (stack.includes(c) || depth + 1 > MAX_DEPTH) {
            cut = true;
            miss.push(c);
            continue;
          }
          const sub = levelOf(c, [...stack, c]);
          cut ||= sub.cut;
          height = Math.max(height, sub.height + 1);
          if (!sub.primary.range) miss.push(c);
          else {
            known = [...known, sub.primary.range.low];
            if (sub.primary.kind === 'crafted_floor') floor = true;
          }
        }
        const level = known.length ? Math.max(...known) : null;
        return { r, level, full: !miss.length && !floor && level !== null, miss };
      });
      const full = scored.filter((s) => s.full).sort((a, b) => (a.level as number) - (b.level as number) || byTie(a, b));
      if (full.length) {
        kinds.set('crafted', { low: full[0].level as number, high: full[0].level as number });
        chosen = full[0].r.source_key;
      } else {
        const floors = scored.sort((a, b) => (a.level === null ? 1 : 0) - (b.level === null ? 1 : 0) || (a.level ?? 0) - (b.level ?? 0) || byTie(a, b));
        kinds.set('crafted_floor', floors[0].level === null ? null : { low: floors[0].level, high: null });
        missing = floors[0].miss;
        chosen = floors[0].r.source_key;
      }
    }
    const result: Result = { kinds, primary: choose(kinds), height, cut, missing, recipe: chosen };
    if (!cut) memo.set(key, result);
    return result;
  };

  const levels = new Map<string, ItemLevel>();
  const zero = () => Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  const summary: LevelSummary = {
    gear: 0,
    byKind: zero(),
    byKindWithLevel: zero(),
    crafted: { results: 0, full: 0, floor: 0, none: 0 },
    quest: { rewards: 0, withLevel: 0, withoutLevel: 0 },
    nonCrafted: { items: 0, mobLevel: 0, dropNoLevel: 0, noSource: 0, vendorOnly: 0 },
    manyIntegers: [],
    unparsed: [],
    questionMarks: [],
    missingComponents: [],
  };
  const missingCount = new Map<string, number>();
  const chosenRecipes = new Map<string, string>();
  for (const it of input.items) {
    if (!gearKeys.has(it.key)) continue;
    const r = levelOf(it.key, [it.key]);
    if (r.recipe) chosenRecipes.set(it.key, r.recipe);
    const order = orderKinds(r.kinds);
    levels.set(it.key, {
      level_low: r.primary.range?.low ?? null,
      level_high: r.primary.range?.high ?? null,
      level_kind: r.primary.kind,
      level_kinds: order.length ? order.join(',') : 'unknown',
    });
    summary.gear++;
    summary.byKind[r.primary.kind]++;
    if (r.primary.range) summary.byKindWithLevel[r.primary.kind]++;
    if (r.kinds.has('crafted') || r.kinds.has('crafted_floor')) {
      summary.crafted.results++;
      if (r.kinds.has('crafted')) summary.crafted.full++;
      else if (r.kinds.get('crafted_floor')) summary.crafted.floor++;
      else summary.crafted.none++;
      for (const m of new Set(r.missing)) missingCount.set(m, (missingCount.get(m) ?? 0) + 1);
    } else {
      const nc = summary.nonCrafted;
      nc.items++;
      if (r.kinds.get('mob')) nc.mobLevel++;
      else if (drops.get(it.key)?.size) nc.dropNoLevel++;
      if (!r.kinds.size) nc.noSource++;
      if (r.kinds.size === 1 && r.kinds.has('vendor')) nc.vendorOnly++;
    }
    if (r.kinds.has('quest')) {
      summary.quest.rewards++;
      if (r.kinds.get('quest')) summary.quest.withLevel++;
      else summary.quest.withoutLevel++;
    }
  }
  const byCount = <T>(m: Map<string, T>, n: (v: T) => number) => [...m].sort((a, b) => n(b[1]) - n(a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  summary.unparsed = byCount(texts, (n) => n).map(([text, count]) => ({ text, count }));
  summary.questionMarks = byCount(questions, (n) => n).map(([text, count]) => ({ text, count, reading: questionReading(text) as QuestionReading }));
  summary.manyIntegers = byCount(many, (v) => v.count).map(([text, v]) => ({ text, count: v.count, low: v.range.low, high: v.range.high }));
  summary.missingComponents = byCount(missingCount, (n) => n).slice(0, 20).map(([key, items]) => ({ key, items }));
  return { levels, summary, recipes: chosenRecipes };
}

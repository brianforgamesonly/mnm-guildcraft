// Order 36, ITEM 2 (docs/PRD.md "Gear upgrades", part 2: Scoring): how much an item is worth to a class, and what beats
// what a character wears. Pure: no D1, no Discord. src/gear/upgrades.ts reads the data and renders; this decides.
//
// - A score is Σ stat × the class's weight for it, in integer hundredths (weights are held × 100), so "gain above 0" is an
//   integer test and two items of equal value are never upgrades of each other. Negative stats count negatively.
// - Default weights come from the class's role preset, then its stat priority (CLASSES): 1st place 1, 2nd 0.5, 3rd and 4th
//   0.25, other attributes 0. Places are dense: stats joined by "&" share a place and the next place is not skipped.
// - Hybrid casters (Tank or Melee preset, INT or WIS in the priority) also get Mana 0.05 and mana regeneration 1.
// - Damage ÷ delay × 100 counts in Primary and Range always, in Secondary only for the Tank and Melee presets.
// - Haste does not stack (only the highest counts): an item's haste counts only by what it exceeds the highest haste worn
//   in every other slot, for a candidate and for the item it replaces alike.
// - Weights are read only through weightsFor(server, class) (ITEM 4 changes its source, never its callers).
import { RESISTS, STATS, ALL_CLASSES, ALL_RACES, REMOVED_BIT, bitOf, SLOTS } from './vocab.ts';
import { WEAR_SLOTS, type SlotToken } from './slots.ts';

// ---------------------------------------------------------------- the weights

/** Every stat a weight is held for: 22 keys (the weights view's 22 fields). Labels are /gear search's (src/gear/options.ts). */
export const WEIGHT_KEYS = [...STATS, 'AC', 'HP', 'MANA', ...RESISTS, 'RATIO', 'HASTE', 'HPREGEN', 'MANAREGEN'] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export const WEIGHT_LABEL: Record<WeightKey, string> = {
  ...(Object.fromEntries([...STATS, ...RESISTS].map((k) => [k, k])) as Record<(typeof STATS)[number] | (typeof RESISTS)[number], string>),
  AC: 'AC', HP: 'HP', MANA: 'Mana', RATIO: 'damage ÷ delay', HASTE: 'Haste', HPREGEN: 'HP regen', MANAREGEN: 'Mana regen',
};
/** A class's weights, each × 100 (an integer: 0.35 is 35). */
export type Weights = Record<WeightKey, number>;

export const PRESETS = ['Tank', 'Melee', 'Caster', 'Healer'] as const;
export type Preset = (typeof PRESETS)[number];

/** Section E's preset table (× 100), for everything but the attributes (the priority gives those). */
const PRESET_VALUES: Record<Preset, { AC: number; HP: number; MANA: number; resist: number; RATIO: number; HASTE: number; HPREGEN: number; MANAREGEN: number }> = {
  Tank: { AC: 35, HP: 10, MANA: 3, resist: 10, RATIO: 10, HASTE: 50, HPREGEN: 100, MANAREGEN: 0 },
  Melee: { AC: 10, HP: 5, MANA: 0, resist: 5, RATIO: 30, HASTE: 100, HPREGEN: 50, MANAREGEN: 0 },
  Caster: { AC: 3, HP: 5, MANA: 8, resist: 5, RATIO: 0, HASTE: 0, HPREGEN: 50, MANAREGEN: 200 },
  Healer: { AC: 8, HP: 5, MANA: 8, resist: 5, RATIO: 0, HASTE: 0, HPREGEN: 50, MANAREGEN: 200 },
};
/** Attribute weights by place (× 100): 1st, 2nd, 3rd, 4th. Unplaced attributes are 0. */
const PLACE = [100, 50, 25, 25] as const;
/** Hybrid casters' additions (× 100). */
const HYBRID = { MANA: 5, MANAREGEN: 100 } as const;

/**
 * Section E's class table (Brian-approved, 2026-11-05; from the class guides on Stories of Monsters and Memories), keyed by
 * game_class's code. "›" separates places, "&" joins a shared place.
 */
export const CLASSES: Record<string, { name: string; preset: Preset; priority: string }> = {
  ARC: { name: 'Archer', preset: 'Melee', priority: 'DEX › AGI › STR › STA' },
  BRD: { name: 'Bard', preset: 'Melee', priority: 'CHA › STA › DEX › STR' },
  BST: { name: 'Beastmaster', preset: 'Melee', priority: 'STR & STA › DEX & AGI' },
  CLR: { name: 'Cleric', preset: 'Healer', priority: 'WIS › STA' },
  DRU: { name: 'Druid', preset: 'Healer', priority: 'WIS › STA › CHA' },
  ELE: { name: 'Elementalist', preset: 'Caster', priority: 'INT › STA' },
  ENC: { name: 'Enchanter', preset: 'Caster', priority: 'CHA › INT › WIS & STA' },
  FTR: { name: 'Fighter', preset: 'Tank', priority: 'STA › STR › AGI' },
  INQ: { name: 'Inquisitor', preset: 'Tank', priority: 'STA › INT › STR › WIS' },
  MNK: { name: 'Monk', preset: 'Melee', priority: 'AGI & STR › STA & DEX' },
  NEC: { name: 'Necromancer', preset: 'Caster', priority: 'INT › STA' },
  PAL: { name: 'Paladin', preset: 'Tank', priority: 'STA › STR › WIS' },
  RNG: { name: 'Ranger', preset: 'Melee', priority: 'STR & DEX › AGI › STA › WIS' },
  ROG: { name: 'Rogue', preset: 'Melee', priority: 'DEX › AGI › STR › STA' },
  SHD: { name: 'Shadow Knight', preset: 'Tank', priority: 'STA › STR › INT' },
  SHM: { name: 'Shaman', preset: 'Healer', priority: 'WIS › STA › DEX' },
  SPB: { name: 'Spellblade', preset: 'Melee', priority: 'INT & AGI › STR & STA' },
  WIZ: { name: 'Wizard', preset: 'Caster', priority: 'INT › STA › DEX' },
};
/** A class with no row (or no class): the Melee preset with no priorities. */
export const FALLBACK_PRESET: Preset = 'Melee';

/** "STR & DEX › AGI" → [["STR", "DEX"], ["AGI"]]. */
export const places = (priority: string): string[][] => priority.split('›').map((p) => p.split('&').map((s) => s.trim()).filter(Boolean)).filter((p) => p.length);

export const classInfo = (code: string | null | undefined) => (code ? CLASSES[code.toUpperCase()] : undefined);
export const presetOf = (code: string | null | undefined): Preset => classInfo(code)?.preset ?? FALLBACK_PRESET;
/** A class's display name ("Inquisitor"); the code itself for a class not in the table; "no class" for none. */
export const className = (code: string | null | undefined) => classInfo(code)?.name ?? (code ? code.toUpperCase() : 'no class');

/** A preset's values with the given priority's attributes (and the hybrid additions when they apply). */
export function presetWeights(preset: Preset, priority: string): Weights {
  const p = PRESET_VALUES[preset];
  const w = Object.fromEntries(WEIGHT_KEYS.map((k) => [k, 0])) as Weights;
  Object.assign(w, { AC: p.AC, HP: p.HP, MANA: p.MANA, RATIO: p.RATIO, HASTE: p.HASTE, HPREGEN: p.HPREGEN, MANAREGEN: p.MANAREGEN });
  for (const r of RESISTS) w[r] = p.resist;
  const ps = places(priority);
  ps.forEach((stats, i) => {
    for (const s of stats) if ((STATS as readonly string[]).includes(s)) w[s as WeightKey] = PLACE[i] ?? 0; // review fix: a 5th place or later is "other": 0
  });
  const named = ps.flat();
  if ((preset === 'Tank' || preset === 'Melee') && (named.includes('INT') || named.includes('WIS'))) {
    w.MANA = Math.max(w.MANA, HYBRID.MANA);
    w.MANAREGEN = Math.max(w.MANAREGEN, HYBRID.MANAREGEN);
  }
  return w;
}

/** The class's default weights: its preset and priority (or Melee and none for a class not in the table). */
export function defaultWeights(code: string | null | undefined): Weights {
  const k = classInfo(code);
  return presetWeights(k?.preset ?? FALLBACK_PRESET, k?.priority ?? '');
}

/**
 * The one reader of a server's weights for a class. Part 2, PR A: the defaults (no server stores a change yet; PR B adds
 * the stored differences here, and nowhere else). `server` is the guild id.
 */
export async function weightsFor(_db: D1Database, _server: string, code: string | null | undefined): Promise<Weights> {
  return defaultWeights(code);
}

// ---------------------------------------------------------------- an item's stats

/** One gear item as scoring needs it (built once per import by src/gear/index.ts). */
export interface GearItem {
  id: number;
  name: string;
  key: string;
  slotMask: number;
  classMask: number;
  raceMask: number;
  sourceMask: number;
  gone: boolean;
  twoHanded: boolean;
  levelLow: number | null;
  levelHigh: number | null;
  levelKind: string | null;
  levelKinds: string | null;
  /** Stat values in WEIGHT_KEYS order; RATIO is damage × 100 ÷ delay, rounded to a whole number (0 without both). */
  v: number[];
}

const IDX = Object.fromEntries(WEIGHT_KEYS.map((k, i) => [k, i])) as Record<WeightKey, number>;
const RATIO_I = IDX.RATIO;
const HASTE_I = IDX.HASTE;
const KEYS_N = WEIGHT_KEYS.length;

/**
 * A stat as a whole number (review fix: the import checks only that it is a number, so a fraction is rounded here, and a
 * score stays in integer hundredths). Every stat on gear in bb1a703 is already whole.
 */
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0);

/**
 * The stat vector of an item's stats_json (scripts/import/core.ts statsJson: ac, dmg, delay, hp, mana, hpRegen, manaRegen,
 * haste, stats{STR…}, resists{MR…}). Haste is read as an integer percent: the source holds it as a number
 * (scripts/import/core.ts:176), every value on gear a whole number from 4 to 20 (bb1a703); it states no unit.
 */
export function statVector(statsJson: string | null): number[] {
  const s = (statsJson ? JSON.parse(statsJson) : {}) as Record<string, unknown>;
  const st = (s.stats ?? {}) as Record<string, unknown>;
  const rs = (s.resists ?? {}) as Record<string, unknown>;
  const v = new Array<number>(WEIGHT_KEYS.length).fill(0);
  for (const k of STATS) v[IDX[k]] = num(st[k]);
  for (const k of RESISTS) v[IDX[k]] = num(rs[k]);
  v[IDX.AC] = num(s.ac);
  v[IDX.HP] = num(s.hp);
  v[IDX.MANA] = num(s.mana);
  v[IDX.HPREGEN] = num(s.hpRegen);
  v[IDX.MANAREGEN] = num(s.manaRegen);
  v[HASTE_I] = num(s.haste);
  const dmg = num(s.dmg);
  const delay = num(s.delay);
  v[RATIO_I] = dmg > 0 && delay > 0 ? Math.round((dmg * 100) / delay) : 0;
  return v;
}

/**
 * Order 36, ITEM 5: the same vector, worked out by D1 (one column per WEIGHT_KEYS entry, s0…s21), so building the gear
 * index parses no JSON in the Worker. test/worker/upgrades.test.ts checks it equals statVector on every item it seeds.
 */
export const STAT_VECTOR_SQL = WEIGHT_KEYS.map((k, i) => {
  const path =
    (STATS as readonly string[]).includes(k) ? `$.stats.${k}` : (RESISTS as readonly string[]).includes(k) ? `$.resists.${k}`
    : ({ AC: '$.ac', HP: '$.hp', MANA: '$.mana', HASTE: '$.haste', HPREGEN: '$.hpRegen', MANAREGEN: '$.manaRegen' } as Record<string, string>)[k];
  const expr = k === 'RATIO'
    ? "CASE WHEN json_extract(stats_json, '$.dmg') > 0 AND json_extract(stats_json, '$.delay') > 0 THEN round(json_extract(stats_json, '$.dmg') * 100.0 / json_extract(stats_json, '$.delay')) ELSE 0 END"
    : `coalesce(json_extract(stats_json, '${path}'), 0)`;
  return `${expr} AS s${i}`;
}).join(', ');
/** A row's s0…s21 as a vector (non-numbers as 0, as statVector reads them). */
const S_COLS = WEIGHT_KEYS.map((_, i) => `s${i}`);
export const vectorOf = (r: Record<string, unknown>) => {
  const v = new Array<number>(KEYS_N);
  for (let i = 0; i < KEYS_N; i++) {
    const x = r[S_COLS[i]];
    v[i] = typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : 0;
  }
  return v;
};

// ---------------------------------------------------------------- who can use what

export interface Wearer {
  /** game_class.bit of the character's class, or null (no class, or a class the data has no bit for: any). */
  classBit: number | null;
  /** game_race.bit of the character's race, or null (no race: any). */
  raceBit: number | null;
}
const allows = (mask: number, bit: number | null, all: number) => bit === null || mask === all || mask === 0 || ((mask >>> bit) & 1) === 1;
/** The same rule as saved gear's refusal (src/gear/wear.ts refusal): ALL, or no class/race recorded, is anyone. */
export const canUse = (w: Wearer, it: Pick<GearItem, 'classMask' | 'raceMask'>) => allows(it.classMask, w.classBit, ALL_CLASSES) && allows(it.raceMask, w.raceBit, ALL_RACES);
/** A candidate: listed, not a Removed Item, and usable. */
export const isCandidate = (w: Wearer, it: GearItem) => !it.gone && (it.sourceMask & REMOVED_BIT) === 0 && canUse(w, it);

// ---------------------------------------------------------------- scoring

/** The 17 slot groups: the 20 slots with each pair (Ear, Wrist, Finger) as one. */
export interface SlotGroup {
  key: string;
  label: string;
  token: SlotToken;
  sides: string[];
}
export const SLOT_GROUPS: SlotGroup[] = (() => {
  const out: SlotGroup[] = [];
  for (const w of WEAR_SLOTS) {
    const g = out.find((x) => x.token === w.token);
    if (g) g.sides.push(w.key);
    else out.push({ key: w.key.replace(/\d$/, ''), label: w.label.replace(/ \d$/, ''), token: w.token, sides: [w.key] });
  }
  return out;
})();
export const groupByKey = (key: string) => SLOT_GROUPS.find((g) => g.key === key);
export const sideLabel = (key: string) => WEAR_SLOTS.find((w) => w.key === key)?.label ?? key;

/** Whether damage ÷ delay counts in a slot, for a class's preset. */
export const ratioCounts = (token: SlotToken, preset: Preset) => token === 'PRIMARY' || token === 'RANGE' || (token === 'SECONDARY' && (preset === 'Tank' || preset === 'Melee'));

/** Σ weight × stat, in hundredths, leaving haste out (it depends on the other slots) and ratio where it doesn't count. */
function baseScore(v: number[], w: Weights, ratio: boolean): number {
  let s = 0;
  for (let i = 0; i < WEIGHT_KEYS.length; i++) {
    if (i === HASTE_I || (i === RATIO_I && !ratio)) continue;
    s += w[WEIGHT_KEYS[i]] * v[i];
  }
  return s;
}

/** Why a worn item counts 0. */
export type WornReason = 'gone' | 'cantUse';
export interface Worn {
  /** The item the slot names (null: the key names no item row). */
  item: GearItem | null;
  /** The saved key (item.name_key). */
  key: string;
  /** Set when it counts 0: no longer listed (or no item), or the character can't use it. */
  reason: WornReason | null;
}
export function wornState(key: string, item: GearItem | null, w: Wearer): Worn {
  if (!item || item.gone) return { item, key, reason: 'gone' };
  return { item, key, reason: canUse(w, item) ? null : 'cantUse' };
}
const counts = (g: Worn | undefined): GearItem | null => (g && g.reason === null ? g.item : null);

export interface Context {
  weights: Weights;
  preset: Preset;
  /** Saved gear by slot key (src/gear/slots.ts WEAR_SLOTS keys). */
  worn: Map<string, Worn>;
}

/** The highest haste worn (counted items only) in every slot outside `except`. */
function hasteElsewhere(ctx: Context, except: string[]): number {
  let h = 0;
  for (const [slot, g] of ctx.worn) {
    if (except.includes(slot)) continue;
    const it = counts(g);
    if (it) h = Math.max(h, it.v[HASTE_I]);
  }
  return h;
}

/**
 * Items scored together in one place (a two-hander's Primary + Secondary), with the slots they free for haste. Each item is
 * valued by its own slot's ratio rule (`tokens[i]`, else `token`): review fix, a worn Secondary weapon's ratio counts only
 * for the Tank and Melee presets even when compared with a two-hander.
 */
function scoreTogether(items: (GearItem | null)[], ctx: Context, token: SlotToken, except: string[], tokens?: SlotToken[]): { score: number; v: number[] } {
  const v = new Array<number>(WEIGHT_KEYS.length).fill(0);
  let score = 0;
  let haste = 0;
  items.forEach((it, n) => {
    if (!it) return;
    const ratio = ratioCounts(tokens?.[n] ?? token, ctx.preset);
    score += baseScore(it.v, ctx.weights, ratio);
    for (let i = 0; i < v.length; i++) if (i !== RATIO_I || ratio) v[i] += it.v[i];
    haste = Math.max(haste, it.v[HASTE_I]);
  });
  const effective = Math.max(0, haste - hasteElsewhere(ctx, except));
  v[HASTE_I] = effective;
  return { score: score + ctx.weights.HASTE * effective, v };
}
const PAIR_TOKENS: SlotToken[] = ['PRIMARY', 'SECONDARY'];

/** One candidate for a slot group. */
export interface Upgrade {
  item: GearItem;
  /** Gain in hundredths (> 0). */
  gain: number;
  /** The candidate's score and what it replaces' score, in hundredths. */
  score: number;
  baseline: number;
  /** What it is compared with (the items replaced), in which slot's terms, and the slots left out of "haste elsewhere". */
  against: (GearItem | null)[];
  token: SlotToken;
  except: string[];
  /** The side it replaces, for a pair; null otherwise. */
  side: string | null;
  note: 'secondaryFree' | 'needsOneHand' | null;
}

/**
 * Order 36, ITEM 5: the stat differences (candidate − replaced), effective values, WEIGHT_KEYS order: worked out only for
 * the results a page shows, so comparing every candidate allocates nothing per item.
 */
export function upgradeDiff(u: Upgrade, ctx: Context): number[] {
  const cand = scoreTogether([u.item], ctx, u.token, u.except).v;
  const base = scoreTogether(u.against, ctx, u.token, u.except, u.against.length === 2 ? PAIR_TOKENS : undefined).v;
  return cand.map((x, i) => x - base[i]);
}

export interface GroupResult {
  group: SlotGroup;
  /** What the comparison is against: the slots replaced and their score. */
  replaces: string[];
  baseline: number;
  /** The worn items replaced (counted or not), for the header. */
  worn: Worn[];
  upgrades: Upgrade[];
}

/**
 * A two-hander in Primary takes both hands whether or not it counts (review fix: order 35's saved gear refuses Secondary
 * under any saved two-hander, src/gear/wear.ts wear, so a gone or unusable one still blocks it; it then scores 0).
 */
const isTwoHand = (g: Worn | undefined) => !!g?.item?.twoHanded;

/**
 * Every candidate that beats what's worn in one slot group (unsorted). The comparison:
 * - a pair compares with its weaker side (an empty side scores 0; a tie picks the first side); an item worn on the other
 *   side is still a candidate;
 * - Primary: a two-handed candidate against Primary plus Secondary; a one-handed one against a worn two-hander alone
 *   ("Secondary is then free"), else against Primary;
 * - Secondary under a worn two-hander: against the two-hander's score ("needs a one-handed Primary"); two-handers are never
 *   Secondary candidates (one takes both hands from Primary).
 */
export function compareGroup(group: SlotGroup, ctx: Context, wearer: Wearer, items: readonly GearItem[]): GroupResult {
  const bit = bitOf(SLOTS, group.token);
  const worn = (slot: string) => ctx.worn.get(slot);
  const out: Upgrade[] = [];
  const wv = WEIGHT_KEYS.map((k) => ctx.weights[k]);
  // One candidate's score in a slot's terms: integer adds only (ITEM 5: no arrays per item; upgradeDiff works out the
  // differences for the results shown).
  const fast = (it: GearItem, ratio: boolean, hasteOther: number) => {
    const v = it.v;
    let s = 0;
    for (let i = 0; i < KEYS_N; i++) if (i !== HASTE_I && (i !== RATIO_I || ratio)) s += wv[i] * v[i];
    return s + wv[HASTE_I] * Math.max(0, v[HASTE_I] - hasteOther);
  };
  const consider = (it: GearItem, token: SlotToken, except: string[], against: (GearItem | null)[], base: number, hasteOther: number, side: string | null, note: Upgrade['note']) => {
    const score = fast(it, ratioCounts(token, ctx.preset), hasteOther);
    if (score - base > 0) out.push({ item: it, gain: score - base, score, baseline: base, against, token, except, side, note });
  };
  const one = (slot: string) => scoreTogether([counts(worn(slot))], ctx, group.token, [slot]).score;
  const fitting: GearItem[] = [];
  for (const it of items) if ((it.slotMask & bit) !== 0 && isCandidate(wearer, it)) fitting.push(it);

  if (group.token === 'PRIMARY') {
    const twoWorn = isTwoHand(worn('primary'));
    const both = ['primary', 'secondary'];
    const p = counts(worn('primary'));
    const pair = [p, counts(worn('secondary'))];
    const pairBase = scoreTogether(pair, ctx, 'PRIMARY', both, PAIR_TOKENS).score;
    const twoBase = scoreTogether([p], ctx, 'PRIMARY', both).score;
    const oneBase = one('primary');
    const hBoth = hasteElsewhere(ctx, both);
    const hOne = hasteElsewhere(ctx, ['primary']);
    for (const it of fitting) {
      if (it.key === worn('primary')?.key) continue;
      if (it.twoHanded) consider(it, 'PRIMARY', both, pair, pairBase, hBoth, null, null);
      else if (twoWorn) consider(it, 'PRIMARY', both, [p], twoBase, hBoth, null, 'secondaryFree');
      else consider(it, 'PRIMARY', ['primary'], [p], oneBase, hOne, null, null);
    }
    return { group, replaces: ['primary'], baseline: oneBase, worn: [worn('primary')].filter((g): g is Worn => !!g), upgrades: out };
  }
  if (group.token === 'SECONDARY' && isTwoHand(worn('primary'))) {
    const both = ['primary', 'secondary'];
    const p = counts(worn('primary'));
    const base = scoreTogether([p], ctx, 'PRIMARY', both).score;
    const h = hasteElsewhere(ctx, both);
    for (const it of fitting) if (!it.twoHanded) consider(it, 'SECONDARY', both, [p], base, h, null, 'needsOneHand');
    return { group, replaces: ['primary'], baseline: base, worn: [worn('primary')!], upgrades: out };
  }
  // A single slot, or a pair's weaker side (a tie picks the first side).
  const sides = group.sides.map((s) => ({ s, base: one(s) }));
  const weaker = sides.reduce((a, b) => (b.base < a.base ? b : a));
  const h = hasteElsewhere(ctx, [weaker.s]);
  const against = [counts(worn(weaker.s))];
  for (const it of fitting) {
    if (group.token === 'SECONDARY' && it.twoHanded) continue;
    if (it.key === worn(weaker.s)?.key) continue;
    consider(it, group.token, [weaker.s], against, weaker.base, h, group.sides.length > 1 ? weaker.s : null, null);
  }
  return { group, replaces: [weaker.s], baseline: weaker.base, worn: [worn(weaker.s)].filter((g): g is Worn => !!g), upgrades: out };
}

/** The score of one worn slot (0 when empty or not counted), in hundredths: the header's "score". */
export const wornScore = (slot: string, token: SlotToken, ctx: Context) => scoreTogether([counts(ctx.worn.get(slot))], ctx, token, [slot]).score;

// ---------------------------------------------------------------- grouping and order

export const GROUPS = ['around', 'above', 'unknown'] as const;
export type LevelGroup = (typeof GROUPS)[number];
export const DEFAULT_WINDOW = 10;

/**
 * Around: level_low at most level + window (any-level kinds are stored as 0). Above: higher. Level unknown: no level_low.
 * A character with no level: everything with a level is Around.
 */
export function levelGroup(it: Pick<GearItem, 'levelLow'>, level: number | null, window: number): LevelGroup {
  if (it.levelLow === null) return 'unknown';
  if (level === null) return 'around';
  return it.levelLow <= level + window ? 'around' : 'above';
}

/** Smallest gain first; ties: the lower level_low (none last), then the name. */
export const byGain = (a: Upgrade, b: Upgrade) =>
  a.gain - b.gain || (a.item.levelLow ?? Infinity) - (b.item.levelLow ?? Infinity) || a.item.name.localeCompare(b.item.name, 'en', { sensitivity: 'base' }) || a.item.id - b.item.id;

/** The groups in order, each sorted: every candidate in exactly one. */
export function grouped(ups: Upgrade[], level: number | null, window: number): Record<LevelGroup, Upgrade[]> {
  const out: Record<LevelGroup, Upgrade[]> = { around: [], above: [], unknown: [] };
  for (const u of ups) out[levelGroup(u.item, level, window)].push(u);
  for (const g of GROUPS) out[g].sort(byGain);
  return out;
}

// ---------------------------------------------------------------- showing numbers

/** Hundredths as "+0.03", "+11.20", "−5.00" (two decimals, so a tiny gain never reads "+0.0"). */
export function fmtHundredths(n: number, signed = true): string {
  const a = Math.abs(n);
  const s = `${Math.trunc(a / 100)}.${String(a % 100).padStart(2, '0')}`;
  return n < 0 ? `−${s}` : signed ? `+${s}` : s;
}
/** A weight (× 100) as "0.35", "1", "0.05". */
export const fmtWeight = (w: number) => String(w / 100);

const DIFF_LABEL: Record<WeightKey, string> = { ...WEIGHT_LABEL, RATIO: 'dmg÷delay×100', HASTE: '% haste' };
/** Up to `max` stat differences, largest weighted effect first, with signs ("+14 AC, +1 STA, −5 HP"). */
export function breakdown(diff: number[], w: Weights, max = 3): string {
  return WEIGHT_KEYS.map((k, i) => ({ k, d: diff[i], e: Math.abs(w[k] * diff[i]) }))
    .filter((x) => x.d !== 0 && x.e !== 0)
    .sort((a, b) => b.e - a.e || WEIGHT_KEYS.indexOf(a.k) - WEIGHT_KEYS.indexOf(b.k))
    .slice(0, max)
    .map((x) => `${x.d > 0 ? '+' : '−'}${Math.abs(x.d)}${x.k === 'HASTE' ? DIFF_LABEL[x.k] : ` ${DIFF_LABEL[x.k]}`}`)
    .join(', ');
}

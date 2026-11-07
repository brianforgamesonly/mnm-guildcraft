// Order 39, ITEM 3: one stat line for an item, shared by the /item card (src/commands/find.ts statFields) and /gear
// upgrades (src/gear/upgrades.ts), so a stat never reads differently on the card and in the list. Read from stats_json
// (scripts/import/core.ts statsJson), never from the gear index (which holds only scoring's vector).
//
// - The line: AC; Damage / delay; HP; Mana; each stat; each resist; Haste; HP regen; Mana regen; the effect. Weight, size,
//   flags, class/race, and a weapon's skill and hands stay on the card only.
// - Marked (the owner, 2026-11-07): a changed stat is bold, with ▲ (higher) or ▼ (lower) and the difference, against what
//   the upgrade replaces (the same items upgradeDiff compares with). A stat the replaced item has and the candidate lacks
//   reads "**WIS — ▼−4**": a changed stat is never hidden. Unchanged stats show plainly. Every stat is marked whatever its
//   weight. Damage and delay are each compared with the replaced weapon; against a pair, with Primary's ("vs Primary").
//   Haste doesn't stack (src/gear/score.ts): its value is compared as the others, and when it is no more than the haste
//   worn elsewhere the line says so. The effect is marked only when it differs: "new effect" or "effect lost".
import { md } from '../discord.ts';

export interface ItemStats {
  ac: number | null;
  dmg: number | null;
  delay: number | null;
  skill: string | null;
  handed: string | null;
  hp: number | null;
  mana: number | null;
  stats: [string, number][];
  resists: [string, number][];
  haste: number | null;
  hpRegen: number | null;
  manaRegen: number | null;
  effect: { name: string; trigger: string | null } | null;
}

const numOrNull = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** Numeric entries of an object, by key (stats_json is written with sorted keys: the card's order). */
const pairs = (o: unknown): [string, number][] =>
  o && typeof o === 'object' && !Array.isArray(o)
    ? (Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === 'number') as [string, number][]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    : [];

/** An item's stats_json, read once. */
export function parseStats(statsJson: string | null): ItemStats {
  const s = (statsJson ? JSON.parse(statsJson) : {}) as Record<string, unknown>;
  const e = s.effect as { name?: unknown; trigger?: unknown } | undefined;
  return {
    ac: numOrNull(s.ac),
    dmg: numOrNull(s.dmg),
    delay: numOrNull(s.delay),
    skill: typeof s.skill === 'string' && s.skill ? s.skill : null,
    handed: typeof s.handed === 'string' && s.handed ? s.handed : null,
    hp: numOrNull(s.hp),
    mana: numOrNull(s.mana),
    stats: pairs(s.stats),
    resists: pairs(s.resists),
    haste: numOrNull(s.haste),
    hpRegen: numOrNull(s.hpRegen),
    manaRegen: numOrNull(s.manaRegen),
    effect: e && typeof e.name === 'string' && e.name ? { name: e.name, trigger: typeof e.trigger === 'string' && e.trigger ? e.trigger : null } : null,
  };
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** One stat as the card shows it: its key, its label, its value text, and its number. */
export interface StatPart {
  key: string;
  label: string;
  /** The value as the card's field shows it ("12", "+5", "30 delay"). */
  value: string;
  n: number;
}
/** The line's text of a part: "AC 12", "STA +5", "HP regen 2"; delay's value carries its own word ("30 delay"). */
export const partText = (p: Pick<StatPart, 'key' | 'label' | 'value'>) => (p.key === 'DELAY' ? p.value : `${p.label} ${p.value}`);

const LABEL = { AC: 'AC', DMG: 'Damage', DELAY: 'Delay', HP: 'HP', MANA: 'Mana', HASTE: 'Haste', HPREGEN: 'HP regen', MANAREGEN: 'Mana regen' } as const;
const valueOf = (key: string, n: number) => (key === 'DELAY' ? `${n} delay` : key === 'HP' || key === 'MANA' || key.startsWith('stat:') || key.startsWith('res:') ? signed(n) : String(n));
const part = (key: string, label: string, n: number): StatPart => ({ key, label, value: valueOf(key, n), n });

/** The numeric parts of an item, in the line's order. Damage and delay only with damage (as the card). */
export function statParts(s: ItemStats): StatPart[] {
  const out: StatPart[] = [];
  if (s.ac !== null) out.push(part('AC', LABEL.AC, s.ac));
  if (s.dmg !== null) {
    out.push(part('DMG', LABEL.DMG, s.dmg));
    if (s.delay !== null) out.push(part('DELAY', LABEL.DELAY, s.delay));
  }
  if (s.hp !== null) out.push(part('HP', LABEL.HP, s.hp));
  if (s.mana !== null) out.push(part('MANA', LABEL.MANA, s.mana));
  for (const [k, v] of s.stats) out.push(part(`stat:${k}`, k, v));
  for (const [k, v] of s.resists) out.push(part(`res:${k}`, k, v));
  if (s.haste !== null) out.push(part('HASTE', LABEL.HASTE, s.haste));
  if (s.hpRegen !== null) out.push(part('HPREGEN', LABEL.HPREGEN, s.hpRegen));
  if (s.manaRegen !== null) out.push(part('MANAREGEN', LABEL.MANAREGEN, s.manaRegen));
  return out;
}
/** The line's order of keys (stats and resists by name within their place), for merging two items' parts. */
const RANK: Record<string, number> = { AC: 0, DMG: 1, DELAY: 2, HP: 3, MANA: 4, HASTE: 7, HPREGEN: 8, MANAREGEN: 9 };
const rank = (k: string) => RANK[k] ?? (k.startsWith('stat:') ? 5 : 6);
const byLine = (a: string, b: string) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0);

export const effectText = (e: NonNullable<ItemStats['effect']>) => `${e.name}${e.trigger ? ` (${e.trigger})` : ''}`;

// ---------------------------------------------------------------- copy (order 39; listed for approval in docs/COPY.md)

export const STAT_COPY = {
  effect: (text: string) => `Effect: ${md(text)}`,
  newEffect: 'new effect',
  effectLost: (text: string) => `effect lost: ${md(text)}`,
  lost: '—',
  vsPrimary: 'vs Primary',
  hasteNoStack: (h: number) => `doesn't stack: Haste ${h} worn elsewhere`,
  sep: ' · ',
} as const;

/** "▲+2" / "▼−2" (a true minus, as the gains print). */
export const mark = (d: number) => (d > 0 ? `▲+${tidy(d)}` : `▼−${tidy(-d)}`);

/** The unmarked full line (the header's worn items). Empty when the item has no stats. */
export function plainLine(item: ItemStats): string {
  const entries = statParts(item).map((p) => ({ key: p.key, text: partText(p) }));
  return [...joinWeapon(entries).map((e) => e.text), ...(item.effect ? [STAT_COPY.effect(effectText(item.effect))] : [])].join(STAT_COPY.sep);
}
const isWeapon = (k: string) => k === 'DMG' || k === 'DELAY';
/** Damage and delay read as one entry, "Damage 20 / 30 delay", as the card's Damage field does. */
function joinWeapon<T extends { key: string; text: string }>(entries: T[]): T[] {
  const out: T[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (e.key === 'DELAY' && last?.key === 'DMG') out[out.length - 1] = { ...last, text: `${last.text} / ${e.text}` };
    else out.push(e);
  }
  return out;
}

export interface Baseline {
  /**
   * The items replaced, as upgradeDiff compares with: [] for an empty slot; [Primary, Secondary] against a pair, each null
   * when that side is empty or counts 0 (review fix: kept in place, so Primary's weapon is never mistaken for Secondary's).
   */
  items: (ItemStats | null)[];
  /** The highest haste worn in every other slot (src/gear/score.ts hasteWornElsewhere). */
  hasteElsewhere: number;
}

/** Review fix: whole hundredths, so a fraction never prints as 0.30000000000000004 or marks a rounding error as a change. */
const tidy = (n: number) => Math.round(n * 100) / 100;

/**
 * The candidate's line, marked against the baseline. `changesOnly`: only the marked stats (the summary, and Pick a result's
 * own lines). Numbers add up across a pair (scoring adds them too); damage and delay are the replaced weapon's (Primary's
 * alone, against a pair). Haste is marked as scoring counts it (review fix): each side's haste above the haste worn
 * elsewhere, so a haste that doesn't stack never reads as a gain or a loss; the note says so whenever haste worn elsewhere
 * limits either side.
 */
export function markedLine(cand: ItemStats, base: Baseline, changesOnly: boolean): string {
  const mine = new Map(statParts(cand).map((p) => [p.key, p]));
  const theirs = new Map<string, StatPart>();
  const pair = base.items.length > 1;
  const present = base.items.filter((b): b is ItemStats => !!b);
  const weapon = pair ? base.items[0] : present[0];
  for (const b of present) {
    for (const p of statParts(b)) {
      if (p.key === 'DMG' || p.key === 'DELAY') continue;
      const had = theirs.get(p.key);
      const n = had ? (p.key === 'HASTE' ? Math.max(had.n, p.n) : tidy(had.n + p.n)) : p.n;
      theirs.set(p.key, { ...p, value: valueOf(p.key, n), n });
    }
  }
  if (weapon) for (const p of statParts(weapon)) if (p.key === 'DMG' || p.key === 'DELAY') theirs.set(p.key, p);
  const keys = [...new Set([...mine.keys(), ...theirs.keys()])].sort(byLine);
  const entries: { key: string; text: string; changed: boolean }[] = [];
  for (const k of keys) {
    const a = mine.get(k);
    const b = theirs.get(k);
    const h = base.hasteElsewhere;
    const eff = (n: number | undefined) => (k === 'HASTE' ? Math.max(0, (n ?? 0) - h) : (n ?? 0));
    const d = tidy(eff(a?.n) - eff(b?.n));
    if (d === 0 && changesOnly) continue;
    // A lost stat reads "**WIS — ▼−4**": it never vanishes. A lost delay keeps its word ("**Delay — ▼−30**").
    const shown = a ? partText(a) : `${b!.label} ${STAT_COPY.lost}`;
    let text = d === 0 ? shown : `**${shown} ${mark(d)}**`;
    if (k === 'HASTE' && h > 0 && ((a?.n ?? 0) > 0 || (b?.n ?? 0) > 0) && Math.min(a?.n ?? h, b?.n ?? h) <= h) text = `${text} (${STAT_COPY.hasteNoStack(h)})`;
    entries.push({ key: k, text, changed: d !== 0 });
  }
  const joined = joinWeapon(entries);
  // Against a pair, damage and delay were compared with Primary's weapon alone: say so after them.
  const w = pair ? joined.find((e) => isWeapon(e.key) && entries.some((x) => isWeapon(x.key) && x.changed)) : undefined;
  if (w) w.text = `${w.text} (${STAT_COPY.vsPrimary})`;
  const line = joined.map((e) => e.text);
  // The effect: plain when the same, marked when new or lost (both, when one replaces another); each lost effect once.
  const theirEffects = [...new Map(present.flatMap((b) => (b.effect ? [[b.effect.name, b.effect] as const] : []))).values()];
  const mineE = cand.effect;
  const same = mineE && theirEffects.some((e) => e.name === mineE.name);
  if (mineE && same && !changesOnly) line.push(STAT_COPY.effect(effectText(mineE)));
  if (mineE && !same) line.push(`**${STAT_COPY.effect(effectText(mineE))} (${STAT_COPY.newEffect})**`);
  for (const e of theirEffects) if (!mineE || e.name !== mineE.name) line.push(`**${STAT_COPY.effectLost(effectText(e))}**`);
  return line.join(STAT_COPY.sep);
}

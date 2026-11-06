// The gear finder's lists (work order 13), held once each. The import (scripts/import/core.ts) derives each item's bitmasks
// from these, /gear find registers its choices from them (src/commands/definitions.ts), and the import warns when the data
// holds a value one of them lacks (Warning 'vocab_drift'), so a new value prompts a re-registration instead of going
// unsearchable. Classes are not here: they are derived from the data into game_class (scripts/import/core.ts deriveClasses).
//
// Order matters for SLOTS and SOURCES: a token's index is its bit in item.slot_mask / item.source_mask. Append only.

/** Slot tokens, as the source writes them upper-cased (mnm-tools wiki.json 7b17117: 24 tokens on 3,156 gear items). */
export const SLOTS = [
  'PRIMARY', 'SECONDARY', 'NECK', 'FINGER', 'EAR', 'CHEST', 'WRIST', 'HEAD', 'LEGS', 'HANDS', 'FEET', 'SHOULDERS',
  'WAIST', 'RANGE', 'BAG', 'FACE', 'BACK', 'BELT', 'SHIRT', 'AMMO', 'BACKPACK', 'BARDING', 'SADDLEBAG', 'RIGGING',
] as const;

/** Weapon type codes (item skill), shown as the code alone: the data does not pair them with names. */
export const WEAPON_TYPES = ['1HS', '2HB', '2HS', 'ARC', 'BLG', 'H2H', 'SLA', 'STA', 'THR'] as const;

/** The keys of an item's stats object. */
export const STATS = ['STR', 'STA', 'DEX', 'AGI', 'INT', 'WIS', 'CHA'] as const;
/** The keys of an item's resists object. */
export const RESISTS = ['MR', 'PR', 'DR', 'FR', 'CORR', 'CR', 'ER', 'HR'] as const;

/** An item's sources, derived on every import (work order 13, ITEM 2). Index = bit in item.source_mask. */
export const SOURCES = ['Drop', 'Crafted', 'Vendor', 'Quest', 'Unknown'] as const;
export type Source = (typeof SOURCES)[number];
/** Not a source: the wiki's "Removed Items" category, held in source_mask so /gear find excludes it through the index. */
export const REMOVED_BIT = 1 << SOURCES.length;
/** Categories that make an item a Quest source. */
export const QUEST_CATEGORIES = ['Quest Items', 'Reward'] as const;
export const REMOVED_CATEGORY = 'Removed Items';

export const bitOf = <T extends string>(list: readonly T[], token: T) => 1 << list.indexOf(token);
/** A class mask for "every class" (the source's ALL): every bit set. */
export const ALL_CLASSES = -1;

/** Order 35: a race mask for "every race" (the source's ALL, in any case): every bit set. 0 = no race recorded. */
export const ALL_RACES = -1;
/**
 * Order 35: the slots a mount wears (the source's BARDING, SADDLEBAG and RIGGING). A race is a mount race when every
 * item carrying it fits only these slots (scripts/import/core.ts deriveRaces); mount races are never offered for characters.
 */
export const MOUNT_SLOTS = ['BARDING', 'SADDLEBAG', 'RIGGING'] as const;

/**
 * Order 36: race display names, by game_race code, from the Monsters and Memories Wiki's Races page
 * (https://monstersandmemories.miraheze.org/wiki/Races, CC BY-SA 4.0). Only a name confirmed on that page goes here; no
 * runtime fetch. Empty in order 36: the page is not in the committed snapshot (data/wiki-snapshot/), order 28's rule
 * keeps the session off the live wiki, and no archived copy could be read, so every code shows as itself (raceLabel).
 */
export const RACE_NAMES: Readonly<Record<string, string>> = {};
/** A race's label in menus and panels: its confirmed name, else the code. */
export const raceLabel = (code: string) => RACE_NAMES[code.toUpperCase()] ?? code;

/**
 * Order 35: the one reading of an item's `handed` (item.handed, generated from stats_json). The source spells it
 * "Two Handed", "TWO HANDED", "2", "One Handed" and "1" (mnm-tools wiki.json bb1a703, 2026-11-05). Two-handed means
 * the text says two (any case, with a space, hyphen or nothing between) or is "2"; anything else, or none, is not.
 * Nothing is inferred from the weapon type (skill) or the name.
 */
export const isTwoHanded = (handed: unknown): boolean => typeof handed === 'string' && /^\s*(?:2|two[\s-]*handed)\s*$/i.test(handed);

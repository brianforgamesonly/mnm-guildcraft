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

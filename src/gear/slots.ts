// Order 35: the 20 saved-gear slots (docs/PRD.md "Gear upgrades"), held once. Pure: the command definitions
// (src/commands/definitions.ts, read by the registration script) and src/gear/wear.ts both read it.
import { bitOf, SLOTS } from './vocab.ts';

export type SlotToken = (typeof SLOTS)[number];
export interface WearSlot {
  key: string;
  label: string;
  /** The source's slot token (src/gear/vocab.ts SLOTS) an item's slot_mask must carry. Pairs share one. */
  token: SlotToken;
}
const s = (key: string, label: string, token: SlotToken): WearSlot => ({ key, label, token });
/** The 20 slots, in panel order. Paired slots share a token (EAR, WRIST, FINGER). No bags, belts, ammo or mount slots. */
export const WEAR_SLOTS: readonly WearSlot[] = [
  s('head', 'Head', 'HEAD'), s('face', 'Face', 'FACE'), s('ear1', 'Ear 1', 'EAR'), s('ear2', 'Ear 2', 'EAR'), s('neck', 'Neck', 'NECK'),
  s('shoulders', 'Shoulders', 'SHOULDERS'), s('back', 'Back', 'BACK'), s('chest', 'Chest', 'CHEST'), s('shirt', 'Shirt', 'SHIRT'),
  s('wrist1', 'Wrist 1', 'WRIST'), s('wrist2', 'Wrist 2', 'WRIST'), s('hands', 'Hands', 'HANDS'), s('waist', 'Waist', 'WAIST'),
  s('finger1', 'Finger 1', 'FINGER'), s('finger2', 'Finger 2', 'FINGER'), s('legs', 'Legs', 'LEGS'), s('feet', 'Feet', 'FEET'),
  s('primary', 'Primary', 'PRIMARY'), s('secondary', 'Secondary', 'SECONDARY'), s('range', 'Range', 'RANGE'),
];
export const slotByKey = (key: string) => WEAR_SLOTS.find((w) => w.key === key);
/**
 * Order 43: the weapon slots' tokens, held once. Damage ÷ delay belongs to these slots: scoring reads it here
 * (src/gear/score.ts ratioCounts, which also asks the class preset for Secondary), and the upgrade list's Minimum ratio box
 * and min_ratio: go by token alone (src/gear/filter.ts), whatever the class.
 */
export const WEAPON_TOKENS: readonly SlotToken[] = ['PRIMARY', 'SECONDARY', 'RANGE'];
/** Order 43: the weapon slots, derived from WEAR_SLOTS by token (Primary, Secondary, Range). */
export const WEAPON_SLOTS: readonly WearSlot[] = WEAR_SLOTS.filter((w) => WEAPON_TOKENS.includes(w.token));
/** Every slot bit the 20 slots use: an item is wearable when its slot_mask meets this. */
export const WEAR_MASK = WEAR_SLOTS.reduce((m, w) => m | bitOf(SLOTS, w.token), 0);

// Work order 36, ITEM 2: scoring (src/gear/score.ts). Pure: no D1.
import { describe, expect, it } from 'vitest';
import {
  breakdown, byGain, CLASSES, compareSlot, upgradeDiff, defaultWeights, presetWeights, fmtHundredths, upgradeSlot, grouped, levelGroup, OLD_PAIR_KEYS, presetOf, resolveSlot, UPGRADE_SLOTS, statVector, WEIGHT_KEYS, wornState,
  type Context, type GearItem, type Wearer, type Weights,
} from '../../src/gear/score.ts';
import { bitOf, REMOVED_BIT, SLOTS } from '../../src/gear/vocab.ts';

type Tok = (typeof SLOTS)[number];
let nextId = 1;
/** A gear item: slots, stats (stats_json's shape), and the rest by default usable by anyone. */
function mk(name: string, slots: Tok[], stats: Record<string, unknown> = {}, o: Partial<GearItem> = {}): GearItem {
  return {
    id: nextId++, name, key: name.toLowerCase(), slotMask: slots.reduce((m, s) => m | bitOf(SLOTS, s), 0), classMask: -1, raceMask: -1, sourceMask: 0, gone: false,
    twoHanded: false, levelLow: 1, levelHigh: 1, levelKind: 'mob', levelKinds: 'mob', v: statVector(JSON.stringify(stats)), ...o,
  };
}
const anyone: Wearer = { classBit: null, raceBit: null };
const ctxFor = (cls: string, worn: Record<string, GearItem | null> = {}, wearer = anyone, weights?: Weights): Context => ({
  weights: weights ?? defaultWeights(cls),
  preset: presetOf(cls),
  worn: new Map(Object.entries(worn).map(([slot, it]) => [slot, it ? wornState(it.key, it, wearer) : { item: null, key: 'missing', reason: 'gone' as const }])),
});
const W = (cls: string | null) => defaultWeights(cls);
/** A score by itself in an empty slot: the gain against nothing. */
const alone = (cls: string, it: GearItem, slot = 'chest') => compareSlot(upgradeSlot(slot)!, ctxFor(cls), anyone, [it]).upgrades[0]?.gain ?? 0;

describe('order 36, ITEM 2: weights', () => {
  it('each preset, from the table (× 100)', () => {
    // Tank (Fighter), Melee (Rogue), Caster (Wizard), Healer (Cleric): everything but the attributes.
    const pick = (w: Weights) => ({ AC: w.AC, HP: w.HP, MANA: w.MANA, MR: w.MR, HR: w.HR, RATIO: w.RATIO, HASTE: w.HASTE, HPREGEN: w.HPREGEN, MANAREGEN: w.MANAREGEN });
    expect(pick(W('FTR'))).toEqual({ AC: 35, HP: 10, MANA: 3, MR: 10, HR: 10, RATIO: 10, HASTE: 50, HPREGEN: 100, MANAREGEN: 0 });
    expect(pick(W('ROG'))).toEqual({ AC: 10, HP: 5, MANA: 0, MR: 5, HR: 5, RATIO: 30, HASTE: 100, HPREGEN: 50, MANAREGEN: 0 });
    expect(pick(W('WIZ'))).toEqual({ AC: 3, HP: 5, MANA: 8, MR: 5, HR: 5, RATIO: 0, HASTE: 0, HPREGEN: 50, MANAREGEN: 200 });
    expect(pick(W('CLR'))).toEqual({ AC: 8, HP: 5, MANA: 8, MR: 5, HR: 5, RATIO: 0, HASTE: 0, HPREGEN: 50, MANAREGEN: 200 });
    expect(WEIGHT_KEYS).toHaveLength(22);
  });

  it('places: 1st 1, 2nd 0.5, 3rd and 4th 0.25, others 0', () => {
    const f = W('FTR');
    expect([f.STA, f.STR, f.AGI, f.DEX, f.INT, f.WIS, f.CHA]).toEqual([100, 50, 25, 0, 0, 0, 0]);
    const r = W('ROG');
    expect([r.DEX, r.AGI, r.STR, r.STA, r.INT]).toEqual([100, 50, 25, 25, 0]);
  });

  it('"&" shares a place, and places are dense (Beastmaster, Ranger)', () => {
    const b = W('BST');
    expect([b.STR, b.STA, b.DEX, b.AGI]).toEqual([100, 100, 50, 50]);
    const r = W('RNG');
    expect([r.STR, r.DEX, r.AGI, r.STA, r.WIS]).toEqual([100, 100, 50, 25, 25]);
  });

  it('a class not in the table, or none: the Melee preset with no priorities', () => {
    for (const w of [W('XYZ'), W(null)]) {
      expect([w.STR, w.STA, w.DEX, w.AGI, w.INT, w.WIS, w.CHA]).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect([w.AC, w.RATIO, w.HASTE]).toEqual([10, 30, 100]);
    }
    expect(presetOf('XYZ')).toBe('Melee');
  });

  it('hybrid casters (Tank or Melee with INT or WIS) get Mana 0.05 and mana regeneration 1; others do not', () => {
    const hybrids = Object.entries(CLASSES).filter(([code]) => W(code).MANAREGEN === 100).map(([, k]) => k.name).sort();
    expect(hybrids).toEqual(['Inquisitor', 'Paladin', 'Ranger', 'Shadow Knight', 'Spellblade']);
    for (const code of ['INQ', 'PAL', 'SHD', 'RNG', 'SPB']) expect(W(code).MANA).toBe(5);
    expect([W('FTR').MANA, W('FTR').MANAREGEN, W('BRD').MANA, W('BRD').MANAREGEN]).toEqual([3, 0, 0, 0]);
  });

  it("the Inquisitor's defaults are Brian's check's step 5", () => {
    const w = W('INQ');
    expect({ STA: w.STA, INT: w.INT, STR: w.STR, WIS: w.WIS, AGI: w.AGI, DEX: w.DEX, CHA: w.CHA, AC: w.AC, HP: w.HP, MANA: w.MANA, MR: w.MR, RATIO: w.RATIO, HASTE: w.HASTE, HPREGEN: w.HPREGEN, MANAREGEN: w.MANAREGEN })
      .toEqual({ STA: 100, INT: 50, STR: 25, WIS: 25, AGI: 0, DEX: 0, CHA: 0, AC: 35, HP: 10, MANA: 5, MR: 10, RATIO: 10, HASTE: 50, HPREGEN: 100, MANAREGEN: 100 });
  });
});

describe('order 36, ITEM 2: scores', () => {
  // A chest piece: AC 22, HP 10, STA 2, STR 2 (the Enchanted Copper Plate Breastplate's stats, bb1a703).
  const plate = () => mk('Plate', ['CHEST'], { ac: 22, hp: 10, stats: { STA: 2, STR: 2 } });

  it('by hand: Fighter 11.70, Wizard 2.16, Cleric 3.26', () => {
    // Fighter: 22×0.35 + 10×0.1 + 2×1 (STA 1st) + 2×0.5 (STR 2nd) = 7.70 + 1.00 + 2.00 + 1.00 = 11.70
    expect(alone('FTR', plate())).toBe(1170);
    // Wizard: 22×0.03 + 10×0.05 + 2×0.5 (STA 2nd) + 2×0 = 0.66 + 0.50 + 1.00 = 2.16
    expect(alone('WIZ', plate())).toBe(216);
    // Cleric: 22×0.08 + 10×0.05 + 2×0.5 (STA 2nd) + 2×0 = 1.76 + 0.50 + 1.00 = 3.26
    expect(alone('CLR', plate())).toBe(326);
    // Inquisitor (Testchar, Brian's check): 22×0.35 + 10×0.1 + 2×1 + 2×0.25 = 11.20
    expect(alone('INQ', plate())).toBe(1120);
  });

  it('negative stats count negatively', () => {
    expect(alone('FTR', mk('Cursed', ['CHEST'], { ac: 10, hp: -5 }))).toBe(350 - 50);
  });

  it('resists: +5 to every resist against +5 STA, for Fighter and Cleric', () => {
    const resists = mk('Resist Ring', ['FINGER'], { resists: { MR: 5, PR: 5, DR: 5, FR: 5, CORR: 5, CR: 5, ER: 5, HR: 5 } });
    const sta = mk('Stamina Ring', ['FINGER'], { stats: { STA: 5 } });
    // Fighter: 8 × 5 × 0.1 = 4.00 against 5 × 1 = 5.00. Cleric: 8 × 5 × 0.05 = 2.00 against 5 × 0.5 = 2.50.
    expect([alone('FTR', resists, 'finger1'), alone('FTR', sta, 'finger1')]).toEqual([400, 500]);
    expect([alone('CLR', resists, 'finger1'), alone('CLR', sta, 'finger1')]).toEqual([200, 250]);
  });

  it('integer hundredths: two items of equal value are not upgrades of each other; a gain of 0.03 shows as "+0.03"', () => {
    const a = mk('A', ['CHEST'], { ac: 10 });
    const b = mk('B', ['CHEST'], { ac: 10 });
    expect(compareSlot(upgradeSlot('chest')!, ctxFor('WIZ', { chest: a }), anyone, [a, b]).upgrades).toEqual([]);
    const c = mk('C', ['CHEST'], { ac: 11 });
    const u = compareSlot(upgradeSlot('chest')!, ctxFor('WIZ', { chest: a }), anyone, [c]).upgrades[0];
    expect(u.gain).toBe(3); // 1 AC × 0.03
    expect(fmtHundredths(u.gain)).toBe('+0.03');
    expect([fmtHundredths(1120), fmtHundredths(-500), fmtHundredths(0, false)]).toEqual(['+11.20', '−5.00', '0.00']);
  });

  it('the breakdown: up to three differences, largest weighted effect first, with signs', () => {
    const worn = mk('Old', ['CHEST'], { ac: 8, hp: 15, stats: { STA: 1 } });
    const cand = mk('New', ['CHEST'], { ac: 22, hp: 10, stats: { STA: 2, AGI: 3 } });
    const ctx = ctxFor('FTR', { chest: worn });
    const u = compareSlot(upgradeSlot('chest')!, ctx, anyone, [cand]).upgrades[0];
    // AC +14 × 0.35 = 4.90; STA +1 × 1 = 1.00; AGI +3 × 0.25 = 0.75; HP −5 × 0.1 = −0.50
    expect(breakdown(upgradeDiff(u, ctx), W('FTR'))).toBe('+14 AC, +1 STA, +3 AGI');
    expect(u.gain).toBe(490 + 100 + 75 - 50);
  });
});

describe('order 36, ITEM 2: comparing', () => {
  it('an empty slot scores 0', () => {
    const r = compareSlot(upgradeSlot('head')!, ctxFor('FTR'), anyone, [mk('Cap', ['HEAD'], { ac: 2 })]);
    expect([r.baseline, r.upgrades[0].gain]).toEqual([0, 70]);
  });

  it('order 40: each side of a pair compares only with its own slot; an item worn on the other side is still a candidate', () => {
    const gold = mk('Gold Ring', ['FINGER'], { stats: { STA: 5 } });
    const tin = mk('Tin Ring', ['FINGER'], { stats: { STA: 1 } });
    const silver = mk('Silver Ring', ['FINGER'], { stats: { STA: 3 } });
    const ctx = ctxFor('FTR', { finger1: gold, finger2: tin });
    const f1 = compareSlot(upgradeSlot('finger1')!, ctx, anyone, [gold, tin, silver]);
    const f2 = compareSlot(upgradeSlot('finger2')!, ctx, anyone, [gold, tin, silver]);
    // Finger 1 holds Gold (5.00): nothing beats it, the stronger side is never left out.
    expect([f1.replaces, f1.baseline, f1.upgrades]).toEqual([['finger1'], 500, []]);
    // Finger 2 holds Tin (1.00): Gold (worn on Finger 1) and Silver beat it there; Tin itself is not a candidate.
    expect([f2.replaces, f2.baseline]).toEqual([['finger2'], 100]);
    expect(f2.upgrades.map((u) => [u.item.name, u.baseline, u.gain])).toEqual([['Gold Ring', 100, 400], ['Silver Ring', 100, 200]]);
  });

  it('order 40: an empty Ear 2 beside a filled Ear 1, each list comparing with its own side', () => {
    const pearl = mk('Pearl Earring', ['EAR'], { ac: 4 });
    const jade = mk('Jade Earring', ['EAR'], { ac: 6 });
    const ctx = ctxFor('FTR', { ear1: pearl });
    const e1 = compareSlot(upgradeSlot('ear1')!, ctx, anyone, [pearl, jade]);
    const e2 = compareSlot(upgradeSlot('ear2')!, ctx, anyone, [pearl, jade]);
    // AC 0.35: Pearl 1.40, Jade 2.10.
    expect([e1.baseline, e1.upgrades.map((u) => [u.item.name, u.gain])]).toEqual([140, [['Jade Earring', 70]]]);
    expect([e2.baseline, e2.worn, e2.upgrades.map((u) => [u.item.name, u.gain])]).toEqual([0, [], [['Pearl Earring', 140], ['Jade Earring', 210]]]);
    // Against the empty side, each is compared with nothing: the stat line's baseline is empty.
    expect(e2.upgrades.every((u) => u.against.length === 1 && u.against[0] === null && u.except.length === 1 && u.except[0] === 'ear2')).toBe(true);
  });

  it('order 40: haste elsewhere counts the other side of the pair', () => {
    const fast = mk('Haste Bracer', ['WRIST'], { haste: 20 });
    const faster = mk('Faster Bracer', ['WRIST'], { haste: 25 });
    // A Rogue (haste 1 per %) wearing a 20% bracer on Wrist 1: on an empty Wrist 2, a 25% bracer adds only 5.
    const r = compareSlot(upgradeSlot('wrist2')!, ctxFor('ROG', { wrist1: fast }), anyone, [fast, faster]);
    expect(r.upgrades.map((u) => [u.item.name, u.gain])).toEqual([['Faster Bracer', 500]]);
    // And on Wrist 1 itself, its own haste counts in full (nothing else worn).
    const r1 = compareSlot(upgradeSlot('wrist1')!, ctxFor('ROG', { wrist1: fast }), anyone, [faster]);
    expect([r1.baseline, r1.upgrades[0].gain]).toEqual([2000, 500]);
  });

  it('a two-hander for Primary compares with Primary plus Secondary', () => {
    const sword = mk('Sword', ['PRIMARY', 'SECONDARY'], { stats: { STA: 3 } });
    const shield = mk('Shield', ['SECONDARY'], { ac: 10 });
    const great = mk('Greatsword', ['PRIMARY'], { stats: { STA: 8 } }, { twoHanded: true });
    const r = compareSlot(upgradeSlot('primary')!, ctxFor('FTR', { primary: sword, secondary: shield }), anyone, [great]);
    // 8 STA = 8.00 against 3 STA + 10 AC = 3.00 + 3.50 = 6.50.
    expect(r.upgrades.map((u) => [u.item.name, u.baseline, u.gain, u.note])).toEqual([['Greatsword', 650, 150, null]]);
  });

  it('a one-hander for Primary under a worn two-hander compares with the two-hander alone (Secondary is then free)', () => {
    const great = mk('Greatsword', ['PRIMARY'], { stats: { STA: 4 } }, { twoHanded: true });
    const dagger = mk('Dagger', ['PRIMARY'], { stats: { STA: 5 } });
    const r = compareSlot(upgradeSlot('primary')!, ctxFor('FTR', { primary: great }), anyone, [dagger]);
    expect(r.upgrades.map((u) => [u.baseline, u.gain, u.note])).toEqual([[400, 100, 'secondaryFree']]);
  });

  it("a Secondary candidate under a worn two-hander compares with the two-hander's score, and notes it needs a one-handed Primary", () => {
    const great = mk('Greatsword', ['PRIMARY'], { stats: { STA: 4 } }, { twoHanded: true });
    const small = mk('Small Shield', ['SECONDARY'], { ac: 5 });
    const big = mk('Tower Shield', ['SECONDARY'], { ac: 20 });
    const r = compareSlot(upgradeSlot('secondary')!, ctxFor('FTR', { primary: great }), anyone, [small, big]);
    // 5 AC = 1.75 is below the two-hander's 4.00 (not listed); 20 AC = 7.00 is 3.00 above it.
    expect(r.upgrades.map((u) => [u.item.name, u.gain, u.note])).toEqual([['Tower Shield', 300, 'needsOneHand']]);
  });

  it('an item that fits Primary and Secondary is a candidate in both, compared separately', () => {
    const sword = mk('Sword', ['PRIMARY', 'SECONDARY'], { stats: { STA: 3 } });
    const ctx = ctxFor('FTR');
    expect(compareSlot(upgradeSlot('primary')!, ctx, anyone, [sword]).upgrades).toHaveLength(1);
    expect(compareSlot(upgradeSlot('secondary')!, ctx, anyone, [sword]).upgrades).toHaveLength(1);
  });

  it('class and race filters; a character with no race uses any; removed and no-longer-listed items are never candidates', () => {
    const ftrOnly = mk('Fighter Helm', ['HEAD'], { ac: 5 }, { classMask: 1 << 0 });
    const wizOnly = mk('Wizard Hat', ['HEAD'], { ac: 5 }, { classMask: 1 << 1 });
    const elfOnly = mk('Elf Circlet', ['HEAD'], { ac: 5 }, { raceMask: 1 << 3 });
    const removed = mk('Old Helm', ['HEAD'], { ac: 9 }, { sourceMask: REMOVED_BIT });
    const gone = mk('Gone Helm', ['HEAD'], { ac: 9 }, { gone: true });
    const names = (w: Wearer) => compareSlot(upgradeSlot('head')!, ctxFor('FTR'), w, [ftrOnly, wizOnly, elfOnly, removed, gone]).upgrades.map((u) => u.item.name).sort();
    expect(names({ classBit: 0, raceBit: 2 })).toEqual(['Fighter Helm']);
    expect(names({ classBit: 0, raceBit: 3 })).toEqual(['Elf Circlet', 'Fighter Helm']);
    expect(names({ classBit: 0, raceBit: null })).toEqual(['Elf Circlet', 'Fighter Helm']); // no race: any
  });

  it("damage ÷ delay counts in Primary and Range always, in Secondary only for the Melee and Tank presets", () => {
    const blade = mk('Blade', ['PRIMARY', 'SECONDARY', 'RANGE', 'WAIST'], { dmg: 10, delay: 20 }); // ratio 0.5 → 50
    const caster = { ...W('WIZ'), RATIO: 10 }; // a Caster with a ratio weight, to see the slot rule alone
    const gainIn = (slot: string, cls: string, w?: Weights) => compareSlot(upgradeSlot(slot)!, ctxFor(cls, {}, anyone, w), anyone, [blade]).upgrades[0]?.gain ?? 0;
    expect([gainIn('primary', 'WIZ', caster), gainIn('range', 'WIZ', caster), gainIn('secondary', 'WIZ', caster), gainIn('waist', 'WIZ', caster)]).toEqual([500, 500, 0, 0]);
    expect([gainIn('secondary', 'FTR'), gainIn('secondary', 'ROG')]).toEqual([500, 1500]);
    // A shield has no ratio and scores its stats only.
    expect(statVector(JSON.stringify({ ac: 10 }))[WEIGHT_KEYS.indexOf('RATIO')]).toBe(0);
  });

  it('haste: a second haste item adds only what it exceeds the highest worn elsewhere; the worn item is valued the same way', () => {
    const belt = mk('Haste Belt', ['WAIST'], { haste: 20 });
    const cloakLow = mk('Cloak 10', ['BACK'], { haste: 10 });
    const cloakHigh = mk('Cloak 25', ['BACK'], { haste: 25 });
    const ctx = ctxFor('ROG', { waist: belt });
    const r = compareSlot(upgradeSlot('back')!, ctx, anyone, [cloakLow, cloakHigh]);
    // Rogue haste weight 1 per %: 10 adds nothing over the belt's 20; 25 adds 5.
    expect(r.upgrades.map((u) => [u.item.name, u.gain])).toEqual([['Cloak 25', 500]]);
    // The belt itself, with a 25% cloak worn: its own haste counts 0, so a 21% belt is no upgrade but a 30% one adds 5.
    const ctx2 = ctxFor('ROG', { waist: belt, back: cloakHigh });
    const r2 = compareSlot(upgradeSlot('waist')!, ctx2, anyone, [mk('Belt 21', ['WAIST'], { haste: 21 }), mk('Belt 30', ['WAIST'], { haste: 30 })]);
    expect(r2.upgrades.map((u) => [u.item.name, u.gain])).toEqual([['Belt 30', 500]]);
  });

  it('a worn item no longer listed, or no longer usable, scores 0', () => {
    const cand = mk('Cap', ['HEAD'], { ac: 2 });
    const gone = mk('Gone Cap', ['HEAD'], { ac: 50 }, { gone: true });
    expect(compareSlot(upgradeSlot('head')!, ctxFor('FTR', { head: gone }), anyone, [cand]).baseline).toBe(0);
    const wizHat = mk('Wizard Cap', ['HEAD'], { ac: 50 }, { classMask: 1 << 1 });
    const ftr: Wearer = { classBit: 0, raceBit: null };
    const r = compareSlot(upgradeSlot('head')!, ctxFor('FTR', { head: wizHat }, ftr), ftr, [cand]);
    expect([r.baseline, r.worn[0].reason]).toEqual([0, 'cantUse']);
    // A key that names no item row at all.
    expect(compareSlot(upgradeSlot('head')!, ctxFor('FTR', { head: null }), anyone, [cand]).baseline).toBe(0);
  });
});

describe('order 36, ITEM 2: review fixes', () => {
  it('a 5th place or later weighs 0; a fractional stat is rounded, so scores stay whole hundredths', () => {
    const w = presetWeights('Melee', 'STR › STA › DEX › AGI › INT');
    expect([w.STR, w.STA, w.DEX, w.AGI, w.INT]).toEqual([100, 50, 25, 25, 0]);
    expect(statVector(JSON.stringify({ hpRegen: 0.5, ac: 2.4 })).filter((x) => x !== 0)).toEqual([2, 1]);
  });

  it("a two-hander's baseline values the worn Secondary weapon by Secondary's rule (no ratio for a Caster)", () => {
    const dagger = mk('Dagger', ['SECONDARY'], { dmg: 10, delay: 20 });
    const staff = mk('Staff', ['PRIMARY'], { stats: { INT: 1 } }, { twoHanded: true });
    const caster = { ...W('WIZ'), RATIO: 10 };
    const r = compareSlot(upgradeSlot('primary')!, ctxFor('WIZ', { secondary: dagger }, anyone, caster), anyone, [staff]);
    // The dagger's ratio (50 × 0.10) counts nothing in Secondary for a Caster: the baseline is 0.
    expect(r.upgrades.map((u) => [u.baseline, u.gain])).toEqual([[0, 100]]);
  });

  it('a gone two-hander still takes both hands (saved gear refuses Secondary under it) and scores 0', () => {
    const great = mk('Old Greatsword', ['PRIMARY'], { stats: { STA: 9 } }, { twoHanded: true, gone: true });
    const shield = mk('Shield', ['SECONDARY'], { ac: 1 });
    const r = compareSlot(upgradeSlot('secondary')!, ctxFor('FTR', { primary: great }), anyone, [shield]);
    expect(r.upgrades.map((u) => [u.baseline, u.note])).toEqual([[0, 'needsOneHand']]);
  });

  it('two-handers are never Secondary candidates', () => {
    const big = mk('Big Axe', ['PRIMARY', 'SECONDARY'], { stats: { STA: 9 } }, { twoHanded: true });
    expect(compareSlot(upgradeSlot('secondary')!, ctxFor('FTR'), anyone, [big]).upgrades).toEqual([]);
  });
});

describe('order 40: slots and order', () => {
  it('20 slots, from WEAR_SLOTS; the old pair keys are derived and read as their first side', () => {
    expect(UPGRADE_SLOTS.map((s) => s.key)).toEqual([
      'head', 'face', 'ear1', 'ear2', 'neck', 'shoulders', 'back', 'chest', 'shirt', 'wrist1', 'wrist2', 'hands', 'waist', 'finger1', 'finger2', 'legs', 'feet', 'primary', 'secondary', 'range',
    ]);
    expect([...OLD_PAIR_KEYS]).toEqual([['ear', ['ear1', 'ear2']], ['wrist', ['wrist1', 'wrist2']], ['finger', ['finger1', 'finger2']]]);
    expect(resolveSlot('wrist')).toMatchObject({ slot: { key: 'wrist1', label: 'Wrist 1' }, oldSides: ['wrist1', 'wrist2'] });
    expect(resolveSlot('wrist2')).toMatchObject({ slot: { key: 'wrist2' }, oldSides: null });
    expect([resolveSlot('nope'), resolveSlot('')]).toEqual([null, null]);
  });

  it('order 36 follow-up: no cap lists every level; a cap hides what is above it (any-level kinds are 0); no level is unknown', () => {
    expect([levelGroup({ levelLow: 63 }, null), levelGroup({ levelLow: null }, null)]).toEqual(['listed', 'unknown']);
    expect([levelGroup({ levelLow: 30 }, 30), levelGroup({ levelLow: 31 }, 30), levelGroup({ levelLow: 0 }, 1), levelGroup({ levelLow: null }, 1)]).toEqual(['listed', 'above', 'listed', 'unknown']);
  });

  it('smallest gain first; ties go to the lower level_low, then the name', () => {
    const u = (name: string, gain: number, low: number | null) => ({ item: mk(name, ['HEAD'], {}, { levelLow: low }), gain, score: 0, baseline: 0, against: [], token: 'HEAD' as const, except: [], side: null, note: null });
    const ups = [u('Zed', 200, 5), u('Bee', 100, 9), u('Ant', 100, 9), u('Cat', 100, 3), u('Dog', 50, 40), u('Elk', 10, null)];
    const g = grouped(ups, 20);
    expect(g.listed.map((x) => x.item.name)).toEqual(['Cat', 'Ant', 'Bee', 'Zed']);
    expect(grouped(ups, null).listed.map((x) => x.item.name)).toEqual(['Dog', 'Cat', 'Ant', 'Bee', 'Zed']);
    expect(g.above.map((x) => x.item.name)).toEqual(['Dog']);
    expect(g.unknown.map((x) => x.item.name)).toEqual(['Elk']);
    expect([...ups].sort(byGain)[0].item.name).toBe('Elk');
  });
});

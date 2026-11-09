// Order 42: every member is shown once, as their saved name in plain text; the mention alone only with no saved name.
import { describe, expect, it } from 'vitest';
import { memberTag } from '../../src/discord.ts';
import { howToGet } from '../../src/gear/upgrades.ts';
import { statVector, type GearItem } from '../../src/gear/score.ts';
import { buildSourceIndex } from '../../src/gear/sources.ts';

const ID = '100000000000000042';

describe('memberTag (order 42)', () => {
  it('a saved name is shown alone, markdown-escaped, with no mention', () => {
    expect(memberTag(ID, 'Kestrel')).toBe('Kestrel');
    expect(memberTag(ID, 'Kes_trel*')).toBe('Kes\\_trel\\*');
    expect(memberTag(ID, 'Kestrel')).not.toContain('<@');
  });

  it('no saved name (none, empty, or the id itself from coalesce(display_name, member_id)) shows the mention alone, never a raw id', () => {
    for (const none of [undefined, null, '', ID]) {
      expect(memberTag(ID, none)).toBe(`<@${ID}>`);
      expect(memberTag(ID, none).replace(`<@${ID}>`, '')).toBe('');
    }
  });
});

// The same hand-made page data as test/worker/upgrades.test.ts's "how to get it".
const gi = (o: Partial<GearItem>): GearItem => ({
  id: 1, name: 'X', key: 'x', slotMask: 1, classMask: -1, raceMask: -1, sourceMask: 0, gone: false, twoHanded: false, levelLow: null, levelHigh: null, levelKind: null, levelKinds: null, v: statVector(null), ratio: null, ...o,
});
const extras = (crafters: unknown[]) => ({
  rows: new Map([[1, { origin_json: '{}', source_mask: 0 }]]),
  d: { classes: [], mobs: [], recipes: [{ id: 7, item_id: 1, tradeskill: 'Blacksmithing', trivial: 45, acquisition: 'vendor', trivial_corrected: 0, trivial_unconfirmed: 0 }], crafters, version: null } as any,
  src: buildSourceIndex('t', { mobs: [], npcs: [], zoneNames: [], zones: [] }),
});
const crafter = (owner: string, member: string, character: string, level: number) => ({ recipe_id: 7, character, owner_user_id: owner, member, class: null, char_level: null, level, knows_recipe: 0 });

describe('how to get it: Reliable crafters, one line per member (order 42)', () => {
  it('two Reliable characters owned by one member: listed once, by their first; told apart by owner id, not by the shown name', () => {
    // 202 owns two Reliable characters. 206 is a different member who happens to share the saved name "Dee".
    const crafters = [crafter('202', 'Dee', 'Dorn', 180), crafter('202', 'Dee', 'Dorn2', 150), crafter('206', 'Dee', 'Dax', 120)];
    const h = howToGet(gi({ levelKind: 'crafted', levelKinds: 'crafted' }), extras(crafters), '999', 25);
    expect(h.lines[1]).toBe('Reliable in your guild: Dee: Dorn 180, Dee: Dax 120');
    expect(h.lines[1]).not.toContain('Dorn2');
    expect(h.lines[1]).not.toContain('<@');
  });
});

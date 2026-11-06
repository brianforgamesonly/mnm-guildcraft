// Order 37, ITEMs 1 and 2: the drop line's creature and the vendor line's merchants (src/gear/sources.ts), through
// /gear upgrades' howToGet. Pure: hand-made page data, and source rows copied from the real data where the order says so.
import { describe, expect, it } from 'vitest';
import { howToGet, UPGRADES_COPY, type Extras } from '../../src/gear/upgrades.ts';
import { buildSourceIndex, clearSourceIndex, dropPick, sourceIndex, vendorParts } from '../../src/gear/sources.ts';
import { statVector, type GearItem } from '../../src/gear/score.ts';
import { computeLevels } from '../../scripts/import/levels.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE } from '../../src/zone/names.ts';

type Rows = Parameters<typeof buildSourceIndex>[1];
const src = (r: Partial<Rows> = {}) => buildSourceIndex('t', { mobs: [], npcs: [], zoneNames: [], zones: [], ...r });
const gi = (o: Partial<GearItem>): GearItem => ({
  id: 1, name: 'X', key: 'x', slotMask: 1, classMask: -1, raceMask: -1, sourceMask: 0, gone: false, twoHanded: false, levelLow: null, levelHigh: null, levelKind: null, levelKinds: null, v: statVector(null), ...o,
});
const extras = (origin: unknown, s = src()): Extras => ({
  rows: new Map([[1, { origin_json: JSON.stringify(origin), source_mask: 0 }]]),
  d: { classes: [], mobs: [], recipes: [], crafters: [], version: null },
  src: s,
});
const lines = (it: Partial<GearItem>, origin: unknown, s: ReturnType<typeof src>) => howToGet(gi(it), extras(origin, s), '100', 25).lines;
const zone = (key: string, name: string, level: string | null = null) => ({ key, name, level });
const names = (key: string, name: string, sources = [MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE]) => sources.map((source) => ({ source, name, zone_key: key }));
const npc = (name: string, zone_key: string, level: string | null = null, loot: string[] | null = null) => ({ name, zone_key, level, loot_json: loot ? JSON.stringify(loot) : null });
const mob = (key: string, level: string | null, zones: string[], loot: string[] | null = null) => ({ key, title: key[0].toUpperCase() + key.slice(1), level, zones_json: JSON.stringify(zones), loot_json: loot ? JSON.stringify(loot) : null });

// ---------------------------------------------------------------- ITEM 1

// Corroded Bronze Plate Breastplate's source data as production imported it (run 42274262832: mnm-tools aa4f1eb, wiki
// snapshot revid 86997), read from a local import of the same inputs on 2026-11-06: its from list and wikiZones, every
// creature row with a level among them, a creature row with no level, the NPC whose loot names it, and their zones.
const BREASTPLATE = {
  key: 'corroded bronze plate breastplate',
  origin: {
    from: ['a Sangrel striker', 'a Blacktide raider', 'a Muggrah brawler', 'an ashira warrior', 'a gruff farmhand', 'a tavern patron', 'a Muggrah raider', 'a Muggrah scrapper', 'a dusty skeleton', 'a restless skeleton', 'a restless ghoul', 'a smuggler', 'a goon', 'a lawbreaker', 'a ransacker', 'a drunken dockworker', 'a river pirate', 'a cultist', 'a scoundrel', 'a cunning privateer', 'a Bloodchain sentry', 'a fallen sergeant', 'a vagrant', 'a bulky bandit'],
    wikiZones: ["Keeper's Bight", 'Sungreet Strand', 'Fallen Pass', 'Night Harbor', 'Blacktide Bay', 'Ancient Crypt', 'Caves of Irem', 'Glass Flats', 'Scarwood'],
  },
  rows: {
    mobs: [mob('a lawbreaker', '17', ['Night Harbor']), mob('a restless ghoul', '23-25', ['Fallen Pass']), mob('a restless skeleton', '20-23', ['Fallen Pass']), mob('a river pirate', '19', ['Night Harbor']), mob('a goon', null, ['Night Harbor'])],
    npcs: [
      npc('a Blacktide raider', "keeper's bight", '23-25'),
      npc('a restless ghoul', 'fallen pass', '23-25'),
      npc('a restless skeleton', 'fallen pass', '20-23'),
      npc('a cultist', 'glass flats', '?'),
      npc('a cultist', 'night harbor', '14 - 17'),
      npc('a cultist', 'shaded dunes', '14 - 17'),
      npc('a Muggrah raider', 'glass flats', '17-22'),
      npc('a Muggrah raider', 'sungreet strand', '17-22'),
      npc('a lawbreaker', 'night harbor', '17'),
      npc('a river pirate', 'night harbor', '19'),
      npc('a river pirate', 'sungreet strand', '19'),
      npc('High Marshal Fionna', 'tomb of the last wyrmsbane', '~15', ['Corroded Bronze Plate Breastplate']),
    ],
    zones: [zone('night harbor', 'Night Harbor', '1 - 50'), zone('shaded dunes', 'Shaded Dunes'), zone('glass flats', 'Glass Flats', '20+'), zone('fallen pass', 'Fallen Pass', '19 - 44'), zone('sungreet strand', 'Sungreet Strand'), zone("keeper's bight", "Keeper's Bight", '5 - ??'), zone('tomb of the last wyrmsbane', 'Tomb of the Last Wyrmsbane', '3-15')],
    zoneNames: [
      ...names('night harbor', 'Night Harbor'), ...names('shaded dunes', 'Shaded Dunes'), ...names('glass flats', 'Glass Flats', [WIKI_ZONES_SOURCE]), ...names('fallen pass', 'Fallen Pass'),
      ...names('sungreet strand', 'Sungreet Strand'), ...names("keeper's bight", "Keeper's Bight"), ...names('tomb of the last wyrmsbane', 'Tomb of the Last Wyrmsbane'),
    ],
  },
};

describe('order 37, ITEM 1: the drop line names the creature with the lowest level', () => {
  it("Corroded Bronze Plate Breastplate: a cultist (its NPC rows' 14 - 17), in Night Harbor; the import's level_low is 14 too", () => {
    const s = src(BREASTPLATE.rows);
    expect(lines({ key: BREASTPLATE.key, levelKind: 'mob', levelKinds: 'mob', levelLow: 14, levelHigh: 25 }, BREASTPLATE.origin, s)).toEqual(['Drop: a cultist in Night Harbor · Lv 14–17 · +24 more']);
    // The same rows through the import's own computation (scripts/import/levels.ts computeLevels): the shown level is level_low.
    const { rows } = BREASTPLATE;
    const parse = (v: string | null) => (v ? (JSON.parse(v) as string[]) : []);
    const { levels } = computeLevels(
      {
        items: [{ key: BREASTPLATE.key, from: BREASTPLATE.origin.from, sold: false, harvested: false, questCategory: false }],
        mobs: rows.mobs.map((m) => ({ key: m.key, title: m.title, level: m.level, zones: parse(m.zones_json), loot: parse(m.loot_json) })),
        npcs: rows.npcs.map((n) => ({ name: n.name, zone_key: n.zone_key, level: n.level, loot: parse(n.loot_json) })),
        zones: rows.zones.map((z) => ({ key: z.key, level: z.level })),
        zoneNames: rows.zoneNames,
        recipes: [],
        quests: [],
      },
      new Set([BREASTPLATE.key]),
    );
    expect(levels.get(BREASTPLATE.key)).toMatchObject({ level_low: 14, level_high: 25, level_kind: 'mob' });
    expect(dropPick(s, BREASTPLATE.key, BREASTPLATE.origin.from, BREASTPLATE.origin.wikiZones)).toMatchObject({ name: 'a cultist', range: { low: 14, high: 17 }, more: 24 });
  });

  it("a creature linked only by its loot counts, and is named as the data writes it", () => {
    const s = src({ npcs: [npc('High Marshal Fionna', 'tomb', '~15', ['Old Shield']), npc('a rat', 'tomb', '20')], zones: [zone('tomb', 'Tomb')], zoneNames: names('tomb', 'Tomb') });
    expect(lines({ key: 'old shield', levelKind: 'mob', levelKinds: 'mob', levelLow: 15, levelHigh: 20 }, { from: ['a rat'] }, s)).toEqual(['Drop: High Marshal Fionna in Tomb · Lv 15 · +1 more']);
  });

  it('a tie goes to the creature whose zone comes first in wikiZones, then the name', () => {
    const rows = { npcs: [npc('a zebra', 'east', '10'), npc('an aardvark', 'west', '10'), npc('a yak', 'east', '10')], zones: [zone('east', 'East'), zone('west', 'West')], zoneNames: [...names('east', 'East'), ...names('west', 'West')] };
    const it = { levelKind: 'mob', levelKinds: 'mob', levelLow: 10, levelHigh: 10 };
    expect(lines(it, { from: ['an aardvark', 'a zebra', 'a yak'], wikiZones: ['East', 'West'] }, src(rows))).toEqual(['Drop: a yak in East · Lv 10 · +2 more']);
    expect(lines(it, { from: ['an aardvark', 'a zebra', 'a yak'], wikiZones: ['West', 'East'] }, src(rows))).toEqual(['Drop: an aardvark in West · Lv 10 · +2 more']);
  });

  it('review fix: a tie is settled by the zones where the creature has that level, the zone the line shows', () => {
    const rows = { npcs: [npc('a rat', 'harbor', '14'), npc('a rat', 'east', '30'), npc('a bat', 'west', '14')], zones: [zone('harbor', 'Harbor'), zone('east', 'East'), zone('west', 'West')], zoneNames: [...names('harbor', 'Harbor'), ...names('east', 'East'), ...names('west', 'West')] };
    expect(lines({ levelKind: 'mob', levelKinds: 'mob', levelLow: 14 }, { from: ['a rat', 'a bat'], wikiZones: ['East', 'West', 'Harbor'] }, src(rows))).toEqual(['Drop: a bat in West · Lv 14 · +1 more']);
  });

  it('loot: an item name holding a quote is still matched exactly; the raw path agrees with the import\'s lists', () => {
    const s = src({ npcs: [npc('a sage', 'tomb', '9', ['The "Old" Ring']), npc('a fool', 'tomb', '2', ['The Old Ring'])], zones: [zone('tomb', 'Tomb')], zoneNames: names('tomb', 'Tomb') });
    expect(dropPick(s, 'the "old" ring', [], [])).toMatchObject({ name: 'a sage', more: 0 });
    expect(dropPick(s, 'the old ring', [], [])).toMatchObject({ name: 'a fool', more: 0 });
  });

  it('creatures with no level come after every creature with one; a mob row with no level falls back to its NPC rows', () => {
    const rows = {
      mobs: [mob('a ghost', null, ['Crypt']), mob('a bat', '30', ['Crypt'])],
      npcs: [npc('a ghost', 'crypt', '25 - 27'), npc('a rat', 'crypt')],
      zones: [zone('crypt', 'Crypt')],
      zoneNames: names('crypt', 'Crypt'),
    };
    expect(lines({ levelKind: 'mob', levelKinds: 'mob', levelLow: 25, levelHigh: 30 }, { from: ['a rat', 'a bat', 'a ghost'] }, src(rows))).toEqual(['Drop: a ghost in Crypt · Lv 25–27 · +2 more']);
  });

  it('an item whose creatures have no level still shows the zone fallback, named as such', () => {
    const rows = { mobs: [mob('a ghost', null, ['Crypt'])], zones: [zone('crypt', 'Crypt', '20 - 30')], zoneNames: names('crypt', 'Crypt') };
    expect(lines({ levelKind: 'zone', levelKinds: 'zone', levelLow: 20, levelHigh: 30 }, { from: ['a ghost', 'a shade'] }, src(rows))).toEqual(['Drop: a ghost in Crypt · zone Lv 20–30 · +1 more']);
  });

  it('a vendor item that also drops: the vendor line first, then the drop line naming its lowest-level creature', () => {
    const rows = {
      npcs: [npc('Quartermaster Obaid', 'night harbor'), npc('a goblin', 'night harbor', '8 - 10'), npc('a hobgoblin', 'night harbor', '12')],
      zones: [zone('night harbor', 'Night Harbor')],
      zoneNames: names('night harbor', 'Night Harbor'),
    };
    const origin = { soldBy: { vendors: ['Night Harbor', 'Quartermaster Obaid'] }, from: ['a hobgoblin', 'a goblin'] };
    expect(lines({ levelKind: 'vendor', levelKinds: 'vendor,mob', levelLow: 0 }, origin, src(rows))).toEqual([
      'Vendor: Quartermaster Obaid, Night Harbor · any level',
      'Drop: a goblin in Night Harbor · Lv 8–10 · +1 more',
    ]);
  });

  it('the zone shown is the zone button the reply offers (items\' wikiZones names first)', () => {
    const s = src(BREASTPLATE.rows);
    const h = howToGet(gi({ key: BREASTPLATE.key, levelKind: 'mob', levelKinds: 'mob', levelLow: 14 }), extras(BREASTPLATE.origin, s), '100', 25);
    expect(h.zones).toEqual([{ source: WIKI_ZONES_SOURCE, name: 'Night Harbor' }]);
  });
});

describe('order 37: the source index is read once per finished import', () => {
  it('cached by version; read again on a new version; never cached while the newest import has no finish time', async () => {
    let reads = 0;
    const stmt = { all: async () => ({ results: [], meta: { rows_read: 1 } }) };
    const db = { prepare: () => stmt, batch: async (l: unknown[]) => (reads++, l.map(() => ({ results: [], meta: { rows_read: 1 } }))) } as unknown as D1Database;
    clearSourceIndex();
    expect((await sourceIndex(db, '1:ok:t')).rowsRead).toBe(4);
    expect((await sourceIndex(db, '1:ok:t')).rowsRead).toBe(0);
    await sourceIndex(db, '2:ok:t');
    await sourceIndex(db, '3:running:');
    await sourceIndex(db, '3:running:');
    expect(reads).toBe(4);
    clearSourceIndex();
  });
});

// ---------------------------------------------------------------- ITEM 2

const NH = { npcs: [npc('Master Tailor Sansha', 'night harbor'), npc('a bowyer', 'night harbor'), npc('a bowyer', 'faelindral'), npc('Gorn, the Smith', 'faelindral'), npc('Rais Alyssum', 'night harbor'), npc('Ilyra Luthielle', 'evershade weald'), npc('a fletcher', 'faelindral')],
  zones: [zone('night harbor', 'Night Harbor'), zone('faelindral', 'Faelindral'), zone('evershade weald', 'Evershade Weald')],
  zoneNames: [...names('night harbor', 'Night Harbor'), ...names('faelindral', 'Faelindral'), ...names('evershade weald', 'Evershade Weald', ['atlas:maps'])] };
const vendor = (v: string[]) => lines({ levelKind: 'vendor', levelKinds: 'vendor', levelLow: 0 }, { soldBy: { vendors: v } }, src(NH))[0];

describe('order 37, ITEM 2: vendor lines name the merchant, from npc and zone_name, exactly', () => {
  it('"Night Harbor, Master Tailor Sansha": the merchant, then its zone (npc.zone_key joined to zone)', () => {
    expect(vendor(['Night Harbor', 'Master Tailor Sansha'])).toBe('Vendor: Master Tailor Sansha, Night Harbor · any level');
    // The same record as one string, split on its comma; case and spaces don't matter, the match is still whole.
    expect(vendor([' night harbor ,MASTER TAILOR SANSHA'])).toBe('Vendor: MASTER TAILOR SANSHA, Night Harbor · any level');
    // Never partial: a shorter name is not the merchant (and with no merchant, the zone is shown).
    expect(vendor(['Night Harbor', 'Master Tailor'])).toBe('Vendor: Night Harbor, Master Tailor · any level');
  });

  it('a merchant in two zones takes the zone the record names; with none named, "(2 zones)"', () => {
    expect(vendor(['Faelindral', 'a bowyer'])).toBe('Vendor: a bowyer, Faelindral · any level');
    expect(vendor(['a bowyer'])).toBe('Vendor: a bowyer (2 zones) · any level');
  });

  it('a name containing a comma matches whole, before its parts', () => {
    expect(vendor(['Faelindral', 'Gorn', 'the Smith'])).toBe('Vendor: Gorn, the Smith, Faelindral · any level');
  });

  it('a part matching neither table, and a recorded zone that is not the merchant\'s, are shown as recorded after the merchants', () => {
    expect(vendor(['Night Harbor', 'Master Tailor Sansha', 'Fishing Supplies'])).toBe('Vendor: Master Tailor Sansha, Night Harbor; Fishing Supplies · any level');
    expect(vendor(['Faelindral', 'Master Tailor Sansha'])).toBe('Vendor: Master Tailor Sansha, Night Harbor; Faelindral · any level');
  });

  it('several merchants: the first two, then "+N more" counting merchants only', () => {
    expect(vendor(['Night Harbor', 'Rais Alyssum', 'Evershade Weald', 'Ilyra Luthielle', 'Faelindral', 'a fletcher', 'a bowyer', 'Mining Supplies'])).toBe(
      'Vendor: Rais Alyssum, Night Harbor; Ilyra Luthielle, Evershade Weald +2 more; Mining Supplies · any level',
    );
  });

  it('a record with only a zone names the zone as the zone table does; an empty record says where is not recorded', () => {
    expect(vendor(['night harbor'])).toBe('Vendor: Night Harbor · any level');
    expect(vendor([])).toBe(UPGRADES_COPY.vendorUnnamed);
  });

  it('review fix: a merchant in several zones takes the record\'s zone nearest before it', () => {
    expect(vendor(['Night Harbor', 'Rais Alyssum', 'Faelindral', 'a bowyer'])).toBe('Vendor: Rais Alyssum, Night Harbor; a bowyer, Faelindral · any level');
  });

  it('an NPC whose zone is not an active zone takes the record\'s zone before it', () => {
    const s = src({ ...NH, npcs: [...NH.npcs, npc('a tinker', 'gone zone')] });
    expect(vendorParts(s, ['Faelindral', 'a tinker'])).toMatchObject({ merchants: ['a tinker, Faelindral'], rest: [] });
  });
});

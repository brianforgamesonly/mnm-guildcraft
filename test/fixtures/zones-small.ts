// Order 17: small zone sources shaped like the real ones (mnm-tools maps.json, MnM Atlas data/maps.json, Mo Betta
// zones.json and npcs.json), with each case the zone import handles: a curly apostrophe, a case variant, a space-only
// list, " or ", an unmatched adjacent zone, a shared placeholder map, records equal but for case, a merchant, and a mob
// whose fields conflict with Mo Betta's or are filled by it.
import type { WikiData } from '../../scripts/import/core.ts';
import type { ZoneInput } from '../../scripts/import/zones.ts';

export function zoneInput(changedAt = '2026-10-20T00:00:00Z'): ZoneInput {
  return {
    files: {
      'mnm-tools/maps.json': {
        generatedAt: '2026-07-02T00:00:00Z',
        categories: [],
        zones: [
          {
            name: 'Evershade Weald',
            image: 'evershade_weald.avif',
            markers: [
              { x: 1, y: 2, label: 'Copper Vein', category: 'ore', notes: '' },
              { x: 3, y: 4, label: 'Old Hermit', category: 'quest', notes: 'https://mnm-db.com/#/mob/x\n\nAsk twice' },
            ],
            width: 10,
            height: 10,
          },
          { name: "Keeper's Bight", image: 'keeper_s_bight.avif', markers: [] },
          { name: 'Rothold', image: 'rothold.avif', markers: [], source: 'wiki: Rothold map by skoop.png' },
        ],
      },
      'mnmatlas/maps.json': {
        version: 1,
        defaultMap: 'world',
        maps: [
          { id: 'world', title: 'World map' },
          { id: 'evershade-weald', title: 'Evershade Weald' },
          { id: 'keepers-bight', title: 'Keeper’s Bight' },
          { id: 'rothold', title: 'Rothold' },
        ],
      },
      'mo-betta/zones.json': {
        source: 'https://example.invalid',
        fetched: '2026-10-20',
        zones: [
          {
            name: 'Evershade Weald', level: '1 - ??', description: 'A forest.', adjacent: ["Keeper's Bight", 'Fields of the Lost'],
            map_file: 'File:Phformaps.png', map: 'https://example.invalid/Phformaps.png', url: 'https://monstersandmemories.miraheze.org/wiki/Evershade_Weald',
          },
          {
            name: "Keeper's Bight", level: '5 - ??', description: 'A coast.', adjacent: ['Evershade Weald'],
            map_file: 'File:Phformaps.png', map: 'https://example.invalid/Phformaps.png', url: 'https://monstersandmemories.miraheze.org/wiki/Keeper%27s_Bight',
          },
          { name: 'Rothold', level: '30-45', description: '', adjacent: [], map_file: '', map: '', url: 'https://monstersandmemories.miraheze.org/wiki/Rothold' },
          { name: 'Ail\'Vorith', level: '1 - 50', description: 'Deep.', adjacent: [], url: 'https://monstersandmemories.miraheze.org/wiki/Ail%27Vorith' },
        ],
      },
      'mo-betta/npcs.json': {
        source: 'https://example.invalid',
        fetched: '2026-10-20',
        npcs: [
          // Order 24: factions ("Reputation Lost") and opposing_factions ("Reputation Gained"), as the wiki infobox records them.
          { name: 'A gnoll scout', kind: 'npc', level: '~8-11', zone: 'Evershade Weald', race: 'Gnoll', class: '', location: 'North', loot: ['Gnoll Tooth'], factions: ['Gnoll Pack'], opposing_factions: ['Weald Rangers'] },
          { name: 'A Gnoll scout', kind: 'npc', level: '', zone: 'Evershade Weald', race: 'Gnoll', class: 'Warrior', location: 'South', loot: [], factions: [' Gnoll Pack '], opposing_factions: [] },
          { name: 'Marshal Harding', kind: 'npc', level: '20', zone: "Evershade Weald, Keeper's Bight", race: 'Human', class: 'Paladin', location: '', loot: [], factions: ['Weald Rangers'], opposing_factions: ['Gnoll Pack', 'Gnoll Pack Elders'] },
          { name: 'Supplier Jul', kind: 'merchant', level: '', zone: "Ail'vorith", race: 'Deep Elf', class: '', location: '', loot: [], factions: [], opposing_factions: [] },
          { name: 'A wanderer', kind: 'npc', level: '', zone: "Rothold or Keeper's Bight", race: '', class: '', location: '', loot: [] },
          { name: 'A lost soul', kind: 'npc', level: '??', zone: 'Evershade Weald Rothold', race: '', class: '', location: '', loot: [], factions: ['Weald Rangers'] },
          { name: 'A nobody', kind: 'npc', level: '', zone: '', race: '', class: '', location: '', loot: [], factions: ['Lost Cause'], opposing_factions: [] },
        ],
      },
    },
    versions: [
      { name: 'mnm-tools/wiki.json', sha: 'b'.repeat(40), changedAt: '2026-10-20T00:00:00Z' },
      { name: 'mnm-tools/maps.json', sha: 'c'.repeat(40), changedAt },
      { name: 'mnmatlas/maps.json', sha: 'd'.repeat(40), changedAt: '2025-01-01T00:00:00Z' },
      { name: 'mo-betta/zones.json', sha: 'e'.repeat(40), changedAt: '2026-10-20T00:00:00Z' },
      { name: 'mo-betta/npcs.json', sha: 'e'.repeat(40), changedAt: '2026-10-20T00:00:00Z' },
    ],
  };
}

/** The wiki fixture with the mobs and wikiZones the zone sources meet. */
export function withZoneWiki(base: unknown): WikiData {
  const f = structuredClone(base) as WikiData;
  f.items['Gnoll Tooth'] = { wikiZones: ['Evershade Weald'] };
  f.items['Bight Shell'] = { wikiZones: ["Keeper's Bight", 'Sunken Resort'] };
  f.mobs = {
    'a gnoll scout': { title: 'A gnoll scout', level: '8 - 10', race: 'Gnoll', class: null, zone: '[[Evershade Weald]]', loot: ['Gnoll Tooth', 'Gnoll Pelt'] },
    'a curious jackal': { title: 'A curious jackal', level: '3', zone: 'Evershade Weald' },
  };
  return f;
}

// Order 25, ITEM 2: the faction spellings merged on the owner's ruling of 2026-10-27 (corrected the same day, 18:18 ET:
// eight groups, not four), and only these. Each misspelling maps to its group's most common spelling, by active
// npc_faction links on 2026-10-27: Night Harbor Garrison 39 (vs 1), Pyrmos Mercenaries 90 (vs 1 and 1), Vermahn's
// Brood 43 (vs 4 and 3), House Malrathen 5 (vs 1), Red Mantles 25 (vs 2), Slaves of Pasha 6 (vs 5), Denizens of
// Wyrmsbane 27 (vs 1), Citizens of Night Harbor 179 (vs 10). This is an explicit override of order 24's "Faction names
// are trimmed, never merged or re-spelled" and order 4's "never merged, aliased … unless the source data or the owner
// says so": the owner said so for exactly these eight groups. Never extended without the owner.
//
// Kept separate by the same ruling: City Watch of Night Harbor; Denizens of the Court of Summer / of Winter.
//
// The import maps each name (trimmed, exact) before writing faction and npc_faction (scripts/import/zones.ts); the
// factions board reads the same list to say where a merged faction's retired post now appears (src/board/factions.ts).

export const FACTION_ALIASES: ReadonlyMap<string, string> = new Map([
  ['Nigh Harbor Garrison', 'Night Harbor Garrison'],
  ['Pymos Mercenaries', 'Pyrmos Mercenaries'],
  ['Pyrmos Mercanaries', 'Pyrmos Mercenaries'],
  ["Vermahan's Brood", "Vermahn's Brood"],
  ["Vehrman's Brood", "Vermahn's Brood"],
  ['House Malrethren', 'House Malrathen'],
  ['Red Mantle', 'Red Mantles'],
  ['Slaves of the Pasha', 'Slaves of Pasha'],
  ['Denizens of Wyrmsbane Tomb', 'Denizens of Wyrmsbane'],
  ['City of Night Harbor', 'Citizens of Night Harbor'],
]);

/** A trimmed faction name as the import stores it: the approved spelling for a listed misspelling, otherwise itself. */
export const factionName = (name: string): string => FACTION_ALIASES.get(name) ?? name;

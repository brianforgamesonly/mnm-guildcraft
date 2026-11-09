// Work order 41, ITEM 1: a level bound recorded only as question marks is unknown: parsed as open, shown as not recorded.
// The parser (scripts/import/levels.ts parseLevel) and every surface that prints a recorded level text read
// src/level-text.ts. The derived check over the committed wiki snapshot's own level texts is scripts/wiki/level-text.test.ts.
import { describe, expect, it } from 'vitest';
import { pluralOnlyPairs } from '../../scripts/import/core.ts';
import { computeLevels, parseLevel, type LevelInput } from '../../scripts/import/levels.ts';
import { creatureText } from '../../src/board/factions.ts';
import { LEVEL_COPY, questionReading, shownLevel } from '../../src/level-text.ts';
import { creatureLine, ZONE_COPY } from '../../src/zone/card.ts';
import { MOB_ZONES_SOURCE } from '../../src/zone/names.ts';

// Every distinct level text holding "?" in zone.level, mob.level and npc.level on 2026-11-08 (production import
// 42462309448's sources, mnm-tools 4c48d60 and wiki revid 87056, imported locally), with the rows holding each.
const PRODUCTION_TEXTS: [text: string, rows: number][] = [
  ['1 - ?', 1], ['1 - ??', 1], ['5 - ??', 1], // zone
  ['15-?', 1], ['18-???', 1], ['?', 4], ['??', 1], // npc: an unknown bound, or nothing but question marks
  ['11?', 1], ['15?', 7], ['19-24?', 2], ['20?', 1], ['25?', 2], ['29?', 1], ['35?', 1], ['38+?', 1], ['42-44?', 2], ['8-12?', 1], // npc: a trailing "?"
];
/** A bound made only of question marks: a run of "?" not directly after a digit or a "+". */
const QUESTION_BOUND = /(^|[^\d+?])\?+/;

describe('order 41: parsing an unknown top', () => {
  const r = (t: string) => parseLevel(t).range;
  it('a top written only as question marks is open, as "N+" is', () => {
    expect(r('1 - ??')).toEqual({ low: 1, high: null });
    expect(r('5 - ??')).toEqual({ low: 5, high: null });
    expect(r('1 - ?')).toEqual({ low: 1, high: null });
    expect(r('5 - ?')).toEqual({ low: 5, high: null });
    expect(r('15-?')).toEqual({ low: 15, high: null });
    expect(r('18-???')).toEqual({ low: 18, high: null });
  });

  it('only question marks stays no level; a number followed by "?" parses exactly as before', () => {
    expect(r('?')).toBeNull();
    expect(r('??')).toBeNull();
    expect(r('15?')).toEqual({ low: 15, high: 15 });
    expect(r('42-44?')).toEqual({ low: 42, high: 44 });
    expect(r('19-24?')).toEqual({ low: 19, high: 24 });
    expect(r('8-12?')).toEqual({ low: 8, high: 12 });
    expect(r('38+?')).toEqual({ low: 38, high: null });
  });

  it("order 35's cases are unchanged", () => {
    expect(r('3 - 10')).toEqual({ low: 3, high: 10 });
    expect(r('31-33')).toEqual({ low: 31, high: 33 });
    expect(r('~15')).toEqual({ low: 15, high: 15 });
    expect(r('Lv 5+')).toEqual({ low: 5, high: null });
    expect(r('50 (raid)')).toEqual({ low: 50, high: 50 });
    expect(r('[[Zone 2]] 10')).toEqual({ low: 10, high: 10 });
    expect(r('[[Night Harbor]] 20-30')).toEqual({ low: 20, high: 30 });
    expect(r('105')).toBeNull();
    expect(r('')).toBeNull();
    expect(parseLevel('16 or 17 or 21')).toEqual({ range: { low: 16, high: 21 }, integers: 3 });
  });
});

describe('order 41: the item levels it feeds', () => {
  const item = (key: string, from: string[]) => ({ key, from, sold: false, harvested: false, questCategory: false });
  const input = (o: Partial<LevelInput>): LevelInput => ({ items: [], mobs: [], npcs: [], zones: [], zoneNames: [], recipes: [], quests: [], ...o });

  it('a zone-kind drop in a zone recorded "1 - ??" is zone Lv 1 and up (high NULL), not 1–1', () => {
    const { levels, summary } = computeLevels(
      input({
        items: [item('cuff', ['a bat'])],
        mobs: [{ key: 'a bat', title: 'a bat', level: null, zones: ['Evershade Weald'], loot: [] }],
        zones: [{ key: 'evershade weald', level: '1 - ??' }],
        zoneNames: [{ source: MOB_ZONES_SOURCE, name: 'Evershade Weald', zone_key: 'evershade weald' }],
      }),
      new Set(['cuff']),
    );
    expect(levels.get('cuff')).toEqual({ level_low: 1, level_high: null, level_kind: 'zone', level_kinds: 'zone' });
    expect(summary.questionMarks).toEqual([{ text: '1 - ??', count: 1, reading: 'top not recorded' }]);
  });

  it('a mob-kind drop from an NPC recorded "15-?" is Lv 15 and up; the coverage report counts every "?" text by its reading', () => {
    const { levels, summary } = computeLevels(
      input({
        items: [item('sting', ['a wasp drone'])],
        npcs: [
          { name: 'a wasp drone', zone_key: 'keepers bight', level: '15-?', loot: [] },
          { name: 'a cultist', zone_key: 'z', level: '?', loot: [] },
          { name: 'a cultist', zone_key: 'y', level: '?', loot: [] },
          { name: 'Old Brinehide', zone_key: 'z', level: '20?', loot: [] },
        ],
      }),
      new Set(['sting']),
    );
    expect(levels.get('sting')).toEqual({ level_low: 15, level_high: null, level_kind: 'mob', level_kinds: 'mob' });
    expect(summary.questionMarks).toEqual([
      { text: '?', count: 2, reading: 'no level' },
      { text: '15-?', count: 1, reading: 'top not recorded' },
      { text: '20?', count: 1, reading: 'as recorded' },
    ]);
  });
});

describe('order 41: how a recorded level text is shown (one function for every surface)', () => {
  it('every "?" text in the production data: no bound made only of question marks survives', () => {
    for (const [t] of PRODUCTION_TEXTS) {
      const shown = shownLevel(t);
      if (shown !== null) expect(shown, t).not.toMatch(QUESTION_BOUND);
    }
    expect(PRODUCTION_TEXTS.map(([t]) => questionReading(t))).not.toContain(null);
  });

  it('an unknown top reads "N and up (top level not recorded)"; only "?" is nothing; a trailing "?" is as recorded', () => {
    expect(shownLevel('1 - ??')).toBe('1 and up (top level not recorded)');
    expect(shownLevel('5 - ??')).toBe('5 and up (top level not recorded)');
    expect(shownLevel('1 - ?')).toBe('1 and up (top level not recorded)');
    expect(shownLevel('15-?')).toBe('15 and up (top level not recorded)');
    expect(shownLevel('18-???')).toBe(LEVEL_COPY.topNotRecorded('18'));
    expect(shownLevel('?')).toBeNull();
    expect(shownLevel('??')).toBeNull();
    for (const t of ['15?', '42-44?', '38+?', '8-12?', '11?']) expect(shownLevel(t)).toBe(t);
  });

  it('text with no "?" is shown exactly as before', () => {
    for (const t of ['3 - 10', '~7-8', '15+', '1', '  12  ', 'varies']) expect(shownLevel(t)).toBe(t);
    expect(shownLevel(null)).toBeNull();
    expect(shownLevel('')).toBeNull();
  });

  it('the zone card: "Levels: 1 and up (top level not recorded)"; "?" alone is "not recorded"; others as recorded', () => {
    expect(ZONE_COPY.levels('1 - ??')).toBe('**Levels:** 1 and up (top level not recorded)');
    expect(ZONE_COPY.levels('5 - ??')).toBe('**Levels:** 5 and up (top level not recorded)');
    expect(ZONE_COPY.levels('?')).toBe('**Levels:** not recorded');
    expect(ZONE_COPY.levels(null)).toBe('**Levels:** not recorded');
    expect(ZONE_COPY.levels('10 - 20')).toBe('**Levels:** 10 - 20');
  });

  it("the zone card's creature lines and the factions board: an unknown top reads as not recorded; only \"?\" shows no level", () => {
    expect(creatureLine({ name: 'a wasp drone', level: '15-?' }, null)).toBe('a wasp drone (L15 and up (top level not recorded))');
    expect(creatureLine({ name: 'a cultist', level: '?' }, null)).toBe('a cultist');
    expect(creatureLine({ name: 'Old Brinehide', level: '20?' }, null)).toBe('Old Brinehide (L20?)');
    expect(creatureLine({ name: 'a bat', level: '1' }, null)).toBe('a bat (L1)');
    expect(creatureText({ creature: 'An ashira shaman scribe', level: '18-???', location: null })).toBe('An ashira shaman scribe (level 18 and up (top level not recorded))');
    expect(creatureText({ creature: "An Ail'trist patrol", level: '?', location: 'The gate' })).toBe("An Ail'trist patrol (The gate)");
    expect(creatureText({ creature: 'A glowing wisp', level: '42-44?', location: null })).toBe('A glowing wisp (level 42-44?)');
    expect(creatureText({ creature: 'A bat', level: ' 23-24 ', location: null })).toBe('A bat (level 23-24)');
  });
});

describe('order 41, ITEM 2: titles that differ only by a trailing "s" are reported, never merged', () => {
  it('pairs each plural title with its singular, case-insensitive; nothing else pairs', () => {
    expect(pluralOnlyPairs(['Bloodied Allegiance Cuffs', 'Bloodied Allegiance Cuff', 'Bone Chip', 'bone chips', 'Boots', 'Glass', 'Glas', 'Cuffs'])).toEqual([
      ['Bloodied Allegiance Cuff', 'Bloodied Allegiance Cuffs'],
      ['Bone Chip', 'bone chips'],
      ['Glas', 'Glass'],
    ]);
    expect(pluralOnlyPairs(['A', 'As', 'Ass'])).toEqual([['A', 'As'], ['As', 'Ass']]);
  });
});

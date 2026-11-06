// Work order 35, ITEMs 1-2 (PR A): races on items, and item levels (scripts/import/levels.ts), with the import around them.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { deriveRaces, raceMask, raceTokens, runImport, type WikiData, type WikiItem } from '../../scripts/import/core.ts';
import { computeLevels, MAX_DEPTH, parseLevel, type LevelInput } from '../../scripts/import/levels.ts';
import { questBucket } from '../../scripts/wiki/parse.ts';
import type { WikiSnapshot } from '../../scripts/wiki/types.ts';
import { ALL_RACES, isTwoHanded } from '../../src/gear/vocab.ts';
import small from '../fixtures/wiki-small.json';

const db = bindingDb(env.DB as never);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 10, 5, 12, 0, tick++)).toISOString();
const load = (raw: unknown, opts: { dryRun?: boolean } = {}) => runImport(db, raw, { sourceSha: 'c'.repeat(40), now, ...opts });
const one = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;

beforeEach(async () => {
  await env.DB.batch(
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import', 'game_class', 'game_race', 'mob'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

// ---------------------------------------------------------------- ITEM 1: race on items

const data = (items: Record<string, WikiItem>): WikiData => {
  const f = structuredClone(small) as unknown as WikiData;
  Object.assign(f.items, items);
  return f;
};

describe('order 35, ITEM 1: race_mask and the derived race list', () => {
  it('ALL in any spelling is every bit; one race and several get their bits; no race list is 0', () => {
    const bits = new Map([['HUM', 0], ['DEF', 1], ['TRL', 2]]);
    for (const all of ['ALL', 'All', 'all', 'ALL\n| item_link_id-OLD = rusty_iron_scimitar']) expect(raceMask({ race: all }, bits), all).toBe(ALL_RACES);
    expect(raceMask({ race: 'DEF' }, bits)).toBe(0b010);
    expect(raceMask({ race: 'HUM DEF TRL' }, bits)).toBe(0b111);
    expect(raceMask({ race: 'HUM ELD' }, bits)).toBe(0b001); // ELD: not a kept code, no bit
    expect(raceMask({}, bits)).toBe(0);
    // A template line where the value should be ("| item_link_id-OLD = manastone", the source's Manastone) is no race.
    expect(raceTokens('| item_link_id-OLD = manastone')).toEqual([]);
    expect(raceTokens('all\n| item_link_id-OLD = x')).toEqual(['ALL']);
  });

  it('derives the list from the data: codes on 2+ items kept, one-item codes dropped; mount races told apart by their slots', () => {
    const r = deriveRaces(
      data({
        'Saddle A': { slot: 'RIGGING', race: 'HRS DNK' },
        'Saddle B': { slot: 'BARDING', race: 'HRS DNK' },
        Pack: { slot: 'RIGGING', race: 'DNK' },
        'Ring A': { slot: 'FINGER', race: 'HUM DEF' },
        'Ring B': { slot: 'FINGER', race: 'DEF' },
        Tunic: { slot: 'CHEST', race: 'HUM ELD' },
        Plain: { slot: 'CHEST', race: 'ALL' },
      }),
    );
    expect(r.kept).toEqual([
      { code: 'DNK', item_count: 3, mount: 1 },
      { code: 'DEF', item_count: 2, mount: 0 },
      { code: 'HRS', item_count: 2, mount: 1 },
      { code: 'HUM', item_count: 2, mount: 0 },
    ]);
    expect(r.dropped).toEqual([{ code: 'ELD', items: 1 }]);
  });

  it('review fixes: NONE is no race; case-only duplicate items count once; bits running out fails the run cleanly', async () => {
    expect(deriveRaces(data({ 'Cap A': { slot: 'HEAD', race: 'NONE' }, 'Cap B': { slot: 'HEAD', race: 'none' } })).kept).toEqual([]);
    expect(deriveRaces(data({ 'Odd Hat': { slot: 'HEAD', race: 'GIE' }, 'odd hat': { slot: 'HEAD', race: 'GIE' } })).kept).toEqual([]);
    const f = data({});
    for (let i = 0; i < 32; i++) {
      const code = `R${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
      f.items[`Hat ${i} a`] = { slot: 'HEAD', race: code };
      f.items[`Hat ${i} b`] = { slot: 'HEAD', race: code };
    }
    const res = await load(f);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/more than 30/);
  });

  it('the import writes game_race and race_mask; a new race token raises vocab_drift; a second run writes 0', async () => {
    const f = data({
      'Ring A': { slot: 'FINGER', race: 'HUM DEF' },
      'Ring B': { slot: 'FINGER', race: 'HUM DEF' },
      'Odd Tunic': { slot: 'CHEST', race: 'HUM GIE' },
      'Plain Cap': { slot: 'HEAD', race: 'All' },
    });
    const first = await load(f);
    expect(first.status).toBe('ok');
    expect(await all('SELECT code, name, item_count, bit, mount FROM game_race ORDER BY code')).toEqual([
      { code: 'DEF', name: null, item_count: 2, bit: 0, mount: 0 },
      { code: 'HUM', name: null, item_count: 3, bit: 1, mount: 0 },
    ]);
    expect(await one("SELECT race_mask FROM item WHERE name = 'Ring A'")).toEqual({ race_mask: 0b11 });
    expect(await one("SELECT race_mask FROM item WHERE name = 'Plain Cap'")).toEqual({ race_mask: ALL_RACES });
    expect(first.warnings).toContainEqual(expect.objectContaining({ kind: 'vocab_drift', list: 'race', values: [{ value: 'GIE', items: 1 }] }));
    const second = await load(f);
    expect(second.written!.game_race.rows_written + second.written!.item.rows_written).toBe(0);
    // A new race on two items: kept, with the next free bit (no other race's bit moves), and the list change is a drift warning.
    f.items['Ring C'] = { slot: 'FINGER', race: 'TRL' };
    f.items['Ring D'] = { slot: 'FINGER', race: 'TRL' };
    const third = await load(f);
    expect(await one("SELECT bit FROM game_race WHERE code = 'TRL'")).toEqual({ bit: 2 });
    expect(await one("SELECT bit FROM game_race WHERE code = 'HUM'")).toEqual({ bit: 1 });
    expect(third.warnings).toContainEqual(expect.objectContaining({ kind: 'vocab_drift', list: 'race', values: [{ value: '+TRL', items: 2 }] }));
  });

  it('the one reading of handed: two-handed in each of the source spellings, and nothing else', () => {
    for (const h of ['Two Handed', 'TWO HANDED', '2', 'two-handed', 'Twohanded']) expect(isTwoHanded(h), h).toBe(true);
    for (const h of ['One Handed', '1', '', null, undefined, 'Two']) expect(isTwoHanded(h), String(h)).toBe(false);
  });
});

// ---------------------------------------------------------------- ITEM 2: the parser

describe('order 35, ITEM 2: parsing level text', () => {
  it('reads the order\'s texts', () => {
    const r = (t: string) => parseLevel(t).range;
    expect(r('3 - 10')).toEqual({ low: 3, high: 10 });
    expect(r('31-33')).toEqual({ low: 31, high: 33 });
    expect(r('~15')).toEqual({ low: 15, high: 15 });
    expect(r('Lv 5+')).toEqual({ low: 5, high: null });
    expect(r('50 (raid)')).toEqual({ low: 50, high: 50 });
    expect(r('[[Zone 2]] 10')).toEqual({ low: 10, high: 10 });
    expect(r('[[Night Harbor]] 20-30')).toEqual({ low: 20, high: 30 });
    expect(r('105')).toBeNull();
    expect(r('?')).toBeNull();
    expect(r('')).toBeNull();
    expect(parseLevel('16 or 17 or 21')).toEqual({ range: { low: 16, high: 21 }, integers: 3 });
    expect(parseLevel(12).range).toEqual({ low: 12, high: 12 });
  });
});

// ---------------------------------------------------------------- ITEM 2: the kinds

type Item = LevelInput['items'][number];
const item = (key: string, o: Partial<Item> = {}): Item => ({ key, from: [], sold: false, harvested: false, questCategory: false, ...o });
const input = (o: Partial<LevelInput>): LevelInput => ({ items: [], mobs: [], npcs: [], zones: [], zoneNames: [], recipes: [], quests: [], ...o });
let rid = 0;
const recipe = (result: string, comps: string[], o: { unknown?: number; id?: number } = {}) => ({
  result_key: result,
  components: new Map(comps.map((c) => [c, 1])),
  unknown_components: o.unknown ?? 0,
  id: o.id ?? ++rid,
  source_key: `Smithing|${result}|${rid}`,
});
const levelsOf = (inp: LevelInput, keys = inp.items.map((i) => i.key)) => computeLevels(inp, new Set(keys));
const mob = (key: string, level: string | null, o: { zones?: string[]; loot?: string[] } = {}) => ({ key, title: key, level, zones: o.zones ?? [], loot: o.loot ?? [] });

describe('order 35, ITEM 2: each kind and the primary choice', () => {
  it('mob: the lowest low and highest high of the dropping creatures; from, mob loot and NPC loot all count', () => {
    const { levels } = levelsOf(
      input({
        items: [item('sword', { from: ['an orc'] })],
        mobs: [mob('an orc', '3 - 10'), mob('a troll', '12', { loot: ['Sword'] })],
        npcs: [{ name: 'A Giant', zone_key: 'z', level: '40+', loot: ['sword'] }],
      }),
    );
    expect(levels.get('sword')).toEqual({ level_low: 3, level_high: null, level_kind: 'mob', level_kinds: 'mob' });
  });

  it('a mob at 40 plus a vendor gives vendor ("any level", 0); a tie gives mob', () => {
    const { levels } = levelsOf(
      input({
        items: [item('a', { from: ['m40'], sold: true }), item('b', { from: ['m12'] }), item('c')],
        mobs: [mob('m40', '40'), mob('m12', '12')],
        recipes: [recipe('b', ['c']), recipe('c', ['d'])],
      }),
      ['a', 'b'],
    );
    expect(levels.get('a')).toEqual({ level_low: 0, level_high: 0, level_kind: 'vendor', level_kinds: 'vendor,mob' });
    // b: mob 12; crafted from c, whose own level is a floor (d has no source), so b's crafted kind is a floor at NULL.
    expect(levels.get('b')!.level_kind).toBe('mob');
    const tie = levelsOf(
      input({
        items: [item('t', { from: ['m12'] }), item('ore', { from: ['m12'] })],
        mobs: [mob('m12', '12')],
        recipes: [recipe('t', ['ore'])],
      }),
      ['t'],
    ).levels.get('t')!;
    expect(tie).toEqual({ level_low: 12, level_high: 12, level_kind: 'mob', level_kinds: 'mob,crafted' });
  });

  it('npc.level is used when mob.level does not parse (same name, case-insensitive)', () => {
    const { levels } = levelsOf(
      input({
        items: [item('cap', { from: ['A Bandit'] })],
        mobs: [mob('a bandit', '?')],
        npcs: [{ name: 'a BANDIT', zone_key: 'z1', level: '8-9', loot: [] }, { name: 'a bandit', zone_key: 'z2', level: '11', loot: [] }],
      }),
    );
    expect(levels.get('cap')).toMatchObject({ level_low: 8, level_high: 11, level_kind: 'mob' });
  });

  it('zone: no dropping creature has a level, but its zones do (mob zones through zone_name); never shown as a mob level', () => {
    const { levels } = levelsOf(
      input({
        items: [item('boots', { from: ['a ghost'] })],
        mobs: [mob('a ghost', null, { zones: ['Night Harbor'] })],
        zones: [{ key: 'night harbor', level: '20-30' }],
        zoneNames: [{ source: 'mnm-tools:mobs', name: 'Night Harbor', zone_key: 'night harbor' }],
      }),
    );
    expect(levels.get('boots')).toEqual({ level_low: 20, level_high: 30, level_kind: 'zone', level_kinds: 'zone' });
  });

  it('harvest and quest; a quest with no recorded minimum level is kind quest with no level; nothing is unknown', () => {
    const { levels, summary } = levelsOf(
      input({
        items: [item('herb', { harvested: true }), item('mask', { questCategory: true }), item('tunic'), item('nothing')],
        quests: [{ title: 'Q', minLevel: 7, rewards: ['Tunic', 'exp:You gain experience!!'] }],
      }),
    );
    expect(levels.get('herb')).toMatchObject({ level_low: 0, level_kind: 'harvest' });
    expect(levels.get('mask')).toEqual({ level_low: null, level_high: null, level_kind: 'quest', level_kinds: 'quest' });
    expect(levels.get('tunic')).toMatchObject({ level_low: 7, level_high: 7, level_kind: 'quest' });
    expect(levels.get('nothing')).toEqual({ level_low: null, level_high: null, level_kind: 'unknown', level_kinds: 'unknown' });
    expect(summary.quest).toEqual({ rewards: 2, withLevel: 1, withoutLevel: 1 });
  });
});

describe('order 35, ITEM 2: crafted levels', () => {
  it('a recipe with a vendor, a harvested, a crafted sub-component and one with no source is a floor at its highest known level', () => {
    const inp = input({
      items: [item('helm'), item('bar', { sold: true }), item('herb', { harvested: true }), item('plate'), item('ore', { from: ['m9'] }), item('rare')],
      mobs: [mob('m9', '9 - 14')],
      recipes: [recipe('helm', ['bar', 'herb', 'plate', 'rare']), recipe('plate', ['ore'])],
    });
    const { levels, summary } = levelsOf(inp, ['helm', 'plate']);
    // plate: crafted from ore (mob 9-14: its primary low, 9).
    expect(levels.get('plate')).toEqual({ level_low: 9, level_high: 9, level_kind: 'crafted', level_kinds: 'crafted' });
    // helm: bar 0, herb 0, plate 9, rare no source: a floor, "Lv 9+".
    expect(levels.get('helm')).toEqual({ level_low: 9, level_high: null, level_kind: 'crafted_floor', level_kinds: 'crafted_floor' });
    expect(summary.crafted).toEqual({ results: 2, full: 1, floor: 1, none: 0 });
    expect(summary.missingComponents).toEqual([{ key: 'rare', items: 1 }]);
    // With no component level known at all, the floor is NULL ("level unknown").
    const none = levelsOf(input({ items: [item('x'), item('y')], recipes: [recipe('x', ['y'], { unknown: 1 })] }), ['x']);
    expect(none.levels.get('x')).toEqual({ level_low: null, level_high: null, level_kind: 'crafted_floor', level_kinds: 'crafted_floor' });
    expect(none.summary.crafted.none).toBe(1);
  });

  it('a full recipe is chosen over a lower floor recipe; ties go to fewest components, then the lowest recipe id', () => {
    const inp = input({
      items: [item('ring'), item('gold', { from: ['m30'] }), item('gem', { sold: true }), item('dust'), item('silver', { from: ['m30'] })],
      mobs: [mob('m30', '30')],
      recipes: [recipe('ring', ['gem', 'dust'], { id: 1 }), recipe('ring', ['gold', 'gem'], { id: 9 }), recipe('ring', ['silver'], { id: 12 })],
    });
    const { levels, recipes } = levelsOf(inp, ['ring']);
    // The floor recipe (gem 0 + dust: no source) would be Lv 0+; the full ones are 30. Full wins.
    expect(levels.get('ring')).toMatchObject({ level_low: 30, level_high: 30, level_kind: 'crafted' });
    // Both full recipes are 30: the one with fewer components (silver, id 12) beats the lower id (id 9, two components).
    expect(recipes.get('ring')).toBe(inp.recipes[2].source_key);
    // Same level, same component count: the lowest recipe id.
    const same = input({
      items: [item('band'), item('gold', { from: ['m30'] }), item('silver', { from: ['m30'] })],
      mobs: [mob('m30', '30')],
      recipes: [recipe('band', ['silver'], { id: 40 }), recipe('band', ['gold'], { id: 31 })],
    });
    expect(levelsOf(same, ['band']).recipes.get('band')).toBe(same.recipes[1].source_key);
  });

  it('a recipe cycle stops: the component in the cycle has no source', () => {
    const { levels } = levelsOf(
      input({ items: [item('a'), item('b'), item('c', { sold: true })], recipes: [recipe('a', ['b', 'c']), recipe('b', ['a'])] }),
      ['a', 'b'],
    );
    expect(levels.get('a')).toMatchObject({ level_low: 0, level_kind: 'crafted_floor' });
    expect(levels.get('b')).toMatchObject({ level_kind: 'crafted_floor' });
  });

  it(`a recipe chain is followed ${MAX_DEPTH} components deep; one past it has no source`, () => {
    const keys = Array.from({ length: MAX_DEPTH + 2 }, (_, i) => `c${i}`);
    const items = keys.map((k, i) => (i === keys.length - 1 ? item(k, { sold: true }) : item(k)));
    const recipes = keys.slice(0, -1).map((k, i) => recipe(k, [keys[i + 1]]));
    const { levels } = levelsOf(input({ items, recipes }), keys);
    expect(levels.get('c0')!.level_kind).toBe('crafted_floor'); // its chain reaches the vendor item at depth 7
    expect(levels.get('c1')).toMatchObject({ level_low: 0, level_kind: 'crafted' }); // depth 6: within the limit
  });

  it('an item both dropped and crafted keeps both kinds', () => {
    const { levels } = levelsOf(
      input({ items: [item('axe', { from: ['m20'] }), item('ore', { sold: true })], mobs: [mob('m20', '20')], recipes: [recipe('axe', ['ore'])] }),
      ['axe'],
    );
    expect(levels.get('axe')).toEqual({ level_low: 0, level_high: 0, level_kind: 'crafted', level_kinds: 'crafted,mob' });
  });

  it('reports unparsed texts and texts with more than two integers', () => {
    const { summary } = levelsOf(
      input({ items: [item('a')], mobs: [mob('m1', '?'), mob('m2', '?'), mob('m3', '16 or 17 or 21')], zones: [{ key: 'z', level: 'varies' }] }),
    );
    expect(summary.unparsed).toEqual([{ text: '?', count: 2 }, { text: 'varies', count: 1 }]);
    expect(summary.manyIntegers).toEqual([{ text: '16 or 17 or 21', count: 1, low: 16, high: 21 }]);
  });

  it("reads the snapshot's Quests bucket by the fields TEMPLATE_FIELDS names", () => {
    const snap = { buckets: { quests: { schema: null, fields: [], rows: [{ quest_name: 'Q', quest_min_level: 3, quest_rewards: ['A', 7] }, { quest_name: 'R' }] } } } as unknown as WikiSnapshot;
    expect(questBucket(snap)).toEqual([{ title: 'Q', minLevel: 3, rewards: ['A'] }, { title: 'R', minLevel: null, rewards: [] }]);
  });
});

// ---------------------------------------------------------------- ITEM 2: the import

describe('order 35, ITEM 2: the import writes the levels', () => {
  const levelFixture = (): WikiData => {
    const f = data({
      'Orc Helm': { slot: 'HEAD', race: 'ALL', from: ['an orc'] },
      'Shop Cloak': { slot: 'BACK', soldBy: { base: 5, shady: null, vendors: ['a tailor'] } },
      Herb: { harvestedBy: 'Herbalism' },
    });
    f.mobs = { 'an orc': { title: 'An orc', level: '3 - 10' } };
    return f;
  };
  const row = (name: string) => one(`SELECT level_low, level_high, level_kind, level_kinds, gone_at FROM item WHERE name = '${name}'`);

  it('gear gets its levels; harvestedBy is kept in origin_json; a second import writes 0; a change is rewritten, not appended', async () => {
    const f = levelFixture();
    const first = await load(f);
    expect(first.status).toBe('ok');
    expect(await row('Orc Helm')).toEqual({ level_low: 3, level_high: 10, level_kind: 'mob', level_kinds: 'mob', gone_at: null });
    expect(await row('Shop Cloak')).toEqual({ level_low: 0, level_high: 0, level_kind: 'vendor', level_kinds: 'vendor', gone_at: null });
    expect(await one("SELECT origin_json FROM item WHERE name = 'Herb'")).toEqual({ origin_json: '{"harvestedBy":"Herbalism"}' });
    expect(await one("SELECT level_kind FROM item WHERE name = 'Herb'")).toEqual({ level_kind: null }); // not gear: not stored
    expect(first.levels!.byKind).toMatchObject({ mob: 1, vendor: 1 });
    const second = await load(f);
    expect(second.written!.item).toEqual({ statements: 0, rows_written: 0, changes: 0 });
    f.mobs['an orc'].level = '12';
    const third = await load(f);
    expect(third.written!.item.changes).toBe(1);
    expect(await row('Orc Helm')).toMatchObject({ level_low: 12, level_high: 12 });
    expect(await one("SELECT count(*) AS n FROM item WHERE name = 'Orc Helm'")).toEqual({ n: 1 });
  });

  it('an item gone upstream is flagged, never deleted; listed again, the flag clears', async () => {
    const f = levelFixture();
    await load(f);
    const id = await one<{ id: number }>("SELECT id FROM item WHERE name = 'Shop Cloak'");
    delete f.items['Shop Cloak'];
    const dry = await load(f, { dryRun: true });
    expect(dry.predicted!.item.gone).toBe(1);
    await load(f);
    expect(await one<{ id: number; gone: number }>("SELECT id, gone_at IS NOT NULL AS gone FROM item WHERE name = 'Shop Cloak'")).toEqual({ id: id.id, gone: 1 });
    const again = await load(f);
    expect(again.written!.item.rows_written).toBe(0); // flagged once
    f.items['Shop Cloak'] = { slot: 'BACK', soldBy: { base: 5, shady: null, vendors: ['a tailor'] } };
    await load(f);
    expect(await row('Shop Cloak')).toMatchObject({ gone_at: null, level_kind: 'vendor' });
  });

  it('a night the zone data is kept keeps the stored levels (nothing rewritten)', async () => {
    const f = levelFixture();
    await load(f);
    const kept = await runImport(db, f, { sourceSha: 'c'.repeat(40), now, zonesKept: 'test' });
    expect(kept.status).toBe('zones-kept');
    expect(kept.levels).toBeUndefined();
    expect(kept.written!.item.rows_written).toBe(0);
    expect(await row('Orc Helm')).toMatchObject({ level_low: 3, level_kind: 'mob' });
  });
});

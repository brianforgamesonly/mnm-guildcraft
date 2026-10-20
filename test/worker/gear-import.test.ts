// Work order 13, ITEMs 1-2: the gear fields, masks, sources and mobs the import keeps, the write ceiling and its resume.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { classTokens, mobZones, runImport, type WikiData, type WikiItem } from '../../scripts/import/core.ts';
import { ALL_CLASSES, REMOVED_BIT, SLOTS, SOURCES } from '../../src/gear/vocab.ts';
import small from '../fixtures/wiki-small.json';

const db = bindingDb(env.DB as never);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 20, 12, 0, tick++)).toISOString();
const load = (raw: unknown, opts: { dryRun?: boolean; writeCeiling?: number } = {}) => runImport(db, raw, { sourceSha: 'b'.repeat(40), now, ...opts });
const one = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;

const src = (...names: (typeof SOURCES)[number][]) => names.reduce((m, s) => m | (1 << SOURCES.indexOf(s)), 0);
const slot = (...names: (typeof SLOTS)[number][]) => names.reduce((m, s) => m | (1 << SLOTS.indexOf(s)), 0);

function gearFixture(): WikiData {
  const f = structuredClone(small) as unknown as WikiData;
  const items: Record<string, WikiItem> = {
    'Ashira Bracer': { slot: 'Wrist', class: 'ARC BRD <br> SHM', ac: 3, from: ['an ashira warrior'], wikiZones: ['Night Harbor'] },
    'Bandit Ring': { slot: 'FINGER EAR', class: 'ARC, brd', from: ['Bandit Chief'] },
    'Odd Ring': { slot: 'FINGER', class: 'INQNEC SMH' },
    'Shop Cloak': { slot: 'BACK', class: 'None', soldBy: { base: 115, shady: null, vendors: ['Night Harbor', 'a bowyer'] } },
    'Quest Mask': { slot: 'FACE', class: 'ALL', categories: ['Quest Items'] },
    'Old Belt': { slot: 'WAIST', class: 'All', categories: ['Removed Items'] },
    'Mystery Earring': { slot: 'EAR' },
    'Strange Thing': { slot: 'TAIL ear' },
  };
  Object.assign(f.items, items);
  // Enough class-carrying items that a code on one item falls under the 1% share (deriveClasses).
  for (let i = 0; i < 150; i++) f.items[`Class Filler ${i}`] = { class: 'ARC BRD SHM' };
  f.mobs = {
    'an ashira warrior': { title: 'An ashira warrior', level: '3 - 10', race: 'Ashira', zone: '[[Night Harbor]], Night Harbor, Shaded Dunes', loot: ['Ashira Bracer'], image: 'https://example.invalid/a.png' },
    'a bandit': { title: 'Bandit Chief', level: null, zone: 'Tel Ekir' },
  };
  return f;
}

const itemRow = (name: string) =>
  one<{ class_mask: number; slot_mask: number; source_mask: number; origin_json: string | null; ac: number | null }>(
    `SELECT class_mask, slot_mask, source_mask, origin_json, ac FROM item WHERE name = '${name}'`,
  );
const state = () =>
  one<{ f: string }>(`SELECT
    (SELECT group_concat(name_key || ':' || class_mask || ':' || slot_mask || ':' || source_mask || ':' || ifnull(origin_json, '-'), ',') FROM (SELECT * FROM item ORDER BY name_key)) || '#' ||
    (SELECT group_concat(code || ':' || item_count || ':' || ifnull(bit, '-'), ',') FROM (SELECT * FROM game_class ORDER BY code)) || '#' ||
    (SELECT group_concat(key || ':' || title || ':' || ifnull(zones_json, '-') || ':' || active, ',') FROM (SELECT * FROM mob ORDER BY key)) || '#' ||
    (SELECT count(*) FROM recipe) || ':' || (SELECT count(*) FROM recipe_component) AS f`);

beforeEach(async () => {
  await env.DB.batch(
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import', 'game_class', 'mob'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

describe('order 13: class tokens', () => {
  it('strips markup, splits on whitespace and commas, upper-cases, and never splits joined codes', () => {
    expect(classTokens('ARC BRD <br> \nSHM SPB')).toEqual(['ARC', 'BRD', 'SHM', 'SPB']);
    expect(classTokens('CLR FTR INQ PAL SHD<')).toEqual(['CLR', 'FTR', 'INQ', 'PAL', 'SHD']);
    expect(classTokens('ARC, RNG')).toEqual(['ARC', 'RNG']);
    expect(classTokens('bRD INQNEC PALRNG')).toEqual(['BRD', 'INQNEC', 'PALRNG']);
    expect(classTokens('<br>SPB')).toEqual(['SPB']);
  });

  it('mob zones: wiki links to their text, comma lists split, repeats dropped', () => {
    expect(mobZones('[[Tomb of the Last Wyrmsbane]]')).toEqual(['Tomb of the Last Wyrmsbane']);
    expect(mobZones("[[Keeper's Bight]], Keeper's Bight")).toEqual(["Keeper's Bight"]);
    expect(mobZones('Night Harbor, Shaded Dunes, Sungreet Strand')).toEqual(['Night Harbor', 'Shaded Dunes', 'Sungreet Strand']);
    expect(mobZones('[[Target|Shown]]')).toEqual(['Shown']);
    expect(mobZones(null)).toEqual([]);
  });
});

describe('order 13: gear import', () => {
  it('derives class, slot and source masks; keeps origin JSON and the mobs; reports the gear summary', async () => {
    const res = await load(gearFixture());
    expect(res.status).toBe('ok');
    const bits = new Map((await all<{ code: string; bit: number }>('SELECT code, bit FROM game_class WHERE item_count > 0')).map((r) => [r.code, r.bit]));
    expect([...bits.keys()].sort()).toEqual(['ARC', 'BRD', 'SHM']);
    expect([...bits.values()].sort()).toEqual([0, 1, 2]); // first assignment: code order
    const cls = (...codes: string[]) => codes.reduce((m, c) => m | (1 << bits.get(c)!), 0);

    expect(await itemRow('Ashira Bracer')).toMatchObject({ class_mask: cls('ARC', 'BRD', 'SHM'), slot_mask: slot('WRIST'), source_mask: src('Drop'), ac: 3 });
    expect(JSON.parse((await itemRow('Ashira Bracer')).origin_json!)).toEqual({ from: ['an ashira warrior'], wikiZones: ['Night Harbor'] });
    expect(await itemRow('Bandit Ring')).toMatchObject({ class_mask: cls('ARC', 'BRD'), slot_mask: slot('FINGER', 'EAR'), source_mask: src('Drop') });
    expect(await itemRow('Odd Ring')).toMatchObject({ class_mask: 0, source_mask: src('Unknown') }); // only unrecognised tokens: matches only Any
    expect(await itemRow('Shop Cloak')).toMatchObject({ class_mask: 0, source_mask: src('Vendor') }); // "None"
    expect(await itemRow('Quest Mask')).toMatchObject({ class_mask: ALL_CLASSES, source_mask: src('Quest') });
    expect(await itemRow('Old Belt')).toMatchObject({ class_mask: ALL_CLASSES, source_mask: src('Unknown') | REMOVED_BIT });
    expect(await itemRow('Mystery Earring')).toMatchObject({ class_mask: 0, slot_mask: slot('EAR'), source_mask: src('Unknown'), origin_json: null });
    expect(await itemRow('Copper Sword')).toMatchObject({ slot_mask: slot('PRIMARY'), source_mask: src('Crafted') }); // a recipe result
    expect(await itemRow('Strange Thing')).toMatchObject({ slot_mask: slot('EAR') }); // TAIL is not a known slot

    expect(res.warnings).toContainEqual({ kind: 'unrecognised_class_tokens', tokens: [{ token: 'INQNEC', items: 1 }, { token: 'SMH', items: 1 }] });
    expect(res.warnings).toContainEqual(expect.objectContaining({ kind: 'vocab_drift', list: 'slot', values: [{ value: 'TAIL', items: 1 }] }));
    expect(res.gear).toMatchObject({
      gear: 10,
      removed: 1,
      bySource: { Drop: 2, Crafted: 2, Vendor: 1, Quest: 1, Unknown: 4 }, // Crafted: Copper Sword, HIDE BOOTS
      classMaskZero: 6,
      unrecognisedClassTokens: [{ token: 'INQNEC', items: 1 }, { token: 'SMH', items: 1 }],
      fromNames: 2,
      fromMatchKey: 1,
      fromMatchTitle: 1,
    });

    expect(await all('SELECT key, title, level, race, zones_json, loot_json, image_url, active FROM mob ORDER BY key')).toEqual([
      { key: 'a bandit', title: 'Bandit Chief', level: null, race: null, zones_json: '["Tel Ekir"]', loot_json: null, image_url: null, active: 1 },
      {
        key: 'an ashira warrior', title: 'An ashira warrior', level: '3 - 10', race: 'Ashira', zones_json: '["Night Harbor","Shaded Dunes"]',
        loot_json: '["Ashira Bracer"]', image_url: 'https://example.invalid/a.png', active: 1,
      },
    ]);
    // The from-name match rule: key first, then title, both case-insensitive (the NOCASE columns).
    expect(await one("SELECT key FROM mob WHERE key = 'AN ASHIRA WARRIOR'")).toEqual({ key: 'an ashira warrior' });
    expect(await one("SELECT key FROM mob WHERE title = 'bandit chief'")).toEqual({ key: 'a bandit' });
  });

  it('a re-import with no changes writes 0 game-data rows (only its own data_import row)', async () => {
    await load(gearFixture());
    const again = await load(gearFixture());
    expect(again.status).toBe('ok');
    for (const [t, w] of Object.entries(again.written!)) expect(w.rows_written, t).toBe(0);
    expect(again.rowsWritten).toBe(2);
  });

  it('a class bit is never reassigned: a new class takes the next free bit, and other items keep their masks', async () => {
    await load(gearFixture());
    const before = await itemRow('Ashira Bracer');
    const f = gearFixture();
    for (let i = 0; i < 10; i++) f.items[`Druid Thing ${i}`] = { class: 'DRU' };
    const res = await load(f);
    expect(await all('SELECT code, bit FROM game_class ORDER BY bit')).toEqual([
      { code: 'ARC', bit: 0 }, { code: 'BRD', bit: 1 }, { code: 'SHM', bit: 2 }, { code: 'DRU', bit: 3 },
    ]);
    expect(await itemRow('Ashira Bracer')).toEqual(before);
    expect(res.warnings).toContainEqual(expect.objectContaining({ kind: 'vocab_drift', list: 'class', values: [{ value: '+DRU', items: 10 }] }));
  });

  it('a mob missing upstream is deactivated, never deleted', async () => {
    await load(gearFixture());
    const f = gearFixture();
    delete f.mobs['a bandit'];
    await load(f);
    expect(await all('SELECT key, active FROM mob ORDER BY key')).toEqual([{ key: 'a bandit', active: 0 }, { key: 'an ashira warrior', active: 1 }]);
  });

  it('the structure check refuses a source without a mobs object', async () => {
    const f = gearFixture() as unknown as Record<string, unknown>;
    delete f.mobs;
    const res = await load(f);
    expect(res.status).toBe('failed');
    expect(res.error).toContain('mobs is not an object');
  });
});

describe('order 13: the write ceiling', () => {
  it('stops cleanly between whole groups, never inside one, and the next run resumes to the same end state', async () => {
    // The reference: one run with no ceiling pressure.
    await load(gearFixture());
    const reference = await state();
    await env.DB.batch(['recipe_component', 'recipe', 'item', 'tradeskill', 'data_import', 'game_class', 'mob'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));

    const ceiling = 600;
    const first = await load(gearFixture(), { writeCeiling: ceiling });
    expect(first.status).toBe('partial');
    expect(first.rowsWritten).toBeLessThanOrEqual(ceiling);
    expect(first.warnings).toContainEqual(expect.objectContaining({ kind: 'write_ceiling', ceiling, written: expect.any(Number) }));
    // Never a half-written item: every stored wiki item already carries its derived columns (one statement wrote it whole).
    const half = await one<{ n: number }>("SELECT count(*) AS n FROM item WHERE source = 'wiki' AND slot IS NOT NULL AND slot_mask = 0 AND slot <> 'TAIL ear'");
    expect(half.n).toBe(0);
    expect(await one("SELECT status FROM data_import ORDER BY id DESC LIMIT 1")).toEqual({ status: 'partial' });

    let runs = 1;
    let res = first;
    while (res.status === 'partial' && runs < 20) {
      res = await load(gearFixture(), { writeCeiling: ceiling });
      expect(res.rowsWritten).toBeLessThanOrEqual(ceiling);
      runs++;
    }
    expect(res.status).toBe('ok');
    expect(runs).toBeGreaterThan(1);
    expect(await state()).toEqual(reference);
    const after = await load(gearFixture(), { writeCeiling: ceiling });
    expect(after.rowsWritten).toBe(2);
  });

  it('fails loudly, writing nothing, when the first group alone exceeds the ceiling', async () => {
    const res = await load(gearFixture(), { writeCeiling: 3 });
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/write ceiling 3 is below the bound of statement group 1 of /);
    expect(await one<{ n: number }>('SELECT count(*) AS n FROM item')).toEqual({ n: 0 });
  });

  it('review: a later group that could never fit fails the run loudly instead of closing partial every night', async () => {
    await load(gearFixture());
    // Unchanged items and mobs are not sent, so the groups are tradeskills, classes, then the recipe group (bound 34).
    const res = await load(gearFixture(), { writeCeiling: 30 });
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/below the bound of statement group 3 of 3 \(34 rows\)/);
    expect(await one("SELECT status FROM data_import ORDER BY id DESC LIMIT 1")).toEqual({ status: 'failed' });
  });

  it('mobs are written right after the classes, so a stopped first run already holds them', async () => {
    const res = await load(gearFixture(), { writeCeiling: 600 }); // one item group fits, not all of them
    expect(res.status).toBe('partial');
    expect(res.written!.recipe.statements).toBe(0);
    expect(await one<{ n: number }>('SELECT count(*) AS n FROM mob')).toEqual({ n: 2 });
  });

  it('a dry run reports the write bound and the ceiling, and writes only its own row', async () => {
    const res = await load(gearFixture(), { dryRun: true });
    expect(res.writeBound).toBeGreaterThan(0);
    expect(res.ceiling).toBe(40_000);
    expect(res.predicted!.mob).toEqual({ insert: 2, update: 0, deactivate: 0 });
    expect(await one<{ n: number }>('SELECT count(*) AS n FROM item')).toEqual({ n: 0 });
  });
});

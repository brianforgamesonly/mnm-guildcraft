import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport, type WikiData } from '../../scripts/import/core.ts';
import corrupt from '../fixtures/wiki-corrupt.json';
import small from '../fixtures/wiki-small.json';

const db = bindingDb(env.DB as never);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 19, 12, 0, tick++)).toISOString();
const fixture = () => structuredClone(small) as unknown as WikiData;
const load = (raw: unknown, dryRun = false) => runImport(db, raw, { sourceSha: 'a'.repeat(40), now, dryRun });

const one = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
const fingerprint = () =>
  one<{ f: string }>(`SELECT
    (SELECT group_concat(name || kind || sort_order, ',') FROM (SELECT * FROM tradeskill ORDER BY name)) || '#' ||
    (SELECT group_concat(name_key || source || ifnull(stats_json, '-'), ',') FROM (SELECT * FROM item ORDER BY name_key)) || '#' ||
    (SELECT group_concat(source_key || active || ifnull(trivial, '-'), ',') FROM (SELECT * FROM recipe ORDER BY source_key)) || '#' ||
    (SELECT group_concat(recipe_id || ':' || item_id || 'x' || qty, ',') FROM (SELECT * FROM recipe_component ORDER BY recipe_id, item_id)) AS f`);
const componentsOf = (key: string) =>
  all<{ k: string; qty: number }>(
    `SELECT i.name_key AS k, c.qty FROM recipe_component c JOIN item i ON i.id = c.item_id JOIN recipe r ON r.id = c.recipe_id WHERE r.source_key = '${key}' ORDER BY k`,
  );

beforeEach(async () => {
  await env.DB.batch(
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

describe('import', () => {
  it('loads the fixture; a second run writes 0 reference rows (D1 metadata)', async () => {
    const first = await load(fixture());
    expect(first.status).toBe('ok');
    expect(first.counts).toMatchObject({
      sourceItems: 8, items: 8, stubItems: 4, sourceRecipes: 7, recipes: 6, duplicatesCollapsed: 1,
      recipesWithVariantAbove1: 1, components: 8, tradeskills: { crafting: 5, gathering: 0 }, trivialKnown: 4, caseOnlyMatches: 1,
    });
    expect(first.gatheringCandidates).toEqual(['Fishing', 'Herbalism']);
    expect(first.written!.item.rows_written).toBeGreaterThan(0);

    const second = await load(fixture());
    expect(second.status).toBe('ok');
    for (const t of ['tradeskill', 'item', 'recipe', 'recipe_component'] as const) {
      expect(second.written![t].statements, t).toBeGreaterThan(0); // statements were sent: not a vacuous zero
      expect(second.written![t].rows_written, t).toBe(0);
      expect(second.written![t].changes, t).toBe(0);
    }
    expect(Object.values(second.predicted!).flatMap((x) => Object.values(x)).every((n) => n === 0)).toBe(true);
    const runs = await all<{ status: string; source_version: string; items: number; recipes: number }>('SELECT status, source_version, items, recipes FROM data_import ORDER BY id');
    expect(runs).toEqual([
      { status: 'ok', source_version: `${'a'.repeat(40)} / 2026-10-14T07:00:59.321Z`, items: 12, recipes: 6 },
      { status: 'ok', source_version: `${'a'.repeat(40)} / 2026-10-14T07:00:59.321Z`, items: 12, recipes: 6 },
    ]);
  });

  it('the structure check fails on the corrupted fixture and leaves the data untouched', async () => {
    await load(fixture());
    const before = await fingerprint();
    const res = await load(corrupt);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/^structure check failed: /);
    expect(res.error).toContain('recipes[0].result is not {qty>0, item}');
    expect(await fingerprint()).toEqual(before);
    const last = await one<{ status: string; error: string }>('SELECT status, error FROM data_import ORDER BY id DESC LIMIT 1');
    expect(last.status).toBe('failed');
    expect(last.error).toBe(res.error);
  });

  it('stores NULL trivials as NULL, marks stubs, and maps a case-only name to the stored item', async () => {
    await load(fixture());
    expect(await one('SELECT trivial FROM recipe WHERE source_key = \'Blacksmithing|copper sword|1\'')).toEqual({ trivial: null });
    expect(await all('SELECT name, source FROM item WHERE source = \'stub\' ORDER BY name')).toEqual([
      { name: 'Bone Tip', source: 'stub' }, { name: 'Feather', source: 'stub' }, { name: 'Mystery Helm', source: 'stub' }, { name: 'Tanned Hide', source: 'stub' },
    ]);
    expect(await one('SELECT i.name FROM recipe r JOIN item i ON i.id = r.result_item_id WHERE r.source_key = \'Leatherworking|hide boots|1\'')).toEqual({ name: 'HIDE BOOTS' });
    expect(await one('SELECT stats_json FROM item WHERE name_key = \'copper sword\'')).toEqual({ stats_json: '{"delay":30,"dmg":5,"stats":{"STR":1}}' });
  });

  it('keeps each variant\'s key when components change', async () => {
    await load(fixture());
    const swordId = await one<{ id: number }>('SELECT id FROM recipe WHERE source_key = \'Blacksmithing|copper sword|1\'');
    const changed = fixture();
    changed.recipes[1].components = [{ qty: 4, item: 'Copper Bar' }, { qty: 1, item: 'Copper Ore' }]; // single-recipe group
    changed.recipes[3].components[1].qty = 2; // Arrow variant 1 (Feather): quantity change
    changed.recipes.reverse(); // source order must not matter
    const res = await load(changed);
    expect(res.status).toBe('ok');
    expect(await one('SELECT id FROM recipe WHERE source_key = \'Blacksmithing|copper sword|1\'')).toEqual(swordId);
    expect(await componentsOf('Blacksmithing|copper sword|1')).toEqual([{ k: 'copper bar', qty: 4 }, { k: 'copper ore', qty: 1 }]);
    expect(await componentsOf('Fletching|arrow|1')).toEqual([{ k: 'feather', qty: 2 }, { k: 'wood shaft', qty: 1 }]);
    expect(await componentsOf('Fletching|arrow|2')).toEqual([{ k: 'bone tip', qty: 1 }, { k: 'wood shaft', qty: 1 }]);
    expect(res.written!.recipe_component.changes).toBe(2 + 1); // sword: 1 update + 1 insert; arrow: 1 update
  });

  it('deactivates a recipe missing upstream, never deletes it, and reactivates it when it returns', async () => {
    await load(fixture());
    const without = fixture();
    without.recipes.splice(3, 1); // drop Arrow variant 1 (Feather)
    const res = await load(without);
    expect(res.counts!.deactivated).toBe(1);
    expect(await all('SELECT source_key, active FROM recipe WHERE source_key LIKE \'Fletching|arrow|%\' ORDER BY source_key')).toEqual([
      { source_key: 'Fletching|arrow|1', active: 0 },
      { source_key: 'Fletching|arrow|2', active: 1 },
    ]);
    expect(await componentsOf('Fletching|arrow|2')).toEqual([{ k: 'bone tip', qty: 1 }, { k: 'wood shaft', qty: 1 }]);
    await load(fixture());
    expect(await all('SELECT source_key, active FROM recipe WHERE source_key LIKE \'Fletching|arrow|%\' ORDER BY source_key')).toEqual([
      { source_key: 'Fletching|arrow|1', active: 1 },
      { source_key: 'Fletching|arrow|2', active: 1 },
    ]);
  });

  it('refuses an implausible drop in recipes', async () => {
    await load(fixture());
    const before = await fingerprint();
    const truncated = fixture();
    truncated.recipes = truncated.recipes.slice(0, 1);
    const res = await load(truncated);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/^implausible drop/);
    expect(await fingerprint()).toEqual(before);
  });

  it('a dry run writes nothing and predicts the writes', async () => {
    const res = await load(fixture(), true);
    expect(res.status).toBe('dry-run');
    expect(res.predicted).toEqual({
      tradeskill: { insert: 5, update: 0 },
      item: { insert: 8, update: 0 },
      stub: { insert: 4 },
      recipe: { insert: 6, update: 0, deactivate: 0 },
      recipe_component: { insert: 8, update: 0, delete: 0 },
    });
    expect(await one('SELECT (SELECT count(*) FROM item) + (SELECT count(*) FROM recipe) + (SELECT count(*) FROM data_import) AS n')).toEqual({ n: 0 });
  });
});

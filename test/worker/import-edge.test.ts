import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport, type WikiData } from '../../scripts/import/core.ts';
import edge from '../fixtures/wiki-edge.json';

// Source shapes first seen in mnm-tools e19cc75: "Unknown" placeholder components, "Recipe: …" scroll
// results, trivialUnconfirmed, and fields the structure check does not know.

const db = bindingDb(env.DB as never);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 19, 19, 0, tick++)).toISOString();
const fixture = () => structuredClone(edge) as unknown as WikiData;
const load = (raw: unknown) => runImport(db, raw, { sourceSha: 'e'.repeat(40), now });

const one = async <T>(sql: string) => (await env.DB.prepare(sql).first<T>())!;
const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;
const recipe = (key: string) =>
  one<{ trivial: number | null; trivial_unconfirmed: number; unknown_components: number; components: number; result: string }>(
    `SELECT r.trivial, r.trivial_unconfirmed, r.unknown_components, (SELECT count(*) FROM recipe_component c WHERE c.recipe_id = r.id) AS components,
            i.name AS result FROM recipe r JOIN item i ON i.id = r.result_item_id WHERE r.source_key = '${key}'`,
  );

beforeEach(async () => {
  await env.DB.batch(
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

describe('import: source edge cases', () => {
  it('the Unknown placeholder becomes a row count, never an item or a component', async () => {
    const res = await load(fixture());
    expect(res.status).toBe('ok');
    expect(await one("SELECT count(*) AS n FROM item WHERE name_key = 'unknown'")).toEqual({ n: 0 });
    expect(res.counts!.unknownComponentRows).toBe(1 + 2); // Prison Gruel 1, adopted Shiv scroll 2
  });

  it('an all-unknown recipe is still imported, with 0 stored components', async () => {
    await load(fixture());
    expect(await recipe('Cooking|prison gruel|1')).toEqual({ trivial: 10, trivial_unconfirmed: 0, unknown_components: 1, components: 0, result: 'Prison Gruel' });
  });

  it('Recipe: scrolls are skipped when the product has a recipe, adopted when it has only an item record, else skipped; all logged', async () => {
    const res = await load(fixture());
    expect(res.counts!.scrolls).toEqual({ skipped: 3, adopted: 1 });
    expect(await all("SELECT source_key FROM recipe WHERE source_key LIKE '%recipe:%'")).toEqual([]);
    expect(await recipe('Blacksmithing|double-bladed retractable prison shiv|1')).toEqual({
      trivial: null, trivial_unconfirmed: 0, unknown_components: 2, components: 0, result: 'Double-Bladed Retractable Prison Shiv',
    });
    expect(await all("SELECT source_key FROM recipe WHERE source_key LIKE 'Fletching|net arrow|%'")).toEqual([{ source_key: 'Fletching|net arrow|1' }]);
    expect(await one("SELECT count(*) AS n FROM item WHERE name_key = 'ectoplasm'")).toEqual({ n: 0 }); // skipped scroll leaves no stub
    const stored = JSON.parse((await one<{ warnings: string }>('SELECT warnings FROM data_import')).warnings) as { kind: string; result?: string; decision?: string }[];
    expect(stored.filter((w) => w.kind === 'scroll').map((w) => `${w.result} -> ${w.decision}`)).toEqual([
      'Recipe: Prison Gruel -> skipped: the product already has a recipe',
      "Recipe: Double-Bladed Retractable Prison Shiv -> adopted as the product's recipe",
      'Recipe: Net Arrow (x20) -> skipped: the product already has a recipe',
      'Recipe: Ghost Arrow -> skipped: the product has no item record',
    ]);
  });

  it('stores the unconfirmed-trivial flag', async () => {
    const res = await load(fixture());
    expect(await recipe('Smelting|copper bar|1')).toMatchObject({ trivial: 20, trivial_unconfirmed: 1 });
    expect(res.counts!.trivialUnconfirmed).toBe(1);
  });

  it('an unknown field produces a warning, not a failure', async () => {
    const res = await load(fixture());
    expect(res.status).toBe('ok');
    const stored = JSON.parse((await one<{ warnings: string }>('SELECT warnings FROM data_import')).warnings) as unknown[];
    expect(stored).toContainEqual({ kind: 'unknown_field', path: '$.vendors', count: 1 });
    expect(stored).toContainEqual({ kind: 'unknown_field', path: '$.recipes[].mold', count: 1 });
    expect(stored).toContainEqual({ kind: 'unmatched_component_names', count: 2, names: ['Ectoplasm', 'Unknown'] });
  });

  it('changing only the new columns produces a write; an unchanged re-run writes 0', async () => {
    await load(fixture());
    const same = await load(fixture());
    expect(same.written!.recipe.rows_written).toBe(0);
    expect(same.written!.recipe.changes).toBe(0);

    const flagOff = fixture();
    delete flagOff.recipes[0].trivialUnconfirmed;
    const r1 = await load(flagOff);
    expect(r1.predicted!.recipe.update).toBe(1);
    expect(r1.written!.recipe.changes).toBe(1);
    expect(await recipe('Smelting|copper bar|1')).toMatchObject({ trivial_unconfirmed: 0 });

    const moreUnknown = flagOff;
    moreUnknown.recipes[1].components.push({ qty: 1, item: 'Unknown' });
    const r2 = await load(moreUnknown);
    expect(r2.predicted!.recipe.update).toBe(1);
    expect(r2.written!.recipe.changes).toBe(1);
    expect(await recipe('Cooking|prison gruel|1')).toMatchObject({ unknown_components: 2, components: 0 });

    const again = await load(moreUnknown);
    expect(again.written!.recipe.rows_written).toBe(0);
    expect(again.written!.recipe_component.rows_written).toBe(0);
  });
});

import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { buildPlan, buildStatements, IMPORT_TABLES, loadExisting, previousImportFailing, runImport, type WikiData } from '../../scripts/import/core.ts';
import { alarmOutcome } from '../../scripts/ci/alarm-outcome.ts';
import { IMPORT_STATUS, isFailing, REAL_IMPORT } from '../../src/import-status.ts';
import corrupt from '../fixtures/wiki-corrupt.json';
import small from '../fixtures/wiki-small.json';
import { buildZonePlan } from '../../scripts/import/zones.ts';
import { zoneInput } from '../fixtures/zones-small.ts';

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
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import', 'game_class', 'mob'].map((t) =>
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
    for (const t of ['tradeskill', 'recipe', 'recipe_component'] as const) {
      expect(second.written![t].statements, t).toBeGreaterThan(0); // statements were sent: not a vacuous zero
      expect(second.written![t].rows_written, t).toBe(0);
      expect(second.written![t].changes, t).toBe(0);
    }
    // Order 13: unchanged item rows are not sent at all (itemDiffers, as the dry run predicts) ...
    expect(second.written!.item).toEqual({ statements: 0, rows_written: 0, changes: 0 });
    expect(second.rowsWritten).toBe(2); // its own data_import row, opened then closed
    expect(Object.values(second.predicted!).flatMap((x) => Object.values(x)).every((n) => n === 0)).toBe(true);
    // ... and when they are sent, the statements' own guards write 0: not a vacuous zero either.
    const unfiltered = buildStatements(buildPlan(fixture(), await loadExisting(db)), now());
    expect(unfiltered.filter((s) => s.table === 'item').length).toBeGreaterThan(0);
    expect((await db.run(unfiltered.map((s) => s.sql))).reduce((n, m) => n + m.rows_written, 0)).toBe(0);
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

  it('order 3: fills item.wiki_url for hasPage items only, as mnm-tools builds it; stubs stay NULL; then writes 0', async () => {
    const f = fixture();
    (f.items['Arrow'] as Record<string, unknown>).hasPage = false;
    // The state before order 3: items stored with wiki_url empty.
    await load(f);
    await env.DB.prepare('UPDATE item SET wiki_url = NULL').run();
    const dry = await load(f, true);
    expect(dry.predicted!.item).toEqual({ insert: 0, update: 7 });
    const fill = await load(f);
    expect(fill.written!.item.changes).toBe(7);
    expect(await all("SELECT name, wiki_url FROM item WHERE name IN ('Arrow', 'Copper Bar', 'HIDE BOOTS', 'Rune of Fire', 'Feather') ORDER BY name")).toEqual([
      { name: 'Arrow', wiki_url: null },
      { name: 'Copper Bar', wiki_url: 'https://monstersandmemories.miraheze.org/wiki/Copper_Bar' },
      { name: 'Feather', wiki_url: null },
      { name: 'HIDE BOOTS', wiki_url: 'https://monstersandmemories.miraheze.org/wiki/HIDE_BOOTS' },
      { name: 'Rune of Fire', wiki_url: 'https://monstersandmemories.miraheze.org/wiki/Rune_of_Fire' },
    ]);
    const again = await load(f);
    expect(again.predicted!.item).toEqual({ insert: 0, update: 0 });
    expect(again.written!.item.rows_written).toBe(0);
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

  it('a real write is refused while data_import holds no completed dry run, and allowed after one', async () => {
    const guarded = (dryRun: boolean) => runImport(db, fixture(), { sourceSha: 'b'.repeat(40), now, dryRun, requireDryRun: true });
    const refused = await guarded(false);
    expect(refused.status).toBe('refused');
    expect(await one('SELECT (SELECT count(*) FROM item) + (SELECT count(*) FROM recipe) AS n')).toEqual({ n: 0 });
    // Order 9: the refusal leaves its own row, with its reason, for the alarm.
    expect(await all('SELECT status, error FROM data_import')).toEqual([{ status: 'refused', error: refused.error }]);

    expect((await guarded(true)).status).toBe('dry-run');
    const allowed = await guarded(false);
    expect(allowed.status).toBe('ok');
    expect(await one('SELECT count(*) AS n FROM recipe')).toEqual({ n: 6 });
    expect(await all('SELECT status FROM data_import ORDER BY id')).toEqual([{ status: 'refused' }, { status: 'dry-run' }, { status: 'ok' }]);
  });

  it('order 9 alarm: refused then refused alerts once; refused then ok is a recovery', async () => {
    const guarded = () => runImport(db, fixture(), { sourceSha: 'd'.repeat(40), now, requireDryRun: true });
    // The nightly run is scheduled; what it does is alarmOutcome(failed, previousFailing, scheduled).
    const nightly = async () => {
      const r = await guarded();
      return alarmOutcome(isFailing(r.status), await previousImportFailing(db), true);
    };
    expect(await nightly()).toBe('notify'); // first refusal: no earlier state, so it alerts
    expect(await nightly()).toBe('quiet'); // second refusal: already failing, no second alert
    await runImport(db, fixture(), { sourceSha: 'd'.repeat(40), now, dryRun: true }); // dry runs are not alarm state
    expect(await nightly()).toBe('recovered');
    expect(await nightly()).toBe('pass');
  });

  it('order 9: "Last import" is a positive rule: a refused or dry run is never the last import', async () => {
    await load(fixture());
    await env.DB.prepare("INSERT INTO data_import (source, source_version, status, started_at, finished_at) VALUES ('t', 'v', 'refused', 'x', 'x'), ('t', 'v', 'dry-run', 'x', 'x')").run();
    expect(await one(`SELECT status FROM data_import WHERE ${REAL_IMPORT} ORDER BY id DESC LIMIT 1`)).toEqual({ status: 'ok' });
    expect(Object.keys(IMPORT_STATUS).sort()).toEqual(['dry-run', 'failed', 'ok', 'partial', 'refused', 'running']);
  });

  it('a structure failure in a dry run does not unlock real writes', async () => {
    const res = await runImport(db, corrupt, { sourceSha: 'c'.repeat(40), now, dryRun: true });
    expect(res.status).toBe('failed');
    expect((await runImport(db, fixture(), { sourceSha: 'c'.repeat(40), now, requireDryRun: true })).status).toBe('refused');
  });

  it('a dry run writes only its own data_import row and predicts the writes', async () => {
    const res = await load(fixture(), true);
    expect(res.status).toBe('dry-run');
    expect(res.predicted).toEqual({
      tradeskill: { insert: 5, update: 0 },
      item: { insert: 8, update: 0 },
      stub: { insert: 4 },
      recipe: { insert: 6, update: 0, deactivate: 0 },
      recipe_component: { insert: 8, update: 0, delete: 0 },
      game_class: { insert: 0, update: 0, deactivate: 0 },
      mob: { insert: 0, update: 0, deactivate: 0 },
    });
    expect(await one('SELECT (SELECT count(*) FROM tradeskill) + (SELECT count(*) FROM item) + (SELECT count(*) FROM recipe) + (SELECT count(*) FROM recipe_component) AS n')).toEqual({ n: 0 });
    expect(await all('SELECT status, items, recipes FROM data_import')).toEqual([{ status: 'dry-run', items: 12, recipes: 6 }]);
  });
});

describe('game_class (classes derived at import)', () => {
  // 121 items carry a class, so the 1% bar is 1.21 items: SHB (1 item) drops, WAR and CLR stay.
  const withClasses = () => {
    const f = fixture();
    for (let i = 0; i < 120; i++) f.items[`Class Test ${i}`] = { class: i === 0 ? 'SHB' : i % 2 ? 'war clr' : 'WAR<br> ALL' };
    f.items['Class Test markup'] = { class: '<br>SPB' };
    f.items['Class Test null'] = { class: null };
    return f;
  };

  it('order 10: every statement writes exactly the table it names, and together they cover IMPORT_TABLES (the backup reads that list)', () => {
    const empty = {
      tradeskills: new Map(), items: new Map(), recipes: new Map(), activeWikiRecipes: 0, classes: new Map(), mobs: new Map(),
      zones: new Map(), zoneNames: new Map(), npcs: new Map(), importSources: new Map(), factions: new Map(), factionLinks: new Map(), indexes: {},
    };
    const f = withClasses();
    f.mobs['a test mob'] = { title: 'A test mob', zone: '[[Night Harbor]]' };
    const plan = buildPlan(f, empty);
    // Order 17: the zone tables are written by a run that read the zone sources.
    plan.zones = buildZonePlan(zoneInput(), [], [], '2026-10-20T00:00:00Z');
    const stmts = buildStatements(plan, '2026-10-20T00:00:00Z');
    for (const s of stmts) expect(/^(?:INSERT INTO|UPDATE|DELETE FROM) (\w+)/.exec(s.sql)?.[1], s.sql.slice(0, 60)).toBe(s.table);
    expect([...new Set(stmts.map((s) => s.table))].sort()).toEqual([...IMPORT_TABLES].sort());
  });

  it('upper-cases, strips markup, drops ALL/NONE and keeps codes on at least 1% of class-carrying items', async () => {
    const res = await load(withClasses());
    expect(res.status).toBe('ok');
    // Order 13: "<br>SPB" is markup then SPB (classTokens), no longer a token with nothing before its "<".
    expect(res.classes).toEqual({
      carrying: 121,
      kept: [{ code: 'WAR', item_count: 119 }, { code: 'CLR', item_count: 60 }],
      dropped: [{ code: 'SHB', items: 1 }, { code: 'SPB', items: 1 }],
      ignored: [{ token: 'ALL', items: 59 }],
    });
    expect(await all('SELECT code, item_count FROM game_class ORDER BY code')).toEqual([
      { code: 'CLR', item_count: 60 },
      { code: 'WAR', item_count: 119 },
    ]);
  });

  it('a second run writes 0 game_class rows; a code that falls away is set to 0, never deleted', async () => {
    await load(withClasses());
    const second = await load(withClasses());
    expect(second.written!.game_class.statements).toBeGreaterThan(0);
    expect(second.written!.game_class.rows_written).toBe(0);
    expect(second.predicted!.game_class).toEqual({ insert: 0, update: 0, deactivate: 0 });

    const noClr = withClasses();
    for (const it of Object.values(noClr.items)) if (it.class === 'war clr') it.class = 'war';
    const dry = await load(noClr, true);
    expect(dry.predicted!.game_class).toEqual({ insert: 0, update: 0, deactivate: 1 });
    const third = await load(noClr);
    expect(third.written!.game_class.changes).toBe(1);
    expect(await all('SELECT code, item_count FROM game_class ORDER BY code')).toEqual([
      { code: 'CLR', item_count: 0 },
      { code: 'WAR', item_count: 119 },
    ]);
  });
});

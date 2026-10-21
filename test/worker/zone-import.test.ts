// Work order 17, ITEM 1: the zone list and its derived mapping, the NPC merge, map images only where the licence is
// known, the staleness warning, and a re-import that writes nothing.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { buildPlan, buildStatements, loadExisting, runImport } from '../../scripts/import/core.ts';
import { buildZonePlan, levelSort, npcZoneParts, zoneKey } from '../../scripts/import/zones.ts';
import { mergeCreature } from '../../src/zone/creatures.ts';
import small from '../fixtures/wiki-small.json';
import { withZoneWiki, zoneInput } from '../fixtures/zones-small.ts';

const db = bindingDb(env.DB as never);
let tick = 0;
const now = () => new Date(Date.UTC(2026, 9, 21, 12, 0, tick++)).toISOString();
const load = (zones = zoneInput(), dryRun = false) => runImport(db, withZoneWiki(small), { sourceSha: 'b'.repeat(40), now, dryRun, zones });
const all = async <T>(sql: string) => (await env.DB.prepare(sql).all<T>()).results;

beforeEach(async () => {
  await env.DB.batch(
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import', 'game_class', 'mob', 'zone', 'zone_name', 'npc', 'import_source'].map(
      (t) => env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
});

describe('order 17: names', () => {
  it('normalises only case and curly apostrophes', () => {
    expect(zoneKey('Keeper’s Bight')).toBe(zoneKey("keeper's bight"));
    expect(zoneKey('Night Harbor (West)')).not.toBe(zoneKey('Night Harbor'));
    expect(zoneKey(' Rothold')).not.toBe(zoneKey('Rothold'));
  });

  it('splits NPC zone text only on ", " and " or ", then de-duplicates', () => {
    expect(npcZoneParts('Underdocks, Underdocks')).toEqual(['Underdocks']);
    expect(npcZoneParts("Keeper's Bight or Night Harbor")).toEqual(["Keeper's Bight", 'Night Harbor']);
    expect(npcZoneParts('Night Harbor Faelindral')).toEqual(['Night Harbor Faelindral']);
    expect(npcZoneParts('Rothold,Tel Ekir')).toEqual(['Rothold,Tel Ekir']);
    expect(npcZoneParts('')).toEqual([]);
  });

  it('sorts levels by their first whole number; no number sorts last (null)', () => {
    expect(['~36-37', '< 20', '20+', '1 - ??', '??', ''].map(levelSort)).toEqual([36, 20, 20, 1, null, null]);
  });
});

describe('order 17: zone import', () => {
  it('builds the zone list from the registries and maps every other name onto it, reporting the unmatched', async () => {
    const res = await load();
    expect(res.status).toBe('ok');
    const zones = await all<{ key: string; name: string; atlas_id: string | null; level: string | null; adjacent_json: string | null; map_json: string | null; markers_json: string | null }>(
      'SELECT key, name, atlas_id, level, adjacent_json, map_json, markers_json FROM zone ORDER BY key',
    );
    expect(zones.map((z) => `${z.name}:${z.atlas_id ?? '-'}`)).toEqual(["Ail'Vorith:-", 'Evershade Weald:evershade-weald', "Keeper's Bight:keepers-bight", 'Rothold:rothold', 'Sunken Resort:-']);
    expect(zones.find((z) => z.name === 'Evershade Weald')!.adjacent_json).toBe(JSON.stringify(["Keeper's Bight", 'Fields of the Lost']));
    // Markers keep label, category and notes as recorded; the pixel positions are dropped.
    expect(JSON.parse(zones.find((z) => z.name === 'Evershade Weald')!.markers_json!)).toEqual([
      { label: 'Copper Vein', category: 'ore', notes: null },
      { label: 'Old Hermit', category: 'quest', notes: 'https://mnm-db.com/#/mob/x\n\nAsk twice' },
    ]);
    const n = res.zones!.names;
    expect(n['atlas:maps']).toEqual({ names: 4, matched: 3, unmatched: ['World map'] });
    expect(n['mo-betta:adjacent'].unmatched).toEqual(['Fields of the Lost']);
    expect(n['mo-betta:npcs'].unmatched).toEqual(['Evershade Weald Rothold']);
    expect(n['mo-betta:npcs'].matched).toBe(4); // Evershade Weald, Keeper's Bight, Ail'vorith (case), Rothold
    const unmatched = await all<{ source: string; name: string }>('SELECT source, name FROM zone_name WHERE zone_key IS NULL ORDER BY source, name');
    expect(unmatched.map((r) => `${r.source}:${r.name}`)).toEqual(['atlas:maps:World map', 'mo-betta:adjacent:Fields of the Lost', 'mo-betta:npcs:Evershade Weald Rothold']);
    expect(res.warnings!.filter((w) => w.kind === 'zone_names_unmatched').map((w) => (w as { source: string }).source)).toEqual(['atlas:maps', 'mo-betta:adjacent', 'mo-betta:npcs']);
  });

  it('stores Mo Betta NPCs per zone; folds records equal but for case; merchants kept with their kind; reports the merge', async () => {
    const res = await load();
    const npcs = await all<{ zone_key: string; name: string; kind: string; class: string | null; location: string | null }>('SELECT zone_key, name, kind, class, location FROM npc ORDER BY zone_key, name');
    expect(npcs.map((r) => `${r.zone_key}:${r.name}:${r.kind}`)).toEqual([
      "ail'vorith:Supplier Jul:merchant",
      'evershade weald:A gnoll scout:npc',
      'evershade weald:Marshal Harding:npc',
      "keeper's bight:A wanderer:npc",
      "keeper's bight:Marshal Harding:npc",
      'rothold:A wanderer:npc',
    ]);
    // The first record wins a conflict; an empty field is filled from the second.
    const scout = npcs.find((r) => r.name === 'A gnoll scout')!;
    expect([scout.class, scout.location]).toEqual(['Warrior', 'North']);
    const s = res.zones!.npcs;
    expect([s.source, s.merchants, s.rows, s.noZone, s.caseDuplicates]).toEqual([7, 1, 6, 2, 1]);
    expect(s.caseDuplicateConflicts).toEqual([
      { zone: 'Evershade Weald', name: 'A gnoll scout', field: 'location', kept: 'North', dropped: 'South' },
    ]);
    // mnm-tools' mob keeps its fields; Mo Betta fills only the class it lacks.
    expect(s.mobMatches).toBe(1);
    expect(s.mobFills).toEqual({ class: 1 });
    expect(s.mobConflicts.map((c) => c.field)).toEqual(['level', 'loot']);
    expect(s.mobsWithoutNpc).toEqual(['a curious jackal']);
  });

  it('the merge rule: the mob keeps every value it holds, Mo Betta fills only what it lacks', () => {
    const r = mergeCreature({ level: '8 - 10', race: null, class: 'Warrior', loot: [] }, { level: '~9', race: 'Gnoll', class: 'Rogue', loot: ['Tooth'] });
    expect(r.merged).toEqual({ level: '8 - 10', race: 'Gnoll', class: 'Warrior', loot: ['Tooth'] });
    expect(r.filled).toEqual(['race', 'loot']);
    expect(r.conflicts.map((c) => c.field)).toEqual(['level', 'class']);
  });

  it('keeps a map image only where the licence record names it; a map file shared by several zones is a placeholder', async () => {
    const res = await load();
    expect(res.zones!.maps.withImage).toEqual([]);
    expect(res.zones!.maps.placeholderFiles).toEqual(['File:Phformaps.png']);
    expect(res.zones!.maps.unchecked).toEqual([{ zone: 'Rothold', file: 'wiki: Rothold map by skoop.png' }]);
    const licences = {
      'wiki: Rothold map by skoop.png': {
        licence: 'CC BY-SA 4.0', licence_url: 'https://creativecommons.org/licenses/by-sa/4.0/', author: 'skoop', via: 'mnm-tools',
        page: 'https://monstersandmemories.miraheze.org/wiki/File:Rothold_map_by_skoop.png', evidence: 'https://web.archive.org/x', checked: '2026-10-21',
      },
    };
    const plan = buildZonePlan(zoneInput(), [], [], '2026-10-21T00:00:00Z', licences);
    const rothold = plan.zones.find((z) => z.name === 'Rothold')!;
    expect(JSON.parse(rothold.map_json!)).toMatchObject({
      url: `https://raw.githubusercontent.com/Boisteroux/mnm-tools/${'c'.repeat(40)}/mnmdb/maps/rothold.avif`,
      author: 'skoop',
      licence: 'CC BY-SA 4.0',
    });
  });

  it('warns (never fails) when a mnm-tools or Mo Betta file has not changed for 30 days; the atlas registry is exempt', async () => {
    const res = await load(zoneInput('2026-09-01T00:00:00Z'));
    expect(res.status).toBe('ok');
    expect(res.warnings!.filter((w) => w.kind === 'stale_source')).toEqual([{ kind: 'stale_source', source: 'mnm-tools/maps.json', changedAt: '2026-09-01T00:00:00Z', days: 50 }]);
    const versions = await all<{ name: string; sha: string }>('SELECT name, sha FROM import_source ORDER BY name');
    expect(versions.map((v) => v.name)).toEqual(['mnm-tools/maps.json', 'mnm-tools/wiki.json', 'mnmatlas/maps.json', 'mo-betta/npcs.json', 'mo-betta/zones.json']);
  });

  it('a re-import of unchanged sources writes 0 zone rows; a vanished NPC is deactivated, never deleted', async () => {
    await load();
    const again = await load();
    for (const t of ['zone', 'zone_name', 'npc', 'import_source'] as const) expect(again.written![t].rows_written, t).toBe(0);
    expect(again.predicted!.zones).toEqual({ zone: 0, zone_name: 0, npc: 0, import_source: 0, deactivate: { zone: 0, zone_name: 0, npc: 0 } });
    const z = zoneInput();
    (z.files['mo-betta/npcs.json'] as { npcs: { name: string }[] }).npcs = (z.files['mo-betta/npcs.json'] as { npcs: { name: string }[] }).npcs.filter((n) => n.name !== 'Supplier Jul');
    await load(z);
    expect(await all('SELECT name, active FROM npc WHERE name = \'Supplier Jul\'')).toEqual([{ name: 'Supplier Jul', active: 0 }]);
  });

  it('keeps every statement under D1\'s 100,000-byte limit, however long the markers and descriptions', async () => {
    const z = zoneInput();
    const tools = z.files['mnm-tools/maps.json'] as { zones: { name: string; markers: unknown[] }[] };
    tools.zones = Array.from({ length: 60 }, (_, i) => ({ name: `Long Zone ${i}`, markers: Array.from({ length: 40 }, () => ({ label: 'x', category: 'ore', notes: 'é'.repeat(400) })) }));
    const plan = buildPlan(withZoneWiki(small), await loadExisting(db));
    plan.zones = buildZonePlan(z, [], [], '2026-10-21T00:00:00Z');
    const stmts = buildStatements(plan, '2026-10-21T00:00:00Z');
    const longest = Math.max(...stmts.map((s) => new TextEncoder().encode(s.sql).length));
    expect(longest).toBeGreaterThan(30_000);
    expect(longest).toBeLessThan(100_000);
    const res = await load(z);
    expect(res.status).toBe('ok');
  });

  it('a dry run writes no zone rows and predicts the first import', async () => {
    const res = await load(zoneInput(), true);
    expect(res.status).toBe('dry-run');
    expect(res.predicted!.zones).toEqual({ zone: 5, zone_name: 23, npc: 6, import_source: 5, deactivate: { zone: 0, zone_name: 0, npc: 0 } });
    expect(await all('SELECT key FROM zone')).toEqual([]);
  });

  it('refuses a malformed zone source without writing zone rows', async () => {
    const z = zoneInput();
    z.files['mo-betta/zones.json'] = { zones: 'nope' };
    const res = await load(z);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/zone sources: mo-betta\/zones.json: zones is not a list/);
    expect(await all('SELECT key FROM zone')).toEqual([]);
  });
});

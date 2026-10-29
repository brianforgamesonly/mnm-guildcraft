// Work order 17, ITEM 1: the zone list and its derived mapping, the NPC merge, map images only where the licence is
// known, the staleness warning, and a re-import that writes nothing.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { buildPlan, buildStatements, loadExisting, runImport } from '../../scripts/import/core.ts';
import { buildZonePlan, levelSort, npcZoneParts, zoneKey } from '../../scripts/import/zones.ts';
import { mentions } from '../../scripts/import/quests.ts';
import { FACTION_ALIASES, factionName } from '../../src/faction-aliases.ts';
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
    ['recipe_component', 'character_recipe', 'recipe', 'item_image', 'recipe_report', 'item', 'character_skill', 'board_post', 'tradeskill', 'data_import', 'game_class', 'mob', 'zone', 'zone_name', 'npc', 'import_source', 'npc_faction', 'faction_quest', 'faction_post', 'faction'].map(
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
    // Order 28b, PR D: the wiki snapshot is the zone source (wiki:*), Mo Betta is not read.
    expect(n['wiki:adjacent'].unmatched).toEqual(['Fields of the Lost']);
    expect(n['wiki:npcs'].unmatched).toEqual(['Evershade Weald Rothold']);
    expect(n['wiki:npcs'].matched).toBe(4); // Evershade Weald, Keeper's Bight, Ail'vorith (case), Rothold
    expect(Object.entries(n).filter(([s, v]) => s.startsWith('mo-betta:') && v.names > 0)).toEqual([]);
    const unmatched = await all<{ source: string; name: string }>('SELECT source, name FROM zone_name WHERE zone_key IS NULL ORDER BY source, name');
    expect(unmatched.map((r) => `${r.source}:${r.name}`)).toEqual(['atlas:maps:World map', 'wiki:adjacent:Fields of the Lost', 'wiki:npcs:Evershade Weald Rothold']);
    expect(res.warnings!.filter((w) => w.kind === 'zone_names_unmatched').map((w) => (w as { source: string }).source)).toEqual(['atlas:maps', 'wiki:adjacent', 'wiki:npcs']);
  });

  it('stores the wiki\'s NPCs per zone; folds records equal but for case; merchants kept with their kind; reports the merge', async () => {
    const res = await load();
    const npcs = await all<{ zone_key: string; name: string; kind: string; class: string | null; location: string | null; level: string | null; named: number | null }>(
      'SELECT zone_key, name, kind, class, location, level, named FROM npc ORDER BY zone_key, name',
    );
    expect(npcs.map((r) => `${r.zone_key}:${r.name}:${r.kind}`)).toEqual([
      "ail'vorith:Supplier Jul:merchant",
      'evershade weald:A Gnoll scout:npc',
      'evershade weald:Marshal Harding:npc',
      "keeper's bight:A wanderer:npc",
      "keeper's bight:Marshal Harding:npc",
      'rothold:A wanderer:npc',
    ]);
    // The first record wins a conflict; an empty field is filled from the second. The parser reads pages A→Z by title,
    // so "A Gnoll scout" (South, Warrior, no level) comes first and "A gnoll scout" fills its level.
    const scout = npcs.find((r) => r.name === 'A Gnoll scout')!;
    expect([scout.class, scout.location, scout.level]).toEqual(['Warrior', 'South', '~8-11']);
    // Order 28: the wiki's tags are stored (Marshal Harding is in Category:Named Mobs).
    expect(npcs.filter((r) => r.named === 1).map((r) => `${r.zone_key}:${r.name}`)).toEqual(['evershade weald:Marshal Harding', "keeper's bight:Marshal Harding"]);
    const s = res.zones!.npcs;
    expect([s.source, s.merchants, s.rows, s.noZone, s.caseDuplicates]).toEqual([7, 1, 6, 2, 1]);
    expect(s.caseDuplicateConflicts).toEqual([
      { zone: 'Evershade Weald', name: 'A Gnoll scout', field: 'location', kept: 'South', dropped: 'North' },
    ]);
    // mnm-tools' mob keeps its fields; the wiki fills only the class it lacks.
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

  it('keeps a map image only where the licence record names it (the wiki snapshot carries no map file)', async () => {
    const res = await load();
    expect(res.zones!.maps.withImage).toEqual([]);
    expect(res.zones!.maps.placeholderFiles).toEqual([]);
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

  it('warns (never fails) when a mnm-tools file has not changed for 30 days; the atlas registry is exempt; the snapshot is recorded', async () => {
    const res = await load(zoneInput('2026-09-01T00:00:00Z'));
    expect(res.status).toBe('ok');
    expect(res.warnings!.filter((w) => w.kind === 'stale_source')).toEqual([{ kind: 'stale_source', source: 'mnm-tools/maps.json', changedAt: '2026-09-01T00:00:00Z', days: 50 }]);
    const versions = await all<{ name: string; sha: string }>('SELECT name, sha FROM import_source ORDER BY name');
    expect(versions.map((v) => v.name)).toEqual(['mnm-tools/maps.json', 'mnm-tools/wiki.json', 'mnmatlas/maps.json', 'wiki/snapshot']);
  });

  it('a re-import of unchanged sources writes 0 zone rows; a vanished NPC is deactivated, never deleted', async () => {
    await load();
    const again = await load();
    for (const t of ['zone', 'zone_name', 'npc', 'import_source', 'faction', 'npc_faction', 'faction_quest'] as const) expect(again.written![t].rows_written, t).toBe(0);
    expect(again.predicted!.zones).toEqual({
      zone: 0, zone_name: 0, npc: 0, import_source: 0, faction: 0, npc_faction: 0, faction_quest: 0, factions_changed: 0,
      deactivate: { zone: 0, zone_name: 0, npc: 0, faction: 0, npc_faction: 0, faction_quest: 0 },
    });
    await load(zoneInput(undefined, (r) => void (r.npcs = r.npcs.filter((n) => n.name !== 'Supplier Jul'))));
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
    expect(res.predicted!.zones).toEqual({
      zone: 5, zone_name: 23, npc: 6, import_source: 4, faction: 3, npc_faction: 8, faction_quest: 3, factions_changed: 3,
      deactivate: { zone: 0, zone_name: 0, npc: 0, faction: 0, npc_faction: 0, faction_quest: 0 },
    });
    expect(await all('SELECT key FROM zone')).toEqual([]);
  });

  it('order 24: keeps each NPC row\'s factions (lost) and opposing_factions (gained), trimmed, never merged; counts what has no npc row', async () => {
    const res = await load();
    const factions = await all<{ name: string; active: number; changed_at: string | null }>('SELECT name, active, changed_at FROM faction ORDER BY name');
    expect(factions.map((f) => f.name)).toEqual(['Gnoll Pack', 'Gnoll Pack Elders', 'Weald Rangers']);
    expect(factions.every((f) => f.active === 1 && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(f.changed_at!))).toBe(true);
    const links = await all<{ zone_key: string; npc_name: string; faction: string; kind: string }>(
      'SELECT l.zone_key, l.npc_name, f.name AS faction, l.kind FROM npc_faction l JOIN faction f ON f.id = l.faction_id ORDER BY 1, 2, 3, 4',
    );
    expect(links.map((l) => `${l.zone_key}:${l.npc_name}:${l.faction}:${l.kind}`)).toEqual([
      // The case-only duplicate record's " Gnoll Pack " is trimmed and folds into the first record's link (pages A→Z:
      // "A Gnoll scout" first).
      'evershade weald:A Gnoll scout:Gnoll Pack:lost',
      'evershade weald:A Gnoll scout:Weald Rangers:gained',
      'evershade weald:Marshal Harding:Gnoll Pack:gained',
      'evershade weald:Marshal Harding:Gnoll Pack Elders:gained',
      'evershade weald:Marshal Harding:Weald Rangers:lost',
      "keeper's bight:Marshal Harding:Gnoll Pack:gained",
      "keeper's bight:Marshal Harding:Gnoll Pack Elders:gained",
      "keeper's bight:Marshal Harding:Weald Rangers:lost",
    ]);
    // "Gnoll Pack" and "Gnoll Pack Elders" stay separate; "Lost Cause" is named only by an NPC without a row, so no row.
    expect(res.zones!.factions).toEqual({ npcsWithFactions: 5, npcsWithoutRow: 2, linksLeftOut: 2, factions: 3, namesWithoutRow: ['Lost Cause'], links: { lost: 3, gained: 5 }, merged: [] });
  });

  it('order 24: a re-import changes only what changed; a vanished link or faction is deactivated, and changed_at marks the posts to re-render', async () => {
    await load();
    const at = async () => Object.fromEntries((await all<{ name: string; changed_at: string }>('SELECT name, changed_at FROM faction')).map((f) => [f.name, f.changed_at]));
    const first = await at();
    await new Promise((r) => setTimeout(r, 5));
    // Marshal Harding loses "Gnoll Pack Elders" (its only NPC); the gnoll scout's level changes.
    const z = zoneInput(undefined, (r) => {
      r.npcs.find((n) => n.name === 'Marshal Harding')!.opposing_factions = ['Gnoll Pack'];
      r.npcs.find((n) => n.name === 'A gnoll scout')!.level = '~9-11';
    });
    const res = await load(z);
    expect(res.predicted!.zones!.deactivate).toMatchObject({ faction: 1, npc_faction: 2 });
    expect(res.predicted!.zones!.factions_changed).toBe(3);
    expect(await all('SELECT name, active FROM faction ORDER BY name')).toEqual([
      { name: 'Gnoll Pack', active: 1 },
      { name: 'Gnoll Pack Elders', active: 0 },
      { name: 'Weald Rangers', active: 1 },
    ]);
    expect((await all<{ n: number }>('SELECT count(*) AS n FROM npc_faction WHERE active = 0'))[0].n).toBe(2);
    const second = await at();
    // The scout's level touches both its factions; the link change touches Gnoll Pack Elders.
    for (const f of ['Gnoll Pack', 'Gnoll Pack Elders', 'Weald Rangers']) expect(second[f] > first[f], f).toBe(true);
    // Nothing changed: nothing is touched.
    await load(z);
    expect(await at()).toEqual(second);
  });

  it('refuses a malformed zone source without writing zone rows', async () => {
    const z = zoneInput();
    z.files['mnm-tools/maps.json'] = { zones: 'nope' };
    const res = await load(z);
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/zone sources: mnm-tools\/maps.json: zones is not a list/);
    expect(await all('SELECT key FROM zone')).toEqual([]);
    // A snapshot whose zone pages use no {{ZoneDetails}} is refused the same way.
    const bare = zoneInput(undefined, (r) => void (r.zones = []));
    const res2 = await load(bare);
    expect(res2.status).toBe('failed');
    expect(res2.error).toMatch(/zone sources: wiki snapshot: no zone page uses \{\{ZoneDetails\}\}/);
    expect(await all('SELECT key FROM zone')).toEqual([]);
  });
});

describe('order 25: quest lines and the approved faction merges', () => {
  const names = ['Gnoll Pack', 'Gnoll Pack Elders', 'Weald Rangers', 'The Underwatch', 'Citizens of Underdocks'];

  it('a line mentions a faction by its whole name, any case; where names overlap the longest wins', () => {
    expect(mentions('Faction with Gnoll Pack Elders and Weald Rangers', names)).toEqual(['Gnoll Pack Elders', 'Weald Rangers']);
    expect(mentions('faction with GNOLL PACK.', names)).toEqual(['Gnoll Pack']);
    expect(mentions('Faction with Gnoll Packs', names)).toEqual([]);
    expect(mentions('Faction with Delvestone Mining Company, The Underwatch, Citizens of Underdocks', names)).toEqual(['The Underwatch', 'Citizens of Underdocks']);
  });

  it('takes only reward lines starting "Faction" (any case, leading spaces), stores one row per line and faction, and reports the unmatched', async () => {
    const res = await load();
    expect(await all('SELECT f.name AS faction, q.quest_title, q.line, q.wiki_url, q.active FROM faction_quest q JOIN faction f ON f.id = q.faction_id ORDER BY 2, 1')).toEqual([
      { faction: 'Gnoll Pack Elders', quest_title: 'Elder Words', line: 'faction with Gnoll Pack Elders and Weald Rangers', wiki_url: 'https://monstersandmemories.miraheze.org/wiki/Elder_Words', active: 1 },
      { faction: 'Weald Rangers', quest_title: 'Elder Words', line: 'faction with Gnoll Pack Elders and Weald Rangers', wiki_url: 'https://monstersandmemories.miraheze.org/wiki/Elder_Words', active: 1 },
      { faction: 'Weald Rangers', quest_title: 'Ranger Trial', line: 'Faction standing with Weald Rangers', wiki_url: 'https://monstersandmemories.miraheze.org/wiki/Ranger_Trial', active: 1 },
    ]);
    expect(res.zones!.quests).toMatchObject({ quests: 4, questsWithLines: 3, lines: 3, unmatched: [{ quest: 'Fight Night', line: 'Faction with The Fight Club' }], untitled: 0 });
  });

  it('a re-import writes 0 quest rows; a changed line is written, the old one deactivated, and the factions marked to re-render', async () => {
    await load();
    expect((await load()).written!.faction_quest.rows_written).toBe(0);
    const before = (await all<{ changed_at: string }>("SELECT changed_at FROM faction WHERE name = 'Weald Rangers'"))[0].changed_at;
    await new Promise((r) => setTimeout(r, 5));
    const z = zoneInput(undefined, (r) => void (r.quests.find((q) => q.title === 'Ranger Trial')!.rewards = ['Faction with Weald Rangers']));
    const res = await load(z);
    expect(res.predicted!.zones).toMatchObject({ faction_quest: 1, deactivate: { faction_quest: 1 } });
    expect(await all("SELECT line, active FROM faction_quest WHERE quest_title = 'Ranger Trial' ORDER BY line")).toEqual([
      { line: 'Faction standing with Weald Rangers', active: 0 },
      { line: 'Faction with Weald Rangers', active: 1 },
    ]);
    expect((await all<{ changed_at: string }>("SELECT changed_at FROM faction WHERE name = 'Weald Rangers'"))[0].changed_at > before).toBe(true);
  });

  it('the alias file holds exactly the eight approved groups (the owner, 2026-10-27)', () => {
    expect([...FACTION_ALIASES]).toEqual([
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
    expect(factionName('City Watch of Night Harbor')).toBe('City Watch of Night Harbor');
    expect(factionName('constructor')).toBe('constructor');
  });

  it('a stored misspelling is deactivated (row kept), its links move to the approved name, and both are marked to re-render', async () => {
    await load(zoneInput(undefined, (r) => void (r.npcs.find((n) => n.name === 'A gnoll scout')!.factions = ['Gnoll Pack', 'Red Mantles'])));
    // As an import before order 25 stored it: the misspelling as its own faction, with a link.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO faction (name, active, changed_at) VALUES ('Red Mantle', 1, '2026-10-01T00:00:00.000Z')"),
      env.DB.prepare("INSERT INTO npc_faction (zone_key, npc_name, faction_id, kind, active) SELECT 'evershade weald', 'Marshal Harding', id, 'lost', 1 FROM faction WHERE name = 'Red Mantle'"),
    ]);
    const res = await load(
      zoneInput(undefined, (r) => {
        r.npcs.find((n) => n.name === 'A gnoll scout')!.factions = ['Gnoll Pack', 'Red Mantles'];
        r.npcs.find((n) => n.name === 'Marshal Harding')!.factions = ['Weald Rangers', ' Red Mantle '];
      }),
    );
    expect(res.zones!.factions.merged).toEqual([{ from: 'Red Mantle', to: 'Red Mantles', rows: 2 }]);
    expect(await all("SELECT name, active FROM faction WHERE name LIKE 'Red Mantle%' ORDER BY name")).toEqual([
      { name: 'Red Mantle', active: 0 },
      { name: 'Red Mantles', active: 1 },
    ]);
    expect(await all("SELECT l.zone_key, l.npc_name, f.name AS faction, l.active FROM npc_faction l JOIN faction f ON f.id = l.faction_id WHERE f.name LIKE 'Red Mantle%' ORDER BY 3, 1, 2")).toEqual([
      { zone_key: 'evershade weald', npc_name: 'Marshal Harding', faction: 'Red Mantle', active: 0 },
      { zone_key: 'evershade weald', npc_name: 'A Gnoll scout', faction: 'Red Mantles', active: 1 },
      { zone_key: 'evershade weald', npc_name: 'Marshal Harding', faction: 'Red Mantles', active: 1 },
      { zone_key: "keeper's bight", npc_name: 'Marshal Harding', faction: 'Red Mantles', active: 1 },
    ]);
    const at = await all<{ name: string; changed_at: string }>("SELECT name, changed_at FROM faction WHERE name LIKE 'Red Mantle%'");
    expect(at.every((f) => f.changed_at > '2026-10-21')).toBe(true);
  });
});

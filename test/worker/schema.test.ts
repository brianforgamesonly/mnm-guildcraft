import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import coreQuery from '../../docs/PRD-core-query.sql?raw';
import prdSchema from '../../docs/PRD-schema.sql?raw';
import migration from '../../migrations/0001_init.sql?raw';

// Expected names are derived from the PRD's own SQL, never typed by hand.
const prdTables = [...prdSchema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]).sort();
const prdIndexes = [...prdSchema.matchAll(/CREATE INDEX (\w+)/g)].map((m) => m[1]).sort();

describe('schema (migrations/0001_init.sql)', () => {
  it('is the PRD schema byte for byte', () => {
    expect(migration).toBe(prdSchema);
  });

  it('creates the PRD tables and indexes, read from sqlite_master', async () => {
    const { results: tables } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string }>();
    const { results: indexes } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all<{ name: string }>();
    expect(prdTables.length).toBe(14);
    expect(tables.map((t) => t.name)).toEqual(prdTables);
    expect(indexes.map((i) => i.name)).toEqual(prdIndexes);
    expect(prdIndexes).toEqual(['character_by_owner', 'image_by_item', 'recipe_by_result', 'skill_ranking']);
  });

  it('the core query prepares and returns the four tiers on a fixture', async () => {
    const at = '2026-10-19T00:00:00Z';
    const stmts = [
      "DELETE FROM character_recipe", "DELETE FROM character_skill", "DELETE FROM character", "DELETE FROM member",
      "DELETE FROM guild", "DELETE FROM recipe_component", "DELETE FROM recipe", "DELETE FROM item", "DELETE FROM tradeskill",
      "INSERT INTO tradeskill (id, name, kind) VALUES (1, 'Blacksmithing', 'crafting')",
      `INSERT INTO item (id, name, name_key, imported_at) VALUES (1, 'Copper Sword', 'copper sword', '${at}')`,
      `INSERT INTO guild (id, name, created_at) VALUES ('g1', 'Test Guild', '${at}')`,
      `INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES ('g1', 'u1', 'Ann', '${at}'), ('g1', 'u2', 'Bo', '${at}')`,
      `INSERT INTO character (id, guild_id, owner_user_id, name, name_key, created_at, updated_at) VALUES (1, 'g1', 'u1', 'Annsmith', 'annsmith', '${at}', '${at}'), (2, 'g1', 'u2', 'Bohammer', 'bohammer', '${at}', '${at}')`,
      `INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES (1, 1, 60, '${at}', 'u1'), (2, 1, 40, '${at}', 'u2')`,
      // 1 reliable (trivial 50 <= 60), 2 still learning (trivial 50 > 40), 3 trivial unknown, 4 reputation, not marked known.
      `INSERT INTO recipe (id, source_key, tradeskill_id, result_item_id, trivial, acquisition, source, imported_at) VALUES
        (1, 'Blacksmithing|copper sword|1', 1, 1, 50, 'vendor', 'wiki', '${at}'),
        (2, 'Blacksmithing|copper sword|2', 1, 1, NULL, 'unknown', 'wiki', '${at}'),
        (3, 'Blacksmithing|copper sword|3', 1, 1, 30, 'reputation', 'wiki', '${at}')`,
    ];
    await env.DB.batch(stmts.map((s) => env.DB.prepare(s)));
    const { results } = await env.DB.prepare(coreQuery).bind(1, 'g1').all<{ recipe_id: number; character: string; tier: string; knows_recipe: number }>();
    const rows = results.map((r) => `${r.recipe_id}:${r.character}:${r.tier}`);
    expect(rows).toEqual([
      '1:Annsmith:reliable',
      '1:Bohammer:still learning',
      '2:Annsmith:trivial unknown',
      '2:Bohammer:trivial unknown',
      '3:Annsmith:recipe not confirmed',
      '3:Bohammer:recipe not confirmed',
    ]);
    expect(new Set(results.map((r) => r.tier))).toEqual(new Set(['reliable', 'still learning', 'trivial unknown', 'recipe not confirmed']));
  });
});

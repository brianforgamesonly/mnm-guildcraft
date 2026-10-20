// Order 10, ITEM 1.2: the per-guild export on a local database holding two guilds. Guild B's rows never appear in
// guild A's export, every guild table is covered, and the export loads into an empty D1 (the import path).
//   node --test scripts/export/lib.test.ts
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DATABASE, loadAndCount, wrangler } from '../backup/lib.ts';
import { IMPORT_WRITES } from '../import/core.ts';
import { counts, dump, guildDump, load } from './dump.ts';
import { exportPlan, parseTable } from './lib.ts';

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), '../../migrations');
const A = '111111111111111111';
const B = '222222222222222222';
const at = '2026-10-20T00:00:00Z';

/** Every migration, then the d1_migrations rows a real database carries. */
function schema(): string {
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  return [
    ...files.map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')),
    'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);',
    ...files.map((f) => `INSERT INTO d1_migrations (name) VALUES ('${f}');`),
  ].join('\n');
}

/** Shared game data, and the same shape of guild data for each guild (ids and names differ). */
function fixture(): string {
  const rows = [
    "INSERT INTO tradeskill (id, name, kind) VALUES (1, 'Blacksmithing', 'crafting')",
    `INSERT INTO item (id, name, name_key, imported_at) VALUES (1, 'Copper Bar', 'copper bar', '${at}'), (2, 'Copper Sword', 'copper sword', '${at}')`,
    `INSERT INTO recipe (id, source_key, tradeskill_id, result_item_id, source, imported_at) VALUES (1, 'shared', 1, 2, 'wiki', '${at}')`,
    'INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES (1, 1, 3)',
    "INSERT INTO game_class (code, item_count) VALUES ('WAR', 10)",
    `INSERT INTO data_import (source, source_version, status, started_at) VALUES ('wiki', 'v1', 'ok', '${at}')`,
    `INSERT INTO backup_status (started_at, finished_at, result, token_expires) VALUES ('${at}', '${at}', 'ok', 'unknown')`,
    `INSERT INTO usage_daily (metric, day, value, measured_at) VALUES ('d1_rows_written', '2026-10-19', 5, '${at}')`,
  ];
  for (const [g, n] of [[A, 1], [B, 2]] as const) {
    const u = `${n}0000000000000000${n}`;
    rows.push(
      `INSERT INTO guild (id, name, created_at) VALUES ('${g}', 'Guild ${n}', '${at}')`,
      `INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES ('${g}', '${u}', 'Member${n}', '${at}')`,
      `INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES ('${g}', '${u}9', 'Departed${n}', 'left', '${at}')`,
      `INSERT INTO character (id, guild_id, owner_user_id, name, name_key, created_at, updated_at) VALUES (${n}, '${g}', '${u}', 'Char${n}', 'char${n}', '${at}', '${at}')`,
      `INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES (${n}, 1, ${n * 10}, '${at}', '${u}')`,
      `INSERT INTO recipe (id, source_key, tradeskill_id, result_item_id, source, guild_id, imported_at) VALUES (${10 + n}, 'private${n}', 1, 2, 'guild', '${g}', '${at}')`,
      `INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES (${10 + n}, 1, ${n})`,
      `INSERT INTO character_recipe (character_id, recipe_id, created_at) VALUES (${n}, 1, '${at}'), (${n}, ${10 + n}, '${at}')`,
      `INSERT INTO item_image (guild_id, item_id, submitted_by, created_at) VALUES ('${g}', 2, '${u}', '${at}')`,
      `INSERT INTO recipe_report (guild_id, item_id, recipe_id, reporter, issue, created_at) VALUES ('${g}', 2, 1, '${u}', 'trivial', '${at}')`,
      `INSERT INTO board_post (guild_id, tradeskill_id, thread_id, message_ids_json) VALUES ('${g}', 1, 'thread${n}', '[]')`,
      `INSERT INTO audit_log (guild_id, actor, action, target, created_at) VALUES ('${g}', '${u}', 'member.left', 'member:${u}9', '${at}')`,
      `INSERT INTO recipe_correction (guild_id, recipe_id, acquisition, faction, updated_by, updated_at) VALUES ('${g}', 1, 'reputation', 'Faction${n}', '${u}', '${at}')`,
      `INSERT INTO recipe_correction_component (guild_id, recipe_id, item_id, qty) VALUES ('${g}', 1, 1, ${n})`,
    );
  }
  return `${schema()}\n${rows.map((r) => `${r};`).join('\n')}\n`;
}

const tablesOf = (sql: string) => (load(sql).prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[]);

test('the schema parser reads guild_id, nullability and both foreign-key forms (ALTER TABLE columns included)', () => {
  const t = tablesOf(fixture());
  const char = parseTable(t.find((x) => x.name === 'character')!);
  assert.deepEqual(char.foreignKeys, [{ columns: ['guild_id', 'owner_user_id'], parent: 'member', parentColumns: ['guild_id', 'discord_user_id'] }]);
  const recipe = parseTable(t.find((x) => x.name === 'recipe')!);
  assert.equal(recipe.columns.find((c) => c.name === 'guild_id')!.nullable, true);
  assert.ok(parseTable(t.find((x) => x.name === 'recipe_report')!).columns.some((c) => c.name === 'details'), 'a column added by ALTER TABLE');
});

test('the plan is derived: every guild_id table and every child of one is scoped; operator tables are emptied', () => {
  const plan = new Map(exportPlan(tablesOf(fixture()), A, IMPORT_WRITES).map((p) => [p.table, p.scope]));
  for (const t of tablesOf(fixture())) if (parseTable(t).columns.some((c) => c.name === 'guild_id')) assert.equal(plan.get(t.name), 'guild_id', t.name);
  assert.equal(plan.get('guild'), 'guild');
  for (const t of ['character_skill', 'character_recipe', 'recipe_component']) assert.equal(plan.get(t), 'child', t);
  for (const t of ['tradeskill', 'item', 'game_class', 'data_import', 'd1_migrations']) assert.equal(plan.get(t), 'reference', t);
  for (const t of ['backup_status', 'usage_daily']) assert.equal(plan.get(t), 'emptied', t);
  // A new table no rule recognises is emptied, never exported whole.
  const extra = [...tablesOf(fixture()), { name: 'later_table', sql: 'CREATE TABLE later_table (x TEXT)' }];
  assert.equal(exportPlan(extra, A, IMPORT_WRITES).find((p) => p.table === 'later_table')!.scope, 'emptied');
  assert.throws(() => exportPlan(tablesOf(fixture()), "1' OR '1", IMPORT_WRITES), /snowflake/);
  // A nullable guild_id outside the game data keeps only the guild's rows, never the NULL ones.
  const ops = [...tablesOf(fixture()), { name: 'ops_log', sql: 'CREATE TABLE ops_log (guild_id TEXT, x TEXT)' }];
  assert.equal(exportPlan(ops, A, IMPORT_WRITES).find((p) => p.table === 'ops_log')!.keep, `guild_id = '${A}'`);
  // A key the parser cannot read stops the export rather than leaving a table unscoped.
  assert.throws(() => parseTable({ name: 'bad', sql: 'CREATE TABLE bad (character_id INTEGER REFERENCES character)' }), /without a column list/);
});

test("two guilds: guild B's rows never appear in guild A's export, and A's are all there", () => {
  const sql = fixture();
  const full = load(sql);
  // The fixture covers every guild table for both guilds (derived: a new guild table fails here until it is added).
  for (const t of tablesOf(sql).filter((x) => parseTable(x).columns.some((c) => c.name === 'guild_id'))) {
    for (const g of [A, B]) assert.ok(Number((full.prepare(`SELECT count(*) AS n FROM "${t.name}" WHERE guild_id = ?`).get(g) as { n: number }).n) > 0, `${t.name} has no row for ${g}`);
  }
  const out = guildDump(sql, A, IMPORT_WRITES);
  for (const leak of [B, '200000000000000002', 'Char2', 'Member2', 'Departed2', 'Faction2', 'thread2', 'private2', 'Guild 2']) assert.ok(!out.sql.includes(leak), `B's ${leak} leaked`);
  for (const mine of [A, 'Char1', 'Departed1', 'Faction1', 'thread1', 'private1', 'member.left']) assert.ok(out.sql.includes(mine), `A's ${mine} missing`);
  const c = out.counts;
  assert.deepEqual(
    { guild: c.guild, member: c.member, character: c.character, character_skill: c.character_skill, character_recipe: c.character_recipe, recipe: c.recipe, recipe_component: c.recipe_component, audit_log: c.audit_log, recipe_correction_component: c.recipe_correction_component },
    { guild: 1, member: 2, character: 1, character_skill: 1, character_recipe: 2, recipe: 2, recipe_component: 2, audit_log: 1, recipe_correction_component: 1 },
  );
  assert.equal(c.backup_status, 0);
  assert.equal(c.usage_daily, 0);
  assert.equal(c.item, 2);
  // Guild rows are plain INSERTs (a refused row fails the load); only d1_migrations and game data are OR IGNORE.
  assert.match(out.sql, /^INSERT INTO "character" /m);
  assert.match(out.sql, /^INSERT OR IGNORE INTO "d1_migrations" /m);
  assert.doesNotMatch(out.sql, /^INSERT OR IGNORE INTO "(member|character|audit_log)" /m);
  assert.throws(() => guildDump(sql, '333333333333333333', IMPORT_WRITES), /not in this database/);
});

test('the import path: the export loads into an empty D1 (wrangler, local) with the same counts', () => {
  const out = guildDump(fixture(), A, IMPORT_WRITES);
  const dir = mkdtempSync(join(tmpdir(), 'guild-export-'));
  try {
    const file = join(dir, 'guild.sql');
    writeFileSync(file, out.sql);
    const loaded = loadAndCount(join(dir, 'd1'), file);
    for (const [t, n] of Object.entries(out.counts)) assert.equal(loaded[t], n, t);
    // ...and into a database whose migrations already ran (a fork's first deploy runs them before the export is loaded).
    wrangler(['d1', 'migrations', 'apply', DATABASE, '--local', '--env', 'dev', '--persist-to', join(dir, 'migrated')]);
    const migrated = loadAndCount(join(dir, 'migrated'), file);
    for (const [t, n] of Object.entries(out.counts)) assert.equal(migrated[t], n, t);
    // A second dump of the loaded copy is the same rows: nothing was lost on the way in.
    assert.deepEqual(counts(load(dump(load(out.sql), []))), out.counts);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

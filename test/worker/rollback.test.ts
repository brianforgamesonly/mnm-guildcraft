// Order 13: the down paths of migrations/0011 and 0010, applied in reverse order, leave no trace of either; the ups then
// restore the same schema.
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import down10 from '../../scripts/rollback/0010_gear.down.sql?raw';
import down11 from '../../scripts/rollback/0011_item_reports.down.sql?raw';
import up10 from '../../migrations/0010_gear.sql?raw';
import up11 from '../../migrations/0011_item_reports.sql?raw';
import down12 from '../../scripts/rollback/0012_craft_requests.down.sql?raw';
import up12 from '../../migrations/0012_craft_requests.sql?raw';
import down13 from '../../scripts/rollback/0013_zones.down.sql?raw';
import up13 from '../../migrations/0013_zones.sql?raw';
import down14 from '../../scripts/rollback/0014_component_by_item.down.sql?raw';
import up14 from '../../migrations/0014_component_by_item.sql?raw';
import down15 from '../../scripts/rollback/0015_channel_setup_lock.down.sql?raw';
import up15 from '../../migrations/0015_channel_setup_lock.sql?raw';
import down16 from '../../scripts/rollback/0016_sweep_run.down.sql?raw';
import up16 from '../../migrations/0016_sweep_run.sql?raw';
import down18 from '../../scripts/rollback/0018_factions.down.sql?raw';
import up18 from '../../migrations/0018_factions.sql?raw';
import down19 from '../../scripts/rollback/0019_faction_quest.down.sql?raw';
import up19 from '../../migrations/0019_faction_quest.sql?raw';

const schema = async () =>
  (await env.DB.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY type, name").all<{ type: string; name: string; sql: string | null }>())
    .results;
const statements = (sql: string) =>
  sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
const run = async (sql: string) => {
  for (const s of statements(sql)) await env.DB.prepare(s).run();
};

it('order 25: 0019 down, then up again, restores the schema; down leaves no trace of it', async () => {
  const before = await schema();
  await run(down19);
  expect((await schema()).some((r) => r.name === 'faction_quest')).toBe(false);
  await run(up19);
  expect(await schema()).toEqual(before);
});

it('order 24: 0018 down, then up again, restores the schema; down leaves no trace of it', async () => {
  // Order 25: 0019 names faction, so it comes off first and goes back last.
  await run(down19);
  const before = await schema();
  await run(down18);
  expect((await schema()).some((r) => /faction/.test(r.name) || /faction_/.test(r.sql ?? ''))).toBe(false);
  await run(up18);
  // ALTER TABLE rewrites the CREATE TABLE text, so compare names and kinds, then the columns.
  expect((await schema()).map((r) => `${r.type}:${r.name}`)).toEqual(before.map((r) => `${r.type}:${r.name}`));
  const cols = (await env.DB.prepare("SELECT name FROM pragma_table_xinfo('guild') ORDER BY cid").all<{ name: string }>()).results.map((r) => r.name);
  expect(cols.slice(-6)).toEqual(['faction_board_channel_id', 'faction_index_thread_id', 'faction_index_message_id', 'faction_index_hash', 'faction_lock_until', 'faction_rebuild_since']);
  await run(up19);
});

it('order 20: 0016 down, then up again, restores the schema; down leaves no trace of it', async () => {
  const before = await schema();
  await run(down16);
  expect((await schema()).some((r) => r.name === 'sweep_run')).toBe(false);
  await run(up16);
  expect(await schema()).toEqual(before);
});

it('order 19: 0015 down, then up again, restores the schema; down leaves no trace of it', async () => {
  const before = await schema();
  await run(down15);
  expect((await schema()).some((r) => /channel_setup_lock_until/.test(r.sql ?? ''))).toBe(false);
  await run(up15);
  // ALTER TABLE rewrites the CREATE TABLE text, so compare names and kinds, then the column.
  expect((await schema()).map((r) => `${r.type}:${r.name}`)).toEqual(before.map((r) => `${r.type}:${r.name}`));
  const cols = (await env.DB.prepare("SELECT name FROM pragma_table_xinfo('guild') ORDER BY cid").all<{ name: string }>()).results.map((r) => r.name);
  expect(cols.at(-1)).toBe('channel_setup_lock_until');
});

it('order 19: 0014 down, then up again, restores the schema; down leaves no trace of it', async () => {
  const before = await schema();
  await run(down14);
  expect((await schema()).some((r) => r.name === 'recipe_component_by_item')).toBe(false);
  await run(up14);
  expect(await schema()).toEqual(before);
});

it('order 17: 0013 down, then up again, restores the schema; down leaves no trace of it', async () => {
  const before = await schema();
  await run(down13);
  expect((await schema()).some((r) => ['zone', 'zone_name', 'npc', 'import_source'].includes(r.name))).toBe(false);
  await run(up13);
  expect(await schema()).toEqual(before);
});

it('order 16: 0012 down, then up again, restores the schema; down leaves no trace of it', async () => {
  const before = await schema();
  await run(down12);
  const without = await schema();
  expect(without.some((r) => /^craft_/.test(r.name) || /request_channel_id/.test(r.sql ?? ''))).toBe(false);
  await run(up12);
  expect((await schema()).map((r) => `${r.type}:${r.name}`)).toEqual(before.map((r) => `${r.type}:${r.name}`));
  const cols = (await env.DB.prepare("SELECT name FROM pragma_table_xinfo('guild') ORDER BY cid").all<{ name: string }>()).results.map((r) => r.name);
  expect(cols.at(-1)).toBe('request_channel_id');
});

it('0011 then 0010 down, then up again, restores the schema; down leaves no trace of either', async () => {
  // Order 16: 0012 comes off first (it is the newest), and goes back last.
  await run(down12);
  const before = await schema();
  await run(down11);
  await run(down10);
  const without = await schema();
  expect(without.some((r) => r.name === 'mob' || /class_mask|origin_json|total_stats|GENERATED/.test(r.sql ?? '') || (r.name === 'recipe_report' && /\bkind\b/.test(r.sql ?? '')))).toBe(false);
  await run(up10);
  await run(up11);
  // ALTER TABLE rewrites the CREATE TABLE text in sqlite_master, so compare names and kinds, then the added columns.
  expect((await schema()).map((r) => `${r.type}:${r.name}`)).toEqual(before.map((r) => `${r.type}:${r.name}`));
  const cols = (await env.DB.prepare("SELECT name FROM pragma_table_xinfo('item') ORDER BY cid").all<{ name: string }>()).results.map((r) => r.name);
  expect(cols.slice(-11)).toEqual(['ac', 'dmg', 'delay', 'ratio', 'skill', 'handed', 'class_mask', 'slot_mask', 'source_mask', 'origin_json', 'total_stats']);
  await run(up12);
});

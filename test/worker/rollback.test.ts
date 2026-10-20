// Order 13: the down path of migrations/0010_gear.sql leaves the schema exactly as 0009 left it.
import { env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import down from '../../scripts/rollback/0010_gear.down.sql?raw';
import up from '../../migrations/0010_gear.sql?raw';

const schema = async () =>
  (await env.DB.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE '_cf_%' ORDER BY type, name").all<{ type: string; name: string; sql: string | null }>())
    .results;
const statements = (sql: string) =>
  sql
    .replace(/--.*$/gm, '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);

it('0010 down then up restores the schema; down leaves no trace of 0010', async () => {
  const withGear = await schema();
  for (const s of statements(down)) await env.DB.prepare(s).run();
  const without = await schema();
  expect(without.some((r) => r.name === 'mob' || /class_mask|origin_json|GENERATED/.test(r.sql ?? ''))).toBe(false);
  for (const s of statements(up)) await env.DB.prepare(s).run();
  // ALTER TABLE rewrites the CREATE TABLE text in sqlite_master, so compare names and kinds, then the added columns.
  expect((await schema()).map((r) => `${r.type}:${r.name}`)).toEqual(withGear.map((r) => `${r.type}:${r.name}`));
  const cols = (await env.DB.prepare("SELECT name FROM pragma_table_xinfo('item') ORDER BY cid").all<{ name: string }>()).results.map((r) => r.name);
  expect(cols.slice(-10)).toEqual(['ac', 'dmg', 'delay', 'ratio', 'skill', 'handed', 'class_mask', 'slot_mask', 'source_mask', 'origin_json']);
});

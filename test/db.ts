import { env } from 'cloudflare:test';

export const one = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<T>())!;
export const all = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).all<T>()).results;
export const count = async (table: string, where = '1 = 1', ...binds: unknown[]) =>
  (await one<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, ...binds)).n;

let imports = 0;
/** A completed import row: what tells the game-data cache (src/gamedata.ts) to reload. Call after seeding reference data. */
export const markImported = () =>
  env.DB.prepare("INSERT INTO data_import (source, source_version, status, started_at, finished_at) VALUES ('test', ?, 'ok', '2026-10-19T00:00:00Z', '2026-10-19T00:00:00Z')")
    .bind(`test${String(++imports).padStart(7, '0')} / 2026-10-19T17:35:56.514Z`)
    .run();

/** Empties guild and reference data, then seeds tradeskills and classes (as an import would). */
export async function reset(tradeskills: string[] = ['Alchemy', 'Blacksmithing', 'Brewing', 'Fletching', 'Tailoring'], classes: [string, number][] = [['CLR', 1140], ['SHD', 1498], ['WIZ', 342], ['OLD', 0]]) {
  await env.DB.batch(
    ['craft_request_item', 'craft_request', 'craft_notify', 'audit_log', 'recipe_correction_component', 'recipe_correction', 'recipe_report', 'item_image', 'character_recipe', 'character_skill', 'character', 'member', 'guild', 'board_post', 'recipe_component', 'recipe', 'tradeskill', 'game_class', 'sweep_run'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  await env.DB.batch([
    ...tradeskills.map((name, i) => env.DB.prepare("INSERT INTO tradeskill (name, kind, sort_order) VALUES (?, 'crafting', ?)").bind(name, i + 1)),
    ...classes.map(([code, n]) => env.DB.prepare('INSERT INTO game_class (code, item_count) VALUES (?, ?)').bind(code, n)),
  ]);
  await markImported();
}

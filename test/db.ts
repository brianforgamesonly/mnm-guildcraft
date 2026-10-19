import { env } from 'cloudflare:test';

export const one = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).first<T>())!;
export const all = async <T>(sql: string, ...binds: unknown[]) => (await env.DB.prepare(sql).bind(...binds).all<T>()).results;
export const count = async (table: string, where = '1 = 1', ...binds: unknown[]) =>
  (await one<{ n: number }>(`SELECT count(*) AS n FROM ${table} WHERE ${where}`, ...binds)).n;

/** Empties guild and reference data, then seeds tradeskills and classes (as an import would). */
export async function reset(tradeskills: string[] = ['Alchemy', 'Blacksmithing', 'Brewing', 'Fletching', 'Tailoring'], classes: [string, number][] = [['CLR', 1140], ['SHD', 1498], ['WIZ', 342], ['OLD', 0]]) {
  await env.DB.batch(
    ['audit_log', 'character_recipe', 'character_skill', 'character', 'member', 'guild', 'board_post', 'recipe_component', 'recipe', 'tradeskill', 'game_class'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  await env.DB.batch([
    ...tradeskills.map((name, i) => env.DB.prepare("INSERT INTO tradeskill (name, kind, sort_order) VALUES (?, 'crafting', ?)").bind(name, i + 1)),
    ...classes.map(([code, n]) => env.DB.prepare('INSERT INTO game_class (code, item_count) VALUES (?, ?)').bind(code, n)),
  ]);
}

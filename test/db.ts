import { env } from 'cloudflare:test';
// Order 29: 0023 rebuilt the ledger and recreated its triggers; the newest migration's text is the one in force.
import dkpMigration from '../migrations/0023_dkp_auctions.sql?raw';

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

/** Order 27: the ledger's append-only triggers, read from the migration itself (never retyped here). */
const DKP_TRIGGERS = [...dkpMigration.matchAll(/CREATE TRIGGER (\w+)[^;]*;[^;]*END;/g)].map((m) => ({ name: m[1], sql: m[0] }));
/** Empties the DKP tables (they reference guild): the ledger's triggers come off for the delete and go back on after. */
export async function clearDkp() {
  await env.DB.batch([
    ...DKP_TRIGGERS.map((t) => env.DB.prepare(`DROP TRIGGER IF EXISTS ${t.name}`)),
    ...[
      'dkp_ledger', 'dkp_purchase', 'dkp_listing', 'dkp_nudge', 'dkp_bid', 'dkp_wishlist', 'dkp_auction', 'dkp_kill_member', 'dkp_pending', 'dkp_recheck', 'dkp_kill', 'dkp_attendance', 'dkp_raid', 'dkp_pool',
      'dkp_named_value', 'dkp_setting', 'dkp_guild',
    ].map((t) => env.DB.prepare(`DELETE FROM ${t}`)),
    ...DKP_TRIGGERS.map((t) => env.DB.prepare(t.sql)),
  ]);
}
export const dkpTriggerNames = () => DKP_TRIGGERS.map((t) => t.name);

/** Empties guild and reference data, then seeds tradeskills and classes (as an import would). */
export async function reset(tradeskills: string[] = ['Alchemy', 'Blacksmithing', 'Brewing', 'Fletching', 'Tailoring'], classes: [string, number][] = [['CLR', 1140], ['SHD', 1498], ['WIZ', 342], ['OLD', 0]]) {
  await clearDkp();
  await env.DB.batch(
    ['card_stale', 'event_signup_history', 'event_signup', 'event', 'event_class_role', 'event_setting', 'event_guild', 'faction_post', 'npc_faction', 'faction_quest', 'faction', 'craft_request_item', 'craft_request', 'craft_notify', 'audit_log', 'recipe_correction_component', 'recipe_correction', 'recipe_report', 'item_image', 'character_recipe', 'character_skill', 'character', 'member', 'guild', 'board_post', 'recipe_component', 'recipe', 'tradeskill', 'game_class', 'sweep_run'].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  await env.DB.batch([
    ...tradeskills.map((name, i) => env.DB.prepare("INSERT INTO tradeskill (name, kind, sort_order) VALUES (?, 'crafting', ?)").bind(name, i + 1)),
    ...classes.map(([code, n]) => env.DB.prepare('INSERT INTO game_class (code, item_count) VALUES (?, ?)').bind(code, n)),
  ]);
  await markImported();
}

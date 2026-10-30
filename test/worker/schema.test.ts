import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import coreQuery from '../../docs/PRD-core-query.sql?raw';
import prdSchema from '../../docs/PRD-schema.sql?raw';
import migration from '../../migrations/0001_init.sql?raw';

// Expected names are derived from the PRD's own SQL, never typed by hand.
const prdTables = [...prdSchema.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]).sort();
// Named departures: tables created by later migrations (each one's header names the reason).
const laterMigrations = import.meta.glob<string>('../../migrations/*.sql', { query: '?raw', import: 'default', eager: true });
const departureTables = Object.entries(laterMigrations)
  .filter(([path]) => !path.endsWith('/0001_init.sql'))
  .flatMap(([, sql]) => [...sql.matchAll(/CREATE TABLE (\w+)/g)].map((m) => m[1]));
const prdIndexes = [...prdSchema.matchAll(/CREATE INDEX (\w+)/g)].map((m) => m[1]).sort();
// Order 7: indexes added by later migrations, derived the same way (0007: the departure run's audit_log reads).
const departureIndexes = Object.entries(laterMigrations)
  .filter(([path]) => !path.endsWith('/0001_init.sql'))
  .flatMap(([, sql]) => [...sql.matchAll(/CREATE (?:UNIQUE )?INDEX (\w+)/g)].map((m) => m[1]));

describe('a dump of this schema loads (order 34)', () => {
  // A D1 export writes tables in creation order, and SQLite refuses a row whose foreign key names a table that doesn't exist
  // yet, even with that key NULL and foreign keys deferred. Derived from the live schema: no new table or column escapes it.
  it('every foreign key names a table created before the table that holds it', async () => {
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY rowid").all<{ name: string }>();
    const order = results.map((r) => r.name);
    const late: string[] = [];
    for (const [i, table] of order.entries()) {
      const fks = await env.DB.prepare('SELECT DISTINCT "table" AS parent FROM pragma_foreign_key_list(?)').bind(table).all<{ parent: string }>();
      for (const { parent } of fks.results) if (order.indexOf(parent) > i) late.push(`${table} -> ${parent}`);
    }
    expect(late).toEqual([]);
  });
});

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
    // Order 16 (0012): craft_notify, craft_request, craft_request_item. Order 17 (0013): zone, zone_name, npc, import_source.
    // Order 20 (0016): sweep_run, the heartbeat. Order 24 (0018): faction, npc_faction, faction_post. Order 25 (0019): faction_quest.
    expect(departureTables).toEqual([
      'game_class', 'backup_status', 'usage_daily', 'recipe_correction', 'recipe_correction_component', 'mob', 'craft_notify', 'craft_request', 'craft_request_item',
      'zone', 'zone_name', 'npc', 'import_source', 'sweep_run', 'faction', 'npc_faction', 'faction_post', 'faction_quest',
      // Order 27 (0021): the DKP add-on (the migration's header names each one's reason).
      'dkp_guild', 'dkp_setting', 'dkp_named_value', 'dkp_pool', 'dkp_raid', 'dkp_attendance', 'dkp_kill', 'dkp_recheck', 'dkp_pending', 'dkp_ledger',
      // Order 29 (0023): kill rosters, auctions and bids, nudges, wishlists, the shop; and dkp_ledger rebuilt (override 1).
      'dkp_kill_member', 'dkp_auction', 'dkp_bid', 'dkp_nudge', 'dkp_wishlist', 'dkp_listing', 'dkp_purchase', 'dkp_ledger',
      // Order 32 (0024): the Events module (the migration's header names each one's reason).
      'event_guild', 'event_setting', 'event_class_role', 'event', 'event_signup', 'event_signup_history',
      // Order 33 (0025): cards awaiting a redraw (the migration's header names its reason).
      'card_stale',
      // Order 33 (0026): a member's No reminders, and the first sign-up's note.
      'event_member',
      // Order 34 (0028): who a batch adjustment waiting for approval covers.
      'dkp_pending_member',
    ]);
    expect(tables.map((t) => t.name)).toEqual([...new Set([...prdTables, ...departureTables])].sort());
    expect([...new Set(departureIndexes)].sort()).toEqual([
      'audit_by_action', 'audit_by_target', 'craft_request_by_requester', 'craft_request_live',
      // Order 27 (0021): one open raid per server; raids by pool and time (30-day attendance); kills by raid; the ledger's
      // balance (one indexed row) and its rows per kill. Order 29 (0023): auctions live, by raid and by winner (win limits);
      // rosters by member (the new-member wait); a standby payout and a spend once each; listings live, purchases per
      // listing; wishlists by item (nudges).
      'dkp_auction_by_raid', 'dkp_auction_live', 'dkp_auction_wins',
      'dkp_kill_by_raid', 'dkp_kill_member_by_member', 'dkp_ledger_auction_spend', 'dkp_ledger_balance', 'dkp_ledger_kill', 'dkp_ledger_purchase_spend', 'dkp_ledger_standby_once', 'dkp_listing_live',
      // Order 34 (0027): at most one raid per event.
      'dkp_purchase_by_listing', 'dkp_raid_by_pool', 'dkp_raid_by_time', 'dkp_raid_event', 'dkp_raid_open', 'dkp_wishlist_by_item',
      // Order 32 (0024): a member's changes in the last minute (the spam limit); upcoming events.
      'event_history_by_member', 'event_upcoming',
      // Order 26 (0020): the cron's "anything to do?" query for the factions board, from indexes.
      'faction_changed', 'faction_post_dirty', 'faction_post_rendered',
      'game_class_bit', 'item_ac', 'item_delay', 'item_dmg', 'item_gear', 'item_handed', 'item_ratio', 'item_skill', 'mob_by_title',
      // Order 24 (0018): a faction's links.
      'npc_faction_by_faction',
      // Order 19 (0014): /item's "used in" statement.
      'recipe_component_by_item',
    ]);
    expect(indexes.map((i) => i.name)).toEqual([...prdIndexes, ...new Set(departureIndexes)].sort());
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

// ITEM 3.2: the SQL forms of the member gate and the officer check (one-statement autocomplete) agree
// with the TypeScript deciders over every combination; and the game-data cache costs one cheap read.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isOfficer, loadGuild, passesMemberGate, SQL_IS_OFFICER, SQL_PASSES_MEMBER_GATE, sqlAccessParams } from '../../src/access.ts';
import { gameList, gameListSql } from '../../src/gamedata.ts';
import { countD1 } from '../../src/telemetry.ts';
import { markImported, reset } from '../db.ts';
import { ADMIN, as, GUILD, NO_PERMS } from '../discord.ts';

const MEMBER = '700000000000000001';
const OFFICER = '700000000000000002';

describe('SQL access fragments = passesMemberGate / isOfficer', () => {
  it('agree for every guild setting × roles × admin, and with no guild row', async () => {
    let cases = 0;
    for (const guildRow of [null, [null, null], [MEMBER, null], [null, OFFICER], [MEMBER, OFFICER]] as ([string | null, string | null] | null)[]) {
      await reset();
      if (guildRow)
        await env.DB.prepare("INSERT INTO guild (id, name, member_role_id, officer_role_id, created_at) VALUES (?, 'g', ?, ?, '2026-10-19')").bind(GUILD, ...guildRow).run();
      const guild = await loadGuild(env.DB, GUILD);
      for (const roles of [[], [MEMBER], [OFFICER], [MEMBER, OFFICER]])
        for (const permissions of [NO_PERMS, ADMIN]) {
          const m = as('100000000000000001', { roles, permissions });
          const row = await env.DB.prepare(`SELECT ${SQL_PASSES_MEMBER_GATE} AS gate, ${SQL_IS_OFFICER} AS officer`).bind(...sqlAccessParams(GUILD, m)).first<{ gate: number; officer: number }>();
          expect(row!.gate === 1, JSON.stringify({ guildRow, roles, permissions })).toBe(passesMemberGate(guild, m));
          expect(row!.officer === 1, JSON.stringify({ guildRow, roles, permissions })).toBe(isOfficer(guild, m));
          cases++;
        }
    }
    expect(cases).toBe(40);
  });
});

describe('game-data cache', () => {
  it('one statement per read; a warm read scans none of the list; a new import reloads it', async () => {
    await reset(Array.from({ length: 40 }, (_, i) => `Skill ${i}`));
    // A large item list too: 300 recipe results.
    await env.DB.batch(['recipe_component', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    await env.DB.batch(
      Array.from({ length: 300 }, (_, i) =>
        env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES (?, ?, 'wiki', 'x')").bind(`Item ${i}`, `item ${i}`),
      ),
    );
    await env.DB.prepare(
      "INSERT INTO recipe (source_key, tradeskill_id, result_item_id, source, imported_at) SELECT 'k' || id, (SELECT min(id) FROM tradeskill), id, 'wiki', 'x' FROM item",
    ).run();
    await markImported();
    for (const list of ['skills', 'items'] as const) {
      const c = countD1(env.DB);
      const cold = await gameList(c.db, list);
      const warm = await gameList(c.db, list);
      expect(warm).toBe(cold);
      expect(c.calls.map((x) => x.statements)).toEqual([1, 1]);
      expect(cold.length).toBe(list === 'skills' ? 40 : 300);
      // D1's rows_read for the same statement, warm (current key) and cold.
      const key = (await env.DB.prepare(gameListSql(list)).bind('stale').all<{ t: string; name: string }>()).results[0].name;
      const w = await env.DB.prepare(gameListSql(list)).bind(key).all();
      const k = await env.DB.prepare(gameListSql(list)).bind('stale').all();
      console.log(`[cache] ${list}: warm rows_read ${w.meta.rows_read} (${w.results.length} row), cold rows_read ${k.meta.rows_read} (${k.results.length} rows)`);
      expect(w.results).toHaveLength(1);
      expect(w.meta.rows_read).toBeLessThan(10);
    }
    await env.DB.prepare("INSERT INTO tradeskill (name, kind) VALUES ('Zeta', 'crafting')").run();
    expect(await gameList(env.DB, 'skills')).toHaveLength(40);
    await markImported();
    expect(await gameList(env.DB, 'skills')).toHaveLength(41);
  });
});

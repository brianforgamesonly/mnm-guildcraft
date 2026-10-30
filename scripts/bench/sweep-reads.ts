// Order 26 (ITEM 2): rows read by the 15-minute cron's "anything to do?" query (src/board/refresh.ts SWEEP_SQL), per guild
// with live boards, on the local D1 after a real-data import (npm run db:migrate:local, npm run import:local). It adds
// bench guilds whose tradeskills and factions boards are fully rendered (nothing dirty or stale), reads D1's own
// rows_read for the idle query, then removes them. Local only: it never reads a credential.
//   node scripts/bench/sweep-reads.ts [--guilds 1,10]
/// <reference types="@cloudflare/workers-types" />
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SWEEP_SQL } from '../../src/board/refresh.ts';
import { FACTION_SHOWN } from '../../src/board/kinds.ts';
import { STALE_SQL } from '../../src/dkp/stale.ts';

const { values: args } = parseArgs({ options: { guilds: { type: 'string', default: '1,10' } } });
const { getPlatformProxy } = await import('wrangler');
const root = new URL('../../', import.meta.url);
const proxy = await getPlatformProxy<{ DB: D1Database }>({
  environment: 'dev',
  configPath: fileURLToPath(new URL('wrangler.jsonc', root)),
  persist: { path: fileURLToPath(new URL('.wrangler/state/v3', root)) },
});
const db = proxy.env.DB;
const PREFIX = 'bench-sweep-';
const clear = () =>
  db.batch([
    db.prepare('DELETE FROM board_post WHERE guild_id LIKE ?').bind(`${PREFIX}%`),
    db.prepare('DELETE FROM faction_post WHERE guild_id LIKE ?').bind(`${PREFIX}%`),
    db.prepare('DELETE FROM guild WHERE id LIKE ?').bind(`${PREFIX}%`),
  ]);
const idle = async () => {
  const r = await db.prepare(SWEEP_SQL).bind(0).all();
  return { rows: r.results.length, rowsRead: r.meta.rows_read };
};
try {
  await clear();
  const [{ n: guilds }] = (await db.prepare('SELECT count(*) AS n FROM guild').all<{ n: number }>()).results;
  const [{ n: shown }] = (await db.prepare(`SELECT count(*) AS n FROM faction f WHERE ${FACTION_SHOWN}`).all<{ n: number }>()).results;
  const base = await idle();
  console.log(`local D1: ${guilds} other guild(s), ${shown} factions shown; idle sweep with no bench guild: ${base.rowsRead} rows read`);
  for (const count of args.guilds.split(',').map(Number)) {
    await clear();
    for (let i = 0; i < count; i++) {
      const id = `${PREFIX}${i}`;
      await db.batch([
        db
          .prepare(
            `INSERT INTO guild (id, name, created_at, board_channel_id, board_index_thread_id, board_index_message_id, board_index_hash, faction_board_channel_id, faction_index_thread_id, faction_index_message_id, faction_index_hash)
             VALUES (?1, 'bench', '2026-10-28T00:00:00Z', 'c', 't', 'm', 'h', 'c', 't', 'm', 'h')`,
          )
          .bind(id),
        db.prepare(`INSERT INTO board_post (guild_id, tradeskill_id, thread_id, message_ids_json, dirty, last_rendered_at) SELECT ?1, id, 'p', '[]', 0, '9999' FROM tradeskill`).bind(id),
        db
          .prepare(`INSERT INTO faction_post (guild_id, faction_id, thread_id, message_ids_json, dirty, last_rendered_at) SELECT ?1, f.id, 'p', '[]', 0, '9999' FROM faction f WHERE ${FACTION_SHOWN}`)
          .bind(id),
      ]);
    }
    const r = await idle();
    console.log(`${count} guild(s) with both boards live and idle: SWEEP_SQL reads ${r.rowsRead} rows per cron run (${r.rows} boards to do); × 96 runs = ${r.rowsRead * 96} a day per copy`);
    // Order 33: the out-of-date cards read, the cron's other "anything to do?" query, with nothing out of date.
    const stale = await db.prepare(STALE_SQL).all();
    console.log(`${count} guild(s), no card out of date: STALE_SQL reads ${stale.meta.rows_read} rows per cron run (${stale.results.length} cards to do); × 96 runs = ${stale.meta.rows_read * 96} a day per copy`);
  }
  // Where they go: each half of the UNION alone, and the plan SQLite chose.
  const [, cte, body] = /^(WITH [^\n]*\n)?([\s\S]*)$/.exec(SWEEP_SQL)!;
  const [ts, fa] = body.replace(/\s*ORDER BY board DESC, id\s*$/, '').split(/\n\s*UNION ALL\s*\n/);
  for (const [name, half] of [['tradeskills', ts], ['factions', fa]] as const) {
    const sql = `${cte ?? ''}${half}`;
    const res = await db.prepare(sql).bind(...(sql.includes('?1') ? [0] : [])).all();
    console.log(`  ${name} half alone: ${res.meta.rows_read} rows read`);
  }
  const plan = await db.prepare(`EXPLAIN QUERY PLAN ${SWEEP_SQL}`).bind(0).all<{ detail: string }>();
  for (const p of plan.results) console.log(`  plan: ${p.detail}`);
} finally {
  await clear();
  await proxy.dispose();
}

// Order 18: /item over the local D1 after a real-data import (node scripts/import/run.ts --local): rows read by the
// /item name: autocomplete statement (cold and warm), rows read by the card's "used in" statement for every item, and
// every item's card measured against Discord's limits (10 embeds, 6,000 characters less the welcome's reserve).
//   node scripts/bench/item-cards.ts [--show <item name>]
// Local only: it reads no credential. The output names items only: public game data.
/// <reference types="@cloudflare/workers-types" />
import { parseArgs } from 'node:util';
import { embedChars, EMBED_LIMITS } from '../../src/discord.ts';
import { gameListSql } from '../../src/gamedata.ts';
import { itemCard, USED_IN_SQL } from '../../src/commands/item.ts';

const { values: args } = parseArgs({ options: { show: { type: 'string' } } });
const { getPlatformProxy } = await import('wrangler');
const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
const db = proxy.env.DB;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
try {
  const cold = await db.prepare(gameListSql('allItems')).bind('\u0000no-import').all<{ t: string; name: string }>();
  const key = cold.results.find((r) => r.t === 'k')!.name;
  const warm = await db.prepare(gameListSql('allItems')).bind(key).all();
  console.log(`/item name: autocomplete: cold read ${cold.results.length - 1} names, rows_read ${cold.meta.rows_read}; warm (import unchanged) rows_read ${warm.meta.rows_read}`);

  const guild = { id: 'bench-guild', learning_window: 25 } as never;
  const { results: items } = await db.prepare('SELECT id, name FROM item ORDER BY id').all<{ id: number; name: string }>();
  const rows: number[] = [];
  let worst = { chars: 0, name: '' };
  const problems: string[] = [];
  for (const it of items) {
    const u = await db.prepare(USED_IN_SQL).bind(it.id, 'bench-guild').all();
    rows.push(u.meta.rows_read);
    const k = (await itemCard({ db, guild }, it.id))!;
    const chars = embedChars(k.embeds);
    if (chars > worst.chars) worst = { chars, name: it.name };
    if (k.embeds.length > EMBED_LIMITS.embeds || chars > EMBED_LIMITS.total - 1000) problems.push(`${it.name}: ${k.embeds.length} embeds, ${chars} characters`);
    for (const e of k.embeds) for (const f of e.fields ?? []) if (f.value.length > EMBED_LIMITS.fieldValue) problems.push(`${it.name}: field ${f.name} ${f.value.length}`);
    if (args.show && it.name.toLowerCase() === args.show.toLowerCase()) console.log(JSON.stringify(k, null, 1));
  }
  console.log(`"used in" statement: ${items.length} items, rows_read max ${Math.max(...rows)}, median ${median(rows)}`);
  console.log(`largest card: ${worst.name} (${worst.chars} of ${EMBED_LIMITS.total - 1000} with the welcome's reserve)`);
  if (problems.length) {
    console.error(`problems:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  } else console.log(`every card inside Discord's limits: ${items.length} of ${items.length}`);
} finally {
  await proxy.dispose();
}

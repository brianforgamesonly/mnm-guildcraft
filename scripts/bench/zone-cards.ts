// Order 17: every zone's card, rendered from the local D1 after a real-data import (scripts/bench/import-writes.ts
// --zones-dir), measured against Discord's limits (each field 1,024, the message 6,000) and for D1's rows_read.
//   node scripts/bench/zone-cards.ts [--atlas-images] [--show <zone key> ...]   (--show prints that card's embeds)
// Local only: it never reads a credential.
/// <reference types="@cloudflare/workers-types" />
import { parseArgs } from 'node:util';
import { embedChars, EMBED_LIMITS } from '../../src/discord.ts';
import { DROPS_SQL, loadZone, MOBS_SQL, NPCS_SQL, ZONE_SQL, zoneEmbeds } from '../../src/zone/card.ts';

const { values: args } = parseArgs({ options: { 'atlas-images': { type: 'boolean', default: false }, show: { type: 'string', multiple: true } } });
const { getPlatformProxy } = await import('wrangler');
const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
try {
  const { results: zones } = await proxy.env.DB.prepare('SELECT key FROM zone WHERE active = 1 ORDER BY key').all<{ key: string }>();
  let worst = { total: 0, field: 0, zone: '' };
  for (const { key } of zones) {
    const d = (await loadZone(proxy.env.DB, key))!;
    const embeds = zoneEmbeds(d, args['atlas-images']);
    const total = embedChars(embeds);
    const field = Math.max(0, ...embeds.flatMap((e) => (e.fields ?? []).map((f) => f.value.length)));
    if (total > worst.total) worst = { total, field, zone: d.zone.name };
    const over = total > EMBED_LIMITS.total || field > EMBED_LIMITS.fieldValue ? ' OVER' : '';
    if (args.show?.includes(key)) console.log(JSON.stringify(embeds, null, 1));
    console.log(`${d.zone.name}\tcreatures ${d.creatures.length}\tdrops ${d.drops.length}\trows_read ${d.rowsRead}\tlongest field ${field}\ttotal ${total}${over}`);
  }
  console.log(`largest card: ${worst.zone} (${worst.total} of ${EMBED_LIMITS.total}; longest field ${worst.field} of ${EMBED_LIMITS.fieldValue})`);
  // Each statement on its own, for the zone with the most drops: rows_read and the query plan.
  const key = 'fallen pass';
  for (const [name, sql] of Object.entries({ zone: ZONE_SQL, mobs: MOBS_SQL, npcs: NPCS_SQL, drops: DROPS_SQL })) {
    const r = await proxy.env.DB.prepare(sql).bind(key).all();
    const plan = await proxy.env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(key).all<{ detail: string }>();
    console.log(`${key} ${name}: ${r.results.length} rows, rows_read ${r.meta.rows_read} · ${plan.results.map((p) => p.detail).join(' / ')}`);
  }
} finally {
  await proxy.dispose();
}

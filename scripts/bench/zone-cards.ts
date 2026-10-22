// Order 17: every zone's card, rendered from the local D1 after a real-data import (scripts/bench/import-writes.ts
// --zones-dir), measured against Discord's limits (each field 1,024, the message 6,000) and for D1's rows_read.
// Order 17b: also the card's link buttons, and --remote, the same render read from a live copy (GUILDCRAFT_COPY, with
// CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN from the environment; SELECTs only, scripts/import/db.ts remoteReadD1).
//   node scripts/bench/zone-cards.ts [--remote] [--atlas-images] [--show <zone key> ...]   (--show prints that card's embeds)
// The local run reads no credential. The output names zones, creatures and links only: public game data.
/// <reference types="@cloudflare/workers-types" />
import { parseArgs } from 'node:util';
import { embedChars, EMBED_LIMITS } from '../../src/discord.ts';
import { zoneLinks } from '../../src/commands/zone.ts';
import { loadZone, MOBS_SQL, NPCS_SQL, ZONE_SQL, zoneEmbeds } from '../../src/zone/card.ts';
import { copyDatabaseId, remoteReadD1 } from '../import/db.ts';

/** Order 17b's target: rows read per card. */
const ROWS_TARGET = 1000;

const { values: args } = parseArgs({ options: { remote: { type: 'boolean', default: false }, 'atlas-images': { type: 'boolean', default: false }, show: { type: 'string', multiple: true } } });
const need = (name: string) => process.env[name] || (() => { throw new Error(`${name} is not set`); })();
let db: D1Database;
let dispose = async () => {};
if (args.remote) {
  db = remoteReadD1({ accountId: need('CLOUDFLARE_ACCOUNT_ID'), apiToken: need('CLOUDFLARE_API_TOKEN'), databaseId: copyDatabaseId() });
  console.log(`copy: ${process.env.GUILDCRAFT_COPY || 'dev'} (remote, read-only) · atlas pictures ${args['atlas-images'] ? 'on' : 'off'}`);
} else {
  const { getPlatformProxy } = await import('wrangler');
  const proxy = await getPlatformProxy<{ DB: D1Database }>({ environment: 'dev' });
  db = proxy.env.DB;
  dispose = () => proxy.dispose();
}
try {
  const { results: zones } = await db.prepare('SELECT key FROM zone WHERE active = 1 ORDER BY key').all<{ key: string }>();
  let worst = { total: 0, field: 0, zone: '' };
  const rows: number[] = [];
  const problems: string[] = [];
  for (const { key } of zones) {
    const d = (await loadZone(db, key))!;
    const embeds = zoneEmbeds(d, args['atlas-images']);
    const total = embedChars(embeds);
    const field = Math.max(0, ...embeds.flatMap((e) => (e.fields ?? []).map((f) => f.value.length)));
    if (total > worst.total) worst = { total, field, zone: d.zone.name };
    rows.push(d.rowsRead);
    const over = total > EMBED_LIMITS.total || field > EMBED_LIMITS.fieldValue ? ' OVER' : '';
    const buttons = zoneLinks(d) as { label: string; url: string }[];
    const links = buttons.map((b) => `${b.label}=${b.url}`).join(' | ');
    // An atlas link names a map (/<id>/), never the root, which opens the world map (order 17b).
    for (const b of buttons) if (b.url.includes('mnmatlas.com') && !/^https:\/\/www\.mnmatlas\.com\/[a-z0-9-]+\/$/.test(b.url)) problems.push(`${d.zone.name}: atlas link ${b.url}`);
    if (over) problems.push(`${d.zone.name}: over Discord's limits`);
    if (d.rowsRead >= ROWS_TARGET) problems.push(`${d.zone.name}: rows_read ${d.rowsRead}`);
    if (args.show?.includes(key)) console.log(JSON.stringify(embeds, null, 1));
    console.log(`${d.zone.name}\tatlas_id ${d.zone.atlas_id ?? '-'}\tcreatures ${d.creatures.length}\trows_read ${d.rowsRead}\tlongest field ${field}\ttotal ${total}${over}\tlinks: ${links}`);
  }
  console.log(`largest card: ${worst.zone} (${worst.total} of ${EMBED_LIMITS.total}; longest field ${worst.field} of ${EMBED_LIMITS.fieldValue})`);
  console.log(`rows read per card: max ${Math.max(...rows)}, median ${[...rows].sort((a, b) => a - b)[Math.floor(rows.length / 2)]}; ${rows.filter((n) => n < ROWS_TARGET).length} of ${rows.length} cards under ${ROWS_TARGET}`);
  if (problems.length) {
    console.error(`problems:\n  ${problems.join('\n  ')}`);
    process.exitCode = 1;
  }
  if (!args.remote) {
    // Each statement on its own, for the zone with the most creatures: rows_read and the query plan.
    const key = 'night harbor';
    for (const [name, sql] of Object.entries({ zone: ZONE_SQL, mobs: MOBS_SQL, npcs: NPCS_SQL })) {
      const r = await db.prepare(sql).bind(key).all();
      const plan = await db.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(key).all<{ detail: string }>();
      console.log(`${key} ${name}: ${r.results.length} rows, rows_read ${r.meta.rows_read} · ${plan.results.map((p) => p.detail).join(' / ')}`);
    }
  }
} finally {
  await dispose();
}

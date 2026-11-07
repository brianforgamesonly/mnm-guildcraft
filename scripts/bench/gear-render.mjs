// Order 40, ITEM 1: /gear upgrades as a member sees it, rendered as text from the local D1 after a real-data import
// (npm run import:local), through the real handlers. Seeds the test character of Brian's check, Banakil (Ranger 18,
// Halfling): Ear 1 Blacktide Earring, Wrist 1 Copper Chain Wristguard, Wrist 2 Rawhide Bracelet; Ear 2 and both Fingers empty.
//   node scripts/bench/gear-render.mjs [slot key …]
// Prints the summary (title, description, footer, Pick a slot's options), then each named slot's first page. Writes only its
// own guild's rows to the local database, and removes them. Item names are public wiki data.
import { getPlatformProxy } from 'wrangler';
import { gearUpgrades } from '../../src/gear/upgrades.ts';

const proxy = await getPlatformProxy({ environment: 'dev' });
const db = proxy.env.DB;
const GUILD = 'bench-o40-render';
const USER = 'bench-user';
const at = new Date().toISOString();
const cleanup = () =>
  db.batch(['character_gear', 'character', 'member', 'guild'].map((t) => db.prepare(`DELETE FROM ${t} WHERE ${t === 'guild' ? 'id' : 'guild_id'} = ?`).bind(GUILD)));
await cleanup();
await db.batch([
  db.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(GUILD, 'Bench', at),
  db.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES (?, ?, 'Bench', ?)").bind(GUILD, USER, at),
]);
const ins = await db
  .prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, race, level, is_main, created_at, updated_at) VALUES (?, ?, 'Banakil', 'banakil', 'RNG', 'HFL', 18, 1, ?, ?)")
  .bind(GUILD, USER, at, at)
  .run();
const id = ins.meta.last_row_id;
const WORN = { ear1: 'blacktide earring', wrist1: 'copper chain wristguard', wrist2: 'rawhide bracelet' };
await db.batch(Object.entries(WORN).map(([slot, key]) => db.prepare('INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, GUILD, slot, key, at, USER)));

const ctx = () => ({
  db,
  guild: { id: GUILD, name: 'Bench', learning_window: 25, request_channel_id: null, review_channel_id: null },
  member: { user: { id: USER, username: 'bench', global_name: 'Bench' }, nick: null, roles: [], permissions: '0' },
  userId: USER,
  officer: false,
  effects: {},
});
const opt = (name, value) => ({ type: 3, name, value });
const show = (label, r) => {
  const e = r.data.embeds?.[0];
  console.log(`\n===== ${label} =====`);
  if (!e) return console.log(r.data.content);
  console.log(`# ${e.title}\n${e.description}\n-- footer: ${e.footer?.text ?? ''}`);
  for (const row of r.data.components ?? []) for (const c of row.components ?? []) if (c.options) console.log(`-- ${c.placeholder}: ${c.options.map((o) => `${o.label} [${o.value}]${o.description ? ` (${o.description})` : ''}`).join(' | ')}`);
};
show('summary', await gearUpgrades(ctx(), [opt('character', 'Banakil')]));
for (const slot of process.argv.slice(2)) show(`slot: ${slot}`, await gearUpgrades(ctx(), [opt('character', 'Banakil'), opt('slot', slot)]));
await cleanup();
await proxy.dispose();

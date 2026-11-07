// Order 39 report aid: a test character's /gear upgrades summary and Wrist page, rendered through the real handler on the
// local D1 after a real-data import. Testchar: a Ranger at 30, Halfling, wearing on each wrist the two Ranger-usable wrist
// items with the most stats (public wiki data). Prints the two embeds' descriptions and footers; removes its own rows.
//   npm run show:wrist
import { getPlatformProxy } from 'wrangler';
import { gearUpgrades } from '../../src/gear/upgrades.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';

const proxy = await getPlatformProxy({ environment: 'dev' });
const db = proxy.env.DB;
const GUILD = 'bench-o39-wrist';
const USER = 'bench-user';
const at = new Date().toISOString();
const cleanup = () => db.batch(['character_gear', 'character', 'member', 'guild'].map((t) => db.prepare(`DELETE FROM ${t} WHERE ${t === 'guild' ? 'id' : 'guild_id'} = ?`).bind(GUILD)));
await cleanup();
const rng = await db.prepare("SELECT bit FROM game_class WHERE code = 'RNG'").first('bit');
const wrists = (
  await db
    .prepare("SELECT name_key FROM item WHERE source = 'wiki' AND gone_at IS NULL AND (slot_mask & ?1) <> 0 AND (class_mask IN (-1, 0) OR ((class_mask >> ?2) & 1) = 1) ORDER BY length(stats_json) DESC, name_key LIMIT 2 OFFSET 3")
    .bind(bitOf(SLOTS, 'WRIST'), rng)
    .all()
).results.map((r) => r.name_key);
await db.batch([
  db.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(GUILD, 'Bench', at),
  db.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES (?, ?, 'Bench', ?)").bind(GUILD, USER, at),
  db.prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, race, is_main, created_at, updated_at) VALUES (?, ?, 'Testchar', 'testchar', 'RNG', 30, 'HFL', 1, ?, ?)").bind(GUILD, USER, at, at),
]);
const id = await db.prepare("SELECT id FROM character WHERE guild_id = ? AND name = 'Testchar'").bind(GUILD).first('id');
await db.batch(wrists.map((k, i) => db.prepare('INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, GUILD, `wrist${i + 1}`, k, at, USER)));
const ctx = { db, guild: { id: GUILD, name: 'Bench', learning_window: 25 }, member: { user: { id: USER, username: 'bench' }, nick: null, roles: [], permissions: '0' }, userId: USER, officer: false, effects: {} };
const opt = (name, value) => ({ type: 3, name, value });
for (const o of [[], [opt('slot', 'wrist')]]) {
  const e = (await gearUpgrades(ctx, o)).data.embeds[0];
  console.log(`----- ${o.length ? 'Wrist page 1' : 'summary'}\n${e.description}\n[footer] ${e.footer?.text}`);
}
await cleanup();
await proxy.dispose();

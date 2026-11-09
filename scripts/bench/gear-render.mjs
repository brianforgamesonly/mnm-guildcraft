// Order 40, ITEM 1: /gear upgrades as a member sees it, rendered as text from the local D1 after a real-data import
// (npm run import:local), through the real handlers. Seeds the test character of Brian's check, Banakil (Ranger 18,
// Halfling): Ear 1 Blacktide Earring, Wrist 1 Copper Chain Wristguard, Wrist 2 Rawhide Bracelet; Ear 2 and both Fingers empty.
//   node scripts/bench/gear-render.mjs [slot key …]
// Order 43: a slot key may carry floors, "chest@ac=10" or "primary@ac=5@ratio=0.45" (min_ac:, min_ratio:); each list
// also prints its buttons and how many items it lists over all its pages, and how many each test hid.
// Prints the summary (title, description, footer, Pick a slot's options), then each named slot's first page. Writes only its
// own guild's rows to the local database, and removes them. Item names are public wiki data.
import { getPlatformProxy } from 'wrangler';
import { FILTER_PREFIX, filterModal, gearUpgrades, load, ordered } from '../../src/gear/upgrades.ts';
import { compareSlot, upgradeSlot } from '../../src/gear/score.ts';
import { itemsFor } from '../../src/gear/index.ts';
import { forSlot } from '../../src/gear/filter.ts';

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
const ch = await db.prepare('SELECT * FROM character WHERE id = ?').bind(id).first();
const L = await load(ctx(), ch);
for (const arg of process.argv.slice(2)) {
  const [slot, ...floors] = arg.split('@');
  const f = Object.fromEntries(floors.map((x) => x.split('=')));
  const opts = [opt('character', 'Banakil'), opt('slot', slot), ...(f.ac ? [{ type: 4, name: 'min_ac', value: Number(f.ac) }] : []), ...(f.ratio ? [{ type: 10, name: 'min_ratio', value: Number(f.ratio) }] : [])];
  const r = await gearUpgrades(ctx(), opts);
  show(`slot: ${arg}`, r);
  console.log(`-- buttons: ${(r.data.components ?? []).flatMap((row) => row.components ?? []).filter((c) => c.type === 2).map((c) => `${c.label} [${c.custom_id}]`).join(' | ')}`);
  const s = upgradeSlot(slot);
  const o = ordered(compareSlot(s, L.ctx, L.wearer, itemsFor(L.idx, s.token)), forSlot({ cap: null, minAc: f.ac ? Number(f.ac) : null, minRatio: f.ratio ? Math.round(Number(f.ratio) * 1000) : null }, s.token));
  console.log(`-- listed over all pages: ${o.all.length} · hidden by the cap ${o.hidden} · below AC ${o.belowAc} · below ratio ${o.belowRatio}`);
  const filter = (r.data.components ?? []).flatMap((row) => row.components ?? []).find((c) => c.custom_id?.startsWith(FILTER_PREFIX));
  if (filter) console.log(`-- Filter's form: ${JSON.stringify(filterModal(filter.custom_id))}`);
}
await cleanup();
await proxy.dispose();

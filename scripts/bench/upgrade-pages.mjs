// Order 39, ITEM 3: the longest /gear upgrades page once every result carries its full stat line. On the local D1 after a
// real-data import (npm run import:local): for every class in the derived list, two characters, one with nothing saved and
// one wearing, in each of the 20 slots, the usable item with the longest stat line (the longest header, and the most stats
// a result can lose); every page of every one of the 20 slot lists (17 before order 40), and the summary, through the real handlers.
//   node scripts/bench/upgrade-pages.mjs
// Prints the longest embed description and the longest whole message (Discord: description 4,096, a message's embeds
// 6,000 characters together; src/discord.ts EMBED_LIMITS), with where each was found, and every page that reached the
// description limit (a page the renderer had to cut). Writes only its own guild's rows to the local database, and removes
// them. Item names printed are public wiki data.
import { getPlatformProxy } from 'wrangler';
import { gearUpgrades, PAGE_PREFIX } from '../../src/gear/upgrades.ts';
import { EMBED_LIMITS } from '../../src/discord.ts';
import { plainLine, parseStats } from '../../src/gear/statline.ts';
import { UPGRADE_SLOTS } from '../../src/gear/score.ts';
import { WEAR_SLOTS } from '../../src/gear/slots.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';

const proxy = await getPlatformProxy({ environment: 'dev' });
const db = proxy.env.DB;
const GUILD = 'bench-o39-pages';
const USER = 'bench-user';
const at = new Date().toISOString();
const cleanup = () =>
  db.batch(['character_gear', 'character', 'member', 'guild'].map((t) => db.prepare(`DELETE FROM ${t} WHERE ${t === 'guild' ? 'id' : 'guild_id'} = ?`).bind(GUILD)));
await cleanup();
await db.batch([
  db.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(GUILD, 'Bench', at),
  db.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES (?, ?, 'Bench', ?)").bind(GUILD, USER, at),
]);
const classes = (await db.prepare('SELECT code, bit FROM game_class WHERE item_count > 0 AND bit IS NOT NULL ORDER BY code').all()).results;
const items = (await db.prepare("SELECT name_key, slot_mask, class_mask, handed, stats_json FROM item WHERE source = 'wiki' AND gone_at IS NULL AND slot_mask <> 0").all()).results.map((r) => ({
  ...r,
  len: plainLine(parseStats(r.stats_json)).length,
}));

const ctx = () => ({
  db,
  guild: { id: GUILD, name: 'Bench', learning_window: 25, request_channel_id: null, review_channel_id: null },
  member: { user: { id: USER, username: 'bench', global_name: 'Bench' }, nick: null, roles: [], permissions: '0' },
  userId: USER,
  officer: false,
  effects: {},
});
const opt = (name, value) => ({ type: 3, name, value });
const { upgradesComponent } = await import('../../src/gear/upgrades.ts');
const msgChars = (e) => (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text?.length ?? 0);

let longestDesc = { n: 0, where: '' };
let longestMsg = { n: 0, where: '' };
const atLimit = [];
let pagesSeen = 0;
const note = (e, where) => {
  pagesSeen++;
  const d = e.description?.length ?? 0;
  if (d > longestDesc.n) longestDesc = { n: d, where };
  if (msgChars(e) > longestMsg.n) longestMsg = { n: msgChars(e), where };
  if (d >= EMBED_LIMITS.description - 1) atLimit.push(where);
};

let n = 0;
for (const cls of classes) {
  for (const kind of ['empty', 'geared']) {
    const name = `Bench${cls.code}${kind === 'empty' ? 'e' : 'g'}`;
    const ins = await db
      .prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 30, ?, ?, ?)")
      .bind(GUILD, USER, name, name.toLowerCase(), cls.code, n++ === 0 ? 1 : 0, at, at)
      .run();
    const id = ins.meta.last_row_id;
    if (kind === 'geared') {
      const rows = [];
      for (const w of WEAR_SLOTS) {
        const bit = bitOf(SLOTS, w.token);
        const best = items
          .filter((i) => (i.slot_mask & bit) !== 0 && (i.class_mask === -1 || i.class_mask === 0 || ((i.class_mask >>> cls.bit) & 1) === 1) && !(i.handed ?? '').toLowerCase().includes('two'))
          .sort((a, b) => b.len - a.len)[0];
        if (best) rows.push(db.prepare('INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, GUILD, w.key, best.name_key, at, USER));
      }
      await db.batch(rows);
    }
    const summary = await gearUpgrades(ctx(), [opt('character', name)]);
    note(summary.data.embeds[0], `${cls.code} ${kind} summary`);
    for (const g of UPGRADE_SLOTS) {
      const first = await gearUpgrades(ctx(), [opt('character', name), opt('slot', g.key)]);
      const e = first.data.embeds[0];
      note(e, `${cls.code} ${kind} ${g.key} p1`);
      const m = /Page \d+ of (\d+)/.exec(e.footer?.text ?? '');
      const pages = m ? Number(m[1]) : 1;
      for (let p = 1; p < pages; p++) {
        const r = await upgradesComponent(ctx(), `${PAGE_PREFIX}${id}:${g.key}:c:${p}`, []);
        note(r.data.embeds[0], `${cls.code} ${kind} ${g.key} p${p + 1}`);
      }
    }
  }
}
console.log(JSON.stringify({ classes: classes.length, pagesSeen, longestDescription: longestDesc, longestMessage: longestMsg, limits: { description: EMBED_LIMITS.description, message: 6000 }, atDescriptionLimit: atLimit.length, atLimitSample: atLimit.slice(0, 10) }));
await cleanup();
await proxy.dispose();

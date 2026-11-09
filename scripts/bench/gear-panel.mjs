// Order 44: the Gear panel as a member sees it, rendered as text from the local D1 after a real-data import
// (npm run import:local), through the real handlers; then View an item's reply for one slot, with D1 rows read for it and
// for Open item on the same item, and the worst case from the data (the longest linked line, times 20).
//   node scripts/bench/gear-panel.mjs [--src <a checkout's src directory>] [--show-card <slot key>]
// --src renders another checkout's panel (the base, for a before/after) against this checkout's local D1.
// Seeds Brian's test character, Banakil (Ranger 18, Halfling), with the gear order 40's bench names (Ear 1 Blacktide
// Earring, Wrist 1 Copper Chain Wristguard, Wrist 2 Rawhide Bracelet) and order 44's Chest, Green Drakeling Scale Coat.
// Writes only its own guild's rows to the local database, and removes them. Item names and wiki addresses are public data.
import { getPlatformProxy } from 'wrangler';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: { src: { type: 'string' }, 'show-card': { type: 'string' } } });
const src = args.src ? pathToFileURL(`${resolve(args.src)}/`).href : new URL('../../src/', import.meta.url).href;
const wear = await import(`${src}gear/wear.ts`);
const upgrades = await import(`${src}gear/upgrades.ts`);

// Order 24: this checkout's own config and local state, from the script's location, never the working directory's (as
// scripts/import/db.ts localDb; the raw binding is needed here, for the handlers).
const root = new URL('../../', import.meta.url);
const proxy = await getPlatformProxy({
  environment: 'dev',
  configPath: fileURLToPath(new URL('wrangler.jsonc', root)),
  persist: { path: fileURLToPath(new URL('.wrangler/state/v3', root)) },
});
const raw = proxy.env.DB;
/** The database, counting D1's rows_read for every statement it runs (one or batched). */
let rows = 0;
let statements = 0;
const count = (r) => { statements++; rows += r?.meta?.rows_read ?? 0; return r; };
/** Each wrapped statement's own D1 statement: D1's batch takes only real ones. */
const real = new WeakMap();
const wrapStmt = (s) => {
  const w = new Proxy(s, {
    get(t, k) {
      if (k === 'bind') return (...a) => wrapStmt(t.bind(...a));
      if (k === 'all' || k === 'run' || k === 'raw') return async (...a) => count(await t[k](...a));
      if (k === 'first') return async (col) => { const r = count(await t.all()); const row = r.results[0] ?? null; return col ? row?.[col] ?? null : row; };
      return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
    },
  });
  real.set(w, s);
  return w;
};
const db = new Proxy(raw, {
  get(t, k) {
    if (k === 'prepare') return (sql) => wrapStmt(t.prepare(sql));
    if (k === 'batch') return async (ss) => (await t.batch(ss.map((s) => real.get(s) ?? s))).map(count);
    return typeof t[k] === 'function' ? t[k].bind(t) : t[k];
  },
});

const GUILD = 'bench-o44-panel';
const USER = 'bench-user';
const at = new Date().toISOString();
const cleanup = () => raw.batch(['character_gear', 'character', 'member', 'guild'].map((t) => raw.prepare(`DELETE FROM ${t} WHERE ${t === 'guild' ? 'id' : 'guild_id'} = ?`).bind(GUILD)));
await cleanup();
await raw.batch([
  raw.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?)').bind(GUILD, 'Bench', at),
  raw.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, first_seen_at) VALUES (?, ?, 'Bench', ?)").bind(GUILD, USER, at),
]);
const ins = await raw
  .prepare("INSERT INTO character (guild_id, owner_user_id, name, name_key, class, race, level, is_main, created_at, updated_at) VALUES (?, ?, 'Banakil', 'banakil', 'RNG', 'HFL', 18, 1, ?, ?)")
  .bind(GUILD, USER, at, at)
  .run();
const id = ins.meta.last_row_id;
const WORN = { ear1: 'blacktide earring', chest: 'green drakeling scale coat', wrist1: 'copper chain wristguard', wrist2: 'rawhide bracelet' };
await raw.batch(Object.entries(WORN).map(([slot, key]) => raw.prepare('INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(id, GUILD, slot, key, at, USER)));

const ctx = (d = raw) => ({
  db: d,
  guild: { id: GUILD, name: 'Bench', learning_window: 25, request_channel_id: null, review_channel_id: null },
  member: { user: { id: USER, username: 'bench', global_name: 'Bench' }, nick: null, roles: [], permissions: '0' },
  userId: USER,
  officer: false,
  effects: {},
});
try {
  const p = await wear.panelButton(ctx(), `${wear.PANEL_PREFIX}${id}`);
  console.log('===== the panel: content =====');
  console.log(p.data.content);
  for (const e of p.data.embeds ?? []) console.log(`===== embed description (${e.description.length} chars) =====\n${e.description}`);
  console.log(`===== content: ${p.data.content.length} chars; ${(p.data.components ?? []).length} rows =====`);
  for (const r of p.data.components ?? []) for (const c of r.components ?? []) console.log(c.options ? `-- select ${c.custom_id.replace(String(id), '<id>')} "${c.placeholder}": ${JSON.stringify(c.options)}` : `-- button ${c.label}`);
  if (wear.VIEW_PREFIX && upgrades.upgradesComponent) {
    const key = args['show-card'] ?? 'chest';
    const coat = await raw.prepare('SELECT i.id FROM character_gear g JOIN item i ON i.name_key = g.item_key WHERE g.character_id = ? AND g.slot = ?').bind(id, key).first();
    if (!coat) throw new Error(`--show-card ${key}: Banakil's ${key} holds no item with a row (seeded: ${Object.keys(WORN).join(', ')})`);
    // Warm once, then measure each (the isolate caches, as a live Worker's are after its first card).
    await upgrades.upgradesComponent(ctx(), `${upgrades.OPEN_PREFIX}${coat.id}`, []);
    for (const [label, cid, values] of [['Open item (guo:)', `${upgrades.OPEN_PREFIX}${coat.id}`, []], ['View an item (wrx:)', `${wear.VIEW_PREFIX}${id}`, [key]]]) {
      rows = 0; statements = 0;
      const r = await upgrades.upgradesComponent(ctx(db), cid, values);
      console.log(`===== ${label}: ${statements} statements, ${rows} rows read =====`);
      const e = r.data.embeds?.[0];
      if (label.startsWith('View')) {
        console.log(`title: ${e?.title}`);
        for (const f of e?.fields ?? []) console.log(`${f.name}: ${f.value.replace(/\n/g, ' / ')}`);
      }
    }
    // The worst case from the data: the longest linked line any wearable item makes, with the longest mark, for all 20.
    const { results } = await raw.prepare("SELECT name, wiki_url FROM item WHERE source = 'wiki' AND slot_mask <> 0 AND gone_at IS NULL").all();
    const { md } = await import(`${src}discord.ts`);
    const { linkUrl } = await import(`${src}gear/wiki-link.ts`);
    const worst = results.reduce((m, r) => Math.max(m, `[${md(r.name)}](${r.wiki_url?.startsWith('https://') ? linkUrl(r.wiki_url) : ''})`.length), 0);
    const longest = results.reduce((a, r) => (md(r.name).length > md(a.name).length ? r : a));
    console.log(`===== worst case: ${results.length} wearable items; longest md-escaped name ${md(longest.name).length} ("${longest.name}"); longest linked name ${worst} =====`);
  }
} finally {
  await cleanup();
  await proxy.dispose();
}

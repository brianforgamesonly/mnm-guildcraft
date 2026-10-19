// The roster board's dry run and rollback (order 5, ITEM 1.1), against the remote dev D1.
//
//   ACTION=render  Read-only. Renders every board post and the index from live D1 with the Worker's own
//                  code (src/board/data.ts, src/board/render.ts) and prints them. Every SQL statement must
//                  be a SELECT, or the script stops before sending it. This repository is public, so its
//                  Actions logs are too: member display names and character names are replaced by stable
//                  pseudonyms (Member A, Character A), and Discord ids (15+ digits) are redacted.
//   ACTION=delete  The rollback: deletes the bot-owned forum posts listed in board_post.thread_id and the
//                  index post, then forgets them and clears the board channel (the board stops). DRY_RUN=1
//                  (the default) prints what it would delete and changes nothing.
//
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; for a real delete also DISCORD_BOT_TOKEN.
// Prints counts and rendered text only, never a credential.
import { readFileSync } from 'node:fs';
import { boardStatements, boardFromResults } from '../../src/board/data.ts';
import { contentHash, renderIndex, renderSkillPost } from '../../src/board/render.ts';

const action = process.env.ACTION ?? 'render';
const dryRun = process.env.DRY_RUN !== '0';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
const cfg = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const databaseId = cfg.env.dev.d1_databases[0].database_id;
const readOnly = action === 'render' || dryRun;

const redact = (s) => String(s).replace(/\d{15,}/g, '<id>');

/** A D1Database-shaped adapter over the D1 HTTP query API, so the Worker's own statements run unchanged. */
async function query(sql, params) {
  if (readOnly && !/^\s*SELECT\b/i.test(sql)) throw new Error(`read-only run refused a non-SELECT statement: ${sql.slice(0, 60)}`);
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${databaseId}/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const body = await res.json();
  if (!res.ok || !body.success) throw new Error(`D1 HTTP ${res.status}: ${(body.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ')}`);
  return body.result[0];
}
const stmt = (sql, params = []) => ({
  sql,
  params,
  bind: (...p) => stmt(sql, p),
  all: () => query(sql, params),
  first: async () => (await query(sql, params)).results[0] ?? null,
  run: () => query(sql, params),
});
const db = { prepare: (sql) => stmt(sql), batch: async (stmts) => { const out = []; for (const s of stmts) out.push(await s.all()); return out; } };

const guilds = (await db.prepare('SELECT id, board_channel_id FROM guild ORDER BY id').all()).results;
console.log(JSON.stringify({ action, dry_run: readOnly, guilds: guilds.length, with_board: guilds.filter((g) => g.board_channel_id).length }));

if (action === 'render') {
  const now = Date.now();
  for (const [gi, g] of guilds.entries()) {
    const data = boardFromResults(await db.batch(boardStatements(db, g.id)));
    // Stable pseudonyms per run: the same member or character always gets the same letter.
    const alias = (map, prefix) => (name) => map.get(name) ?? (map.set(name, `${prefix} ${String.fromCharCode(65 + map.size)}`), map.get(name));
    const member = alias(new Map(), 'Member');
    const character = alias(new Map(), 'Character');
    const threads = new Map([...data.posts].map(([id, p]) => [id, p.thread_id]));
    console.log(`\n=== guild ${gi + 1}: board ${data.guild.board_channel_id ? 'set' : 'not set'}, ${data.tradeskills.length} tradeskills (one post each), ${data.posts.size} posts recorded, stale_days ${data.guild.stale_days}`);
    let withLines = 0;
    for (const t of data.tradeskills) {
      const lines = (data.lines.get(t.id) ?? []).map((l) => ({ ...l, member: member(l.member), character: character(l.character) }));
      if (lines.length) withLines++;
      const msgs = renderSkillPost(t.name, lines, data.guild.stale_days, now);
      const hash = (await contentHash(msgs)).slice(0, 12);
      console.log(`\n--- post "${t.name}" · ${msgs.length} message(s) · ${lines.length} line(s) · hash ${hash}`);
      console.log(redact(JSON.stringify(msgs.map((m) => m.embeds))));
    }
    const idx = renderIndex(data.tradeskills.map((t) => ({ skill: t.name, thread_id: threads.get(t.id) ?? null, lines: (data.lines.get(t.id) ?? []).length })), now);
    console.log('\n--- index post "Index: how to get listed" (pinned)');
    console.log(redact(JSON.stringify(idx.message.embeds)));
    console.log(`\nsummary: ${data.tradeskills.length + 1} posts would exist (${data.tradeskills.length} tradeskills + index); ${withLines} tradeskills have at least one character.`);
  }
} else if (action === 'delete') {
  const bot = process.env.DISCORD_BOT_TOKEN;
  if (!dryRun && !bot) throw new Error('DISCORD_BOT_TOKEN must be set for a real delete');
  for (const [gi, g] of guilds.entries()) {
    const posts = (await db.prepare('SELECT thread_id FROM board_post WHERE guild_id = ?').bind(g.id).all()).results;
    const index = (await db.prepare('SELECT board_index_thread_id AS t FROM guild WHERE id = ?').bind(g.id).first())?.t ?? null;
    const threads = [...posts.map((p) => p.thread_id), ...(index ? [index] : [])];
    console.log(`guild ${gi + 1}: ${posts.length} tradeskill posts + ${index ? 1 : 0} index post are bot-owned${dryRun ? ' (dry run: nothing deleted)' : ''}`);
    if (dryRun || !threads.length) continue;
    let deleted = 0;
    const failed = [];
    for (const t of threads) {
      const res = await fetch(`https://discord.com/api/v10/channels/${t}`, { method: 'DELETE', headers: { Authorization: `Bot ${bot}`, 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' } });
      if (res.ok || res.status === 404) deleted++;
      else failed.push(res.status);
      const resetAfter = Number(res.headers.get('X-RateLimit-Reset-After'));
      if (res.headers.get('X-RateLimit-Remaining') === '0' && resetAfter > 0) await new Promise((r) => setTimeout(r, resetAfter * 1000));
    }
    console.log(`guild ${gi + 1}: deleted ${deleted} of ${threads.length} posts${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
    if (failed.length) process.exitCode = 1;
    else {
      await query('DELETE FROM board_post WHERE guild_id = ?', [g.id]);
      await query('UPDATE guild SET board_channel_id = NULL, board_index_thread_id = NULL, board_index_message_id = NULL, board_index_hash = NULL, board_lock_until = NULL WHERE id = ?', [g.id]);
      console.log(`guild ${gi + 1}: board rows removed and board channel cleared`);
    }
  }
} else throw new Error(`unknown ACTION ${action}`);

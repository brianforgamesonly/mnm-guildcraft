// The roster board's dry runs, live checks and rollback (orders 5 and 6), against the remote dev D1.
//
//   ACTION=render   Read-only. Renders every board post and the index from live D1 with the Worker's own
//                   code (src/board/data.ts, src/board/render.ts) and prints them.
//   ACTION=inspect  Read-only (order 6, ITEM 1.2 dry run). D1 SELECTs, and Discord GETs: the guild's active
//                   threads and the forum's archived posts (2 calls), then each post's first message (its
//                   edit time). Prints, per post: tradeskill, thread (last 6 digits), created (from the
//                   snowflake), message_count, archived, auto-archive time; whether the board is A→Z; the
//                   order a rebuild would create; the posts it would guard (message_count > 0).
//   ACTION=archive  Live check (order 6, ITEM 1.0). DRY_RUN=0 only. Archives the post of tradeskill SKILL
//                   through the API, reads it back, and marks its row dirty with content_hash NULL (so the
//                   next refresh must edit it; an unchanged hash is never edited). Rollback: unarchive it
//                   (any refresh does, or PATCH archived:false).
//   ACTION=refresh  DRY_RUN=0 only. One board invocation: the Worker's own refreshGuildBoard (src/board/refresh.ts)
//                   with the same 40-call budget, D1 over HTTP and Discord over fetch. REBUILD=1 first asks
//                   for the A→Z rebuild (guild.board_rebuild_since, kept if already set) and runs as the rebuild.
//   ACTION=delete   The rollback: deletes the bot-owned forum posts listed in board_post.thread_id and the
//                   index post, then forgets them and clears the board channel (the board stops). DRY_RUN=1
//                   (the default) prints what it would delete and changes nothing.
//
// Every SQL statement of a read-only run must be a SELECT, or the script stops before sending it. This
// repository is public, so its Actions logs are too: member display names and character names are replaced by
// stable pseudonyms (Member A, Character A), and Discord ids (15+ digits) are redacted; threads are named by
// tradeskill and the last 6 digits of their id.
//
// Environment: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID; DISCORD_BOT_TOKEN for inspect, archive, refresh
// and a real delete. Prints counts and rendered text only, never a credential.
import { readFileSync } from 'node:fs';
import { boardStatements, boardFromResults } from '../../src/board/data.ts';
import { contentHash, renderIndex, renderSkillPost } from '../../src/board/render.ts';
import { BOARD_CALL_CAP, botApi } from '../../src/board/api.ts';
import { archivesAt, CRON_RUN_MS, refreshGuildBoard, requestRebuild } from '../../src/board/refresh.ts';
import { boardInOrder, displayOrder, snowflakeAt, snowflakeMs } from '../../src/board/order.ts';
import { runDepartures } from '../../src/departures.ts';

const action = process.env.ACTION ?? 'render';
const dryRun = process.env.DRY_RUN !== '0';
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const bot = process.env.DISCORD_BOT_TOKEN;
if (!token || !account) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
const cfg = JSON.parse(readFileSync('wrangler.jsonc', 'utf8').replace(/^\s*\/\/.*$/gm, ''));
const databaseId = cfg.env.dev.d1_databases[0].database_id;
const readOnly = action === 'render' || action === 'inspect' || dryRun;
if (['archive', 'refresh'].includes(action) && dryRun) throw new Error(`ACTION=${action} changes live data: it runs only with DRY_RUN=0`);
if (['inspect', 'archive', 'refresh', 'departures'].includes(action) && !bot) throw new Error(`DISCORD_BOT_TOKEN must be set for ACTION=${action}`);

const redact = (s) => String(s).replace(/\d{15,}/g, '<id>');
const tail = (id) => (id ? `…${String(id).slice(-6)}` : '-');
const iso = (ms) => (ms ? new Date(ms).toISOString().replace('.000Z', 'Z') : '-');

/** A D1Database-shaped adapter over the D1 HTTP query API, so the Worker's own statements run unchanged. */
let d1Calls = 0;
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
  all: () => (d1Calls++, query(sql, params)),
  first: async () => (d1Calls++, (await query(sql, params)).results[0] ?? null),
  run: () => (d1Calls++, query(sql, params)),
});
// A batch counts as one call, as in the Worker (its statements are sent one by one here, in order).
const db = { prepare: (sql) => stmt(sql), batch: async (stmts) => { d1Calls++; const out = []; for (const s of stmts) out.push(await query(s.sql, s.params)); return out; } };

/** One Discord GET or PATCH outside the board budget (inspect and archive). */
async function discord(method, path, body) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${bot}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await res.json().catch(() => null);
  const resetAfter = Number(res.headers.get('X-RateLimit-Reset-After'));
  if (res.headers.get('X-RateLimit-Remaining') === '0' && resetAfter > 0) await new Promise((r) => setTimeout(r, resetAfter * 1000));
  return { ok: res.ok, status: res.status, body: json };
}

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
} else if (action === 'inspect') {
  for (const [gi, g] of guilds.entries()) {
    if (!g.board_channel_id) continue;
    const data = boardFromResults(await db.batch(boardStatements(db, g.id)));
    const changed = new Map(
      (await db.prepare('SELECT cs.tradeskill_id AS id, max(cs.updated_at) AS at FROM character_skill cs JOIN character c ON c.id = cs.character_id WHERE c.guild_id = ? GROUP BY cs.tradeskill_id').bind(g.id).all()).results.map((r) => [r.id, r.at]),
    );
    const active = await discord('GET', `/guilds/${g.id}/threads/active`);
    const archived = await discord('GET', `/channels/${g.board_channel_id}/threads/archived/public?limit=100`);
    const listed = new Map();
    for (const t of active.body?.threads ?? []) if (t.parent_id === g.board_channel_id) listed.set(t.id, t);
    for (const t of archived.body?.threads ?? []) listed.set(t.id, t);
    console.log(`\n=== guild ${gi + 1}: thread lists: active ${active.status}, archived ${archived.status}${archived.body?.has_more ? ' (has_more: incomplete)' : ''}; ${listed.size} threads in the board forum; rebuild ${data.guild.board_rebuild_since ? `in progress since ${data.guild.board_rebuild_since}` : 'not in progress'}`);
    const botId = listed.get(data.guild.board_index_thread_id)?.owner_id ?? [...data.posts.values()].map((p) => listed.get(p.thread_id)?.owner_id).find(Boolean);
    console.log('tradeskill\tthread\tcreated\tmessage_count\tarchived\tauto_archive_min\tarchives_at\tbot_owned\tlast_skill_change\tfirst_message_edited\tedit_lag_s\tmessages');
    for (const t of displayOrder(data.tradeskills)) {
      const p = data.posts.get(t.id);
      if (!p) {
        console.log(`${t.name}\t(no post)`);
        continue;
      }
      const x = listed.get(p.thread_id);
      const first = JSON.parse(p.message_ids_json)[0] ?? p.thread_id;
      const msg = await discord('GET', `/channels/${p.thread_id}/messages/${first}`);
      const edited = msg.body?.edited_timestamp ? Date.parse(msg.body.edited_timestamp) : null;
      const change = changed.get(t.id) ? Date.parse(changed.get(t.id)) : null;
      const info = x && { auto_archive_duration: x.thread_metadata?.auto_archive_duration, archive_timestamp: x.thread_metadata?.archive_timestamp, last_message_id: x.last_message_id, id: x.id };
      console.log(
        [
          t.name, tail(p.thread_id), iso(snowflakeMs(p.thread_id)), x?.message_count ?? 'not listed', x ? !!x.thread_metadata?.archived : 'not listed', x?.thread_metadata?.auto_archive_duration ?? '-',
          info ? iso(archivesAt(info)) : '-', x ? x.owner_id === botId : '-', changed.get(t.id) ?? '-', iso(edited), edited && change ? ((edited - change) / 1000).toFixed(1) : '-', JSON.parse(p.message_ids_json).length,
        ].join('\t'),
      );
    }
    const idx = listed.get(data.guild.board_index_thread_id);
    console.log(`index: thread ${tail(data.guild.board_index_thread_id)} · created ${iso(data.guild.board_index_thread_id && snowflakeMs(data.guild.board_index_thread_id))} · pinned ${idx ? (idx.flags & 2) === 2 : 'not listed'} · archived ${idx ? !!idx.thread_metadata?.archived : 'not listed'}`);
    const others = [...listed.values()].filter((x) => x.id !== data.guild.board_index_thread_id && ![...data.posts.values()].some((p) => p.thread_id === x.id));
    console.log(`other threads in the forum: ${others.length} (${others.map((x) => `${x.owner_id === botId ? 'bot' : 'member'}-owned "${x.owner_id === botId ? x.name : 'member post'}" ${tail(x.id)} messages ${x.message_count}`).join('; ') || 'none'})`);
    const inOrder = boardInOrder(data.tradeskills, (id) => data.posts.get(id)?.thread_id);
    console.log(`board order now: ${inOrder ? 'A→Z' : 'out of order'} (creation-date sort, newest first)`);
    const guarded = data.tradeskills.filter((t) => (listed.get(data.posts.get(t.id)?.thread_id)?.message_count ?? 0) > 0);
    const sequence = displayOrder(data.tradeskills).reverse().filter((t) => !guarded.includes(t));
    console.log(`rebuild would create, in this order (Z→A, so A shows at the top): ${sequence.map((t) => t.name).join(' → ')}`);
    console.log(`rebuild would guard (member messages, left untouched): ${guarded.map((t) => `${t.name} (${listed.get(data.posts.get(t.id).thread_id).message_count})`).join(', ') || 'none'}`);
    console.log(`first post from the top after the rebuild: ${sequence.at(-1)?.name ?? '-'}`);
  }
} else if (action === 'archive') {
  const skill = process.env.SKILL;
  if (!skill) throw new Error('SKILL must name the tradeskill whose post is archived');
  for (const g of guilds.filter((x) => x.board_channel_id)) {
    const p = (await db.prepare('SELECT p.tradeskill_id, p.thread_id FROM board_post p JOIN tradeskill t ON t.id = p.tradeskill_id WHERE p.guild_id = ? AND t.name = ?').bind(g.id, skill).all()).results[0];
    if (!p) throw new Error(`no board post for ${skill}`);
    console.log(`chosen: ${skill}, thread ${tail(p.thread_id)} (created ${iso(snowflakeMs(p.thread_id))}). Rollback: PATCH archived:false on it (any refresh that edits it does this).`);
    const a = await discord('PATCH', `/channels/${p.thread_id}`, { archived: true });
    console.log(`archive: HTTP ${a.status}${a.ok ? '' : ` ${redact(JSON.stringify(a.body))}`}`);
    const back = await discord('GET', `/channels/${p.thread_id}`);
    console.log(`read back: archived ${back.body?.thread_metadata?.archived} · archive_timestamp ${back.body?.thread_metadata?.archive_timestamp}`);
    if (!a.ok) process.exit(1);
    await query('UPDATE board_post SET dirty = 1, content_hash = NULL WHERE guild_id = ? AND tradeskill_id = ?', [g.id, p.tradeskill_id]);
    console.log('row marked dirty (content_hash cleared, so the next refresh edits it)');
  }
} else if (action === 'refresh') {
  for (const g of guilds.filter((x) => x.board_channel_id)) {
    const rebuild = process.env.REBUILD === '1';
    if (rebuild) {
      d1Calls = 0;
      const s = requestRebuild(db, g.id);
      await query(s.sql, s.params);
      const since = (await query('SELECT board_rebuild_since AS s FROM guild WHERE id = ?', [g.id])).results[0]?.s;
      console.log(`rebuild asked for: board_rebuild_since ${since} (posts created before ${iso(Number(snowflakeAt(Date.parse(since)) >> 22n) + 1420070400000)} are old)`);
    }
    d1Calls = 0;
    const budget = { d1: () => d1Calls, discord: 0, cap: BOARD_CALL_CAP, deadline: Date.now() + CRON_RUN_MS };
    const api = botApi(bot, budget);
    const started = Date.now();
    const r = await refreshGuildBoard(db, api, g.id, { trigger: rebuild ? 'rebuild' : 'sweep' });
    const ms = Date.now() - started;
    console.log(redact(JSON.stringify({ trigger: rebuild ? 'rebuild' : 'sweep', ms, d1_calls: d1Calls, discord_calls: budget.discord, total: d1Calls + budget.discord, cap: BOARD_CALL_CAP, result: r })));
    console.log('calls:', JSON.stringify(api.log.map((c) => `${c.route} ${c.status}${c.code ? ` ${c.code}` : ''}${c.waited_ms ? ` waited ${c.waited_ms}ms` : ''}`)));
    const rows = (await query('SELECT p.thread_id, t.name FROM board_post p JOIN tradeskill t ON t.id = p.tradeskill_id WHERE p.guild_id = ?', [g.id])).results;
    for (const x of [...rows].sort((a, b) => (BigInt(a.thread_id) < BigInt(b.thread_id) ? -1 : 1))) console.log(`  created ${iso(snowflakeMs(x.thread_id))}  ${tail(x.thread_id)}  ${x.name}`);
  }
} else if (action === 'delete') {
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
} else if (action === 'departures') {
  // Order 7, ITEM 3.2: the nightly departure run invoked directly (src/departures.ts runDepartures), with the
  // Worker's 40-call budget. DRY_RUN=1 (the default) lists the server's members and reports who would be marked
  // and which notices are owed, writing nothing (every statement must be a SELECT) and posting nothing.
  // Members are named by pseudonym only (public logs).
  d1Calls = 0;
  const budget = { d1: () => d1Calls, discord: 0, cap: BOARD_CALL_CAP, deadline: Date.now() + CRON_RUN_MS };
  const api = botApi(bot, budget);
  const results = await runDepartures(db, api, { dryRun });
  const alias = new Map();
  const pseudo = (id) => alias.get(id) ?? (alias.set(id, `Member ${String.fromCharCode(65 + alias.size)}`), alias.get(id));
  for (const [gi, r] of results.entries()) {
    const { guild: _g, would_mark, errors, ...rest } = r;
    console.log(redact(JSON.stringify({ guild: gi + 1, ...rest, would_mark: would_mark.map(pseudo), errors })));
  }
  console.log(`calls: d1 ${d1Calls}, discord ${budget.discord} (${api.log.map((c) => `${c.route} ${c.status}${c.code ? ` ${c.code}` : ''}`).join('; ') || 'none'}), total ${d1Calls + budget.discord} of ${BOARD_CALL_CAP}`);
  if (results.some((r) => r.errors.length)) process.exitCode = 1;
} else throw new Error(`unknown ACTION ${action}`);

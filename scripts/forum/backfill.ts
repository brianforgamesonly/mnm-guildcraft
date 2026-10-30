// Order 30 (ITEM 1): the ONE backfill of the forums GuildCraft already uses, one copy at a time. It sets a forum's post
// guidelines, and its default reaction from the server's existing guildcraft emoji, only where the field is empty now
// (scripts/forum/plan.ts). One PATCH per forum, never retried: Discord tightly rate-limits topic edits. After order 30
// this script and its workflow are removed, so GuildCraft never touches these fields again and officers' edits win.
//   DRY_RUN=1 (the default) reads and prints; nothing is written. Public log: servers by number, never an id or a name.
// Env: GUILDCRAFT_COPY, DRY_RUN, DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
import { BOARDS } from '../../src/board/kinds.ts';
import { memberChannelBits, type Overwrite, type RoleBits } from '../../src/commands/setup.ts';
import { ADMINISTRATOR, GUILD_FORUM, MANAGE_CHANNELS } from '../../src/discord.ts';
import { EMOJI_NAME } from '../../src/emoji.ts';
import { copyDatabaseId, remoteDb } from '../import/db.ts';
import { planForum, type ForumFields } from './plan.ts';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const dryRun = process.env.DRY_RUN !== '0';
const bot = need('DISCORD_BOT_TOKEN');
const appId = need('DISCORD_APPLICATION_ID');
const db = remoteDb({ accountId: need('CLOUDFLARE_ACCOUNT_ID'), apiToken: need('CLOUDFLARE_API_TOKEN'), databaseId: copyDatabaseId() });

let calls = 0;
async function discord<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; body: T }> {
  calls++;
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: { Authorization: `Bot ${bot}`, 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as T;
  const resetAfter = Number(res.headers.get('X-RateLimit-Reset-After'));
  if (res.headers.get('X-RateLimit-Remaining') === '0' && resetAfter > 0) await new Promise((r) => setTimeout(r, resetAfter * 1000));
  return { ok: res.ok, status: res.status, body: json };
}

type Forum = ForumFields & { type: number; permission_overwrites?: Overwrite[] };

// The forums are the columns BOARDS names, so a new board is covered without a list here.
const rows = await db.all<Record<string, string | null>>(`SELECT id, ${BOARDS.map((b) => b.channel).join(', ')} FROM guild ORDER BY id`);
const servers = rows.filter((g) => BOARDS.some((b) => g[b.channel]));
console.log(JSON.stringify({ copy: process.env.GUILDCRAFT_COPY, dry_run: dryRun, guilds: rows.length, with_a_forum: servers.length }));

const tally = { forums: 0, set: 0, already_set: 0, skipped: 0, failed: 0 };
for (const [n, g] of servers.entries()) {
  const guildId = g.id!;
  const roles = await discord<RoleBits[]>('GET', `/guilds/${guildId}/roles`);
  const me = await discord<{ roles: string[] }>('GET', `/guilds/${guildId}/members/${appId}`);
  if (!roles.ok || !me.ok) {
    console.log(`server ${n + 1}: could not read roles (${roles.status}) or the bot's member (${me.status}); skipped`);
    tally.skipped++;
    continue;
  }
  for (const board of BOARDS) {
    const forumId = g[board.channel];
    if (!forumId) continue;
    tally.forums++;
    const label = `server ${n + 1}, ${board.name} forum`;
    const ch = await discord<Forum>('GET', `/channels/${forumId}`);
    if (!ch.ok || ch.body.type !== GUILD_FORUM) {
      console.log(`${label}: unread (${ch.status}) or not a forum; skipped`);
      tally.skipped++;
      continue;
    }
    const bits = memberChannelBits(guildId, roles.body, ch.body.permission_overwrites ?? [], appId, me.body.roles);
    const can = (bits & ADMINISTRATOR) === ADMINISTRATOR || (bits & MANAGE_CHANNELS) === MANAGE_CHANNELS;
    // The emoji list only when the reaction is empty; the emoji is the server's own, never created here.
    const emojis = ch.body.default_reaction_emoji ? null : await discord<{ id: string; name: string | null }[]>('GET', `/guilds/${guildId}/emojis`);
    const emojiId = emojis?.ok ? (emojis.body.find((e) => e.name === EMOJI_NAME)?.id ?? null) : null;
    const plan = planForum(ch.body, board.guidelines, emojiId);
    console.log(`${label}: guidelines ${ch.body.topic ? 'already set' : 'empty'} · reaction ${ch.body.default_reaction_emoji ? 'already set' : 'empty'} · Manage Channels ${can ? 'held' : 'NOT held'} · would set: ${plan ? Object.keys(plan).join(', ') : 'nothing'}`);
    if (!plan) {
      tally.already_set++;
      continue;
    }
    if (!can) {
      tally.skipped++;
      continue;
    }
    if (dryRun) continue;
    const done = await discord<ForumFields>('PATCH', `/channels/${forumId}`, plan);
    console.log(`${label}: PATCH ${done.status}`);
    if (!done.ok) {
      tally.failed++;
      continue;
    }
    const back = await discord<ForumFields>('GET', `/channels/${forumId}`);
    console.log(`${label}: read back guidelines ${back.body?.topic?.length ?? 0} chars · reaction ${back.body?.default_reaction_emoji ? 'set' : 'empty'}`);
    tally.set++;
  }
}
console.log(JSON.stringify({ ...tally, discord_calls: calls }));
if (tally.failed) process.exitCode = 1;

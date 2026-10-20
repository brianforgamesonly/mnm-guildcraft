// /guildcraft setup member_role: officer_role: board: review: and /guildcraft status (PRD FR-8).
// The review channel arrived in order 7; the vault channel arrives in order 9.
import { audit, type Guild } from '../access.ts';
import type { Ctx } from '../context.ts';
import {
  ADMINISTRATOR, EMBED_LINKS, ephemeral, GUILD_FORUM, GUILD_TEXT, MANAGE_THREADS, optString, READ_MESSAGE_HISTORY, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL,
  type MessageReply, type Option,
} from '../discord.ts';
import { DISCORD_API } from '../respond.ts';
import { boardInOrder, boardOrderLine } from '../board/order.ts';
import { requestRebuild } from '../board/refresh.ts';

const describeRoles = (g: Pick<Guild, 'member_role_id' | 'officer_role_id'>) =>
  [
    `Member role: ${g.member_role_id ? `<@&${g.member_role_id}>` : 'none (anyone in the server can use GuildCraft)'}`,
    `Officer role: ${g.officer_role_id ? `<@&${g.officer_role_id}>` : 'none'} (Administrator and Manage Server always count as officers)`,
  ].join('\n');

const describeBoard = (g: Pick<Guild, 'board_channel_id'>) => `Roster board: ${g.board_channel_id ? `<#${g.board_channel_id}>` : 'not set (`board:` picks a forum channel)'}`;
const describeReview = (g: Pick<Guild, 'review_channel_id'>) =>
  `Review channel: ${g.review_channel_id ? `<#${g.review_channel_id}>` : 'not set (`review:` picks a private text channel for departure notices)'}`;

// ---------------------------------------------------------------- the board channel's permissions

/** What the bot needs in the board forum, by the name Discord's settings show. */
export const BOARD_PERMISSIONS: [bigint, string][] = [
  [VIEW_CHANNEL, 'View Channel'],
  [SEND_MESSAGES, 'Send Messages (Create Posts)'],
  [SEND_MESSAGES_IN_THREADS, 'Send Messages in Threads (Send Messages in Posts)'],
  [EMBED_LINKS, 'Embed Links'],
  [READ_MESSAGE_HISTORY, 'Read Message History'],
  [MANAGE_THREADS, 'Manage Threads (Manage Posts, to pin the index)'],
];

/** What the bot needs in the review channel (order 7): it posts departure notices with embeds and buttons there. */
export const REVIEW_PERMISSIONS: [bigint, string][] = [
  [VIEW_CHANNEL, 'View Channel'],
  [SEND_MESSAGES, 'Send Messages'],
  [EMBED_LINKS, 'Embed Links'],
];

export const missingPermissions = (bits: bigint, needed: [bigint, string][] = BOARD_PERMISSIONS): string[] =>
  (bits & ADMINISTRATOR) === ADMINISTRATOR ? [] : needed.filter(([b]) => (bits & b) !== b).map(([, name]) => name);

interface Overwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}

/**
 * The bot's permissions in a channel, computed from the server's roles and the channel's overwrites
 * (docs.discord.com/developers/topics/permissions, "Permission Overwrites"). The fallback for a resolved
 * channel without app_permissions: three GETs (channel, roles, the bot's member).
 */
export async function computeAppPermissions(token: string, guildId: string, channelId: string, appId: string): Promise<bigint | null> {
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' }, signal: AbortSignal.timeout(5000) });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [channel, roles, me] = await Promise.all([
    get<{ permission_overwrites?: Overwrite[] }>(`/channels/${channelId}`),
    get<{ id: string; permissions: string }[]>(`/guilds/${guildId}/roles`),
    get<{ roles: string[] }>(`/guilds/${guildId}/members/${appId}`),
  ]);
  if (!channel || !roles || !me) return null;
  const perm = (id: string) => BigInt(roles.find((r) => r.id === id)?.permissions ?? '0');
  let bits = perm(guildId) | me.roles.reduce((b, id) => b | perm(id), 0n);
  if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return bits;
  const ow = channel.permission_overwrites ?? [];
  const apply = (o: { allow: bigint; deny: bigint }) => {
    bits = (bits & ~o.deny) | o.allow;
  };
  const everyone = ow.find((o) => o.id === guildId);
  if (everyone) apply({ allow: BigInt(everyone.allow), deny: BigInt(everyone.deny) });
  const roleOw = ow.filter((o) => o.type === 0 && me.roles.includes(o.id));
  apply({ allow: roleOw.reduce((b, o) => b | BigInt(o.allow), 0n), deny: roleOw.reduce((b, o) => b | BigInt(o.deny), 0n) });
  const mine = ow.find((o) => o.type === 1 && o.id === appId);
  if (mine) apply({ allow: BigInt(mine.allow), deny: BigInt(mine.deny) });
  return bits;
}

const CHANNEL_KINDS = {
  board: {
    type: GUILD_FORUM,
    permissions: BOARD_PERMISSIONS,
    wrongType: (id: string) => `<#${id}> is not a forum channel. The roster board needs a forum channel: create one (Create Channel → Forum), then pick it here.`,
  },
  review: {
    type: GUILD_TEXT,
    permissions: REVIEW_PERMISSIONS,
    wrongType: (id: string) => `<#${id}> is not a text channel. The review channel needs a text channel (a private one, for officers), then pick it here.`,
  },
} as const;

/** Checks a picked channel: the right type, and the bot holds every permission it needs there. Returns the refusal text, or ok. */
async function checkChannel(c: Ctx, channelId: string, kind: keyof typeof CHANNEL_KINDS): Promise<{ refusal: string } | { ok: true; source: 'app_permissions' | 'computed' }> {
  const want = CHANNEL_KINDS[kind];
  const ch = c.resolved?.channels?.[channelId];
  if (!ch) return { refusal: "Sorry, Discord didn't send that channel's details. Run the command again and pick the channel from the list." };
  if (ch.type !== want.type) return { refusal: want.wrongType(channelId) };
  let bits: bigint | null = null;
  let source: 'app_permissions' | 'computed' = 'app_permissions';
  if (ch.app_permissions && /^\d+$/.test(ch.app_permissions)) bits = BigInt(ch.app_permissions);
  else if (c.botToken && c.applicationId) {
    source = 'computed';
    bits = await computeAppPermissions(c.botToken, c.guild.id, channelId, c.applicationId);
  }
  if (bits === null) return { refusal: `Sorry, I couldn't read my permissions in <#${channelId}>. Nothing was changed; please try again.` };
  const missing = missingPermissions(bits, want.permissions);
  if (missing.length)
    return {
      refusal: `Nothing was changed. In <#${channelId}> GuildCraft is missing: **${missing.join('**, **')}**.\nGive the GuildCraft role these in the channel's settings (Permissions), then run this again.`,
    };
  return { ok: true, source };
}

// ---------------------------------------------------------------- /guildcraft setup

export async function guildcraftSetup(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const memberRole = optString(opts, 'member_role');
  const officerRole = optString(opts, 'officer_role');
  const board = optString(opts, 'board');
  const review = optString(opts, 'review');
  if (memberRole === undefined && officerRole === undefined && board === undefined && review === undefined)
    return ephemeral(`Current settings:\n${describeRoles(c.guild)}\n${describeBoard(c.guild)}\n${describeReview(c.guild)}`);

  for (const [id, kind] of [[board, 'board'], [review, 'review']] as const) {
    if (id === undefined) continue;
    const check = await checkChannel(c, id, kind);
    if ('refusal' in check) return ephemeral(check.refusal);
  }
  const before = { member_role_id: c.guild.member_role_id, officer_role_id: c.guild.officer_role_id, board_channel_id: c.guild.board_channel_id, review_channel_id: c.guild.review_channel_id };
  const after = {
    member_role_id: memberRole ?? before.member_role_id,
    officer_role_id: officerRole ?? before.officer_role_id,
    board_channel_id: board ?? before.board_channel_id,
    review_channel_id: review ?? before.review_channel_id,
  };
  const moved = board !== undefined && before.board_channel_id !== null && before.board_channel_id !== board;
  const stmts = [
    c.db
      .prepare('UPDATE guild SET member_role_id = ?, officer_role_id = ?, board_channel_id = ?, review_channel_id = ? WHERE id = ?')
      .bind(after.member_role_id, after.officer_role_id, after.board_channel_id, after.review_channel_id, c.guild.id),
    audit(c.db, c.guild.id, c.userId, 'guild.setup', `guild:${c.guild.id}`, before, after),
  ];
  // A new forum starts a new board: the old posts are forgotten here (they stay in the old channel).
  if (moved)
    stmts.push(
      c.db.prepare('DELETE FROM board_post WHERE guild_id = ?').bind(c.guild.id),
      c.db.prepare('UPDATE guild SET board_index_thread_id = NULL, board_index_message_id = NULL, board_index_hash = NULL WHERE id = ?').bind(c.guild.id),
    );
  const counted = c.db.prepare('SELECT (SELECT count(*) FROM tradeskill) AS skills, (SELECT count(*) FROM board_post WHERE guild_id = ?) AS posts').bind(c.guild.id);
  const results = await c.db.batch([...stmts, counted]);
  const lines = [`Saved.\n${describeRoles(after)}\n${describeBoard(after)}\n${describeReview(after)}`];
  if (review !== undefined) lines.push(`Departure notices will go to <#${review}>: one per member who leaves the server, checked nightly, with Remove and Keep buttons for officers.`);
  if (board !== undefined) {
    const { skills, posts } = (results.at(-1)!.results as { skills: number; posts: number }[])[0];
    const toCreate = Math.max(0, skills - posts);
    c.effects.board = true;
    lines.push(
      toCreate
        ? `Building the board now: ${toCreate} tradeskill post${toCreate === 1 ? '' : 's'} plus a pinned index post. Most appear within a minute, all within 15 minutes.`
        : 'The board already has every tradeskill post; refreshing it now.',
    );
    if (moved) lines.push(`The old board's posts in <#${before.board_channel_id}> are left as they are.`);
  }
  return ephemeral(lines.join('\n'));
}

// ---------------------------------------------------------------- /guildcraft status (PRD FR-8, without usage)

const when = (iso: string | null | undefined) => (iso ? `<t:${Math.floor(Date.parse(iso) / 1000)}:f> (<t:${Math.floor(Date.parse(iso) / 1000)}:R>)` : 'never');

function warningsCount(json: string | null): number | null {
  if (!json) return 0;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.length : null;
  } catch {
    return null;
  }
}

export async function guildcraftStatus(c: Ctx): Promise<MessageReply> {
  const [okImport, lastImport, board, posts, departures] = await c.db.batch([
    c.db.prepare("SELECT source_version, finished_at FROM data_import WHERE status = 'ok' ORDER BY id DESC LIMIT 1"),
    c.db.prepare('SELECT status, started_at, finished_at, warnings, error FROM data_import ORDER BY id DESC LIMIT 1'),
    c.db
      .prepare(
        `SELECT count(*) AS posts, coalesce(sum(dirty <> 0), 0) AS dirty, max(last_rendered_at) AS refreshed,
          (SELECT count(*) FROM tradeskill) AS skills FROM board_post WHERE guild_id = ?`,
      )
      .bind(c.guild.id),
    // Order 6: the board order is derived from the thread ids (src/board/order.ts), never stored.
    c.db.prepare('SELECT t.id, t.name, p.thread_id FROM tradeskill t LEFT JOIN board_post p ON p.tradeskill_id = t.id AND p.guild_id = ?').bind(c.guild.id),
    // Order 7: members marked left, and the nightly departure run's own record (src/departures.ts).
    c.db
      .prepare(
        `SELECT (SELECT count(*) FROM member WHERE guild_id = ?1 AND status = 'left') AS left_members,
          (SELECT created_at FROM audit_log WHERE guild_id = ?1 AND action = 'departures.run' ORDER BY id DESC LIMIT 1) AS at,
          (SELECT detail_json FROM audit_log WHERE guild_id = ?1 AND action = 'departures.run' ORDER BY id DESC LIMIT 1) AS detail`,
      )
      .bind(c.guild.id),
  ]);
  const d = (departures.results as { left_members: number; at: string | null; detail: string | null }[])[0];
  const run = (() => {
    try {
      return d?.detail ? (JSON.parse(d.detail) as { marked?: number; stopped?: string | null }) : null;
    } catch {
      return null;
    }
  })();
  const threadOf = new Map((posts.results as { id: number; name: string; thread_id: string | null }[]).map((p) => [p.id, p.thread_id]));
  const inOrder = boardInOrder(posts.results as { id: number; name: string }[], (id) => threadOf.get(id));
  const ok =(okImport.results as { source_version: string; finished_at: string | null }[])[0];
  const last = (lastImport.results as { status: string; started_at: string; finished_at: string | null; warnings: string | null; error: string | null }[])[0];
  const b = (board.results as { posts: number; dirty: number; refreshed: string | null; skills: number }[])[0];
  const warnings = last ? warningsCount(last.warnings) : null;
  const lines = [
    '## GuildCraft status',
    `**Data version:** ${ok ? `\`${ok.source_version}\`` : 'no completed import yet'}`,
    `**Last import:** ${last ? `${when(last.finished_at ?? last.started_at)} · ${last.status}${last.error ? ` (${last.error.slice(0, 200)})` : ''} · ${warnings === null ? 'warnings unreadable' : `${warnings} warning${warnings === 1 ? '' : 's'}`}` : 'none yet'}`,
    c.guild.board_channel_id
      ? `**Roster board:** <#${c.guild.board_channel_id}> · ${b.posts} of ${b.skills} posts · last refresh ${when(b.refreshed)} · ${b.dirty} waiting to refresh`
      : '**Roster board:** not set up (`/guildcraft setup board:`)',
    ...(c.guild.board_channel_id ? [boardOrderLine(inOrder)] : []),
    `**Review channel:** ${c.guild.review_channel_id ? `<#${c.guild.review_channel_id}>` : 'not set (`/guildcraft setup review:`)'}`,
    `**Departures:** ${d?.left_members ?? 0} member${d?.left_members === 1 ? '' : 's'} marked as left · last nightly check ${when(d?.at)}${run ? ` · ${run.stopped ? `stopped: ${run.stopped.slice(0, 200)}` : `${run.marked ?? 0} marked`}` : ''}`,
    '**Usage against the free-tier limits:** coming soon',
  ];
  return ephemeral(lines.join('\n'));
}

// ---------------------------------------------------------------- /guildcraft rebuild-board (order 6)
// Named departure: PRD FR-8 says only "Forces a full board rebuild". Here it recreates the tradeskill posts
// in A→Z order (src/board/refresh.ts): new posts first, then the old ones deleted; posts with member
// messages are kept as they are.

export async function guildcraftRebuildBoard(c: Ctx): Promise<MessageReply> {
  if (!c.guild.board_channel_id) return ephemeral('There is no roster board yet. Set one up first with `/guildcraft setup board:`.');
  await c.db.batch([requestRebuild(c.db, c.guild.id), audit(c.db, c.guild.id, c.userId, 'board.rebuild', `guild:${c.guild.id}`, null, null)]);
  c.effects.board = true;
  c.effects.rebuild = true;
  return ephemeral(
    [
      `Rebuilding the roster board in <#${c.guild.board_channel_id}> in A→Z order: each tradeskill post is created again, then the old one is deleted. Posts with member replies are kept as they are.`,
      'Most of it happens within a minute, all of it within 15 minutes. `/guildcraft status` shows the board order.',
      'For A→Z to show at the top, the forum’s Default Sort Order must be Creation Time (Edit Channel).',
    ].join('\n'),
  );
}

// /guildcraft setup member_role: officer_role: board: review: and /guildcraft status (PRD FR-8).
// The review channel arrived in order 7; the vault channel arrives in order 9.
import { audit, type Guild } from '../access.ts';
import type { Ctx } from '../context.ts';
import { ADMINISTRATOR, ephemeral, GUILD_FORUM, GUILD_TEXT, optString, plural, VIEW_CHANNEL, type MessageReply, type Option } from '../discord.ts';
import { channelPermissions } from '../permissions.ts';
import { DISCORD_API } from '../respond.ts';
import { boardInOrder, boardOrderLine } from '../board/order.ts';
import { requestRebuild } from '../board/refresh.ts';
import { BACKUP_SQL, backupLine, failureText, USAGE_SQL, usageLines, usageParams, type BackupRow, type UsageRow } from '../usage.ts';
import { ALARM_IMPORT, REAL_IMPORT } from '../import-status.ts';
import { isDevCopy } from '../env.ts';

const describeRoles = (g: Pick<Guild, 'member_role_id' | 'officer_role_id'>) =>
  [
    `Member role: ${g.member_role_id ? `<@&${g.member_role_id}>` : 'none (anyone in the server can use GuildCraft)'}`,
    `Officer role: ${g.officer_role_id ? `<@&${g.officer_role_id}>` : 'none'} (Administrator and Manage Server always count as officers)`,
  ].join('\n');

const describeBoard = (g: Pick<Guild, 'board_channel_id'>) => `Roster board: ${g.board_channel_id ? `<#${g.board_channel_id}>` : 'not set (`board:` picks a forum channel)'}`;
const describeReview = (g: Pick<Guild, 'review_channel_id'>) =>
  `Review channel: ${g.review_channel_id ? `<#${g.review_channel_id}>` : 'not set (`review:` picks a private text channel for departure notices and reports)'}`;
const describeVault = (g: Pick<Guild, 'vault_channel_id'>) =>
  `Vault channel: ${g.vault_channel_id ? `<#${g.vault_channel_id}>` : 'not set (`vault:` picks a private text channel for item screenshots)'}`;

// ---------------------------------------------------------------- the board channel's permissions

// Order 10: what the bot needs in each channel, by the name Discord's settings show, derived from the routes the
// code calls there (src/permissions.ts). The install link's permissions come from the same table.
export const BOARD_PERMISSIONS = channelPermissions('board');
export const REVIEW_PERMISSIONS = channelPermissions('review');
export const VAULT_PERMISSIONS = channelPermissions('vault');

export const missingPermissions =(bits: bigint, needed: [bigint, string][] = BOARD_PERMISSIONS): string[] =>
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

/**
 * Order 8 (ITEM 3.4): whether @everyone can view a channel: the @everyone role's permissions, then the channel's
 * @everyone overwrite (the same "Permission Overwrites" order as above). Two GETs; null when either fails.
 */
export async function everyoneCanView(token: string, guildId: string, channelId: string): Promise<boolean | null> {
  const get = async <T>(path: string): Promise<T | null> => {
    try {
      const res = await fetch(`${DISCORD_API}${path}`, { headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' }, signal: AbortSignal.timeout(5000) });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [channel, roles] = await Promise.all([get<{ permission_overwrites?: Overwrite[] }>(`/channels/${channelId}`), get<{ id: string; permissions: string }[]>(`/guilds/${guildId}/roles`)]);
  if (!channel || !roles) return null;
  let bits = BigInt(roles.find((r) => r.id === guildId)?.permissions ?? '0');
  if ((bits & ADMINISTRATOR) === ADMINISTRATOR) return true;
  const everyone = (channel.permission_overwrites ?? []).find((o) => o.id === guildId);
  if (everyone) bits = (bits & ~BigInt(everyone.deny)) | BigInt(everyone.allow);
  return (bits & VIEW_CHANNEL) === VIEW_CHANNEL;
}

/** The setup reply's warning when the review channel is open to everyone. */
export const reviewPublicWarning = (id: string) =>
  `**Note:** everyone in the server can see <#${id}>, so departure notices (a member's name and characters) will show to all members. To keep them to officers: Edit Channel → Permissions → @everyone → turn off View Channel, then add your officer role with View Channel on. The setting is saved either way.`;
/** The vault's warning when @everyone can view it (order 9: warn, never refuse). */
export const vaultPublicWarning = (id: string) =>
  `**Note:** everyone in the server can see <#${id}>, so screenshots waiting for approval will show to all members. To keep them to officers: Edit Channel → Permissions → @everyone → turn off View Channel, then add your officer role with View Channel on. The setting is saved either way.`;
export const reviewUnreadWarning =(id: string) => `**Note:** I couldn't check who can see <#${id}>. Departure notices should go to a channel only officers can see.`;

const CHANNEL_KINDS = {
  board: {
    type: GUILD_FORUM,
    permissions: BOARD_PERMISSIONS,
    wrongType: (id: string) => `<#${id}> is not a forum channel. The roster board needs a forum channel: create one (Create Channel → Forum), then pick it here.`,
  },
  review: {
    type: GUILD_TEXT,
    permissions: REVIEW_PERMISSIONS,
    wrongType: (id: string) => `<#${id}> is not a text channel. Create a private text channel for officers, then pick it here.`,
  },
  vault: {
    type: GUILD_TEXT,
    permissions: VAULT_PERMISSIONS,
    wrongType: (id: string) => `<#${id}> is not a text channel. Create a private text channel for officers, then pick it here.`,
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
      refusal: `Nothing was changed. In <#${channelId}> GuildCraft is missing: **${missing.join('**, **')}**.\nGive MNM-Guildcraft these permissions in the channel's settings (Permissions), then run this again.`,
    };
  return { ok: true, source };
}

// ---------------------------------------------------------------- /guildcraft setup

export async function guildcraftSetup(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const memberRole = optString(opts, 'member_role');
  const officerRole = optString(opts, 'officer_role');
  const board = optString(opts, 'board');
  const review = optString(opts, 'review');
  const vault = optString(opts, 'vault');
  if (memberRole === undefined && officerRole === undefined && board === undefined && review === undefined && vault === undefined)
    return ephemeral(`Current settings:\n${describeRoles(c.guild)}\n${describeBoard(c.guild)}\n${describeReview(c.guild)}\n${describeVault(c.guild)}`);

  for (const [id, kind] of [[board, 'board'], [review, 'review'], [vault, 'vault']] as const) {
    if (id === undefined) continue;
    const check = await checkChannel(c, id, kind);
    if ('refusal' in check) return ephemeral(check.refusal);
  }
  const before = {
    member_role_id: c.guild.member_role_id, officer_role_id: c.guild.officer_role_id, board_channel_id: c.guild.board_channel_id, review_channel_id: c.guild.review_channel_id,
    vault_channel_id: c.guild.vault_channel_id,
  };
  const after = {
    member_role_id: memberRole ?? before.member_role_id,
    officer_role_id: officerRole ?? before.officer_role_id,
    board_channel_id: board ?? before.board_channel_id,
    review_channel_id: review ?? before.review_channel_id,
    vault_channel_id: vault ?? before.vault_channel_id,
  };
  const moved = board !== undefined && before.board_channel_id !== null && before.board_channel_id !== board;
  const stmts = [
    c.db
      .prepare('UPDATE guild SET member_role_id = ?, officer_role_id = ?, board_channel_id = ?, review_channel_id = ?, vault_channel_id = ? WHERE id = ?')
      .bind(after.member_role_id, after.officer_role_id, after.board_channel_id, after.review_channel_id, after.vault_channel_id, c.guild.id),
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
  const lines = [`Saved.\n${describeRoles(after)}\n${describeBoard(after)}\n${describeReview(after)}\n${describeVault(after)}`];
  if (vault !== undefined) {
    lines.push(`Screenshots from \`/item image\` will wait in <#${vault}> for an officer's Approve or Reject. Screenshots already in an earlier vault stay where they are.`);
    const open = c.botToken ? await everyoneCanView(c.botToken, c.guild.id, vault) : null;
    if (open === true) lines.push(vaultPublicWarning(vault));
    else if (open === null) lines.push(`**Note:** I couldn't check who can see <#${vault}>. The vault should be a channel only officers can see.`);
  }
  if (review !== undefined) {
    lines.push(`Departure notices will go to <#${review}>: one per member who leaves the server, checked nightly, with Remove and Keep buttons for officers.`);
    // Order 8: warn, never refuse, when the channel is open to everyone.
    const open = c.botToken ? await everyoneCanView(c.botToken, c.guild.id, review) : null;
    if (open === true) lines.push(reviewPublicWarning(review));
    else if (open === null) lines.push(reviewUnreadWarning(review));
  }
  if (board !== undefined) {
    const { skills, posts } = (results.at(-1)!.results as { skills: number; posts: number }[])[0];
    const toCreate = Math.max(0, skills - posts);
    c.effects.board = true;
    lines.push(
      toCreate
        ? `Building the board now: ${plural(toCreate, 'tradeskill post')} plus a pinned index post. Most appear within a minute, all within 15 minutes. If nothing shows, reload Discord.`
        : 'The board already has every tradeskill post; refreshing it now.',
    );
    if (moved) lines.push(`The old board's posts in <#${before.board_channel_id}> are left as they are.`);
  }
  return ephemeral(lines.join('\n'));
}

// ---------------------------------------------------------------- /guildcraft status (PRD FR-8; usage and backup from order 8)

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
  const nowMs = Date.now();
  const [okImport, lastImport, lastDryRun, alarmRow, board, posts, departures, usage, backup, queue] = await c.db.batch([
    c.db.prepare("SELECT source_version, finished_at FROM data_import WHERE status = 'ok' ORDER BY id DESC LIMIT 1"),
    // Order 8: a dry run writes nothing but its own row, so it is never "the last import" (the operator's check of order 7).
    // Order 9: a positive rule (src/import-status.ts), so a refused run is not one either.
    c.db.prepare(`SELECT status, started_at, finished_at, warnings, error FROM data_import WHERE ${REAL_IMPORT} ORDER BY id DESC LIMIT 1`),
    c.db.prepare(`SELECT id, finished_at, started_at, warnings, (SELECT max(id) FROM data_import WHERE ${REAL_IMPORT}) AS real_id FROM data_import WHERE status = 'dry-run' ORDER BY id DESC LIMIT 1`),
    // The import alarm's state, when it is newer than the last real import (a refusal): the alarm stays quiet on a
    // repeat, so status is where it keeps showing (scripts/ci/alarm.ts).
    c.db.prepare(`SELECT id, status, started_at, finished_at, error, (SELECT max(id) FROM data_import WHERE ${REAL_IMPORT}) AS real_id FROM data_import WHERE ${ALARM_IMPORT} ORDER BY id DESC LIMIT 1`),
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
    c.db.prepare(USAGE_SQL).bind(...usageParams(nowMs)),
    c.db.prepare(BACKUP_SQL),
    // Order 9: what is waiting for officers.
    c.db
      .prepare(
        `SELECT (SELECT count(*) FROM recipe_report WHERE guild_id = ?1 AND status = 'open') AS reports,
          (SELECT count(*) FROM item_image WHERE guild_id = ?1 AND status = 'pending' AND gone_at IS NULL AND vault_message_id IS NOT NULL) AS images`,
      )
      .bind(c.guild.id),
  ]);
  const q = (queue.results as { reports: number; images: number }[])[0];
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
  // Order 11: operator-only lines (the copy marker, test updates, raw errors, the backup token, platform usage) show
  // only in the dev copy (src/env.ts).
  const dev = isDevCopy(c.copy);
  const warningsText = (json: string | null) => {
    const n = warningsCount(json);
    return n === null ? 'warnings unreadable' : plural(n, 'warning');
  };
  const dry = (lastDryRun.results as { id: number; finished_at: string | null; started_at: string; warnings: string | null; real_id: number | null }[])[0];
  // A dry run newer than the last real import gets its own line; older ones are not shown.
  const dryLine =
    dev && dry && (dry.real_id === null || dry.id > dry.real_id)
      ? [`**Last test update:** ${when(dry.finished_at ?? dry.started_at)} (no changes saved) · ${warningsText(dry.warnings)}`]
      : [];
  const al = (alarmRow.results as { id: number; status: string; started_at: string; finished_at: string | null; error: string | null; real_id: number | null }[])[0];
  const alarmLine =
    al && (al.real_id === null || al.id > al.real_id)
      ? [`**Latest nightly run:** ${when(al.finished_at ?? al.started_at)} · **${al.status}**${failureText(al.error, dev)}`]
      : [];
  const lines = [
    '## GuildCraft status',
    // Order 10: which copy answered, so the operator can always tell the Dev app from production (dev only, order 11).
    ...(dev ? ['**Copy:** dev'] : []),
    `**Data version:** ${ok ? `\`${ok.source_version}\`` : 'no completed import yet'}`,
    `**Last data update:** ${last ? `${when(last.finished_at ?? last.started_at)} · ${warningsText(last.warnings)} · ${last.status}${failureText(last.error, dev)}` : 'none yet'}`,
    ...alarmLine,
    ...dryLine,
    c.guild.board_channel_id
      ? `**Roster board:** <#${c.guild.board_channel_id}> · ${b.posts} of ${b.skills} posts · last refresh ${when(b.refreshed)} · ${b.dirty} waiting to refresh`
      : '**Roster board:** not set up (`/guildcraft setup board:`)',
    ...(c.guild.board_channel_id ? [boardOrderLine(inOrder)] : []),
    `**Review channel:** ${c.guild.review_channel_id ? `<#${c.guild.review_channel_id}>` : 'not set (`/guildcraft setup review:`)'}`,
    `**Waiting for officers:** ${plural(q.reports, 'open report')} · ${plural(q.images, 'pending screenshot')}${c.guild.vault_channel_id ? ` in <#${c.guild.vault_channel_id}>` : ' (no vault channel: `/guildcraft setup vault:`)'}`,
    `**Departures:** ${plural(d?.left_members ?? 0, 'member')} marked as left · last nightly check ${when(d?.at)}${run ? ` · ${run.marked ?? 0} marked${run.stopped ? ` · note: ${run.stopped.slice(0, 200)}` : ''}` : ''}`,
    backupLine((backup.results as (BackupRow & { last_ok: string | null })[])[0], nowMs, dev),
    ...(dev ? usageLines(usage.results as unknown as UsageRow[], nowMs) : []),
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
      "For A→Z to show at the top, the forum's Default Sort Order must be Creation Time (Edit Channel).",
    ].join('\n'),
  );
}

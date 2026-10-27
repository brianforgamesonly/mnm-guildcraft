// Order 19 (ITEM 4): /guildcraft setup's Create GuildCraft channels button. It creates whichever of the channels are
// missing, inside a GuildCraft category, then saves them as setup's options do (saveSetup) and builds the boards.
// Order 19's explicit override 2 of order 5's "do not create channels": the bot creates its own channels, only when an
// admin presses this button. The session itself creates nothing; tests use a mocked Discord.
// Order 24 (ITEMs 3 and 4, explicit overrides 2-4): the layout is two forums and two text channels, named GC- plus what
// each holds; the vault is no longer created. Both forums get the GuildCraft emoji as their default reaction
// (src/emoji.ts), when they are created and, once, when a forum GuildCraft uses has none. No channel is ever renamed.
//
// Discord's rules (read 2026-10-22, docs.discord.com/developers/resources/guild and /channel):
//   Create Guild Channel: "Requires the MANAGE_CHANNELS permission. If setting permission overwrites, only permissions
//   your bot has in the guild can be allowed/denied."
//   Edit Channel Permissions: "Requires the MANAGE_ROLES permission. Only permissions your bot has in the guild or
//   parent channel (if applicable) can be allowed/denied."
// A forum needs Community (a Discord support-team reply on its support forum; the API docs do not say), so without the
// COMMUNITY feature the forum is not attempted.
import type { Ctx } from '../context.ts';
import { botApi, type BotApi } from '../board/api.ts';
import {
  ADMINISTRATOR, CREATE_PRIVATE_THREADS, ephemeral, GUILD_CATEGORY, GUILD_FORUM, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, READ_MESSAGE_HISTORY, SEND_MESSAGES,
  SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL, type MessageReply,
} from '../discord.ts';
import { EMOJI_COPY, ensureEmoji, mayNeedReaction, reactionOf, type DefaultReaction, type EmojiOutcome } from '../emoji.ts';
import { channelBits, PERMISSION_NAMES, type ChannelKind } from '../permissions.ts';
import { boardBuildLine, factionBuildLine, memberChannelBits, saveSetup, type Overwrite, type RoleBits, type Settings } from './setup.ts';

/** The category, named as typed (Discord keeps a category's capitals). */
export const CATEGORY_NAME = 'GuildCraft';

interface Planned {
  key: keyof Pick<Settings, 'board_channel_id' | 'faction_board_channel_id' | 'review_channel_id' | 'request_channel_id'>;
  kind: ChannelKind;
  name: string;
  type: number;
  /** Officers, admins and the bot only. */
  private: boolean;
  /** What it holds, one line in the reply. */
  purpose: string;
}

/**
 * The channels, in the order they are created. One pattern: GC- plus what the channel holds. Names as typed: Discord may
 * store text and forum names lower-cased.
 */
export const LAYOUT: Planned[] = [
  { key: 'board_channel_id', kind: 'board', name: 'GC-Tradeskills', type: GUILD_FORUM, private: false, purpose: 'the tradeskills board: one post per tradeskill, listing who can craft it' },
  { key: 'faction_board_channel_id', kind: 'factions', name: 'GC-Factions', type: GUILD_FORUM, private: false, purpose: 'the factions board: one post per faction, listing the creatures whose wiki page names it' },
  { key: 'request_channel_id', kind: 'requests', name: 'GC-Craft Requests', type: GUILD_TEXT, private: false, purpose: 'craft requests: one private thread per request' },
  { key: 'review_channel_id', kind: 'review', name: 'GC-Officer Review', type: GUILD_TEXT, private: true, purpose: 'officers only: member reports and departure notices' },
];

/** Sort Order Types: CREATION_DATE = 1 (order 6's A→Z board reads top-down only in creation order). */
export const FORUM_SORT_CREATION = 1;
/** Officers in a private channel: read it, answer in it. */
export const OFFICER_ALLOW = VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY;
/** How long a press holds the server's lease: past the deferred work's 30 seconds, so it never lapses mid-run. */
const LEASE_MS = 60_000;
/**
 * The calls one press may make (order 24, recounted): 4 reads, the emoji's list and create, the category, 4 channels, one
 * forum update per kept forum (its sort order and reaction together, 2) and one officer overwrite (1 private channel).
 */
export const CALL_CAP = 4 + 2 + 1 + LAYOUT.length + LAYOUT.filter((p) => p.type === GUILD_FORUM).length + LAYOUT.filter((p) => p.private).length + 1;
// (+1: the officer overwrite on a vault the order-19 button created, which this button no longer makes but still serves.)

/**
 * Who sees what, as overwrites (docs.discord.com/developers/topics/permissions, "Permission Overwrites"): @everyone (the
 * guild id), the officer role when set, and the bot's own member last, so a deny for @everyone never locks the bot out.
 * The bot's allows are what its routes need in that channel (src/permissions.ts channelBits), as setup checks.
 */
export function overwritesFor(p: Planned, guildId: string, botId: string, officerRoleId: string | null): Overwrite[] {
  const everyone: Overwrite = p.private
    ? { id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) }
    : // Everyone reads it and replies in threads; nobody but the bot starts a post or sends in the channel itself. In the
      // request channel members do not open private threads of their own either (review of PR B). Create Public Threads
      // is not denied: the bot does not hold it, so it may not set it (Create Guild Channel).
      {
        id: guildId,
        type: 0,
        allow: String(VIEW_CHANNEL | SEND_MESSAGES_IN_THREADS),
        deny: String(p.type === GUILD_TEXT ? SEND_MESSAGES | CREATE_PRIVATE_THREADS : SEND_MESSAGES),
      };
  const officer: Overwrite[] = p.private && officerRoleId ? [{ id: officerRoleId, type: 0, allow: String(OFFICER_ALLOW), deny: '0' }] : [];
  return [everyone, ...officer, { id: botId, type: 1, allow: String(channelBits(p.kind)), deny: '0' }];
}

/** Every bit the overwrites set, allowed or denied: the bot must hold each one in the server. */
export const BITS_SET = LAYOUT.reduce((b, p) => b | channelBits(p.kind), VIEW_CHANNEL | SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PRIVATE_THREADS | OFFICER_ALLOW);
/** What the button needs besides those: creating channels, and editing their overwrites later. (The emoji is optional.) */
export const BUTTON_NEEDS = MANAGE_CHANNELS | MANAGE_ROLES | BITS_SET;

/** The name Discord is expected to store for a text or forum channel (lower-cased, spaces as hyphens; unverified). */
export const storedName = (name: string) => name.toLowerCase().replace(/\s+/g, '-');
/** A channel matches a planned one by type and by name, as typed or as Discord stores it. */
const sameChannel = (ch: GuildChannel, p: { name: string; type: number }) =>
  ch.type === p.type && [p.name.toLowerCase(), storedName(p.name)].includes(ch.name.toLowerCase());

interface GuildChannel {
  id: string;
  type: number;
  name: string;
  parent_id?: string | null;
  default_sort_order?: number | null;
  default_reaction_emoji?: DefaultReaction | null;
  permission_overwrites?: Overwrite[];
}

export const CHANNELS_COPY = {
  busy: 'GuildCraft is already creating channels for this server. Wait a minute, then press the button again.',
  noToken: "Sorry, GuildCraft can't reach Discord right now. Nothing was changed; please try again.",
  unread: "Sorry, I couldn't read this server's channels and roles from Discord. Nothing was changed; please try again.",
  missing: (names: string[]) =>
    `Nothing was created. GuildCraft is missing **${names.join('**, **')}** in this server.\nGrant them to GuildCraft's role (Server Settings → Roles), or re-invite GuildCraft with the current install link (ask Joegandomi): servers that added GuildCraft before this button did not grant **Manage Channels** or **Manage Permissions**. Picking your own channels with \`/guildcraft setup\`'s options still works.`,
  created: (id: string, purpose: string) => `Created <#${id}>: ${purpose}.`,
  kept: (id: string, purpose: string) => `Kept <#${id}>: ${purpose}.`,
  failed: (name: string, status: number) => `Could not create **${name}** (Discord answered ${status || 'nothing'}). Press the button again to retry; nothing is duplicated.`,
  noCommunity: (name: string) => `**${name}** was not created: forum channels need **Community**. Turn it on (Server Settings → Enable Community), then press the button again.`,
  noOfficer: 'No officer role is set, so the new officer review channel is visible only to members with Administrator (and GuildCraft). Run `/guildcraft setup officer_role:`, then press **Create GuildCraft channels** on its reply to add the role to it.',
  officerAdded: (id: string) => `Added the officer role to <#${id}>.`,
  officerFailed: (id: string) => `Could not add the officer role to <#${id}>: add it in the channel's settings (Permissions).`,
  sorted: (id: string) => `Set <#${id}>'s default sort order to Creation Time, so the board reads A→Z.`,
  ...EMOJI_COPY,
  forumFailed: (id: string, status: number) => `Could not update <#${id}>'s sort order or reaction (Discord answered ${status || 'nothing'}). Press the button again to retry.`,
  nothing: 'Every GuildCraft channel already exists and is saved. Nothing was changed.',
  categoryFailed: (status: number) => `Could not create the **${CATEGORY_NAME}** category (Discord answered ${status || 'nothing'}). Nothing else was created; press the button again to retry.`,
};

/** gcc: (an admin's press; src/interactions.ts checks Administrator or Manage Server first). */
export async function createChannelsButton(c: Ctx): Promise<MessageReply> {
  if (!c.botToken || !c.applicationId) return ephemeral(CHANNELS_COPY.noToken);
  const now = Date.now();
  const lease = `${new Date(now + LEASE_MS).toISOString()}#${crypto.randomUUID().slice(0, 8)}`;
  const took = await c.db
    .prepare('UPDATE guild SET channel_setup_lock_until = ? WHERE id = ? AND (channel_setup_lock_until IS NULL OR channel_setup_lock_until < ?)')
    .bind(lease, c.guild.id, new Date(now).toISOString())
    .run();
  if (took.meta.changes !== 1) return ephemeral(CHANNELS_COPY.busy);
  // 10 s for new calls (each may run 10 s more), leaving the board run after it room inside waitUntil's 30 s.
  const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: CALL_CAP, deadline: now + 10_000 });
  try {
    return await createChannels(c, api, c.applicationId);
  } finally {
    c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
    await c.db.prepare('UPDATE guild SET channel_setup_lock_until = NULL WHERE id = ? AND channel_setup_lock_until = ?').bind(c.guild.id, lease).run();
  }
}

async function createChannels(c: Ctx, api: BotApi, botId: string): Promise<MessageReply> {
  const g = c.guild.id;
  const [guild, channels, roles, me] = await Promise.all([
    api.call<{ features?: string[] }>('GET', `/guilds/${g}`),
    api.call<GuildChannel[]>('GET', `/guilds/${g}/channels`),
    api.call<RoleBits[]>('GET', `/guilds/${g}/roles`),
    api.call<{ roles: string[] }>('GET', `/guilds/${g}/members/${botId}`),
  ]);
  if (!guild.ok || !channels.ok || !roles.ok || !me.ok) return ephemeral(CHANNELS_COPY.unread);
  // The bot's own server-wide permissions: roles only, no channel's overwrites.
  const held = memberChannelBits(g, roles.body, [], botId, me.body.roles);
  if ((held & ADMINISTRATOR) !== ADMINISTRATOR) {
    const missing = [...PERMISSION_NAMES].filter(([b]) => (BUTTON_NEEDS & b) === b && (held & b) !== b).map(([, n]) => n);
    if (missing.length) return ephemeral(CHANNELS_COPY.missing(missing));
  }
  const community = (guild.body.features ?? []).includes('COMMUNITY');
  const all = channels.body;
  const lines: string[] = [];
  const saved: { [K in Planned['key']]?: string } = {};
  let changed = false;
  /** A write that saves no setting: a forum's sort order or reaction, an officer overwrite. */
  let acted = false;
  let createdPrivate = false;

  let category = all.find((ch) => sameChannel(ch, { name: CATEGORY_NAME, type: GUILD_CATEGORY }));
  const existingOf = new Map(LAYOUT.map((p) => [p, findExisting(c, all, p, category?.id)]));
  const needsCategory = LAYOUT.some((p) => !existingOf.get(p) && (p.type !== GUILD_FORUM || community));

  // Order 24 (ITEM 3): the emoji first, so a forum created below carries it; only when a forum is to be created or has no reaction.
  const forumNeedsEmoji = LAYOUT.some((p) => p.type === GUILD_FORUM && (existingOf.get(p) ? mayNeedReaction(existingOf.get(p)!.default_reaction_emoji) : community));
  const emoji: EmojiOutcome | null = forumNeedsEmoji ? await ensureEmoji(api, g, held) : null;
  const emojiId = emoji && 'id' in emoji ? emoji.id : null;
  if (emoji && 'created' in emoji && emoji.created) lines.push(CHANNELS_COPY.emojiCreated);

  if (!category && needsCategory) {
    const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, { name: CATEGORY_NAME, type: GUILD_CATEGORY });
    if (!made.ok) {
      console.error('channel setup: category refused', JSON.stringify(api.log));
      // Review of PR B: an emoji added before the refusal is still reported.
      return ephemeral([...lines, CHANNELS_COPY.categoryFailed(made.status)].join('\n'));
    }
    category = made.body;
  }

  for (const p of LAYOUT) {
    const existing = existingOf.get(p) ?? findExisting(c, all, p, category?.id);
    if (existing) {
      lines.push(CHANNELS_COPY.kept(existing.id, p.purpose));
      if (c.guild[p.key] !== existing.id) {
        saved[p.key] = existing.id;
        changed = true;
      }
      if (p.type === GUILD_FORUM) {
        // Order 6's A→Z board needs the forum sorted by creation time; order 24 sets the reaction only where there is none.
        const sort = existing.default_sort_order !== FORUM_SORT_CREATION;
        const react = !!emojiId && mayNeedReaction(existing.default_reaction_emoji);
        if (sort || react) {
          const s = await api.call('PATCH', `/channels/${existing.id}`, {
            ...(sort ? { default_sort_order: FORUM_SORT_CREATION } : {}),
            ...(react ? { default_reaction_emoji: reactionOf(emojiId!) } : {}),
          });
          if (s.ok) {
            if (sort) lines.push(CHANNELS_COPY.sorted(existing.id));
            if (react) lines.push(CHANNELS_COPY.reaction(existing.id));
            acted = true;
          } else lines.push(CHANNELS_COPY.forumFailed(existing.id, s.status));
        }
      }
      // The officer role, added later to the private channels this button created (those in its category).
      if (p.private && c.guild.officer_role_id && category && existing.parent_id === category.id && !(existing.permission_overwrites ?? []).some((o) => o.id === c.guild.officer_role_id)) {
        const put = await api.call('PUT', `/channels/${existing.id}/permissions/${c.guild.officer_role_id}`, { type: 0, allow: String(OFFICER_ALLOW), deny: '0' });
        lines.push(put.ok ? CHANNELS_COPY.officerAdded(existing.id) : CHANNELS_COPY.officerFailed(existing.id));
        acted ||= put.ok;
      }
      continue;
    }
    if (p.type === GUILD_FORUM && !community) {
      lines.push(CHANNELS_COPY.noCommunity(p.name));
      continue;
    }
    const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, {
      name: p.name,
      type: p.type,
      parent_id: category!.id,
      permission_overwrites: overwritesFor(p, g, botId, c.guild.officer_role_id),
      ...(p.type === GUILD_FORUM ? { default_sort_order: FORUM_SORT_CREATION, ...(emojiId ? { default_reaction_emoji: reactionOf(emojiId) } : {}) } : {}),
    });
    if (!made.ok) {
      console.error('channel setup: create refused', p.kind, JSON.stringify(api.log.at(-1)));
      lines.push(CHANNELS_COPY.failed(p.name, made.status));
      continue;
    }
    lines.push(CHANNELS_COPY.created(made.body.id, p.purpose));
    saved[p.key] = made.body.id;
    changed = true;
    createdPrivate ||= p.private;
  }
  if (emoji && 'skipped' in emoji) lines.push(CHANNELS_COPY.emojiSkipped(emoji));
  // Review of PR B: a vault the order-19 button created (private, in the category) still gets the officer role later.
  const vault = c.guild.vault_channel_id ? all.find((ch) => ch.id === c.guild.vault_channel_id) : undefined;
  if (vault && category && vault.parent_id === category.id && c.guild.officer_role_id && !(vault.permission_overwrites ?? []).some((o) => o.id === c.guild.officer_role_id)) {
    const put = await api.call('PUT', `/channels/${vault.id}/permissions/${c.guild.officer_role_id}`, { type: 0, allow: String(OFFICER_ALLOW), deny: '0' });
    lines.push(put.ok ? CHANNELS_COPY.officerAdded(vault.id) : CHANNELS_COPY.officerFailed(vault.id));
    acted ||= put.ok;
  }

  if (!changed) return ephemeral([...lines, ...(acted ? [] : [CHANNELS_COPY.nothing])].join('\n'));
  const { skills, posts, factionCount, factionPosts } = await saveSetup(c, saved);
  // Both boards start building after the reply (tradeskills first); the sweep finishes what one run cannot (order 19).
  if (saved.board_channel_id) {
    c.effects.board = true;
    lines.push(boardBuildLine(skills, posts));
  }
  if (saved.faction_board_channel_id) {
    c.effects.factions = true;
    lines.push(factionBuildLine(factionCount, factionPosts));
  }
  if (createdPrivate && !c.guild.officer_role_id) lines.push(CHANNELS_COPY.noOfficer);
  return ephemeral(lines.join('\n'));
}

/**
 * A saved channel that still exists, else one of the planned type and name inside the GuildCraft category. A channel of
 * that name elsewhere is not adopted (review of PR B): setup's options, with their checks, are the way to pick it.
 */
function findExisting(c: Ctx, all: GuildChannel[], p: Planned, categoryId: string | undefined): GuildChannel | undefined {
  const savedId = c.guild[p.key];
  const saved = savedId ? all.find((ch) => ch.id === savedId) : undefined;
  if (saved) return saved;
  return categoryId ? all.find((ch) => ch.parent_id === categoryId && sameChannel(ch, p)) : undefined;
}

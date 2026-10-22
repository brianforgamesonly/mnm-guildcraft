// Order 19 (ITEM 4): /guildcraft setup's Create GuildCraft channels button. It creates whichever of the four channels
// are missing, inside a GuildCraft category, then saves them as setup's options do (saveSetup) and builds the board.
// Order 19's explicit override 2 of order 5's "do not create channels": the bot creates its own channels, only when an
// admin presses this button. The session itself creates nothing; tests use a mocked Discord.
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
  ADMINISTRATOR, ephemeral, GUILD_CATEGORY, GUILD_FORUM, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, READ_MESSAGE_HISTORY, SEND_MESSAGES,
  SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL, type MessageReply,
} from '../discord.ts';
import { channelBits, PERMISSION_NAMES, type ChannelKind } from '../permissions.ts';
import { boardBuildLine, memberChannelBits, saveSetup, type Overwrite, type RoleBits, type Settings } from './setup.ts';

/** The category, named as typed (Discord keeps a category's capitals). */
export const CATEGORY_NAME = 'GuildCraft';

interface Planned {
  key: keyof Pick<Settings, 'board_channel_id' | 'review_channel_id' | 'vault_channel_id' | 'request_channel_id'>;
  kind: ChannelKind;
  name: string;
  type: number;
  /** Officers, admins and the bot only. */
  private: boolean;
}

/** The four channels, in the order they are created. Names as typed: Discord may store text and forum names lower-cased. */
export const LAYOUT: Planned[] = [
  { key: 'board_channel_id', kind: 'board', name: 'GC-Crafting Roster', type: GUILD_FORUM, private: false },
  { key: 'review_channel_id', kind: 'review', name: 'GC-Officer Review', type: GUILD_TEXT, private: true },
  { key: 'vault_channel_id', kind: 'vault', name: 'GC-Item Vault', type: GUILD_TEXT, private: true },
  { key: 'request_channel_id', kind: 'requests', name: 'GC-Craft Requests', type: GUILD_TEXT, private: false },
];

/** Sort Order Types: CREATION_DATE = 1 (order 6's A→Z board reads top-down only in creation order). */
export const FORUM_SORT_CREATION = 1;
/** Officers in a private channel: read it, answer in it. */
export const OFFICER_ALLOW = VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY;
/** How long a press holds the server's lease: past the deferred work's 30 seconds, so it never lapses mid-run. */
const LEASE_MS = 60_000;
/** The calls one press may make: 4 reads, the category, 4 channels, a sort order and up to 2 officer overwrites. */
const CALL_CAP = 14;

/**
 * Who sees what, as overwrites (docs.discord.com/developers/topics/permissions, "Permission Overwrites"): @everyone (the
 * guild id), the officer role when set, and the bot's own member last, so a deny for @everyone never locks the bot out.
 * The bot's allows are what its routes need in that channel (src/permissions.ts channelBits), as setup checks.
 */
export function overwritesFor(p: Planned, guildId: string, botId: string, officerRoleId: string | null): Overwrite[] {
  const everyone: Overwrite = p.private
    ? { id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) }
    : // Everyone reads it and replies in threads; nobody but the bot starts a post or sends in the channel itself.
      { id: guildId, type: 0, allow: String(VIEW_CHANNEL | SEND_MESSAGES_IN_THREADS), deny: String(SEND_MESSAGES) };
  const officer: Overwrite[] = p.private && officerRoleId ? [{ id: officerRoleId, type: 0, allow: String(OFFICER_ALLOW), deny: '0' }] : [];
  return [everyone, ...officer, { id: botId, type: 1, allow: String(channelBits(p.kind)), deny: '0' }];
}

/** Every bit the overwrites set, allowed or denied: the bot must hold each one in the server. */
export const BITS_SET = LAYOUT.reduce((b, p) => b | channelBits(p.kind), VIEW_CHANNEL | SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | OFFICER_ALLOW);
/** What the button needs besides those: creating channels, and editing their overwrites later. */
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
  permission_overwrites?: Overwrite[];
}

export const CHANNELS_COPY = {
  busy: 'GuildCraft is already creating channels for this server. Wait a minute, then press the button again.',
  noToken: "Sorry, GuildCraft can't reach Discord right now. Nothing was changed; please try again.",
  unread: "Sorry, I couldn't read this server's channels and roles from Discord. Nothing was changed; please try again.",
  missing: (names: string[]) =>
    `Nothing was created. GuildCraft is missing **${names.join('**, **')}** in this server.\nGrant them to GuildCraft's role (Server Settings → Roles), or re-invite GuildCraft with the current install link (ask Joegandomi): servers that added GuildCraft before this button did not grant **Manage Channels** or **Manage Permissions**. Picking your own channels with \`/guildcraft setup\`'s options still works.`,
  created: (id: string, what: string) => `Created <#${id}> (${what}).`,
  kept: (id: string, what: string) => `Kept <#${id}> (${what}): it already exists.`,
  failed: (name: string, status: number) => `Could not create **${name}** (Discord answered ${status || 'nothing'}). Press the button again to retry; nothing is duplicated.`,
  noCommunity: (name: string) =>
    `**${name}** (the roster board) was not created: forum channels need **Community**. Turn it on (Server Settings → Enable Community), then press the button again.`,
  noOfficer: 'No officer role is set, so the review and vault channels are visible to admins only. Run `/guildcraft setup officer_role:`, then press the button again to add the role to them.',
  officerAdded: (id: string) => `Added the officer role to <#${id}>.`,
  officerFailed: (id: string) => `Could not add the officer role to <#${id}>: add it in the channel's settings (Permissions).`,
  sorted: (id: string) => `Set <#${id}>'s default sort order to Creation Time, so the board reads A→Z.`,
  nothing: 'Every GuildCraft channel already exists and is saved. Nothing was changed.',
  categoryFailed: (status: number) => `Could not create the **${CATEGORY_NAME}** category (Discord answered ${status || 'nothing'}). Nothing else was created; press the button again to retry.`,
};

const what = (p: Planned) => (p.type === GUILD_FORUM ? 'forum' : p.private ? 'private text channel' : 'text channel');

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
  const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: CALL_CAP, deadline: now + 20_000 });
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
  /** A write that saves no setting: a forum's sort order, an officer overwrite. */
  let acted = false;

  let category = all.find((ch) => sameChannel(ch, { name: CATEGORY_NAME, type: GUILD_CATEGORY }));
  const needsCategory = LAYOUT.some((p) => !findExisting(c, all, p, undefined) && (p.type !== GUILD_FORUM || community));
  if (!category && needsCategory) {
    const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, { name: CATEGORY_NAME, type: GUILD_CATEGORY });
    if (!made.ok) {
      console.error('channel setup: category refused', JSON.stringify(api.log));
      return ephemeral(CHANNELS_COPY.categoryFailed(made.status));
    }
    category = made.body;
  }

  for (const p of LAYOUT) {
    const existing = findExisting(c, all, p, category?.id);
    if (existing) {
      lines.push(CHANNELS_COPY.kept(existing.id, what(p)));
      if (c.guild[p.key] !== existing.id) {
        saved[p.key] = existing.id;
        changed = true;
      }
      // Order 6's A→Z board needs the forum sorted by creation time.
      if (p.type === GUILD_FORUM && existing.default_sort_order !== FORUM_SORT_CREATION) {
        const s = await api.call('PATCH', `/channels/${existing.id}`, { default_sort_order: FORUM_SORT_CREATION });
        if (s.ok) {
          lines.push(CHANNELS_COPY.sorted(existing.id));
          acted = true;
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
      ...(p.type === GUILD_FORUM ? { default_sort_order: FORUM_SORT_CREATION } : {}),
    });
    if (!made.ok) {
      console.error('channel setup: create refused', p.kind, JSON.stringify(api.log.at(-1)));
      lines.push(CHANNELS_COPY.failed(p.name, made.status));
      continue;
    }
    lines.push(CHANNELS_COPY.created(made.body.id, what(p)));
    saved[p.key] = made.body.id;
    changed = true;
  }

  if (!changed) return ephemeral([...lines, ...(acted ? [] : [CHANNELS_COPY.nothing])].join('\n'));
  const { skills, posts } = await saveSetup(c, saved);
  if (saved.board_channel_id) {
    c.effects.board = true;
    lines.push(boardBuildLine(skills, posts));
  }
  if (!c.guild.officer_role_id) lines.push(CHANNELS_COPY.noOfficer);
  return ephemeral(lines.join('\n'));
}

/** A saved channel that still exists, else one of the planned type and name (in the category first). */
function findExisting(c: Ctx, all: GuildChannel[], p: Planned, categoryId: string | undefined): GuildChannel | undefined {
  const savedId = c.guild[p.key];
  const saved = savedId ? all.find((ch) => ch.id === savedId) : undefined;
  if (saved) return saved;
  const named = all.filter((ch) => sameChannel(ch, p));
  return named.find((ch) => categoryId && ch.parent_id === categoryId) ?? named[0];
}

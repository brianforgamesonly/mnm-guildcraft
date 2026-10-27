// Order 24 (ITEM 3): the GuildCraft emoji, the default reaction on the forums GuildCraft uses.
//
// Discord (read 2026-10-27, docs.discord.com/developers/resources/channel and /emoji): a forum's default reaction is a
// Default Reaction object, "Exactly one of emoji_id and emoji_name must be set"; emoji_id is "the id of a guild's custom
// emoji". So it is a server's own emoji (an application emoji is not a guild's), created with Create Guild Emoji: "Requires
// the CREATE_GUILD_EXPRESSIONS permission", "the 128x128 emoji image", "a maximum file size of 256 KiB". Order 24's
// explicit override 4: one emoji per server, named guildcraft, created once and reused.
import type { BotApi } from './board/api.ts';
import { ADMINISTRATOR, CREATE_GUILD_EXPRESSIONS } from './discord.ts';
import { EMOJI_IMAGE } from './emoji-image.ts';

export const EMOJI_NAME = 'guildcraft';
/** Discord's JSON error "Maximum number of emojis reached" (topics/opcodes-and-status-codes). */
export const MAX_EMOJIS = 30008;
const MISSING_PERMISSIONS = 50013;

export type EmojiOutcome = { id: string; created: boolean } | { skipped: 'permission' | 'slots' | 'failed'; status?: number };

/** The setup replies' lines about the emoji (docs/COPY.md). */
export const EMOJI_COPY = {
  reaction: (id: string) => `Set <#${id}>'s default reaction to the GuildCraft emoji.`,
  emojiCreated: "Added the **guildcraft** emoji to this server: it is the default reaction on GuildCraft's forums.",
  emojiSkipped: (why: EmojiOutcome) =>
    'skipped' in why
      ? why.skipped === 'permission'
        ? "The forums keep their default reaction: GuildCraft can't add its emoji here without **Create Expressions**. Grant it to GuildCraft's role (Server Settings → Roles), or re-invite GuildCraft with the current install link (ask Joegandomi), then press the button again."
        : why.skipped === 'slots'
          ? 'The forums keep their default reaction: this server has no free emoji slot for the GuildCraft emoji. Free one (Server Settings → Emoji), then press the button again.'
          : `The forums keep their default reaction: Discord refused the GuildCraft emoji (${why.status || 'no answer'}). Press the button again to retry.`
      : '',
};

/** The server's guildcraft emoji: the one it already has, else a new one. Never a second one. Two calls at most. */
export async function ensureEmoji(api: BotApi, guildId: string, held: bigint): Promise<EmojiOutcome> {
  const list = await api.call<{ id: string; name: string | null }[]>('GET', `/guilds/${guildId}/emojis`);
  const found = list.ok ? list.body.find((e) => e.name === EMOJI_NAME) : undefined;
  if (found) return { id: found.id, created: false };
  const can = (held & ADMINISTRATOR) === ADMINISTRATOR || (held & CREATE_GUILD_EXPRESSIONS) === CREATE_GUILD_EXPRESSIONS;
  if (!can) return { skipped: 'permission' };
  if (!list.ok) return { skipped: 'failed', status: list.status };
  const made = await api.call<{ id: string }>('POST', `/guilds/${guildId}/emojis`, { name: EMOJI_NAME, image: EMOJI_IMAGE, roles: [] });
  if (made.ok) return { id: made.body.id, created: true };
  if (made.code === MAX_EMOJIS) return { skipped: 'slots' };
  if (made.status === 403 || made.code === MISSING_PERMISSIONS) return { skipped: 'permission' };
  return { skipped: 'failed', status: made.status };
}

/** A forum's default reaction as Discord holds it. */
export interface DefaultReaction {
  emoji_id: string | null;
  emoji_name: string | null;
}
export const reactionOf = (emojiId: string): DefaultReaction => ({ emoji_id: emojiId, emoji_name: null });
/** Whether to set it: only when the forum has none, so a reaction a server chose is left alone. */
export const mayNeedReaction = (current: DefaultReaction | null | undefined): boolean => !current || (!current.emoji_id && !current.emoji_name);
// Search and roster replies (/craft find, /roster ...): private by default, with a Post to channel button
// that re-posts the same content publicly (PRD FR-3). The operator's open question A6 may flip the default:
// SEARCH_REPLIES_PRIVATE is the single setting.
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';
import { button, publicReply, row, type MessageData, type MessageReply } from '../discord.ts';

export const SEARCH_REPLIES_PRIVATE = true;

/** custom_id prefix of every Post to channel button: "pub:<what to re-render>". */
export const POST_PREFIX = 'pub:';
export const postButton = (what: string) => button(`${POST_PREFIX}${what}`, 'Post to channel');

/**
 * A search reply. `extraRows` are the action rows a private reply carries (paging, switchers); `links`
 * are link buttons, kept on both the private reply and the public post. `postBeside` (order 17b: /zone, whose links
 * fill a row of five) puts Post to channel in a row of its own with those buttons, after the links.
 */
export function searchReply(data: Omit<MessageData, 'flags' | 'components'>, post: string, links: unknown[] = [], extraRows: unknown[] = [], postBeside?: unknown[]): MessageReply {
  if (!SEARCH_REPLIES_PRIVATE) return publicReply({ ...data, components: links.length ? [row(links)] : [] });
  const rows = postBeside ? [...(links.length ? [row(links)] : []), row([postButton(post), ...postBeside])] : [row([postButton(post), ...links])];
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { ...data, components: [...rows, ...extraRows], flags: InteractionResponseFlags.EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

/**
 * The public copy: same content, link buttons, and who shared it (a mention that never pings). `actionRows`
 * (order 9: /craft find's buttons) are buttons any viewer may press; each press answers that viewer privately.
 */
export function postedReply(data: Omit<MessageData, 'flags' | 'components'>, userId: string, links: unknown[] = [], actionRows: unknown[] = []): MessageReply {
  const by = `-# Shared by <@${userId}>`;
  return publicReply({ ...data, content: data.content ? `${data.content}\n${by}` : by, components: [...(links.length ? [row(links)] : []), ...actionRows] });
}

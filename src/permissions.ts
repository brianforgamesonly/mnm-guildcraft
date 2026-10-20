// Every Discord API route the Worker and the jobs call with the bot token, and the permission each needs (order 10,
// ITEM 3). The install link's permissions (docs/LAUNCH-GUIDE.md) and /guildcraft setup's per-channel checks are both
// derived from this one table, so they cannot drift apart. scripts/ci/routes.test.ts reads the code and fails when a
// route the code calls is missing here, or a route here is no longer called.
//
// Sources, per route (docs.discord.com/developers/resources/...; read 2026-10-20). Threads "inherit permissions from
// the parent channel", except that SEND_MESSAGES is not inherited (SEND_MESSAGES_IN_THREADS instead); VIEW_CHANNEL is
// needed to see a channel or any thread in it (topics/permissions). EMBED_LINKS: Discord's table describes it only as
// auto-embedding links; it is listed where the bot's own posts are embeds, as /guildcraft setup has required since
// order 5 (whether a bot's embeds need it is unverified either way).
import { ATTACH_FILES, EMBED_LINKS, MANAGE_THREADS, READ_MESSAGE_HISTORY, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL } from './discord.ts';

/** The channel a route acts in: one /guildcraft setup checks, or none (guild-level and application routes). */
export type ChannelKind = 'board' | 'review' | 'vault';

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** The path with every variable part written {} (no query string). */
  path: string;
  channel: ChannelKind | null;
  needs: bigint[];
  /** Why GuildCraft calls it, and Discord's requirement. */
  why: string;
}

export const ROUTES: Route[] = [
  { method: 'GET', path: '/guilds/{}/threads/active', channel: null, needs: [], why: 'board: find the open board posts (List Active Guild Threads: no permission stated)' },
  { method: 'GET', path: '/channels/{}/threads/archived/public', channel: 'board', needs: [VIEW_CHANNEL, READ_MESSAGE_HISTORY], why: 'board: find archived board posts ("Requires the READ_MESSAGE_HISTORY permission")' },
  { method: 'POST', path: '/channels/{}/threads', channel: 'board', needs: [VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS], why: 'board: create a post in the forum ("must have the SEND_MESSAGES permission (CREATE_PUBLIC_THREADS is ignored)")' },
  { method: 'POST', path: '/channels/{}/messages', channel: 'board', needs: [VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS, EMBED_LINKS], why: 'board: overflow messages inside a post (threads need SEND_MESSAGES_IN_THREADS)' },
  { method: 'POST', path: '/channels/{}/messages', channel: 'review', needs: [VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS], why: 'review: departure notices, report cards, usage warnings (Create Message: "must have the SEND_MESSAGES permission")' },
  { method: 'POST', path: '/channels/{}/messages', channel: 'vault', needs: [VIEW_CHANNEL, SEND_MESSAGES, ATTACH_FILES], why: 'vault: re-post a screenshot as a file (ATTACH_FILES: "uploading images and files")' },
  { method: 'PATCH', path: '/channels/{}/messages/{}', channel: 'board', needs: [VIEW_CHANNEL], why: 'board: edit its own posts ("can be edited by the original message author")' },
  { method: 'DELETE', path: '/channels/{}/messages/{}', channel: 'board', needs: [VIEW_CHANNEL], why: 'board: remove its own overflow messages (MANAGE_MESSAGES only for others\' messages)' },
  { method: 'DELETE', path: '/channels/{}/messages/{}', channel: 'vault', needs: [VIEW_CHANNEL], why: 'vault: remove its own rejected screenshot post' },
  { method: 'GET', path: '/channels/{}/messages/{}', channel: 'board', needs: [VIEW_CHANNEL, READ_MESSAGE_HISTORY], why: 'board job: read a post back ("requires ... VIEW_CHANNEL and READ_MESSAGE_HISTORY")' },
  { method: 'GET', path: '/channels/{}/messages/{}', channel: 'vault', needs: [VIEW_CHANNEL, READ_MESSAGE_HISTORY], why: 'vault: read a screenshot back for a fresh link (same requirement)' },
  { method: 'PATCH', path: '/channels/{}', channel: 'board', needs: [VIEW_CHANNEL, MANAGE_THREADS], why: 'board: unarchive posts, set auto-archive, pin the index (Modify Channel: MANAGE_THREADS, or SEND_MESSAGES for unarchive only)' },
  { method: 'DELETE', path: '/channels/{}', channel: 'board', needs: [VIEW_CHANNEL, MANAGE_THREADS], why: 'board rebuild: delete its old posts ("MANAGE_THREADS if the channel is a thread")' },
  { method: 'GET', path: '/channels/{}', channel: null, needs: [], why: 'setup: read a channel to compute permissions (Get Channel: no permission stated)' },
  { method: 'GET', path: '/guilds/{}/roles', channel: null, needs: [], why: 'setup: roles, to compute permissions (no permission stated)' },
  { method: 'GET', path: '/guilds/{}/members/{}', channel: null, needs: [], why: 'setup: the bot\'s own roles (Get Guild Member: no permission stated)' },
  { method: 'GET', path: '/guilds/{}/members', channel: null, needs: [], why: 'departures: who is still in the server ("requires the GUILD_MEMBERS Privileged Intent"; the Server Members intent, not a permission)' },
  { method: 'GET', path: '/guilds/{}', channel: null, needs: [], why: 'the server\'s name (Get Guild: no permission stated)' },
];

/** Discord's settings names for the bits the routes use. */
export const PERMISSION_NAMES = new Map<bigint, string>([
  [VIEW_CHANNEL, 'View Channel'],
  [SEND_MESSAGES, 'Send Messages (in a forum: Create Posts)'],
  [SEND_MESSAGES_IN_THREADS, 'Send Messages in Threads (Send Messages in Posts)'],
  [EMBED_LINKS, 'Embed Links'],
  [ATTACH_FILES, 'Attach Files'],
  [READ_MESSAGE_HISTORY, 'Read Message History'],
  [MANAGE_THREADS, 'Manage Threads (Manage Posts, to pin the index)'],
]);

const union = (rs: Route[]) => rs.reduce((b, r) => r.needs.reduce((x, n) => x | n, b), 0n);
/** The install link's permissions: every route's needs together. */
export const INSTALL_PERMISSIONS = union(ROUTES);
/** What /guildcraft setup checks in one channel: the needs of the routes that act in it, by name, in bit order. */
export const channelPermissions = (kind: ChannelKind): [bigint, string][] => {
  const bits = union(ROUTES.filter((r) => r.channel === kind));
  return [...PERMISSION_NAMES].filter(([b]) => (bits & b) === b);
};

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
import { ATTACH_FILES, CREATE_PRIVATE_THREADS, EMBED_LINKS, MANAGE_CHANNELS, MANAGE_ROLES, MANAGE_THREADS, READ_MESSAGE_HISTORY, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, VIEW_CHANNEL } from './discord.ts';

/** The channel a route acts in: one /guildcraft setup checks, or none (guild-level and application routes). */
export type ChannelKind = 'board' | 'review' | 'vault' | 'requests';

export interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
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
  { method: 'POST', path: '/channels/{}/messages', channel: 'review', needs: [VIEW_CHANNEL, SEND_MESSAGES, EMBED_LINKS], why: 'review: departure notices, report cards, and the dev copy\'s usage warnings (Create Message: "must have the SEND_MESSAGES permission")' },
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
  // Order 16: craft requests, one private thread each in the request channel (read 2026-10-21).
  { method: 'POST', path: '/channels/{}/threads', channel: 'requests', needs: [VIEW_CHANNEL, CREATE_PRIVATE_THREADS], why: 'requests: create a private thread (type 12; CREATE_PRIVATE_THREADS "Allows for creating private threads")' },
  { method: 'PUT', path: '/channels/{}/thread-members/{}', channel: 'requests', needs: [VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS], why: 'requests: add the requester and crafters (Add Thread Member: "Requires the ability to send messages in the thread")' },
  { method: 'POST', path: '/channels/{}/messages', channel: 'requests', needs: [VIEW_CHANNEL, SEND_MESSAGES_IN_THREADS], why: 'requests: the first message and the claim, done and cancel notices (threads need SEND_MESSAGES_IN_THREADS)' },
  { method: 'PATCH', path: '/channels/{}/messages/{}', channel: 'requests', needs: [VIEW_CHANNEL, READ_MESSAGE_HISTORY], why: 'requests: edit its own first message (status); Read Message History so the thread\'s earlier messages stay readable to the bot (required by order 16; whether an edit needs it is unverified)' },
  { method: 'PATCH', path: '/channels/{}', channel: 'requests', needs: [VIEW_CHANNEL, MANAGE_THREADS], why: 'requests: rename, lock, archive and unarchive its threads ("requires MANAGE_THREADS or that the current user is the thread creator"; lock needs MANAGE_THREADS)' },
  // Order 19 (ITEM 4): Create GuildCraft channels (read 2026-10-22). Overwrites: "only permissions your bot has in the
  // guild can be allowed/denied" (Create Guild Channel), so every bit it sets is one the install link asks for.
  { method: 'GET', path: '/guilds/{}/channels', channel: null, needs: [], why: 'channel setup: the channels that already exist, to reuse them (Get Guild Channels: no permission stated)' },
  { method: 'POST', path: '/guilds/{}/channels', channel: null, needs: [MANAGE_CHANNELS], why: 'channel setup: create the category and its channels, with their overwrites (Create Guild Channel: "Requires the MANAGE_CHANNELS permission")' },
  { method: 'PATCH', path: '/channels/{}', channel: null, needs: [MANAGE_CHANNELS], why: 'channel setup: a reused forum\'s default sort order (Modify Channel: "Requires the MANAGE_CHANNELS permission for the guild")' },
  { method: 'PUT', path: '/channels/{}/permissions/{}', channel: null, needs: [MANAGE_ROLES], why: 'channel setup: add the officer role to its private channels later (Edit Channel Permissions: "Requires the MANAGE_ROLES permission")' },
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
  [CREATE_PRIVATE_THREADS, 'Create Private Threads'],
  [MANAGE_CHANNELS, 'Manage Channels'],
  [MANAGE_ROLES, 'Manage Permissions (Manage Roles)'],
]);

const union = (rs: Route[]) => rs.reduce((b, r) => r.needs.reduce((x, n) => x | n, b), 0n);
/** The install link's permissions: every route's needs together. */
export const INSTALL_PERMISSIONS = union(ROUTES);
/** The bits the routes acting in one channel need: what setup checks there, and (order 19) what the bot allows itself there. */
export const channelBits = (kind: ChannelKind): bigint => union(ROUTES.filter((r) => r.channel === kind));
/** What /guildcraft setup checks in one channel: the needs of the routes that act in it, by name, in bit order. */
export const channelPermissions = (kind: ChannelKind): [bigint, string][] => {
  const bits = channelBits(kind);
  return [...PERMISSION_NAMES].filter(([b]) => (bits & b) === b);
};

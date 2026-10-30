// Order 27 (ITEM 1): /guildcraft setup's Add DKP and Remove DKP buttons (admins; src/interactions.ts checks first).
// Order 27's override 1 of order 5's "The session never creates channels or posts on the owner's server" (as extended by
// orders 7, 9, 16, 19 and 24): Add DKP creates one text channel, GC-DKP, with its overwrites (overwritesFor's text
// branch: everyone views and reads; Send Messages and Create Private Threads denied; the bot's member gets
// channelBits('dkp')), inside the GuildCraft category (created first when missing, as Create GuildCraft channels does);
// it creates /dkp on this server and posts the standings. A second press duplicates nothing. Remove DKP deletes /dkp,
// marks DKP off and closes an open raid; GC-DKP and every DKP row stay.
//
// Discord (read 2026-10-29, docs.discord.com/developers/interactions/application-commands):
//   Create Guild Application Command: "Creating a command with the same name as an existing command for your application
//   will overwrite the old command." "Returns 201 if a command with the same name does not already exist, or a 200 if it
//   does". "There is a global rate limit of 200 application command creates per day, per guild".
//   Delete Guild Application Command: "Returns 204 No Content on success."
import { audit, now } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import { CATEGORY_NAME, CHANNELS_COPY, LEASE_MS, overwritesFor, sameChannel, type GuildChannel } from '../commands/channels.ts';
import { memberChannelBits, type RoleBits } from '../commands/setup.ts';
import type { Ctx } from '../context.ts';
import {
  ADMINISTRATOR, button, CREATE_PRIVATE_THREADS, ephemeral, GUILD_CATEGORY, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, row, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, STYLE_DANGER, STYLE_PRIMARY,
  VIEW_CHANNEL, type MessageReply,
} from '../discord.ts';
import { channelBits, PERMISSION_NAMES } from '../permissions.ts';
import { DKP_COPY } from './copy.ts';
import { DKP_COMMAND } from './definition.ts';
import { POOL_GUILD } from './ledger.ts';
import { refreshStandings } from './messages.ts';
import { showRemoved, standbyPayouts } from './raid.ts';
import { cancelAllStatement, showCancelled } from './auction.ts';
import { loadDkp } from './state.ts';

export const ADD_DKP_PREFIX = 'dkpadd:';
export const REMOVE_DKP_PREFIX = 'dkprm:';
export const DKP_CHANNEL_NAME = 'GC-DKP';
const PLAN = { kind: 'dkp', type: GUILD_TEXT, private: false } as const;
/**
 * What Add DKP needs: creating the channel and its overwrites (Manage Channels, Manage Roles, as Create GuildCraft
 * channels' BUTTON_NEEDS), and every bit GC-DKP's overwrites allow or deny ("only permissions your bot has in the guild can
 * be allowed/denied"). Refused with Create GuildCraft channels' own text (CHANNELS_COPY.missing).
 */
export const DKP_NEEDS = MANAGE_CHANNELS | MANAGE_ROLES | VIEW_CHANNEL | SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PRIVATE_THREADS | channelBits('dkp');
/**
 * 4 reads, the category, the channel, the command, and the standings (the guild pool and each pool already used, up to 8).
 * Order 29: Remove DKP also edits each open auction's card (up to 8; a ninth stays as it was, its buttons answering "off").
 */
export const DKP_CALL_CAP = 4 + 1 + 1 + 1 + 8 + 8;

/** The setup reply's DKP row: Add DKP while it is off, Remove DKP while it is on. */
export const dkpButtons = (enabled: boolean) => row([enabled ? button(REMOVE_DKP_PREFIX, DKP_COPY.removeLabel, STYLE_DANGER) : button(ADD_DKP_PREFIX, DKP_COPY.addLabel, STYLE_PRIMARY)]);

async function withLease(c: Ctx, run: (api: BotApi) => Promise<MessageReply>): Promise<MessageReply> {
  if (!c.botToken || !c.applicationId) return ephemeral(CHANNELS_COPY.noToken);
  const at = Date.now();
  const lease = `${new Date(at + LEASE_MS).toISOString()}#${crypto.randomUUID().slice(0, 8)}`;
  // The same lease as Create GuildCraft channels: both create channels in the GuildCraft category.
  const took = await c.db
    .prepare('UPDATE guild SET channel_setup_lock_until = ? WHERE id = ? AND (channel_setup_lock_until IS NULL OR channel_setup_lock_until < ?)')
    .bind(lease, c.guild.id, new Date(at).toISOString())
    .run();
  if (took.meta.changes !== 1) return ephemeral(CHANNELS_COPY.busy);
  const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: DKP_CALL_CAP, deadline: at + 10_000 });
  try {
    return await run(api);
  } finally {
    c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
    await c.db.prepare('UPDATE guild SET channel_setup_lock_until = NULL WHERE id = ? AND channel_setup_lock_until = ?').bind(c.guild.id, lease).run();
  }
}

/** dkpadd: */
export const addDkpButton = (c: Ctx): Promise<MessageReply> => withLease(c, (api) => addDkp(c, api, c.applicationId!));

async function addDkp(c: Ctx, api: BotApi, appId: string): Promise<MessageReply> {
  const g = c.guild.id;
  const state = await loadDkp(c.db, g);
  const [channels, roles, me] = await Promise.all([
    api.call<GuildChannel[]>('GET', `/guilds/${g}/channels`),
    api.call<RoleBits[]>('GET', `/guilds/${g}/roles`),
    api.call<{ roles: string[] }>('GET', `/guilds/${g}/members/${appId}`),
  ]);
  if (!channels.ok || !roles.ok || !me.ok) return ephemeral(CHANNELS_COPY.unread);
  const held = memberChannelBits(g, roles.body, [], appId, me.body.roles);
  if ((held & ADMINISTRATOR) !== ADMINISTRATOR) {
    const missing = [...PERMISSION_NAMES].filter(([b]) => (DKP_NEEDS & b) === b && (held & b) !== b).map(([, n]) => n);
    if (missing.length) return ephemeral(CHANNELS_COPY.missing(missing));
  }
  const lines: string[] = [];
  const all = channels.body;
  let category = all.find((ch) => sameChannel(ch, { name: CATEGORY_NAME, type: GUILD_CATEGORY }));
  // The saved GC-DKP while it exists, else one of that name inside the GuildCraft category.
  let channel = (state.channel_id ? all.find((ch) => ch.id === state.channel_id) : undefined) ?? (category ? all.find((ch) => ch.parent_id === category!.id && sameChannel(ch, { name: DKP_CHANNEL_NAME, type: GUILD_TEXT })) : undefined);
  if (channel) lines.push(DKP_COPY.kept(channel.id));
  else {
    if (!category) {
      const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, { name: CATEGORY_NAME, type: GUILD_CATEGORY });
      if (!made.ok) return ephemeral(CHANNELS_COPY.categoryFailed(made.status));
      category = made.body;
    }
    const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, {
      name: DKP_CHANNEL_NAME,
      type: GUILD_TEXT,
      parent_id: category.id,
      permission_overwrites: overwritesFor(PLAN, g, appId, c.guild.officer_role_id),
    });
    if (!made.ok) return ephemeral(DKP_COPY.channelFailed(made.status));
    channel = made.body;
    lines.push(DKP_COPY.created(channel.id));
  }
  const cmd = await api.call<{ id: string }>('POST', `/applications/${appId}/guilds/${g}/commands`, DKP_COMMAND);
  if (!cmd.ok) {
    // The channel is saved (DKP stays off), so a retry keeps it.
    await saveState(c, { enabled: 0, channel: channel.id, command: state.command_id });
    return ephemeral([...lines, DKP_COPY.commandFailed(cmd.status)].join('\n'));
  }
  await c.db.batch([
    ...saveStatements(c, { enabled: 1, channel: channel.id, command: cmd.body.id }),
    audit(c.db, g, c.userId, 'dkp.on', `channel:${channel.id}`, { enabled: state.enabled }, { enabled: true }),
  ]);
  // The guild pool's standings, and each pool already used (Add DKP after Remove DKP resumes them).
  const { results } = await c.db.prepare('SELECT pool FROM dkp_pool WHERE guild_id = ? ORDER BY pool = ? DESC, created_at').bind(g, POOL_GUILD).all<{ pool: string }>();
  await refreshStandings(c.db, api, g, channel.id, [...new Set([POOL_GUILD, ...results.map((r) => r.pool)])]);
  return ephemeral([...lines, DKP_COPY.added(channel.id)].join('\n'));
}

const saveStatements = (c: Ctx, s: { enabled: 0 | 1; channel: string | null; command: string | null }) => [
  c.db
    .prepare(
      `INSERT INTO dkp_guild (guild_id, enabled, channel_id, command_id, changed_at, changed_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (guild_id) DO UPDATE SET enabled = ?2, channel_id = ?3, command_id = ?4, changed_at = ?5, changed_by = ?6`,
    )
    .bind(c.guild.id, s.enabled, s.channel, s.command, now(), c.userId),
];
const saveState = (c: Ctx, s: Parameters<typeof saveStatements>[1]) => c.db.batch(saveStatements(c, s));

/** Closes the open raid (Remove DKP); its timers are cancelled after the reply (Effects.dkpCancel). */
export const closeOpenRaid = (db: D1Database, guildId: string, by: string, reason: 'officer' | 'auto' | 'removed') =>
  db.prepare('UPDATE dkp_raid SET closed_at = ?1, closed_by = ?2, close_reason = ?3 WHERE guild_id = ?4 AND closed_at IS NULL').bind(now(), by, reason, guildId);

/** dkprm: */
export const removeDkpButton = (c: Ctx): Promise<MessageReply> => withLease(c, (api) => removeDkp(c, api, c.applicationId!));

async function removeDkp(c: Ctx, api: BotApi, appId: string): Promise<MessageReply> {
  const g = c.guild.id;
  const state = await loadDkp(c.db, g);
  if (!state.enabled) return ephemeral(DKP_COPY.alreadyOff);
  // /dkp by name, not by the saved id (review of PR A): in dev, register-commands' bulk PUT removes it and its upsert
  // recreates it with a new id, which only Discord holds (the job never writes D1). A command already gone is as good as
  // deleted.
  const list = await api.call<{ id: string; name: string }[]>('GET', `/applications/${appId}/guilds/${g}/commands`);
  if (!list.ok) return ephemeral(DKP_COPY.commandFailed(list.status));
  for (const cmd of list.body.filter((x) => x.name === DKP_COMMAND.name)) {
    const del = await api.call('DELETE', `/applications/${appId}/guilds/${g}/commands/${cmd.id}`);
    if (!del.ok && del.status !== 404) return ephemeral(DKP_COPY.commandFailed(del.status));
  }
  const open = await c.db.prepare('SELECT id, pool, standby_once FROM dkp_raid WHERE guild_id = ? AND closed_at IS NULL').bind(g).first<{ id: number; pool: string; standby_once: number }>();
  const at = now();
  const [closed, cancelled] = await c.db.batch<{ id: number; message_id: string | null }>([
    closeOpenRaid(c.db, g, c.userId, 'removed'),
    // Order 29: every open or queued auction is cancelled ("DKP removed"; its card reveals the bids) before the timers go.
    cancelAllStatement(c.db, g, at),
    // Order 29 (override 2): a raid closed by Remove DKP pays its Standby once, as any close does.
    ...(open ? standbyPayouts(c.db, g, open, state.settings, at) : []),
    // Its timers are cancelled, so open approvals lapse now (review of PR A); their cards answer "off" from now on.
    c.db.prepare("UPDATE dkp_pending SET status = 'lapsed', decided_at = ?1 WHERE guild_id = ?2 AND status = 'open'").bind(now(), g),
    ...saveStatements(c, { enabled: 0, channel: state.channel_id, command: null }),
    audit(c.db, g, c.userId, 'dkp.off', `channel:${state.channel_id}`, { enabled: true }, { enabled: false }),
  ]);
  c.effects.dkpCancel = g;
  // DKP removed mid-raid: the raid is closed at once, and its card says so (its buttons answer "off" from now on).
  if (open && closed.meta.changes) await showRemoved(c.db, api, g, state.channel_id, open.id);
  await showCancelled(c.db, api, c.guild, state.channel_id, cancelled.results.filter((r) => r.message_id).map((r) => r.id));
  return ephemeral([DKP_COPY.removed(state.channel_id), ...(closed.meta.changes ? [DKP_COPY.removedRaid] : [])].join('\n'));
}

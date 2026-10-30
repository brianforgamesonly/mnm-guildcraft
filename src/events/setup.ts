// Order 32 (ITEM 1): /guildcraft setup's Add Events module and Remove Events module (admins; src/interactions.ts checks
// first), in src/dkp/setup.ts's pattern, with the same lease as Create GuildCraft channels. Add creates or keeps GC-Events
// (everyone reads; only GuildCraft posts: order 32's override of order 5, as order 27's override 1 for GC-DKP), upserts
// /event on this server and re-arms every open event's lock and close items, idempotently: the object keeps an item's
// earlier time, and an event whose close time has passed closes at once. Remove deletes /event and removes Events timer
// items only; GC-Events and every event and sign-up stay.
//
// Discord: the same routes and rules as src/dkp/setup.ts (read 2026-10-29).
import { audit, now } from '../access.ts';
import type { BotApi } from '../board/api.ts';
import { CATEGORY_NAME, CHANNELS_COPY, overwritesFor, sameChannel, type GuildChannel } from '../commands/channels.ts';
import { memberChannelBits, type RoleBits } from '../commands/setup.ts';
import type { Ctx } from '../context.ts';
import {
  ADMINISTRATOR, button, CREATE_PRIVATE_THREADS, ephemeral, GUILD_CATEGORY, GUILD_TEXT, MANAGE_CHANNELS, MANAGE_ROLES, row, SEND_MESSAGES, SEND_MESSAGES_IN_THREADS, STYLE_DANGER, STYLE_PRIMARY,
  VIEW_CHANNEL, type MessageReply,
} from '../discord.ts';
import { withLease } from '../dkp/setup.ts';
import { channelBits, PERMISSION_NAMES } from '../permissions.ts';
import { EVENT_COPY } from './copy.ts';
import { EVENT_COMMAND } from './definition.ts';
import { loadEvents } from './state.ts';

export const ADD_EVENTS_PREFIX = 'evadd:';
export const REMOVE_EVENTS_PREFIX = 'evrm:';
export const EVENTS_CHANNEL_NAME = 'GC-Events';
const PLAN = { kind: 'events', type: GUILD_TEXT, private: false } as const;
/** As src/dkp/setup.ts DKP_NEEDS: creating the channel and its overwrites, and every bit they allow or deny. */
export const EVENTS_NEEDS = MANAGE_CHANNELS | MANAGE_ROLES | VIEW_CHANNEL | SEND_MESSAGES | SEND_MESSAGES_IN_THREADS | CREATE_PRIVATE_THREADS | channelBits('events');
/** 3 reads, the category, the channel and the command. */
export const EVENTS_CALL_CAP = 3 + 1 + 1 + 1;

/** The setup reply's Events row: Add while it is off, Remove while it is on. */
export const eventButtons = (enabled: boolean) => row([enabled ? button(REMOVE_EVENTS_PREFIX, EVENT_COPY.removeLabel, STYLE_DANGER) : button(ADD_EVENTS_PREFIX, EVENT_COPY.addLabel, STYLE_PRIMARY)]);

/** evadd: */
export const addEventsButton = (c: Ctx): Promise<MessageReply> => withLease(c, (api) => addEvents(c, api, c.applicationId!), EVENTS_CALL_CAP);

const saveStatement = (c: Ctx, s: { enabled: 0 | 1; channel: string | null; command: string | null }) =>
  c.db
    .prepare(
      `INSERT INTO event_guild (guild_id, enabled, channel_id, command_id, changed_at, changed_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (guild_id) DO UPDATE SET enabled = ?2, channel_id = ?3, command_id = ?4, changed_at = ?5, changed_by = ?6`,
    )
    .bind(c.guild.id, s.enabled, s.channel, s.command, now(), c.userId);

/** Every open event's lock and close items. A lock already done is left out; a passed time runs at once. */
export async function openEventItems(db: D1Database, guildId: string): Promise<{ key: string; due: number }[]> {
  const { results } = await db.prepare("SELECT id, lock_at, closes_at, lock_done_at FROM event WHERE guild_id = ? AND status = 'open'").bind(guildId).all<{ id: number; lock_at: string | null; closes_at: string; lock_done_at: string | null }>();
  return results.flatMap((e) => [...(e.lock_at && !e.lock_done_at ? [{ key: `evlock:${e.id}`, due: Date.parse(e.lock_at) }] : []), { key: `evclose:${e.id}`, due: Date.parse(e.closes_at) }]);
}

async function addEvents(c: Ctx, api: BotApi, appId: string): Promise<MessageReply> {
  const g = c.guild.id;
  const state = await loadEvents(c.db, g);
  const [channels, roles, me] = await Promise.all([
    api.call<GuildChannel[]>('GET', `/guilds/${g}/channels`),
    api.call<RoleBits[]>('GET', `/guilds/${g}/roles`),
    api.call<{ roles: string[] }>('GET', `/guilds/${g}/members/${appId}`),
  ]);
  if (!channels.ok || !roles.ok || !me.ok) return ephemeral(CHANNELS_COPY.unread);
  const held = memberChannelBits(g, roles.body, [], appId, me.body.roles);
  if ((held & ADMINISTRATOR) !== ADMINISTRATOR) {
    const missing = [...PERMISSION_NAMES].filter(([b]) => (EVENTS_NEEDS & b) === b && (held & b) !== b).map(([, n]) => n);
    if (missing.length) return ephemeral(CHANNELS_COPY.missing(missing));
  }
  const lines: string[] = [];
  const all = channels.body;
  let category = all.find((ch) => sameChannel(ch, { name: CATEGORY_NAME, type: GUILD_CATEGORY }));
  let channel = (state.channel_id ? all.find((ch) => ch.id === state.channel_id) : undefined) ?? (category ? all.find((ch) => ch.parent_id === category!.id && sameChannel(ch, { name: EVENTS_CHANNEL_NAME, type: GUILD_TEXT })) : undefined);
  if (channel) lines.push(EVENT_COPY.kept(channel.id));
  else {
    if (!category) {
      const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, { name: CATEGORY_NAME, type: GUILD_CATEGORY });
      if (!made.ok) return ephemeral(CHANNELS_COPY.categoryFailed(made.status));
      category = made.body;
    }
    const made = await api.call<GuildChannel>('POST', `/guilds/${g}/channels`, {
      name: EVENTS_CHANNEL_NAME,
      type: GUILD_TEXT,
      parent_id: category.id,
      permission_overwrites: overwritesFor(PLAN, g, appId, c.guild.officer_role_id),
    });
    if (!made.ok) return ephemeral(EVENT_COPY.channelFailed(made.status));
    channel = made.body;
    lines.push(EVENT_COPY.created(channel.id));
  }
  const cmd = await api.call<{ id: string }>('POST', `/applications/${appId}/guilds/${g}/commands`, EVENT_COMMAND);
  if (!cmd.ok) {
    // The channel is saved and the switch stays as it was, so a retry keeps it and a second press never turns the module off.
    await saveStatement(c, { enabled: state.enabled ? 1 : 0, channel: channel.id, command: state.command_id }).run();
    return ephemeral([...lines, EVENT_COPY.commandFailed(cmd.status)].join('\n'));
  }
  await c.db.batch([saveStatement(c, { enabled: 1, channel: channel.id, command: cmd.body.id }), audit(c.db, g, c.userId, 'event.on', `channel:${channel.id}`, { enabled: state.enabled }, { enabled: true })]);
  const items = await openEventItems(c.db, g);
  if (items.length) c.effects.dkpTimers = { guildId: g, items: [...(c.effects.dkpTimers?.items ?? []), ...items] };
  return ephemeral([...lines, EVENT_COPY.added(channel.id)].join('\n'));
}

/** evrm: */
export const removeEventsButton = (c: Ctx): Promise<MessageReply> => withLease(c, (api) => removeEvents(c, api, c.applicationId!), EVENTS_CALL_CAP);

async function removeEvents(c: Ctx, api: BotApi, appId: string): Promise<MessageReply> {
  const g = c.guild.id;
  const state = await loadEvents(c.db, g);
  if (!state.enabled) return ephemeral(EVENT_COPY.alreadyOff);
  // By name, as Remove DKP module does: register-commands' bulk PUT and upsert give /event a new id only Discord holds.
  const list = await api.call<{ id: string; name: string }[]>('GET', `/applications/${appId}/guilds/${g}/commands`);
  if (!list.ok) return ephemeral(EVENT_COPY.commandFailed(list.status));
  for (const cmd of list.body.filter((x) => x.name === EVENT_COMMAND.name)) {
    const del = await api.call('DELETE', `/applications/${appId}/guilds/${g}/commands/${cmd.id}`);
    if (!del.ok && del.status !== 404) return ephemeral(EVENT_COPY.commandFailed(del.status));
  }
  await c.db.batch([saveStatement(c, { enabled: 0, channel: state.channel_id, command: null }), audit(c.db, g, c.userId, 'event.off', `channel:${state.channel_id}`, { enabled: true }, { enabled: false })]);
  c.effects.eventsCancel = g;
  return ephemeral(EVENT_COPY.removed(state.channel_id));
}

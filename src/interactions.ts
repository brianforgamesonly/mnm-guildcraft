import { InteractionResponseFlags, InteractionResponseType, InteractionType } from 'discord-interactions';
import { ensureGuild, isAdmin, isOfficer, loadGuild, passesMemberGate, touchMember, type Guild, type WaitUntil } from './access.ts';
import { autocomplete } from './commands/autocomplete.ts';
import { characterAdd, characterEdit, characterRemove } from './commands/character.ts';
import { HELP_TEXT } from './commands/help.ts';
import { guildcraftRebuildBoard, guildcraftSetup, guildcraftStatus } from './commands/setup.ts';
import { craftFind, postFind } from './commands/find.ts';
import { PAGE_PREFIX, postRoster, rosterMember, rosterPage, rosterSkill, rosterSwitch, rosterTop, SWITCH_PREFIX } from './commands/roster.ts';
import { POST_PREFIX, SEARCH_REPLIES_PRIVATE } from './commands/share.ts';
import { BUTTON_PREFIX, craftMe, craftSet, craftUpdate, MODAL_PREFIX, SELECT_PREFIX, updateButton, updateSelected, updateSubmitted } from './commands/skills.ts';
import { WELCOME } from './commands/welcome.ts';
import type { Ctx, Effects } from './context.ts';
import { choices, ephemeral, subcommand, type GuildMember, type Interaction, type InteractionReply, type MessageReply, type Option } from './discord.ts';
import type { Env } from './env.ts';

export type { Interaction, InteractionReply } from './discord.ts';

export const NOT_YET = "Sorry, that command isn't available yet. Type `/craft help` to see what's coming.";
export const NOT_IN_GUILD = 'Sorry, GuildCraft works inside a server, not in direct messages.';
export const ADMIN_ONLY = 'Only server admins (Administrator or Manage Server) can change GuildCraft settings.';
export const STALE_FORM = 'Sorry, that menu has expired. Run the command again.';
export const roleRequired = (g: Guild) => `GuildCraft in this server is for members with the <@&${g.member_role_id}> role. Ask an officer if you should have it.`;

/** open: anyone in the server · member: the member-role gate · admin: Administrator or Manage Server. */
type Access = 'open' | 'member' | 'admin';
/** search: the reply's visibility follows SEARCH_REPLIES_PRIVATE; every other command replies privately. */
const ROUTES: Record<string, { access: Access; search?: true; run: (c: Ctx, opts: Option[]) => Promise<MessageReply> }> = {
  'character add': { access: 'member', run: characterAdd },
  'character edit': { access: 'member', run: characterEdit },
  'character remove': { access: 'member', run: characterRemove },
  'craft set': { access: 'member', run: craftSet },
  'craft update': { access: 'member', run: craftUpdate },
  'craft me': { access: 'member', run: craftMe },
  'craft find': { access: 'member', search: true, run: craftFind },
  'roster skill': { access: 'member', search: true, run: rosterSkill },
  'roster member': { access: 'member', search: true, run: rosterMember },
  'roster top': { access: 'member', search: true, run: rosterTop },
  'craft help': { access: 'open', run: async () => ephemeral(HELP_TEXT) },
  'guildcraft setup': { access: 'admin', run: guildcraftSetup },
  'guildcraft status': { access: 'admin', run: guildcraftStatus },
  'guildcraft rebuild-board': { access: 'admin', run: guildcraftRebuildBoard },
};

const routeOf = (i: Interaction) => ROUTES[`${i.data?.name} ${subcommand(i).name}`];

const ctxFor = (env: Env, guild: Guild, m: GuildMember, effects: Effects, i?: Interaction): Ctx => ({
  db: env.DB,
  guild,
  member: m,
  userId: m.user.id,
  officer: isOfficer(guild, m),
  effects,
  resolved: i?.data?.resolved,
  applicationId: i?.application_id,
  botToken: env.DISCORD_BOT_TOKEN,
});

/** Adds the one-time welcome to a reply, as an extra embed, and keeps the reply private. */
function withWelcome(reply: MessageReply): MessageReply {
  if (reply.type !== InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE) return reply;
  const embeds = [...(reply.data.embeds ?? []).slice(0, 9), WELCOME];
  return { ...reply, data: { ...reply.data, embeds, flags: (reply.data.flags ?? 0) | InteractionResponseFlags.EPHEMERAL } };
}

// ---------------------------------------------------------------- which interactions defer (order 4, ITEM 1.2)

/**
 * Whether an interaction is answered at once or deferred, decided from the interaction alone before
 * any D1 work. The rule: everything that reaches D1 defers, except the two answers Discord does not let
 * us defer. Autocomplete (type 8) and the modal that opens from the skill select (type 9) answer at once.
 * Commands defer with type 5, carrying the reply's private flag (Discord keeps the flag from the defer);
 * components defer with type 6; modal submits with type 5, private (their reply is always private).
 */
export type Plan = { defer: false } | { defer: true; ack: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE | InteractionResponseType.DEFERRED_UPDATE_MESSAGE; private: boolean };

export function planFor(i: Interaction): Plan {
  const inGuild = !!i.guild_id && !!i.member;
  switch (i.type) {
    case InteractionType.APPLICATION_COMMAND: {
      const route = routeOf(i);
      if (!inGuild || !route) return { defer: false }; // replies without touching D1
      return { defer: true, ack: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, private: route.search ? SEARCH_REPLIES_PRIVATE : true };
    }
    case InteractionType.MESSAGE_COMPONENT:
      if (!inGuild || (i.data?.custom_id ?? '').startsWith(SELECT_PREFIX)) return { defer: false }; // the select opens a modal
      return { defer: true, ack: InteractionResponseType.DEFERRED_UPDATE_MESSAGE, private: true };
    case InteractionType.MODAL_SUBMIT:
      if (!inGuild) return { defer: false };
      return { defer: true, ack: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, private: true };
    default:
      return { defer: false }; // PING, autocomplete
  }
}

// ---------------------------------------------------------------- deferred work (runs inside ctx.waitUntil)

async function command(i: Interaction, env: Env, ctx: WaitUntil, effects: Effects): Promise<MessageReply> {
  const { options } = subcommand(i);
  const route = routeOf(i)!;
  // Rights are re-read from this request (member.roles, member.permissions) every time.
  const guild = await ensureGuild(env.DB, env.DISCORD_BOT_TOKEN, i.guild_id!, ctx);
  const m = i.member!;
  const passesGate = passesMemberGate(guild, m);
  if (route.access === 'member' && !passesGate) return ephemeral(roleRequired(guild));
  if (route.access === 'admin' && !isAdmin(m)) return ephemeral(ADMIN_ONLY);
  // Insert order: the guild row (above), then the member row, then rows that reference them.
  // Only a command that passes the member gate creates the member row, and only a new row shows the welcome.
  const isNew = passesGate ? (await touchMember(env.DB, guild.id, m)).isNew : false;
  const reply = await route.run(ctxFor(env, guild, m, effects, i), options);
  return isNew ? withWelcome(reply) : reply;
}

/** Buttons and modal submits: read the guild and member state, never create it. */
async function component(i: Interaction, env: Env, effects: Effects): Promise<MessageReply> {
  const guild = await loadGuild(env.DB, i.guild_id!);
  if (!guild) return ephemeral(STALE_FORM);
  if (!passesMemberGate(guild, i.member!)) return ephemeral(roleRequired(guild));
  const c = ctxFor(env, guild, i.member!, effects, i);
  const id = i.data?.custom_id ?? '';
  if (i.type === InteractionType.MODAL_SUBMIT) return id.startsWith(MODAL_PREFIX) ? updateSubmitted(c, id, i.data?.components) : ephemeral(STALE_FORM);
  if (id.startsWith(BUTTON_PREFIX)) return updateButton(c, id);
  if (id.startsWith(SWITCH_PREFIX)) return rosterSwitch(c, id, i.data?.values ?? []);
  if (id.startsWith(PAGE_PREFIX)) return rosterPage(c, id);
  if (id.startsWith(POST_PREFIX)) {
    const what = id.slice(POST_PREFIX.length);
    if (what.startsWith('find:')) return postFind(c, Number(what.slice(5)));
    return (await postRoster(c, what)) ?? ephemeral(STALE_FORM);
  }
  return ephemeral(STALE_FORM);
}

/**
 * The reply to an interaction planFor deferred. Typed MessageReply: a modal can never come back here.
 * `effects` collects work for after delivery (a board refresh when the handler marked posts dirty).
 */
export function deferredReply(i: Interaction, env: Env, ctx: WaitUntil, effects: Effects = {}): Promise<MessageReply> {
  return i.type === InteractionType.APPLICATION_COMMAND ? command(i, env, ctx, effects) : component(i, env, effects);
}

// ---------------------------------------------------------------- answered at once

/** The skill select's answer (a modal, or a private note), inside Discord's 3 seconds. */
async function skillSelect(i: Interaction, env: Env): Promise<InteractionReply> {
  const guild = await loadGuild(env.DB, i.guild_id!);
  if (!guild) return ephemeral(STALE_FORM);
  if (!passesMemberGate(guild, i.member!)) return ephemeral(roleRequired(guild));
  return updateSelected(ctxFor(env, guild, i.member!, {}), i.data?.custom_id ?? '', i.data?.values ?? []);
}

/** The reply to an interaction planFor answers at once. */
export async function immediateReply(i: Interaction, env: Env): Promise<InteractionReply> {
  switch (i.type) {
    case InteractionType.PING:
      return { type: InteractionResponseType.PONG };
    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE:
      // At most one D1 statement per keystroke; the character list applies the gate inside it.
      return choices(await autocomplete(env.DB, i));
    case InteractionType.APPLICATION_COMMAND:
      return ephemeral(!i.guild_id || !i.member ? NOT_IN_GUILD : NOT_YET);
    case InteractionType.MESSAGE_COMPONENT:
      if (!i.guild_id || !i.member) return ephemeral(NOT_IN_GUILD);
      return skillSelect(i, env);
    case InteractionType.MODAL_SUBMIT:
      return ephemeral(NOT_IN_GUILD);
    default:
      return ephemeral(NOT_YET);
  }
}

import { InteractionResponseFlags, InteractionResponseType, InteractionType } from 'discord-interactions';
import { ensureGuild, isAdmin, isOfficer, loadGuild, passesMemberGate, touchMember, type Guild, type WaitUntil } from './access.ts';
import { autocomplete } from './commands/autocomplete.ts';
import { characterAdd, characterEdit, characterRemove } from './commands/character.ts';
import { HELP_TEXT } from './commands/help.ts';
import { guildcraftSetup } from './commands/setup.ts';
import { craftMe, craftSet, craftUpdate, MODAL_PREFIX, SELECT_PREFIX, updateSelected, updateSubmitted } from './commands/skills.ts';
import { WELCOME } from './commands/welcome.ts';
import type { Ctx } from './context.ts';
import { choices, ephemeral, subcommand, type GuildMember, type Interaction, type InteractionReply, type Option } from './discord.ts';
import type { Env } from './env.ts';

export type { Interaction, InteractionReply } from './discord.ts';

export const NOT_YET = "Sorry, that command isn't available yet. Type `/craft help` to see what's coming.";
export const NOT_IN_GUILD = 'Sorry, GuildCraft works inside a server, not in direct messages.';
export const ADMIN_ONLY = 'Only server admins (Administrator or Manage Server) can change GuildCraft settings.';
export const STALE_FORM = 'Sorry, that menu has expired. Run the command again.';
export const roleRequired = (g: Guild) => `GuildCraft in this server is for members with the <@&${g.member_role_id}> role. Ask an officer if you should have it.`;

/** open: anyone in the server · member: the member-role gate · admin: Administrator or Manage Server. */
type Access = 'open' | 'member' | 'admin';
const ROUTES: Record<string, { access: Access; run: (c: Ctx, opts: Option[]) => Promise<InteractionReply> }> = {
  'character add': { access: 'member', run: characterAdd },
  'character edit': { access: 'member', run: characterEdit },
  'character remove': { access: 'member', run: characterRemove },
  'craft set': { access: 'member', run: craftSet },
  'craft update': { access: 'member', run: craftUpdate },
  'craft me': { access: 'member', run: craftMe },
  'craft help': { access: 'open', run: async () => ephemeral(HELP_TEXT) },
  'guildcraft setup': { access: 'admin', run: guildcraftSetup },
};

const ctxFor = (db: D1Database, guild: Guild, m: GuildMember): Ctx => ({ db, guild, member: m, userId: m.user.id, officer: isOfficer(guild, m) });

/** Adds the one-time welcome to a reply, as an extra embed, and keeps the reply private. */
function withWelcome(reply: InteractionReply): InteractionReply {
  if (reply.type !== InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE) return reply;
  const embeds = [...(reply.data.embeds ?? []).slice(0, 9), WELCOME];
  return { ...reply, data: { ...reply.data, embeds, flags: (reply.data.flags ?? 0) | InteractionResponseFlags.EPHEMERAL } };
}

async function command(i: Interaction, env: Env, ctx: WaitUntil): Promise<InteractionReply> {
  if (!i.guild_id || !i.member) return ephemeral(NOT_IN_GUILD);
  const { name: sub, options } = subcommand(i);
  const route = ROUTES[`${i.data?.name} ${sub}`];
  if (!route) return ephemeral(NOT_YET);
  // Rights are re-read from this request (member.roles, member.permissions) every time.
  const guild = await ensureGuild(env.DB, env.DISCORD_BOT_TOKEN, i.guild_id, ctx);
  const m = i.member;
  const passesGate = passesMemberGate(guild, m);
  if (route.access === 'member' && !passesGate) return ephemeral(roleRequired(guild));
  if (route.access === 'admin' && !isAdmin(m)) return ephemeral(ADMIN_ONLY);
  // Insert order: the guild row (above), then the member row, then rows that reference them.
  // Only a command that passes the member gate creates the member row, and only a new row shows the welcome.
  const isNew = passesGate ? (await touchMember(env.DB, guild.id, m)).isNew : false;
  const reply = await route.run(ctxFor(env.DB, guild, m), options);
  return isNew ? withWelcome(reply) : reply;
}

/** Selects and modal submits: read the guild and member state, never create it. */
async function component(i: Interaction, env: Env): Promise<InteractionReply> {
  if (!i.guild_id || !i.member) return ephemeral(NOT_IN_GUILD);
  const guild = await loadGuild(env.DB, i.guild_id);
  if (!guild) return ephemeral(STALE_FORM);
  if (!passesMemberGate(guild, i.member)) return ephemeral(roleRequired(guild));
  const c = ctxFor(env.DB, guild, i.member);
  const id = i.data?.custom_id ?? '';
  if (i.type === InteractionType.MESSAGE_COMPONENT && id.startsWith(SELECT_PREFIX)) return updateSelected(c, id, i.data?.values ?? []);
  if (i.type === InteractionType.MODAL_SUBMIT && id.startsWith(MODAL_PREFIX)) return updateSubmitted(c, id, i.data?.components);
  return ephemeral(STALE_FORM);
}

export async function handleInteraction(i: Interaction, env: Env, ctx: WaitUntil): Promise<InteractionReply> {
  switch (i.type) {
    case InteractionType.PING:
      return { type: InteractionResponseType.PONG };
    case InteractionType.APPLICATION_COMMAND:
      return command(i, env, ctx);
    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE: {
      if (!i.guild_id || !i.member) return choices([]);
      const guild = await loadGuild(env.DB, i.guild_id);
      if (!passesMemberGate(guild, i.member)) return choices([]);
      return choices(await autocomplete(env.DB, guild, i));
    }
    case InteractionType.MESSAGE_COMPONENT:
    case InteractionType.MODAL_SUBMIT:
      return component(i, env);
    default:
      return ephemeral(NOT_YET);
  }
}

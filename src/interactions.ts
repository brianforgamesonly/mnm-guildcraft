import { InteractionResponseFlags, InteractionResponseType, InteractionType } from 'discord-interactions';
import { ensureGuild, isAdmin, isOfficer, loadGuild, passesMemberGate, touchMember, type Guild, type WaitUntil } from './access.ts';
import { autocomplete } from './commands/autocomplete.ts';
import { characterAdd, characterEdit, characterRemove } from './commands/character.ts';
import { HELP_TEXT } from './commands/help.ts';
import { guildcraftRebuildBoard, guildcraftSetup, guildcraftStatus } from './commands/setup.ts';
import { guildcraftRemoveMember, noticeButton, OFFICER_ONLY, removeMemberButton } from './commands/members.ts';
import { NOTICE_PREFIX, REMOVE_PREFIX } from './departures.ts';
import { craftFind, IMAGE_PREFIX, KNOW_PREFIX, postFind, REPORT_PREFIX } from './commands/find.ts';
import { APPROVE_PREFIX, imageButton, itemImage, REJECT_PREFIX, statImage } from './commands/images.ts';
import { craftForget, craftKnow, KNOW_SELECT_PREFIX, knowButton, knowSelected, postRosterRecipes, RECIPES_PAGE_PREFIX, recipeOverride, recipeSource, rosterRecipes, rosterRecipesPage } from './commands/recipes.ts';
import { craftReport, DISMISS_PREFIX, FIXED_PREFIX, ITEM_REPORT_MODAL_PREFIX, ITEM_REPORT_PREFIX, REPORT_MODAL_PREFIX, reportButton, reportModal, reportSubmitted } from './commands/reports.ts';
import { DETAILS_PREFIX, gearDetails, gearFind, gearPage, PAGE_PREFIX as GEAR_PAGE_PREFIX, postGear, POST_WHAT as GEAR_POST } from './commands/gear.ts';
import { PAGE_PREFIX, postRoster, rosterMember, rosterPage, rosterSkill, rosterSwitch, rosterTop, SWITCH_PREFIX } from './commands/roster.ts';
import { POST_PREFIX, SEARCH_REPLIES_PRIVATE } from './commands/share.ts';
import { BUTTON_PREFIX, craftMe, craftSet, craftUpdate, MODAL_PREFIX, SELECT_PREFIX, updateButton, updateSelected, updateSubmitted } from './commands/skills.ts';
import { WELCOME } from './commands/welcome.ts';
import {
  ADD_MODAL_PREFIX, ADD_PREFIX, addItemModal, addItemSubmitted, cancelFromList, craftNotify, craftRequest, craftRequests, DISCARD_PREFIX, discardUnsent, itemButton, LIST_PREFIX, requestFromFind, SEND_PREFIX, sendUnsent,
} from './commands/requests.ts';
import { FROM_FIND_PREFIX, ITEM_PREFIX as REQUEST_ITEM_PREFIX } from './requests.ts';
import type { Ctx, Effects } from './context.ts';
import { choices, ephemeral, subcommand, type GuildMember, type Interaction, type InteractionReply, type MessageReply, type Option } from './discord.ts';
import type { Env } from './env.ts';

export type { Interaction, InteractionReply } from './discord.ts';

export const NOT_YET = "Sorry, that command isn't available yet. Type `/craft help` to see what's coming.";
export const NOT_IN_GUILD = 'Sorry, GuildCraft works inside a server, not in direct messages.';
export const ADMIN_ONLY = 'Only server admins (Administrator or Manage Server) can change GuildCraft settings.';
export const STALE_FORM = 'Sorry, that menu has expired. Run the command again.';
export const roleRequired = (g: Guild) => `GuildCraft in this server is for members with the <@&${g.member_role_id}> role. Ask an officer if you should have it.`;

/** open: anyone in the server · member: the member-role gate · officer: isOfficer · admin: Administrator or Manage Server. */
type Access = 'open' | 'member' | 'officer' | 'admin';
/**
 * search: the reply's visibility follows SEARCH_REPLIES_PRIVATE; every other command replies privately.
 * audit (order 7, ITEM 1.1): a read that writes this audit row after its reply is delivered (PRD: the bot "counts
 * lookups in its audit log"; craft.find is the PRD's action, roster.view and guildcraft.status are named additions).
 * Writes keep their own audit rows inside their write batch.
 */
const ROUTES: Record<string, { access: Access; search?: true; audit?: string; run: (c: Ctx, opts: Option[]) => Promise<MessageReply> }> = {
  'character add': { access: 'member', run: characterAdd },
  'character edit': { access: 'member', run: characterEdit },
  'character remove': { access: 'member', run: characterRemove },
  'craft set': { access: 'member', run: craftSet },
  'craft update': { access: 'member', run: craftUpdate },
  'craft me': { access: 'member', run: craftMe },
  'craft find': { access: 'member', search: true, audit: 'craft.find', run: craftFind },
  'roster skill': { access: 'member', search: true, audit: 'roster.view', run: rosterSkill },
  'roster member': { access: 'member', search: true, audit: 'roster.view', run: rosterMember },
  'roster top': { access: 'member', search: true, audit: 'roster.view', run: rosterTop },
  // Order 9.
  'craft know': { access: 'member', run: craftKnow },
  'craft forget': { access: 'member', run: craftForget },
  'craft report': { access: 'member', run: craftReport },
  'roster recipes': { access: 'member', search: true, audit: 'roster.view', run: rosterRecipes },
  // Order 13. Any member who passes the gate can search; no character needs to be registered. 'gear.find' is the
  // search's only write (its read audit row, after delivery). Not `search`: its results are always private (order 13),
  // whatever SEARCH_REPLIES_PRIVATE says, and Previous/Next edit them in place; the item card has Post to channel.
  'gear find': { access: 'member', audit: 'gear.find', run: gearFind },
  'item image': { access: 'member', run: itemImage },
  'recipe source': { access: 'officer', run: recipeSource },
  'recipe override': { access: 'officer', run: recipeOverride },
  // Order 16: craft requests. Each answers clearly where no request channel is set (src/requests.ts NO_REQUEST_CHANNEL).
  'craft request': { access: 'member', run: craftRequest },
  'craft notify': { access: 'member', run: craftNotify },
  'craft requests': { access: 'member', run: craftRequests },
  'craft help': { access: 'open', run: async () => ephemeral(HELP_TEXT) },
  'guildcraft setup': { access: 'admin', run: guildcraftSetup },
  'guildcraft status': { access: 'admin', audit: 'guildcraft.status', run: guildcraftStatus },
  'guildcraft rebuild-board': { access: 'admin', run: guildcraftRebuildBoard },
  'guildcraft remove-member': { access: 'officer', run: guildcraftRemoveMember },
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
  copy: env.GUILDCRAFT_COPY,
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
      // The skill select and Report a problem open a modal, which cannot follow a deferral.
      // Order 16: Add item (on an unsent craft request) opens a modal too.
      if (!inGuild || [SELECT_PREFIX, REPORT_PREFIX, ITEM_REPORT_PREFIX, ADD_PREFIX].some((p) => (i.data?.custom_id ?? '').startsWith(p))) return { defer: false };
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
  if (route.access === 'officer' && !isOfficer(guild, m)) return ephemeral(OFFICER_ONLY);
  // Insert order: the guild row (above), then the member row, then rows that reference them.
  // Only a command that passes the member gate creates the member row, and only a new row shows the welcome.
  const isNew = passesGate ? (await touchMember(env.DB, guild.id, m)).isNew : false;
  const reply = await route.run(ctxFor(env, guild, m, effects, i), options);
  if (route.audit)
    effects.audit = {
      guildId: guild.id,
      actor: m.user.id,
      action: route.audit,
      target: `${i.data?.name} ${subcommand(i).name}`,
      detail: Object.fromEntries(options.filter((o) => !o.focused).map((o) => [o.name, o.value ?? null])),
    };
  return isNew ? withWelcome(reply) : reply;
}

/** Buttons and modal submits: read the guild and member state, never create it. */
async function component(i: Interaction, env: Env, effects: Effects): Promise<MessageReply> {
  const guild = await loadGuild(env.DB, i.guild_id!);
  if (!guild) return ephemeral(STALE_FORM);
  const c = ctxFor(env, guild, i.member!, effects, i);
  const id = i.data?.custom_id ?? '';
  // Officer buttons (order 7): rights come from this press; the member gate does not apply to officers' tools.
  if (id.startsWith(REMOVE_PREFIX)) return removeMemberButton(c, id);
  if (id.startsWith(NOTICE_PREFIX)) return noticeButton(c, id);
  if (id.startsWith(FIXED_PREFIX) || id.startsWith(DISMISS_PREFIX)) return reportButton(c, id);
  if (id.startsWith(APPROVE_PREFIX) || id.startsWith(REJECT_PREFIX)) return imageButton(c, id);
  if (!passesMemberGate(guild, i.member!)) return ephemeral(roleRequired(guild));
  if (i.type === InteractionType.MODAL_SUBMIT) {
    if (id.startsWith(MODAL_PREFIX)) return updateSubmitted(c, id, i.data?.components);
    if (id.startsWith(REPORT_MODAL_PREFIX) || id.startsWith(ITEM_REPORT_MODAL_PREFIX)) return reportSubmitted(c, id, i.data?.components);
    if (id.startsWith(ADD_MODAL_PREFIX)) return addItemSubmitted(c, id, i.data?.components);
    return ephemeral(STALE_FORM);
  }
  // Order 16: craft requests. Request a craft answers privately (also on a posted card); the thread's buttons re-check
  // who may press them; an unsent request's and /craft requests' controls are private messages, edited in place.
  if (id.startsWith(FROM_FIND_PREFIX)) return requestFromFind(c, Number(id.slice(FROM_FIND_PREFIX.length)));
  if (id.startsWith(REQUEST_ITEM_PREFIX)) return itemButton(c, id);
  if (id.startsWith(SEND_PREFIX)) return sendUnsent(c, id);
  if (id.startsWith(DISCARD_PREFIX)) return discardUnsent(c, id);
  if (id.startsWith(LIST_PREFIX)) return cancelFromList(c, i.data?.values ?? []);
  // Order 9: /craft find's buttons, private or on a posted copy. Each answers the presser with a new private message.
  if (id.startsWith(KNOW_PREFIX)) return knowButton(c, Number(id.slice(KNOW_PREFIX.length)));
  if (id.startsWith(KNOW_SELECT_PREFIX)) return knowSelected(c, i.data?.values ?? []);
  if (id.startsWith(IMAGE_PREFIX)) return statImage(c, Number(id.slice(IMAGE_PREFIX.length)));
  if (id.startsWith(RECIPES_PAGE_PREFIX)) return rosterRecipesPage(c, id);
  // Order 13: /gear find's paging (edits the private results) and details menu (a new private card).
  if (id.startsWith(GEAR_PAGE_PREFIX)) return gearPage(c, id);
  if (id.startsWith(DETAILS_PREFIX)) return gearDetails(c, i.data?.values ?? []);
  if (id.startsWith(BUTTON_PREFIX)) return updateButton(c, id);
  if (id.startsWith(SWITCH_PREFIX)) return rosterSwitch(c, id, i.data?.values ?? []);
  if (id.startsWith(PAGE_PREFIX)) return rosterPage(c, id);
  if (id.startsWith(POST_PREFIX)) {
    const what = id.slice(POST_PREFIX.length);
    if (what.startsWith('find:')) return postFind(c, Number(what.slice(5)));
    if (what.startsWith(GEAR_POST)) return postGear(c, Number(what.slice(GEAR_POST.length)));
    if (what.startsWith('rr:')) return postRosterRecipes(c, what.slice(3).split(':'));
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
  const id = i.data?.custom_id ?? '';
  if (id.startsWith(REPORT_PREFIX)) return reportModal(Number(id.slice(REPORT_PREFIX.length)));
  if (id.startsWith(ITEM_REPORT_PREFIX)) return reportModal(Number(id.slice(ITEM_REPORT_PREFIX.length)), 'item');
  if (id.startsWith(ADD_PREFIX)) return addItemModal(id);
  return updateSelected(ctxFor(env, guild, i.member!, {}), id, i.data?.values ?? []);
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

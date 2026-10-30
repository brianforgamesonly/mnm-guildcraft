import { InteractionResponseFlags, InteractionResponseType, InteractionType } from 'discord-interactions';
import { ensureGuild, isAdmin, isOfficer, loadGuild, passesMemberGate, touchMember, type Guild, type WaitUntil } from './access.ts';
import { autocomplete } from './commands/autocomplete.ts';
import { HELP_PREFIX, helpButton, helpReply } from './commands/help.ts';
import { CREATE_CHANNELS_PREFIX, guildcraftRebuildBoard, guildcraftSetup, guildcraftStatus } from './commands/setup.ts';
import { createChannelsButton } from './commands/channels.ts';
import { noticeButton, OFFICER_ONLY, officerRemoveMember, removeMemberButton } from './commands/members.ts';
import { itemCommand, POST_WHAT as ITEM_POST, postItem } from './commands/item.ts';
import { ME_OPENS_MODAL, meCommand, meComponent, meImmediate, officerEditMember } from './commands/me.ts';
import { NOTICE_PREFIX, REMOVE_PREFIX } from './departures.ts';
import { IMAGE_PREFIX, KNOW_PREFIX, postFind, REPORT_PREFIX } from './commands/find.ts';
import { APPROVE_PREFIX, imageButton, REJECT_PREFIX, statImage } from './commands/images.ts';
import { KNOW_PAGE_PREFIX, knowPage, KNOW_SELECT_PREFIX, knowButton, knowSelected, postRosterRecipes, RECIPES_PAGE_PREFIX, recipeOverride, recipeSource, rosterRecipes, rosterRecipesPage } from './commands/recipes.ts';
import {
  DISMISS_PREFIX, FIXED_PREFIX, ITEM_REPORT_MODAL_PREFIX, ITEM_REPORT_PREFIX, MISSING_MODAL_PREFIX, MISSING_PREFIX, missingModal, missingSubmitted, REPORT_MODAL_PREFIX, reportButton, reportModal, reportSubmitted,
} from './commands/reports.ts';
import { DETAILS_PREFIX, gearDetails, gearFind, gearPage, gearSort, PAGE_PREFIX as GEAR_PAGE_PREFIX, postGear, POST_WHAT as GEAR_POST, SORT_PREFIX as GEAR_SORT_PREFIX } from './commands/gear.ts';
import { PAGE_PREFIX, postRoster, rosterMember, rosterPage, rosterSkill, rosterSwitch, rosterTop, SWITCH_PREFIX } from './commands/roster.ts';
import { POST_PREFIX, SEARCH_REPLIES_PRIVATE } from './commands/share.ts';
import { BUTTON_PREFIX, MODAL_PREFIX, SELECT_PREFIX, skillsCommand, updateButton, updateSelected, updateSubmitted } from './commands/skills.ts';
import { WELCOME } from './commands/welcome.ts';
import {
  ADD_MODAL_PREFIX, ADD_PREFIX, addItemModal, addItemSubmitted, cancelFromList, craftRequest, DISCARD_PREFIX, discardUnsent, itemButton, LIST_PREFIX, OFFICER_PAGE_PREFIX, officerRequests, officerRequestsPage,
  requestFromFind, SEND_PREFIX, sendUnsent,
} from './commands/requests.ts';
import { FROM_FIND_PREFIX, ITEM_PREFIX as REQUEST_ITEM_PREFIX } from './requests.ts';
import {
  CREATURES_PAGE_PREFIX, CREATURES_PREFIX, DROPS_PAGE_PREFIX, DROPS_PREFIX, GEAR_CLASS_PREFIX, GEAR_PREFIX as ZONE_GEAR_PREFIX, OPEN_PREFIX as ZONE_OPEN_PREFIX, POST_WHAT as ZONE_POST, postZone, zoneCommand, zoneGear,
  zoneGearClass, zoneList, zoneListPage, zoneOpen,
} from './commands/zone.ts';
import { APPROVE_PREFIX as DKP_APPROVE_PREFIX, approveButton, DKP_ROUTES, FULL_PAGE_PREFIX, fullStandings, mayRun } from './dkp/commands.ts';
import { DKP_COPY } from './dkp/copy.ts';
import { FULL_STANDINGS_PREFIX } from './dkp/messages.ts';
import { ADD_DKP_PREFIX, addDkpButton, REMOVE_DKP_PREFIX, removeDkpButton } from './dkp/setup.ts';
import { loadDkp } from './dkp/state.ts';
import { raidComponent } from './dkp/raid.ts';
import { AUCTION_OPENS_MODAL, auctionComponent, auctionImmediate } from './dkp/auction.ts';
import type { Ctx, Effects } from './context.ts';
import { choices, ephemeral, subcommand, type GuildMember, type Interaction, type InteractionReply, type MessageReply, type ModalComponent, type Option } from './discord.ts';
import type { Env } from './env.ts';

export type { Interaction, InteractionReply } from './discord.ts';

export const NOT_YET = "Sorry, that command isn't available. Type `/help` to see every command.";
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
// Order 18 (CHECKLIST A20): one route per registered command (src/commands/definitions.ts; test/worker/next-commands.test.ts
// checks the two match). The old names (/character, /craft, /item image, /gear find, /recipe, /guildcraft remove-member)
// are no longer registered and answer NOT_YET; their buttons and forms on earlier messages are still handled below. The
// audit action names stay as they were (craft.find, gear.find, roster.view), so history stays comparable; the audit row's
// target is the route key, so a lookup's target reads "item" where it read "craft find" before.
export const ROUTES: Record<string, { access: Access; search?: true; audit?: string | ((opts: Option[]) => string | undefined); run: (c: Ctx, opts: Option[]) => Promise<MessageReply> }> = {
  me: { access: 'member', run: meCommand },
  skills: { access: 'member', run: skillsCommand },
  // A stale screenshot: (order 24: screenshots are off) is answered "turned off" and is not a lookup.
  item: { access: 'member', search: true, audit: (opts) => (opts.some((o) => o.name === 'screenshot') ? undefined : 'craft.find'), run: itemCommand },
  // Order 13. Any member who passes the gate can search; no character needs to be registered. 'gear.find' is the
  // search's only write (its read audit row, after delivery). Not `search`: its results are always private (order 13),
  // whatever SEARCH_REPLIES_PRIVATE says, and Previous/Next edit them in place; the item card has Post to channel.
  gear: { access: 'member', audit: 'gear.find', run: gearFind },
  'roster skill': { access: 'member', search: true, audit: 'roster.view', run: rosterSkill },
  'roster member': { access: 'member', search: true, audit: 'roster.view', run: rosterMember },
  'roster top': { access: 'member', search: true, audit: 'roster.view', run: rosterTop },
  'roster recipes': { access: 'member', search: true, audit: 'roster.view', run: rosterRecipes },
  // Order 17: a zone's card, private with Post to channel; 'zone.view' is its only write.
  zone: { access: 'member', search: true, audit: 'zone.view', run: zoneCommand },
  // Order 16: craft requests. Each answers clearly where no request channel is set (src/requests.ts NO_REQUEST_CHANNEL).
  request: { access: 'member', run: craftRequest },
  // Order 27: the DKP page where DKP is on.
  help: { access: 'open', run: async (c) => helpReply((await loadDkp(c.db, c.guild.id)).enabled) },
  'officer recipe-source': { access: 'officer', run: recipeSource },
  'officer recipe-fix': { access: 'officer', run: recipeOverride },
  'officer remove-member': { access: 'officer', run: officerRemoveMember },
  'officer edit-member': { access: 'officer', run: officerEditMember },
  'officer requests': { access: 'officer', run: officerRequests },
  'guildcraft setup': { access: 'admin', run: guildcraftSetup },
  'guildcraft status': { access: 'admin', audit: 'guildcraft.status', run: guildcraftStatus },
  'guildcraft rebuild-board': { access: 'admin', run: guildcraftRebuildBoard },
};

/** "name sub", or "name" for a command without subcommands (order 17: /zone). */
const routeKey = (i: Interaction) => {
  const sub = subcommand(i).name;
  return sub === undefined ? `${i.data?.name}` : `${i.data?.name} ${sub}`;
};
/** Order 27: /dkp's routes (src/dkp/commands.ts), kept apart from ROUTES as /dkp is kept apart from COMMANDS. */
const routeOf = (i: Interaction): { search?: true } | undefined => ROUTES[routeKey(i)] ?? DKP_ROUTES[routeKey(i)];

/**
 * Order 27: every DKP button and select starts with this. Each keeps working after DKP is removed, answering "DKP is off
 * on this server" (order 18: every sent custom_id stays handled); Add DKP and Remove DKP are routed before it.
 */
export const DKP_PREFIX = 'dkp';

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
  atlasZoneImages: env.ATLAS_ZONE_IMAGES === 'on',
});

/** Adds the one-time welcome to a reply, as an extra embed, and keeps the reply private. */
function withWelcome(reply: MessageReply): MessageReply {
  if (reply.type !== InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE) return reply;
  // Order 18: /me with no characters already carries it.
  if (reply.data.embeds?.includes(WELCOME)) return reply;
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
/**
 * The components that answer with a modal, at once (skillSelect below): a modal cannot follow a deferral. Order 18:
 * Report a missing recipe on /item's "No item called" reply; /me's Add character and Edit character (and its select).
 */
export const OPENS_MODAL = [SELECT_PREFIX, REPORT_PREFIX, ITEM_REPORT_PREFIX, ADD_PREFIX, MISSING_PREFIX, ...ME_OPENS_MODAL, ...AUCTION_OPENS_MODAL];

export type Plan ={ defer: false } | { defer: true; ack: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE | InteractionResponseType.DEFERRED_UPDATE_MESSAGE; private: boolean };

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
      if (!inGuild || OPENS_MODAL.some((p) => (i.data?.custom_id ?? '').startsWith(p))) return { defer: false };
      return { defer: true, ack: InteractionResponseType.DEFERRED_UPDATE_MESSAGE, private: true };
    case InteractionType.MODAL_SUBMIT:
      if (!inGuild) return { defer: false };
      return { defer: true, ack: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE, private: true };
    default:
      return { defer: false }; // PING, autocomplete
  }
}

// ---------------------------------------------------------------- deferred work (runs inside ctx.waitUntil)

/** Order 27: /dkp's commands. DKP must be on; the member gate, then the route's own access, from this call's rights. */
async function dkpCommand(i: Interaction, env: Env, ctx: WaitUntil, effects: Effects): Promise<MessageReply> {
  const { options } = subcommand(i);
  const route = DKP_ROUTES[routeKey(i)];
  const guild = await ensureGuild(env.DB, env.DISCORD_BOT_TOKEN, i.guild_id!, ctx);
  const m = i.member!;
  const d = await loadDkp(env.DB, guild.id);
  if (!d.enabled) return ephemeral(DKP_COPY.off);
  const passesGate = passesMemberGate(guild, m);
  const c = ctxFor(env, guild, m, effects, i);
  if (!mayRun(c, route.access, d)) return ephemeral(route.access === 'admin' ? ADMIN_ONLY : DKP_COPY.notRunner);
  if (route.access === 'member' && !passesGate) return ephemeral(roleRequired(guild));
  const isNew = passesGate ? (await touchMember(env.DB, guild.id, m)).isNew : false;
  const reply = await route.run(c, options, d);
  return isNew ? withWelcome(reply) : reply;
}

/** Order 27: a DKP button or select (prefix dkp, after Add DKP and Remove DKP). */
async function dkpComponent(c: Ctx, id: string, values: string[], components?: ModalComponent[]): Promise<MessageReply> {
  const d = await loadDkp(c.db, c.guild.id);
  if (!d.enabled) return ephemeral(DKP_COPY.off);
  if (id.startsWith(DKP_APPROVE_PREFIX)) return approveButton(c, id, d);
  // Standings are guild-public (order 27's override 3 of order 2), behind the member gate like every member tool; a raid
  // button's presser without the member role is refused privately (officers' controls re-check the runner role).
  if (!passesMemberGate(c.guild, c.member) && !c.officer) return ephemeral(roleRequired(c.guild));
  if (id.startsWith(FULL_STANDINGS_PREFIX) || id.startsWith(FULL_PAGE_PREFIX)) return fullStandings(c, id);
  // Order 29: auctions (their forms' submits too: a modal submit routes here by its dkp prefix).
  const auction = await auctionComponent(c, id, components, d);
  if (auction) return auction;
  return (await raidComponent(c, id, values, d)) ?? ephemeral(STALE_FORM);
}

/** Order 29: a DKP control that answers at once (a modal: Bid, Cancel auction, the drop select), as dkpComponent gates. */
async function dkpImmediate(c: Ctx, id: string, values: string[]): Promise<InteractionReply> {
  const d = await loadDkp(c.db, c.guild.id);
  if (!d.enabled) return ephemeral(DKP_COPY.off);
  if (!passesMemberGate(c.guild, c.member) && !c.officer) return ephemeral(roleRequired(c.guild));
  return (await auctionImmediate(c, id, values, d)) ?? ephemeral(STALE_FORM);
}

async function command(i: Interaction, env: Env, ctx: WaitUntil, effects: Effects): Promise<MessageReply> {
  if (DKP_ROUTES[routeKey(i)]) return dkpCommand(i, env, ctx, effects);
  const { options } = subcommand(i);
  const route = ROUTES[routeKey(i)]!;
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
  const action = typeof route.audit === 'function' ? route.audit(options) : route.audit;
  if (action)
    effects.audit = {
      guildId: guild.id,
      actor: m.user.id,
      action,
      target: routeKey(i),
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
  // Order 18: /help's page buttons, open to anyone (as /help is).
  if (id.startsWith(HELP_PREFIX)) return helpButton(id, (await loadDkp(env.DB, guild.id)).enabled);
  // Order 19: Create GuildCraft channels, admins only, as /guildcraft setup is (rights from this press).
  if (id.startsWith(CREATE_CHANNELS_PREFIX)) return isAdmin(i.member!) ? createChannelsButton(c) : ephemeral(ADMIN_ONLY);
  // Order 27: Add DKP and Remove DKP, admins only, as Create GuildCraft channels; then every other DKP control.
  if (id.startsWith(ADD_DKP_PREFIX)) return isAdmin(i.member!) ? addDkpButton(c) : ephemeral(ADMIN_ONLY);
  if (id.startsWith(REMOVE_DKP_PREFIX)) return isAdmin(i.member!) ? removeDkpButton(c) : ephemeral(ADMIN_ONLY);
  if (id.startsWith(DKP_PREFIX)) return dkpComponent(c, id, i.data?.values ?? [], i.data?.components);
  // Officer buttons (order 7): rights come from this press; the member gate does not apply to officers' tools.
  if (id.startsWith(REMOVE_PREFIX)) return removeMemberButton(c, id);
  if (id.startsWith(NOTICE_PREFIX)) return noticeButton(c, id);
  if (id.startsWith(FIXED_PREFIX) || id.startsWith(DISMISS_PREFIX)) return reportButton(c, id);
  if (id.startsWith(APPROVE_PREFIX) || id.startsWith(REJECT_PREFIX)) return imageButton(c, id);
  // Order 18: /me's panel. Each press re-checks that the presser may act on the panel's member (src/commands/me.ts); an
  // officer acting on a member's panel (/officer edit-member) needs no member role, as with the other officer tools.
  const passes = passesMemberGate(guild, i.member!);
  if (passes || c.officer) {
    const panel = meComponent(c, id, i.data?.values ?? [], i.data?.components, i.type === InteractionType.MODAL_SUBMIT);
    if (panel) return panel;
    // The panel's Update skills leads to the skill form, which re-checks owner or officer itself (componentCharacter).
    if (i.type === InteractionType.MODAL_SUBMIT && id.startsWith(MODAL_PREFIX)) return updateSubmitted(c, id, i.data?.components);
  }
  if (!passes) return ephemeral(roleRequired(guild));
  if (i.type === InteractionType.MODAL_SUBMIT) {
    if (id.startsWith(MODAL_PREFIX)) return updateSubmitted(c, id, i.data?.components);
    if (id.startsWith(REPORT_MODAL_PREFIX) || id.startsWith(ITEM_REPORT_MODAL_PREFIX)) return reportSubmitted(c, id, i.data?.components);
    if (id.startsWith(ADD_MODAL_PREFIX)) return addItemSubmitted(c, id, i.data?.components);
    if (id.startsWith(MISSING_MODAL_PREFIX)) return missingSubmitted(c, i.data?.components);
    return ephemeral(STALE_FORM);
  }
  // Order 18: /officer requests' paging (re-checks the officer role).
  if (id.startsWith(OFFICER_PAGE_PREFIX)) return officerRequestsPage(c, id);
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
  if (id.startsWith(KNOW_PAGE_PREFIX)) return knowPage(c, id);
  if (id.startsWith(IMAGE_PREFIX)) return statImage(c, Number(id.slice(IMAGE_PREFIX.length)));
  if (id.startsWith(RECIPES_PAGE_PREFIX)) return rosterRecipesPage(c, id);
  // Order 13: /gear find's paging (edits the private results) and details menu (a new private card).
  if (id.startsWith(GEAR_PAGE_PREFIX)) return gearPage(c, id);
  if (id.startsWith(DETAILS_PREFIX)) return gearDetails(c, i.data?.values ?? []);
  // Order 17: /zone's buttons, private or on a posted card; each from the card answers with a new private message,
  // and the menus and pages they open are edited in place.
  // Order 17b: Gear here asks for the class first; one zone's results carry /gear find's sort select.
  if (id.startsWith(ZONE_GEAR_PREFIX)) return zoneGear(c, id);
  if (id.startsWith(GEAR_CLASS_PREFIX)) return zoneGearClass(c, id, i.data?.values ?? []);
  if (id.startsWith(GEAR_SORT_PREFIX)) return gearSort(c, id, i.data?.values ?? []);
  if (id.startsWith(CREATURES_PREFIX) || id.startsWith(DROPS_PREFIX)) return zoneList(c, id);
  if (id.startsWith(CREATURES_PAGE_PREFIX) || id.startsWith(DROPS_PAGE_PREFIX)) return zoneListPage(c, id);
  // Order 23: a zone button under /gear results or an item card opens the zone's card, privately, as /zone does.
  if (id.startsWith(ZONE_OPEN_PREFIX)) return zoneOpen(c, id);
  if (id.startsWith(BUTTON_PREFIX)) return updateButton(c, id);
  if (id.startsWith(SWITCH_PREFIX)) return rosterSwitch(c, id, i.data?.values ?? []);
  if (id.startsWith(PAGE_PREFIX)) return rosterPage(c, id);
  if (id.startsWith(POST_PREFIX)) {
    const what = id.slice(POST_PREFIX.length);
    if (what.startsWith(ITEM_POST)) return postItem(c, Number(what.slice(ITEM_POST.length)));
    if (what.startsWith('find:')) return postFind(c, Number(what.slice(5)));
    if (what.startsWith(GEAR_POST)) return postGear(c, Number(what.slice(GEAR_POST.length)));
    if (what.startsWith(ZONE_POST)) return postZone(c, what.slice(ZONE_POST.length));
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
  const id = i.data?.custom_id ?? '';
  const c = ctxFor(env, guild, i.member!, {}, i);
  // Order 29: the DKP controls that open a form (dkpImmediate keeps DKP's own gates).
  if (id.startsWith(DKP_PREFIX)) return dkpImmediate(c, id, i.data?.values ?? []);
  const passes = passesMemberGate(guild, i.member!);
  // Order 18: /me's forms (the officer path as in component()).
  if (passes || c.officer) {
    const panel = meImmediate(c, id, i.data?.values ?? []);
    if (panel) return panel;
    // The skill select (from the panel's Update skills), re-checked for owner or officer in updateSelected.
    if (id.startsWith(SELECT_PREFIX)) return updateSelected(c, id, i.data?.values ?? []);
  }
  if (!passes) return ephemeral(roleRequired(guild));
  if (id.startsWith(REPORT_PREFIX)) return reportModal(Number(id.slice(REPORT_PREFIX.length)));
  if (id.startsWith(ITEM_REPORT_PREFIX)) return reportModal(Number(id.slice(ITEM_REPORT_PREFIX.length)), 'item');
  if (id.startsWith(ADD_PREFIX)) return addItemModal(id);
  if (id.startsWith(MISSING_PREFIX)) return missingModal(id);
  return updateSelected(c, id, i.data?.values ?? []);
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

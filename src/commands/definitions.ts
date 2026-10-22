// Slash-command definitions registered with Discord (scripts/discord/register.ts).
// Work order 18 (CHECKLIST A20) replaced the earlier orders' list (/character, /craft, /item image, /gear find, /recipe,
// /guildcraft remove-member) with eight member commands, /officer and /guildcraft. Buttons on messages sent before the
// switch keep working: their custom_ids are still handled (src/interactions.ts).
// /help's pages are built from these definitions (src/commands/help.ts), so a command cannot be missing from them.

import { gearFindOptions } from '../gear/options.ts';
import { ACQUISITION_LABEL, ACQUISITIONS, FACTION_MAX } from '../recipes.ts';

export const SUBCOMMAND = 1;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;
const ATTACHMENT = 11;
/** Channel type GUILD_FORUM (also src/discord.ts GUILD_FORUM; kept literal so the registration script reads this file alone). */
const GUILD_FORUM_CHANNEL = 15;
/** Channel type GUILD_TEXT (also src/discord.ts GUILD_TEXT). */
const GUILD_TEXT_CHANNEL = 0;
/** Interaction context: guild channels only. */
const GUILD_ONLY = [0];
/** Manage Server. Administrators hold every permission, so they see the command too. */
const MANAGE_GUILD = String(1 << 5);

const characterOption = { type: STRING, name: 'character', description: 'Optional; defaults to your main', autocomplete: true, max_length: 32 };
const skillOption = { type: STRING, name: 'skill', description: 'Tradeskill', required: true, autocomplete: true };
/** /officer picks a recipe through item: (autocomplete offers each of an item's recipes, with its tradeskill and trivial). */
const recipeItemOption = { type: STRING, name: 'item', description: 'The item: pick its recipe from the list (each shows its tradeskill and trivial)', required: true, autocomplete: true, max_length: 100 };
const officerMember = (description: string) => ({ type: USER, name: 'member', description, required: true });

export const COMMANDS = [
  {
    name: 'me',
    description: 'Your characters, skills, recipes, notices and requests, with buttons to change them',
    type: 1,
    contexts: GUILD_ONLY,
    options: [{ ...characterOption, description: 'Optional: show one character' }],
  },
  {
    name: 'skills',
    description: 'Set one tradeskill level, or leave the options out to update up to 5 at once',
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      { ...skillOption, required: false, description: 'With level: the tradeskill to set. Leave both out to pick up to 5' },
      { type: INTEGER, name: 'level', description: 'With skill: its level', min_value: 0 },
      characterOption,
    ],
  },
  {
    name: 'item',
    description: 'Any item: stats, where it comes from, its recipe and crafters, and recipes that use it',
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      { type: STRING, name: 'name', description: 'The item: pick from the list (craftable ones are marked)', required: true, autocomplete: true, max_length: 100 },
      { type: ATTACHMENT, name: 'screenshot', description: 'Optional: a screenshot of the item window, for an officer to approve' },
    ],
  },
  {
    // Order 13. The class choices are the copy's game_class codes, filled in at registration (commandsWith).
    name: 'gear',
    description: 'Gear for your class, by slot, weapon type, AC, ratio, stats, source and zone',
    type: 1,
    contexts: GUILD_ONLY,
    options: gearFindOptions([]),
  },
  {
    // Kept as subcommands (order 18): each view has its own required option (skill, member), which Discord then asks for
    // and checks; as options of one command, nothing could make member: required for one view only.
    name: 'roster',
    description: "The guild's crafters, by tradeskill or by member",
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      {
        type: SUBCOMMAND,
        name: 'skill',
        description: 'Everyone with a tradeskill, ranked by skill level',
        options: [skillOption, { type: INTEGER, name: 'min_level', description: 'Only show skill levels at or above this', min_value: 0 }],
      },
      {
        type: SUBCOMMAND,
        name: 'member',
        description: "One member's characters and skills",
        options: [{ type: USER, name: 'member', description: 'The member', required: true }],
      },
      { type: SUBCOMMAND, name: 'top', description: 'The top 3 characters in each tradeskill' },
      {
        type: SUBCOMMAND,
        name: 'recipes',
        description: 'Who knows the reputation and discovery recipes',
        options: [{ ...skillOption, required: false, description: 'Optional: one tradeskill' }],
      },
    ],
  },
  {
    // Order 17: no subcommand; the zone list is data, offered by autocomplete.
    name: 'zone',
    description: 'A zone: map, level range, creatures, and links to the wikis and MnM Atlas',
    type: 1,
    contexts: GUILD_ONLY,
    options: [{ type: STRING, name: 'name', description: 'The zone: pick from the list', required: true, autocomplete: true, max_length: 100 }],
  },
  {
    // Order 16: craft requests.
    name: 'request',
    description: 'Ask the opted-in crafters who can make an item, in a private thread',
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      { type: STRING, name: 'item', description: 'An item that has a recipe: pick from the list', required: true, autocomplete: true, max_length: 100 },
      { type: INTEGER, name: 'quantity', description: 'How many (default 1)', min_value: 1, max_value: 1000 },
      { type: STRING, name: 'note', description: 'Optional: anything the crafter should know (up to 300 characters)', max_length: 300 },
    ],
  },
  { name: 'help', description: 'A guide to every command, a page at a time', type: 1, contexts: GUILD_ONLY },
  {
    name: 'officer',
    description: 'Officers: recipe data, members and craft requests',
    type: 1,
    contexts: GUILD_ONLY,
    // Shown to Manage Server by default; a server admin grants it to the officer role once (Server Settings →
    // Integrations → the app → /officer). src/interactions.ts re-checks the officer role on every call (FR-8).
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: SUBCOMMAND,
        name: 'recipe-source',
        description: 'Set how a recipe is obtained (this server only)',
        options: [
          recipeItemOption,
          { type: STRING, name: 'how', description: 'How it is obtained', required: true, choices: ACQUISITIONS.map((a) => ({ name: ACQUISITION_LABEL[a], value: a })) },
          // Order 10, ITEM 0: free text up to FACTION_MAX; autocomplete suggests this server's factions and echoes the typed name first.
          { type: STRING, name: 'faction', description: 'Reputation recipes: the faction that sells it (type any name)', autocomplete: true, max_length: FACTION_MAX },
          { type: STRING, name: 'note', description: 'Optional: vendor, standing needed, or a hint', max_length: 200 },
        ],
      },
      {
        type: SUBCOMMAND,
        name: 'recipe-fix',
        description: "Correct a recipe's trivial or ingredients (this server only)",
        options: [
          recipeItemOption,
          { type: INTEGER, name: 'trivial', description: 'The correct trivial', min_value: 0 },
          { type: STRING, name: 'components', description: 'The full ingredient list, e.g. 2 Copper Bar, 1 Flux', max_length: 500 },
          { type: BOOLEAN, name: 'reset', description: "True: remove this server's correction" },
        ],
      },
      {
        type: SUBCOMMAND,
        name: 'remove-member',
        description: "Remove a member's characters and mark them as left (shows a preview first)",
        options: [officerMember('The member to remove')],
      },
      {
        type: SUBCOMMAND,
        name: 'edit-member',
        description: "Open a member's /me panel to change their characters and skills",
        options: [officerMember('The member')],
      },
      { type: SUBCOMMAND, name: 'requests', description: 'Every open craft request in this server, with Cancel' },
    ],
  },
  {
    name: 'guildcraft',
    description: 'GuildCraft settings for this server (admins)',
    type: 1,
    contexts: GUILD_ONLY,
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: SUBCOMMAND,
        name: 'setup',
        description: 'Set the roles, roster board, and review, vault and request channels (leave all out to see them)',
        options: [
          { type: ROLE, name: 'member_role', description: 'Members need this role to use GuildCraft (default: anyone)' },
          { type: ROLE, name: 'officer_role', description: 'Officers: edit entries, handle departures, reports, screenshots and recipe data' },
          { type: CHANNEL, name: 'board', description: 'A forum channel for the roster board: one post per tradeskill', channel_types: [GUILD_FORUM_CHANNEL] },
          { type: CHANNEL, name: 'review', description: 'A private text channel for officers: departure notices and member reports', channel_types: [GUILD_TEXT_CHANNEL] },
          { type: CHANNEL, name: 'vault', description: 'A private text channel for officers: item screenshots waiting for approval', channel_types: [GUILD_TEXT_CHANNEL] },
          { type: CHANNEL, name: 'requests', description: 'A text channel for craft requests: one private thread per request', channel_types: [GUILD_TEXT_CHANNEL] },
        ],
      },
      { type: SUBCOMMAND, name: 'status', description: 'Data version, last data update, the roster board and departures' },
      { type: SUBCOMMAND, name: 'rebuild-board', description: 'Recreate the roster board posts in A→Z order (posts with replies are kept)' },
    ],
  },
] as const;

type Gear = { name: string; options?: readonly { type: number; name: string; options?: unknown }[] };

/** The definitions to register: /gear's class option offers "Any" and `classes` (the copy's game_class codes). */
export const commandsWith = (classes: readonly string[]) => COMMANDS.map((c) => (c.name === 'gear' ? { ...c, options: gearFindOptions(classes) } : c)) as readonly Gear[];

/**
 * Discord's documented maximums for a slash command (https://docs.discord.com/developers/interactions/application-commands):
 * "Choices for the user to pick from, max 25"; "Parameters for the command, max of 25"; option names "1-32 character
 * name", descriptions "1-100 character description"; choice names "1-100 character choice name", values "up to 100
 * characters if string"; "Slash commands can have a maximum of 8000 characters for combined name, description, and value
 * properties". Checked in CI (test/worker/gear.test.ts) and before every registration (scripts/discord/register.ts).
 */
export const DISCORD_COMMAND_LIMITS = { choices: 25, options: 25, name: 32, description: 100, choice: 100, combined: 8000 } as const;
type Def = { name: string; description?: string; options?: readonly Def[]; choices?: readonly { name: string; value: string | number }[] };

export function commandLimitProblems(list: readonly object[]): string[] {
  const commands = list as readonly Def[];
  const L = DISCORD_COMMAND_LIMITS;
  const out: string[] = [];
  const visit = (d: Def, at: string): number => {
    let chars = d.name.length + (d.description?.length ?? 0);
    if (d.name.length > L.name) out.push(`${at}: name over ${L.name} characters`);
    if ((d.description?.length ?? 0) > L.description) out.push(`${at}: description over ${L.description} characters`);
    if ((d.options?.length ?? 0) > L.options) out.push(`${at}: ${d.options!.length} options, over ${L.options}`);
    if ((d.choices?.length ?? 0) > L.choices) out.push(`${at}: ${d.choices!.length} choices, over ${L.choices}`);
    for (const ch of d.choices ?? []) {
      if (ch.name.length > L.choice || String(ch.value).length > L.choice) out.push(`${at}: choice ${ch.name} over ${L.choice} characters`);
      chars += ch.name.length + String(ch.value).length;
    }
    for (const o of d.options ?? []) chars += visit(o, `${at} ${o.name}`);
    return chars;
  };
  for (const c of commands) {
    const n = visit(c, `/${c.name}`);
    if (n > L.combined) out.push(`/${c.name}: ${n} combined characters, over ${L.combined}`);
  }
  return out;
}

export interface Defined {
  /** "/name sub", or "/name" for a command without subcommands (order 17). */
  cmd: string;
  command: string;
  description: string;
}
/** Every command and subcommand that is built, with its description: what /help lists (order 18). */
export const DEFINED_LIST: Defined[] = COMMANDS.flatMap((c) => {
  const subs = ((c as { options?: readonly { type: number; name: string; description: string }[] }).options ?? []).filter((o) => o.type === SUBCOMMAND);
  return subs.length ? subs.map((o) => ({ cmd: `/${c.name} ${o.name}`, command: c.name, description: o.description })) : [{ cmd: `/${c.name}`, command: c.name, description: c.description }];
});
export const DEFINED = new Set(DEFINED_LIST.map((d) => d.cmd));

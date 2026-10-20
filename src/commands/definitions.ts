// Slash-command definitions registered with Discord (scripts/discord/register.ts).
// Order 2 shipped /character, /craft set|update|me|help and /guildcraft setup; order 3 adds /craft find
// and /roster skill|member|top; later orders add the rest.
// /craft help marks every PRD command not defined here as "coming soon" (src/commands/help.ts).

import { ACQUISITION_LABEL, ACQUISITIONS, FACTION_MAX, REPORT_ISSUES } from '../recipes.ts';

export const SUBCOMMAND = 1;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const CHANNEL = 7;
const ROLE = 8;
/** Channel type GUILD_FORUM (also src/discord.ts GUILD_FORUM; kept literal so the registration script reads this file alone). */
const GUILD_FORUM_CHANNEL = 15;
/** Channel type GUILD_TEXT (also src/discord.ts GUILD_TEXT). */
const GUILD_TEXT_CHANNEL = 0;
/** Interaction context: guild channels only. */
const GUILD_ONLY = [0];
/** Manage Server. Administrators hold every permission, so they see the command too. */
const MANAGE_GUILD = String(1 << 5);

const memberOption = {
  type: USER,
  name: 'member',
  description: "Officers only: act on another member's character",
};
const classOption = { type: STRING, name: 'class', description: 'Class: pick from the list, or type your own', autocomplete: true, max_length: 32 };
const levelOption = { type: INTEGER, name: 'level', description: 'Character level', min_value: 1, max_value: 100 };
const mainOption = { type: BOOLEAN, name: 'main', description: 'Make this your main character' };
const characterOption = { type: STRING, name: 'character', description: 'Optional; defaults to your main', autocomplete: true, max_length: 32 };
const skillOption = { type: STRING, name: 'skill', description: 'Tradeskill', required: true, autocomplete: true };
/** Order 9: one choice per recipe, with its tradeskill and trivial (src/commands/autocomplete.ts). */
const recipeOption = { type: STRING, name: 'recipe', description: 'A recipe: pick from the list (each shows its tradeskill and trivial)', required: true, autocomplete: true, max_length: 100 };
const itemOption = { type: STRING, name: 'item', description: 'An item: pick from the list', required: true, autocomplete: true, max_length: 100 };
/** /recipe picks a recipe through item: (autocomplete offers each of an item's recipes). */
const recipeItemOption = { ...recipeOption, name: 'item', description: 'The item: pick its recipe from the list (each shows its tradeskill and trivial)' };
const ATTACHMENT = 11;

export const COMMANDS = [
  {
    name: 'character',
    description: 'Register and manage your characters',
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      {
        type: SUBCOMMAND,
        name: 'add',
        description: 'Register a character',
        options: [{ type: STRING, name: 'name', description: 'Character name', required: true, max_length: 32 }, classOption, levelOption, mainOption],
      },
      {
        type: SUBCOMMAND,
        name: 'edit',
        description: 'Rename a character, or change its class, level or main flag',
        options: [
          { type: STRING, name: 'name', description: 'The character to change', required: true, autocomplete: true, max_length: 32 },
          { type: STRING, name: 'new_name', description: 'A new name', max_length: 32 },
          classOption,
          levelOption,
          mainOption,
          memberOption,
        ],
      },
      {
        type: SUBCOMMAND,
        name: 'remove',
        description: 'Remove a character and hide its skills',
        options: [
          { type: STRING, name: 'name', description: 'The character to remove', required: true, autocomplete: true, max_length: 32 },
          memberOption,
        ],
      },
    ],
  },
  {
    name: 'craft',
    description: 'Guild crafting: find crafters and track tradeskills',
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      {
        type: SUBCOMMAND,
        name: 'set',
        description: 'Set one tradeskill level',
        options: [skillOption, { type: INTEGER, name: 'level', description: 'Skill level', required: true, min_value: 0 }, characterOption, memberOption],
      },
      { type: SUBCOMMAND, name: 'update', description: 'Update up to 5 skills: press Enter, pick skills, then type levels', options: [characterOption] },
      { type: SUBCOMMAND, name: 'me', description: 'Your characters, skills and last updates (private)', options: [characterOption] },
      {
        type: SUBCOMMAND,
        name: 'find',
        description: 'Who in the guild can make an item: recipe, stats and crafters',
        options: [{ type: STRING, name: 'item', description: 'An item that has a recipe: pick from the list', required: true, autocomplete: true, max_length: 100 }],
      },
      { type: SUBCOMMAND, name: 'know', description: 'Mark a recipe as known by your character', options: [recipeOption, characterOption] },
      { type: SUBCOMMAND, name: 'forget', description: 'Unmark a recipe your character marked known', options: [recipeOption, characterOption] },
      {
        type: SUBCOMMAND,
        name: 'report',
        description: 'Report a wrong trivial, ingredient or source, or a missing recipe, to the officers',
        options: [
          itemOption,
          { type: STRING, name: 'issue', description: 'What is wrong', required: true, choices: REPORT_ISSUES.map((i) => ({ name: i.label, value: i.value })) },
          { type: STRING, name: 'details', description: 'Optional: what it should be (up to 300 characters)', max_length: 300 },
        ],
      },
      { type: SUBCOMMAND, name: 'help', description: 'A one-screen guide to every command' },
    ],
  },
  {
    name: 'item',
    description: 'Item screenshots',
    type: 1,
    contexts: GUILD_ONLY,
    options: [
      {
        type: SUBCOMMAND,
        name: 'image',
        description: 'Send a screenshot of an item window; an officer approves it before it shows',
        options: [itemOption, { type: ATTACHMENT, name: 'image', description: 'PNG, JPEG or WebP, up to 8 MB', required: true }],
      },
    ],
  },
  {
    name: 'recipe',
    description: 'Officers: correct recipes for this server',
    type: 1,
    contexts: GUILD_ONLY,
    // Order 9: its own top-level command, so a server admin can grant it to the officer role (Server Settings →
    // Integrations → MNM-Guildcraft → /recipe) without granting /guildcraft. src/interactions.ts re-checks the officer
    // role on every call (FR-8).
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: SUBCOMMAND,
        name: 'source',
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
        name: 'override',
        description: "Correct a recipe's trivial or ingredients (this server only)",
        options: [
          recipeItemOption,
          { type: INTEGER, name: 'trivial', description: 'The correct trivial', min_value: 0 },
          { type: STRING, name: 'components', description: 'The full ingredient list, e.g. 2 Copper Bar, 1 Flux', max_length: 500 },
          { type: BOOLEAN, name: 'reset', description: "True: remove this server's correction" },
        ],
      },
    ],
  },
  {
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
    name: 'guildcraft',
    description: 'GuildCraft settings for this server',
    type: 1,
    contexts: GUILD_ONLY,
    // Shown to Manage Server by default. remove-member is officer-level (src/interactions.ts re-checks it): an
    // officer role without Manage Server sees it once a server admin allows that role in Server Settings →
    // Integrations → MNM-Guildcraft (a Discord setting; unverified on the live server).
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: SUBCOMMAND,
        name: 'setup',
        description: 'Set the roles, roster board, and review and vault channels (leave all out to see them)',
        options: [
          { type: ROLE, name: 'member_role', description: 'Members need this role to use GuildCraft (default: anyone)' },
          { type: ROLE, name: 'officer_role', description: 'Officers: edit entries, handle departures, reports, screenshots and recipe data' },
          { type: CHANNEL, name: 'board', description: 'A forum channel for the roster board: one post per tradeskill', channel_types: [GUILD_FORUM_CHANNEL] },
          { type: CHANNEL, name: 'review', description: 'A private text channel for officers: departure notices and member reports', channel_types: [GUILD_TEXT_CHANNEL] },
          { type: CHANNEL, name: 'vault', description: 'A private text channel for officers: item screenshots waiting for approval', channel_types: [GUILD_TEXT_CHANNEL] },
        ],
      },
      { type: SUBCOMMAND, name: 'status', description: 'Data version, last data update, the roster board and departures' },
      { type: SUBCOMMAND, name: 'rebuild-board', description: 'Recreate the roster board posts in A→Z order (posts with replies are kept)' },
      {
        type: SUBCOMMAND,
        name: 'remove-member',
        description: "Officers: remove a member's characters and mark them as left (shows a preview first)",
        options: [{ type: USER, name: 'user', description: 'The member to remove', required: true }],
      },
    ],
  },
] as const;

/** "/name sub" for every defined subcommand: the commands that are built. */
export const DEFINED = new Set(COMMANDS.flatMap((c) => c.options.map((o) => `/${c.name} ${o.name}`)));

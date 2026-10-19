// Slash-command definitions registered with Discord (scripts/discord/register.ts).
// Order 2 ships /character, /craft set|update|me|help and /guildcraft setup; later orders add the rest.
// /craft help marks every PRD command not defined here as "coming soon" (src/commands/help.ts).

export const SUBCOMMAND = 1;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const ROLE = 8;
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
const characterOption = { type: STRING, name: 'character', description: 'Which character (default: your main)', autocomplete: true, max_length: 32 };

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
        options: [
          { type: STRING, name: 'skill', description: 'Tradeskill', required: true, autocomplete: true },
          { type: INTEGER, name: 'level', description: 'Skill level', required: true, min_value: 0 },
          characterOption,
          memberOption,
        ],
      },
      { type: SUBCOMMAND, name: 'update', description: 'Set up to 5 tradeskills at once', options: [characterOption] },
      { type: SUBCOMMAND, name: 'me', description: 'Your characters, skills and last updates (private)', options: [characterOption] },
      { type: SUBCOMMAND, name: 'help', description: 'A one-screen guide to every command' },
    ],
  },
  {
    name: 'guildcraft',
    description: 'GuildCraft settings for this server',
    type: 1,
    contexts: GUILD_ONLY,
    default_member_permissions: MANAGE_GUILD,
    options: [
      {
        type: SUBCOMMAND,
        name: 'setup',
        description: 'Set the member and officer roles (leave both out to see the current settings)',
        options: [
          { type: ROLE, name: 'member_role', description: 'Members need this role to use GuildCraft (default: anyone)' },
          { type: ROLE, name: 'officer_role', description: "Officers can edit any member's entries" },
        ],
      },
    ],
  },
] as const;

/** "/name sub" for every defined subcommand: the commands that are built. */
export const DEFINED = new Set(COMMANDS.flatMap((c) => c.options.map((o) => `/${c.name} ${o.name}`)));

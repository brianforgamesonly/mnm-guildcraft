// Slash-command definitions registered with Discord (scripts/discord/register.ts).
// Order 1 ships /craft help only; later orders add the rest of the PRD's commands here.

export const SUBCOMMAND = 1;

export const COMMANDS = [
  {
    name: 'craft',
    description: 'Guild crafting: find crafters and track tradeskills',
    type: 1,
    options: [
      {
        type: SUBCOMMAND,
        name: 'help',
        description: 'A one-screen guide to every command',
      },
    ],
  },
] as const;

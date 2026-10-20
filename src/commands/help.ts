// DRAFT copy — Brian approves the final text before launch (ORDER-RULES: Product).
// Lists every command in docs/PRD.md (FR-1 to FR-9). "(coming soon)" is derived, never typed: an entry
// is marked when its commands are not in the registered definitions (src/commands/definitions.ts).
import { DEFINED } from './definitions.ts';

export const HELP_FOOTER = 'draft — more commands arrive over the next builds';
export const COMING_SOON = '*(coming soon)*';

/** A heading, or one entry: its commands and what they do. Every command in an entry shares one status. */
export type HelpLine = string | { cmds: string[]; text: string };

export const HELP_LINES: HelpLine[] = [
  '**Your characters**',
  { cmds: ['/character add'], text: 'register a character (name, class, level, main)' },
  { cmds: ['/character edit'], text: 'rename it or change class, level or main' },
  { cmds: ['/character remove'], text: 'remove a character (its skills are kept if you add it back)' },
  '**Your skills and recipes**',
  { cmds: ['/craft set'], text: 'set one tradeskill level' },
  { cmds: ['/craft update'], text: 'press Enter, pick up to 5 tradeskills, then type their levels' },
  { cmds: ['/craft me'], text: 'your skills, levels and last update (private)' },
  { cmds: ['/craft know', '/craft forget'], text: 'mark a recipe as known, or undo it' },
  '**Find a crafter**',
  { cmds: ['/craft find'], text: 'who can make an item, with its recipe and stats' },
  { cmds: ['/roster skill'], text: 'everyone with a tradeskill, ranked' },
  { cmds: ['/roster member'], text: "one member's characters and skills" },
  { cmds: ['/roster top'], text: 'the top 3 in each tradeskill' },
  { cmds: ['/roster recipes'], text: 'who knows the rare reputation and discovery recipes' },
  '**Items and data**',
  { cmds: ['/item image'], text: 'submit a screenshot of an item window' },
  { cmds: ['/craft report'], text: 'report a wrong recipe, trivial or component' },
  { cmds: ['/recipe add'], text: 'record a recipe the data is missing (officer-approved)' },
  '**Officers and admins**',
  { cmds: ['/guildcraft setup'], text: 'set the member and officer roles, the roster board forum and the review channel' },
  { cmds: ['/guildcraft status'], text: 'data version, last import, the roster board, departures, the backup and free-tier usage' },
  { cmds: ['/recipe source', '/recipe override'], text: 'set how a recipe is obtained; correct a recipe' },
  { cmds: ['/guildcraft remove-member'], text: 'remove a departed member' },
  { cmds: ['/guildcraft rebuild-board'], text: 'recreate the roster board posts in A→Z order' },
  { cmds: ['/craft help'], text: 'this guide' },
];

export const isBuilt = (cmd: string) => DEFINED.has(cmd);

export const HELP_TEXT = [
  '## GuildCraft — every command',
  ...HELP_LINES.map((l) =>
    typeof l === 'string' ? l : `${l.cmds.map((c) => `\`${c}\``).join(' · ')} ${l.text}${l.cmds.every(isBuilt) ? '' : ` ${COMING_SOON}`}`,
  ),
  '',
  `-# ${HELP_FOOTER} · Item data: Monsters and Memories Wiki (CC BY-SA 4.0)`,
].join('\n');

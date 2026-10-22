// Approved copy (docs/COPY.md, order 11).
// Lists every command in docs/PRD.md (FR-1 to FR-9). "(coming soon)" is derived, never typed: an entry
// is marked when its commands are not in the registered definitions (src/commands/definitions.ts).
import { ephemeral } from '../discord.ts';
import { DEFINED } from './definitions.ts';

export const HELP_FOOTER = 'Item data: Monsters and Memories Wiki (CC BY-SA 4.0)';
export const COMING_SOON = '*(coming soon)*';
/** Order 10: who runs GuildCraft, and how to reach them (the operator's decision of 2026-10-20). */
export const CONTACT = 'Questions or problems: send a Discord message to **Joegandomi**, who runs GuildCraft.';

/** A heading, or one entry: its commands and what they do. Every command in an entry shares one status. */
export type HelpLine = string | { cmds: string[]; text: string };

export const HELP_LINES: HelpLine[] = [
  '**Your characters**',
  { cmds: ['/character add'], text: 'register a character (name, class, level, main)' },
  { cmds: ['/character edit'], text: 'rename it or change class, level or main' },
  { cmds: ['/character remove'], text: 'remove a character (its skills are kept if you add it back)' },
  '**Your skills and recipes**',
  { cmds: ['/craft set'], text: 'set one tradeskill level' },
  // Order 16: shortened so /craft help stays one message with the request commands.
  { cmds: ['/craft update'], text: 'set up to 5 tradeskill levels at once' },
  { cmds: ['/craft me'], text: 'your skills, levels and last update (private)' },
  { cmds: ['/craft know', '/craft forget'], text: 'mark a recipe known (or press **I know this recipe**), or undo it' },
  '**Find a crafter**',
  { cmds: ['/craft find'], text: 'who can make an item, with its recipe and stats' },
  { cmds: ['/roster skill'], text: 'everyone with a tradeskill, ranked' },
  { cmds: ['/roster member'], text: "one member's characters and skills" },
  { cmds: ['/roster top'], text: 'the top 3 in each tradeskill' },
  { cmds: ['/roster recipes'], text: 'who knows the hard-to-get reputation and discovery recipes' },
  // Order 16.
  { cmds: ['/craft request', '/craft requests'], text: 'ask the crafters who can make an item, privately; list or cancel yours' },
  { cmds: ['/craft notify'], text: 'get added to requests you can craft (off by default)' },
  '**Items and data**',
  { cmds: ['/gear find'], text: '— gear for your class by slot, type, AC, ratio, stats and source' },
  // Order 17.
  { cmds: ['/zone'], text: "a zone's level range, creatures, drops and spots, with MnM Atlas and wiki links" },
  { cmds: ['/item image'], text: 'send an item window screenshot; it shows under **Stat image** once an officer approves' },
  { cmds: ['/craft report'], text: 'report wrong recipe data or a missing recipe (or press **Report a problem**)' },
  { cmds: ['/recipe add'], text: 'record a recipe the data is missing (officer-approved)' },
  '**Officers and admins**',
  { cmds: ['/guildcraft setup'], text: 'set the roles, the board forum, and the review, vault and request channels' },
  { cmds: ['/guildcraft status'], text: 'data version and update, the board, the channels and the backup' },
  { cmds: ['/recipe source', '/recipe override'], text: 'how a recipe is obtained; fix its trivial or ingredients (this server only)' },
  { cmds: ['/guildcraft remove-member'], text: 'remove a departed member' },
  { cmds: ['/guildcraft rebuild-board'], text: 'recreate the roster board posts in A→Z order' },
  { cmds: ['/craft help'], text: 'this guide' },
];

export const isBuilt = (cmd: string) => DEFINED.has(cmd);

/**
 * Order 17: the guide no longer fits a message's 2,000 characters of content (it was at 1,998 before /zone), so it is
 * sent as an embed's description (4,096); the text is unchanged.
 */
export const HELP_LIMIT = 4096;
export const helpReply = () => ephemeral('', { embeds: [{ description: HELP_TEXT }] });

export const HELP_TEXT = [
  '## GuildCraft — every command',
  ...HELP_LINES.map((l) =>
    typeof l === 'string' ? l : `${l.cmds.map((c) => `\`${c}\``).join(' · ')} ${l.text}${l.cmds.every(isBuilt) ? '' : ` ${COMING_SOON}`}`,
  ),
  '',
  CONTACT,
  `-# ${HELP_FOOTER}`,
].join('\n');

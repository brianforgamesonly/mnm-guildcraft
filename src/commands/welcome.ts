// DRAFT copy — Brian approves the final text before launch (ORDER-RULES: Product).
// Shown once, privately, with a new member's first command reply (PRD FR-9).
// "(coming soon)" is derived from the registered definitions, as in /craft help.
import type { Embed } from '../discord.ts';
import { isBuilt } from './help.ts';

export const WELCOME: Embed = {
  title: 'Welcome to GuildCraft',
  description: [
    'Three steps to get on the guild roster:',
    '**1.** `/character add`: register your character. Your first one becomes your main.',
    '**2.** `/craft update`: press Enter, pick up to 5 tradeskills, then type their levels. Or press the **Update skills** button under your `/craft me`, `/craft set` or `/character add` reply. (`/craft set` sets one skill.)',
    `**3.** \`/craft find\`: look up who in the guild can make an item.${isBuilt('/craft find') ? '' : ' *(coming soon: not available yet)*'}`,
    '',
    '*You see this message once. `/craft help` lists every command. (draft)*',
  ].join('\n'),
};

// DRAFT copy — Brian approves the final text before launch (ORDER-RULES: Product).
// Shown once, privately, with a new member's first command reply (PRD FR-9).
import type { Embed } from '../discord.ts';

export const WELCOME: Embed = {
  title: 'Welcome to GuildCraft',
  description: [
    'Three steps to get on the guild roster:',
    '**1.** `/character add`: register your character. Your first one becomes your main.',
    '**2.** `/craft set` (one skill) or `/craft update` (up to 5 at once): enter your tradeskill levels.',
    '**3.** `/craft find`: look up who in the guild can make an item. *(coming soon: not available yet)*',
    '',
    '*You see this message once. `/craft help` lists every command. (draft)*',
  ].join('\n'),
};

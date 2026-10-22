// Shown once, privately, with a new member's first command reply (PRD FR-9). Order 18: the new command names
// (docs/COPY.md lists it for approval).
import type { Embed } from '../discord.ts';
import { CONTACT } from './help.ts';

export const WELCOME: Embed = {
  title: 'Welcome to GuildCraft',
  description: [
    'Three steps to get started:',
    '**1.** `/me`: press **Add character** to register your character. Your first one becomes your main.',
    '**2.** `/skills`: press Enter, pick up to 5 tradeskills, then type their levels. (`/skills skill: level:` sets one.)',
    'Or press **Update skills** on your `/me`.',
    '**3.** `/item`: look up any item, and who in the guild can make it.',
    '',
    '*You see this message once. `/help` shows every command.*',
    CONTACT,
  ].join('\n'),
};

// /help (work order 18): a guide in pages, with a button for each page. The commands on each page come from the
// registered definitions (src/commands/definitions.ts DEFINED_LIST: each command's own description), placed by
// PAGE_OF; test/worker/help.test.ts checks every defined command is on exactly one page. Copy: docs/COPY.md.
import { button, ephemeral, row, STYLE_PRIMARY, STYLE_SECONDARY, updateMessage, type Embed, type MessageReply } from '../discord.ts';
import { COMMANDS, DEFINED, DEFINED_LIST } from './definitions.ts';
import { DKP_DEFINED_LIST } from '../dkp/definition.ts';
import { EVENT_DEFINED_LIST } from '../events/definition.ts';

export const HELP_FOOTER = 'Item data: Monsters and Memories Wiki (CC BY-SA 4.0)';
export const COMING_SOON = '*(coming soon)*';
/** Order 10: who runs GuildCraft, and how to reach them (the operator's decision of 2026-10-20). */
export const CONTACT = 'Questions or problems: send a Discord message to **Joegandomi**, who runs GuildCraft.';
/** Page buttons: "help:<page key>" (answered for anyone, edited in place). */
export const HELP_PREFIX = 'help:';

export type PageKey = 'start' | 'find' | 'profile' | 'requests' | 'officers' | 'admins' | 'dkp' | 'events';
type CommandName = (typeof COMMANDS)[number]['name'];

/** Which page lists each command: every registered command has one (a missing one fails to type-check). */
export const PAGE_OF: Record<CommandName, PageKey> = {
  help: 'start',
  item: 'find',
  gear: 'find',
  roster: 'find',
  zone: 'find',
  me: 'profile',
  skills: 'profile',
  request: 'requests',
  officer: 'officers',
  guildcraft: 'admins',
};

/** The PRD's commands that are not built yet, each on the page it belongs to (test: these and only these are unbuilt). */
export const COMING: { cmd: string; text: string; page: PageKey }[] = [{ cmd: '/recipe add', text: 'record a recipe the data is missing (officer-approved)', page: 'officers' }];

/** Each page: its button label, and the lines above and below its commands. */
export const PAGES: { key: PageKey; label: string; before: string[]; after: string[] }[] = [
  {
    key: 'start',
    label: 'Getting started',
    before: [
      '**1.** `/me`: press **Add character** to register your character. Your first one becomes your main.',
      '**2.** `/skills`: press Enter, pick up to 5 tradeskills, then type their levels. (`/skills skill: level:` sets one.)',
      '**3.** `/item`: any item: its stats, where it comes from, its recipe and who in the guild can make it.',
      'Replies are private to you unless you press **Post to channel**.',
    ],
    after: [CONTACT],
  },
  {
    key: 'find',
    label: 'Finding things',
    before: [],
    after: [
      'On an `/item` card for a craftable item: **I know this recipe**, **Report a recipe problem**, **Report item data**, **Request a craft**. On any other item card: **Report a problem**.',
    ],
  },
  {
    key: 'profile',
    label: 'Your profile',
    before: [],
    after: ['`/me` has buttons to add, edit or remove a character, update skills, turn on request notices, forget a recipe and cancel a request.'],
  },
  {
    key: 'requests',
    label: 'Requests',
    before: [],
    after: [
      'Crafters who turned on **Notices** in `/me` for the tradeskill are added to a private thread and pinged there. Press **Request a craft** on an `/item` card to start one too.',
      'Your open requests are in `/me`, with **Cancel a request**.',
    ],
  },
  {
    key: 'officers',
    label: 'Officers',
    before: [],
    after: ['Server admins grant `/officer` to the officer role once: Server Settings → Integrations → the app → `/officer`.'],
  },
  { key: 'admins', label: 'Admins', before: [], after: [] },
  // Order 27: only in a server with DKP on (pagesFor); its commands are /dkp's per-server definition.
  {
    key: 'dkp',
    label: 'DKP',
    before: ['Points for raid attendance, kept per raid zone. Standings and raid cards are in GC-DKP; everyone in the server can see them.'],
    after: ['On a raid card: **Present**, **Standby** (held outside a full raid) and **Leaving**. Your state carries over to every later kill. `/me` shows your points and 30-day attendance.'],
  },
  // Order 32: only in a server with the Events module on; its commands are /event's per-server definition.
  {
    key: 'events',
    label: 'Events',
    before: ['Raids and get-togethers with sign-ups. Event cards are in GC-Events; everyone in the server can see them.'],
    after: [],
  },
];

/** The pages a server sees: the DKP page only where DKP is on (order 27), the Events page only where Events is on (order 32). */
export const pagesFor = (dkp: boolean, events = false) => PAGES.filter((p) => (dkp || p.key !== 'dkp') && (events || p.key !== 'events'));

/** One page's text: its lines, the commands it lists (from the definitions) and the coming-soon ones placed on it. */
export function pageText(key: PageKey): string {
  const page = PAGES.find((p) => p.key === key)!;
  const listed = key === 'dkp' ? DKP_DEFINED_LIST : key === 'events' ? EVENT_DEFINED_LIST : DEFINED_LIST.filter((d) => PAGE_OF[d.command as CommandName] === key);
  const commands = listed.map((d) => `\`${d.cmd}\` ${d.description}`);
  const coming = COMING.filter((c) => c.page === key).map((c) => `\`${c.cmd}\` ${c.text} ${COMING_SOON}`);
  return [...page.before, ...(page.before.length && commands.length ? [''] : []), ...commands, ...coming, ...(page.after.length ? ['', ...page.after] : [])].join('\n');
}

export function helpPage(key: PageKey, dkp = false, events = false): { embeds: Embed[]; components: unknown[] } {
  const pages = pagesFor(dkp, events);
  const n = Math.max(0, pages.findIndex((p) => p.key === key));
  const page = pages[n];
  const buttons = pages.map((p) => button(`${HELP_PREFIX}${p.key}`, p.label, p.key === page.key ? STYLE_PRIMARY : STYLE_SECONDARY, p.key === page.key));
  return {
    embeds: [{ title: `GuildCraft help · ${page.label} (${n + 1} of ${pages.length})`, description: pageText(page.key), footer: { text: HELP_FOOTER } }],
    // Discord: 5 buttons a row. Order 27: the second row holds the DKP page where DKP is on.
    components: [row(buttons.slice(0, 3)), row(buttons.slice(3))],
  };
}

export const isBuilt = (cmd: string) => DEFINED.has(cmd);
export const helpReply = (dkp = false, events = false): MessageReply => ephemeral('', helpPage('start', dkp, events));

/** help:<key>: another page, in place (the presser's own private message). The DKP and Events pages only where each is on. */
export function helpButton(customId: string, dkp = false, events = false): MessageReply {
  const key = customId.slice(HELP_PREFIX.length) as PageKey;
  return updateMessage(helpPage(pagesFor(dkp, events).some((p) => p.key === key) ? key : 'start', dkp, events));
}

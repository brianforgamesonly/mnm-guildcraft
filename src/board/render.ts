// The roster board's posts (order 5, PRD FR-5 and FR-9), rendered from rows with no I/O, so the Worker,
// the tests and the read-only dry run (scripts/board/run.ts) all render the same way.
import { EMBED_LIMITS, md, memberTag, NO_PINGS, plural, truncate, type AllowedMentions, type Embed } from '../discord.ts';

/** One ranked line: a live character's level in one tradeskill (removed characters and departed members are filtered in SQL). */
export interface BoardLine {
  tradeskill_id: number;
  character: string;
  owner_user_id: string;
  member: string;
  level: number;
  updated_at: string;
}

/** What one bot-owned message of a post carries. */
export interface BoardMessage {
  embeds: Embed[];
  allowed_mentions: AllowedMentions;
}

const DAY_MS = 86_400_000;
export const BOARD_COLOR = 0x8a6d3b;
/** Every board create and edit (first post, rewrites, the nightly run, a rebuild) sends this: the board never pings. */
const NO_MENTIONS = NO_PINGS;

/** "2 characters (1 member)": the count lives in the body, never the title (thread renames are tightly rate-limited). */
export function countText(lines: Pick<BoardLine, 'owner_user_id'>[]): string {
  const members = new Set(lines.map((l) => l.owner_user_id)).size;
  return `${plural(lines.length, 'character')} (${plural(members, 'member')})`;
}

/**
 * A tradeskill post: rank, character, the member (a mention that pings nobody, with the saved name beside it; order 16),
 * skill level, and a stale marker after stale_days. Lines fill embeds of at most 4,096 description characters, and
 * messages of at most 6,000 embed characters and 10 embeds (EMBED_LIMITS); what does not fit goes to further bot-owned
 * messages. The split is measured on each line's own length, so longer lines (a mention is 21-22 characters) simply
 * move to the next embed or message sooner.
 */
export function renderSkillPost(skill: string, lines: BoardLine[], staleDays: number, nowMs: number): BoardMessage[] {
  const staleBefore = nowMs - staleDays * DAY_MS;
  let anyStale = false;
  const rows = lines.map((l, i) => {
    const stale = Date.parse(l.updated_at) < staleBefore;
    anyStale ||= stale;
    return `**${i + 1}.** **${md(l.character)}** · ${memberTag(l.owner_user_id, l.member)} · ${l.level}${stale ? ' · *stale*' : ''}`;
  });
  const title = truncate(skill, EMBED_LIMITS.title);
  const head = lines.length
    ? `${countText(lines)}, ranked by skill level.`
    : `No one in the guild has recorded ${skill} yet. Use \`/craft set\` to get listed.`;
  const footer = anyStale ? { text: `stale = not updated in ${staleDays} days` } : undefined;
  // Room reserved in every message for the title and footer, so any message may carry them.
  const reserve = title.length + (footer?.text.length ?? 0);

  const messages: Embed[][] = [];
  let embeds: Embed[] = [];
  let desc: string[] = [head];
  let descLen = head.length;
  let msgLen = reserve + head.length;
  const closeEmbed = () => {
    embeds.push({ description: desc.join('\n'), color: BOARD_COLOR });
    desc = [];
    descLen = 0;
  };
  for (const row of rows) {
    const add = row.length + (desc.length ? 1 : 0);
    if (descLen + add > EMBED_LIMITS.description || msgLen + add > EMBED_LIMITS.total) {
      closeEmbed();
      if (msgLen + row.length > EMBED_LIMITS.total || embeds.length >= EMBED_LIMITS.embeds) {
        messages.push(embeds);
        embeds = [];
        msgLen = reserve;
      }
    }
    desc.push(row);
    descLen += row.length + (desc.length > 1 ? 1 : 0);
    msgLen += row.length + 1;
  }
  closeEmbed();
  messages.push(embeds);

  messages[0][0].title = title;
  if (footer) messages.at(-1)!.at(-1)!.footer = footer;
  return messages.map((e) => ({ embeds: e, allowed_mentions: NO_MENTIONS }));
}

export interface IndexEntry {
  skill: string;
  /** The tradeskill's forum post, once created. */
  thread_id: string | null;
  lines: number;
}

/** How to get listed (PRD FR-9). */
export const HOW_TO_GET_LISTED = [
  '**How to get listed**',
  '1. `/character add` your character.',
  '2. `/craft set` a tradeskill level, or `/craft update` for several at once.',
  '3. Your tradeskill posts update within about a minute.',
  '',
  // Order 9: the new commands, one line each.
  '**Also**',
  '`/craft find` who can make an item · `/craft know` mark a recipe you know · `/roster recipes` who knows the hard-to-get ones',
  '`/craft report` report wrong data · `/item image` send an item screenshot · `/craft help` every command',
  // Order 13.
  '`/gear find` gear for your class, by slot, stats and source',
  // Order 16.
  '`/craft request` ask the crafters who can make an item · `/craft notify` be added to requests you can craft',
  // Order 17.
  "`/zone` a zone's levels, creatures, drops and map links",
].join('\n');

/**
 * The pinned index post: a link to every tradeskill post with its count, how to get listed, and the last
 * refresh as a Discord timestamp. `hashable` is the same text without the time, so an index whose links
 * and counts are unchanged is not edited just because time passed.
 */
export function renderIndex(entries: IndexEntry[], refreshedAtMs: number): { message: BoardMessage; hashable: string } {
  const links = entries.map((e) => `${e.thread_id ? `<#${e.thread_id}>` : `${e.skill} *(post coming)*`} · ${plural(e.lines, 'character')}`);
  const body = [links.join('\n'), '', HOW_TO_GET_LISTED].join('\n');
  const t = Math.floor(refreshedAtMs / 1000);
  const description = truncate(`${body}\n\nLast refresh: <t:${t}:f> (<t:${t}:R>)`, EMBED_LIMITS.description);
  return {
    message: { embeds: [{ title: 'Crafting roster: index', description, color: BOARD_COLOR }], allowed_mentions: NO_MENTIONS },
    hashable: body,
  };
}

export const INDEX_TITLE = 'Index: how to get listed';

/** Hex SHA-256 of a post's messages (Web Crypto: the same in the Worker and in Node). */
export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

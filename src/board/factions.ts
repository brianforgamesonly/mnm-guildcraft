// Order 24 (ITEM 2): the factions board's posts, rendered from rows with no I/O (as src/board/render.ts renders the
// tradeskill board's), so the Worker, the tests and the read-only dry run (scripts/board/run.mjs) render the same way.
//
// The two sections use the wiki infobox's own labels (order 24, A): an NPC's "factions" field is shown on the wiki as
// "Reputation Lost", its "opposing_factions" as "Reputation Gained". Nothing else is inferred: no amounts (the source
// records none), and no mechanic the wiki does not state.
import { EMBED_LIMITS, md, NO_PINGS, plural, truncate, type Embed } from '../discord.ts';
import { BOARD_COLOR, plainText, type BoardMessage, type LineMode } from './render.ts';

/** One creature row on a faction's post: an active link to an active npc row in an active zone. */
export interface FactionLine {
  faction_id: number;
  kind: 'lost' | 'gained';
  creature: string;
  zone: string;
  /** Free text as the wiki records it (e.g. "~45", "23-24"); NULL when it records none. */
  level: string | null;
  location: string | null;
}

// Order 24: member-facing copy, listed in docs/COPY.md.
export const FACTION_COPY = {
  gained: 'Reputation Gained',
  lost: 'Reputation Lost',
  none: "No creature's wiki page lists it here.",
  footer: "As listed on each creature's wiki page (Monsters and Memories Wiki, CC BY-SA 4.0). Amounts aren't recorded.",
  indexTitle: 'Factions: index',
  indexIntro: [
    'One post per faction, A→Z below. Each lists the creatures whose wiki page names the faction under **Reputation Gained** or **Reputation Lost**, by zone.',
    "As listed on each creature's wiki page (Monsters and Memories Wiki, CC BY-SA 4.0). Amounts aren't recorded.",
  ].join('\n'),
  coming: (n: number) => `${plural(n, 'more post')} coming: the board fills in over the next few hours.`,
};

/** A creature's line: its name, then whichever of level and location the wiki records. */
export function creatureText(l: Pick<FactionLine, 'creature' | 'level' | 'location'>): string {
  const extra = [l.level?.trim() ? `level ${l.level.trim()}` : null, l.location?.trim() || null].filter(Boolean) as string[];
  return `${md(l.creature)}${extra.length ? ` (${extra.map(md).join(', ')})` : ''}`;
}

/** Creatures, counted once per (zone, name): the same creature in two zones is two npc rows. */
const creatures = (lines: Pick<FactionLine, 'zone' | 'creature'>[]) => new Set(lines.map((l) => `${l.zone}\n${l.creature.toLowerCase()}`)).size;

/** Order 24: the post's first-message line, the forum list's preview. */
export function factionPreview(faction: string, lines: FactionLine[]): string {
  const g = creatures(lines.filter((l) => l.kind === 'gained'));
  const l = creatures(lines.filter((x) => x.kind === 'lost'));
  return `${plainText(faction)} · ${plural(creatures(lines), 'creature')}: reputation gained from ${g}, lost from ${l}`;
}

/** One section: its heading, then each zone (A→Z) and its creatures (A→Z), as the SQL orders them. */
function section(kind: FactionLine['kind'], lines: FactionLine[]): string[] {
  const mine = lines.filter((l) => l.kind === kind);
  const head = `**${kind === 'gained' ? FACTION_COPY.gained : FACTION_COPY.lost}** · ${plural(creatures(mine), 'creature')}`;
  if (!mine.length) return [head, FACTION_COPY.none];
  const out = [head];
  let zone: string | null = null;
  for (const l of mine) {
    if (l.zone !== zone) {
      zone = l.zone;
      out.push(`__${md(zone)}__`);
    }
    out.push(`• ${creatureText(l)}`);
  }
  return out;
}

/**
 * A faction's post: Reputation Gained, then Reputation Lost. Rows fill embeds of at most 4,096 description characters,
 * and messages of at most 6,000 characters and 10 embeds (EMBED_LIMITS); what does not fit goes to further bot-owned
 * messages, as the tradeskill post's do. The title is on the first embed, the source footer on the last.
 */
export function renderFactionPost(faction: string, lines: FactionLine[], line: LineMode = 'on'): BoardMessage[] {
  const rows = [...section('gained', lines), '', ...section('lost', lines)];
  const title = truncate(faction, EMBED_LIMITS.title);
  const footer = { text: FACTION_COPY.footer };
  const reserve = title.length + footer.text.length;
  const messages: Embed[][] = [];
  let embeds: Embed[] = [];
  let desc: string[] = [];
  let descLen = 0;
  let msgLen = reserve;
  const closeEmbed = () => {
    embeds.push({ description: desc.join('\n'), color: BOARD_COLOR });
    desc = [];
    descLen = 0;
  };
  for (const row of rows) {
    const add = row.length + (desc.length ? 1 : 0);
    if (desc.length && (descLen + add > EMBED_LIMITS.description || msgLen + add > EMBED_LIMITS.total)) {
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
  messages.at(-1)!.at(-1)!.footer = footer;
  return messages.map((e, i) => ({ ...(i === 0 ? { content: line === 'on' ? factionPreview(faction, lines) : '' } : {}), embeds: e, allowed_mentions: NO_PINGS }));
}

export interface FactionIndexEntry {
  faction: string;
  thread_id: string | null;
  creatures: number;
}

/** Order 24: the index's first-message line. */
export const factionIndexLine = (factions: number): string => `Factions · ${plural(factions, 'post')}, A→Z · from each creature's wiki page`;

/**
 * The pinned index: what the board holds, a link to every faction's post with its creature count, and the last refresh.
 * Posts not created yet are counted in one line (their names would overflow the message while the board fills). The links
 * fill embeds of at most 4,096 characters in one message (125 links are about 3,700 characters, under the 6,000 total).
 * `hashable` leaves out the time, as the tradeskill index's does.
 */
export function renderFactionIndex(entries: FactionIndexEntry[], refreshedAtMs: number, line: LineMode = 'on'): { message: BoardMessage; hashable: string } {
  const posted = entries.filter((e) => e.thread_id);
  const missing = entries.length - posted.length;
  const t = Math.floor(refreshedAtMs / 1000);
  // Review of PR A: the message's 6,000-character total holds about 150 links with counts. Past that the counts are left
  // out, and past about 250 bare links the rest are counted in one line, so the index never fails to post.
  const budget = EMBED_LIMITS.total - FACTION_COPY.indexIntro.length - FACTION_COPY.indexTitle.length - 300;
  const withCounts = posted.map((e) => `<#${e.thread_id}> · ${plural(e.creatures, 'creature')}`);
  const size = (xs: string[]) => xs.reduce((n, x) => n + x.length + 1, 0);
  let links = size(withCounts) <= budget ? withCounts : posted.map((e) => `<#${e.thread_id}>`);
  if (size(links) > budget) {
    const fit = Math.floor((budget - 80) / (links[0].length + 1));
    links = [...links.slice(0, fit), `…and ${plural(links.length - fit, 'more post')} below.`];
  }
  const rows = [FACTION_COPY.indexIntro, '', ...links, ...(missing ? ['', FACTION_COPY.coming(missing)] : [])];
  const embeds: Embed[] = [];
  let desc: string[] = [];
  let len = 0;
  for (const r of rows) {
    if (desc.length && len + r.length + 1 > EMBED_LIMITS.description - 100) {
      embeds.push({ description: desc.join('\n'), color: BOARD_COLOR });
      desc = [];
      len = 0;
    }
    desc.push(r);
    len += r.length + 1;
  }
  desc.push('', `Last refresh: <t:${t}:f> (<t:${t}:R>)`);
  embeds.push({ description: desc.join('\n'), color: BOARD_COLOR });
  embeds[0].title = FACTION_COPY.indexTitle;
  const content = line === 'on' ? factionIndexLine(entries.length) : '';
  return {
    message: { content, embeds: embeds.slice(0, EMBED_LIMITS.embeds), allowed_mentions: NO_PINGS },
    hashable: `${rows.join('\n')}\n\ncontent: ${content}`,
  };
}

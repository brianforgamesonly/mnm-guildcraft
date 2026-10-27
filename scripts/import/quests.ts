// Order 25, ITEM 1: quest lines on the faction posts, the narrow version (the owner, 2026-10-27). From Mo Betta's
// quests.json (override 1: read for this only), each quest's reward lines that begin with "Faction" (case-insensitive,
// leading spaces trimmed). A line mentions a faction when it contains a stored faction name exactly (case-insensitive,
// as a whole phrase), after the approved merges; where names overlap the longest wins. Nothing about direction or amount
// is inferred: the post quotes the line. Lines that mention no faction are shown nowhere and reported.
// Pure TypeScript, like zones.ts.

import { ZoneStructureError } from './zones.ts';

export interface QuestLineRow {
  faction: string;
  quest: string;
  /** The quest's wiki page as recorded; NULL when it records none. */
  url: string | null;
  /** The reward line, trimmed, as the post quotes it. */
  line: string;
}

export interface QuestSummary {
  quests: number;
  /** Quests with at least one "Faction…" reward line. */
  questsWithLines: number;
  lines: number;
  /** Each "Faction…" line and the factions it mentions (empty: shown nowhere). */
  matched: { quest: string; line: string; factions: string[] }[];
  unmatched: { quest: string; line: string }[];
  /** Records without a title: skipped. */
  untitled: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A letter or digit: a name matches only where the characters either side of it are neither. */
const WORD = /[\p{L}\p{N}]/u;

/** The faction names a line mentions: every whole-phrase occurrence, longest first, overlaps dropped. */
export function mentions(line: string, factions: readonly string[]): string[] {
  const text = line.toLowerCase();
  const hits: { start: number; end: number; faction: string }[] = [];
  for (const faction of factions) {
    const name = faction.toLowerCase();
    if (!name) continue;
    for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
      const end = at + name.length;
      if ((at > 0 && WORD.test(text[at - 1])) || (end < text.length && WORD.test(text[end]))) continue;
      hits.push({ start: at, end, faction });
    }
  }
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken: typeof hits = [];
  for (const h of hits) if (!taken.some((t) => h.start < t.end && t.start < h.end)) taken.push(h);
  return [...new Set(taken.sort((a, b) => a.start - b.start).map((t) => t.faction))];
}

export function factionQuestLines(raw: unknown, factions: readonly string[]): { rows: QuestLineRow[]; summary: QuestSummary } {
  if (!isObj(raw) || !Array.isArray(raw.quests)) throw new ZoneStructureError('mo-betta/quests.json: quests is not a list');
  const rows = new Map<string, QuestLineRow>();
  const summary: QuestSummary = { quests: raw.quests.length, questsWithLines: 0, lines: 0, matched: [], unmatched: [], untitled: 0 };
  for (const q of raw.quests as unknown[]) {
    if (!isObj(q) || typeof q.title !== 'string' || !q.title.trim()) {
      summary.untitled++;
      continue;
    }
    const quest = q.title;
    const url = typeof q.url === 'string' && q.url.trim() ? q.url : null;
    const lines = (Array.isArray(q.rewards) ? q.rewards : [])
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim())
      .filter((r) => /^faction/i.test(r));
    if (lines.length) summary.questsWithLines++;
    for (const line of new Set(lines)) {
      summary.lines++;
      const found = mentions(line, factions);
      if (!found.length) summary.unmatched.push({ quest, line });
      else summary.matched.push({ quest, line, factions: found });
      for (const faction of found) {
        const id = `${faction}|${quest}|${line}`;
        if (!rows.has(id)) rows.set(id, { faction, quest, url, line });
      }
    }
  }
  return { rows: [...rows.values()], summary };
}

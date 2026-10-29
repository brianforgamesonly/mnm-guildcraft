// Order 28, ITEM 2: the wiki snapshot (scripts/wiki/snapshot.ts) parsed into the zone data's source rows. Pure
// TypeScript: the import, the comparison (ITEM 3) and the tests run exactly this code.
//
// Rules (order 28, section D):
// - every template field the import reads is named once, in TEMPLATE_FIELDS; a missing field is NULL, never guessed;
// - each NPC template block is one NPC × zone (override 6): a block's zone text is one zone name, never split;
// - removing link markup ([[…]], [[…|…]]), HTML entities and tags, and bold/italic quotes is parsing, not a name
//   normalisation; the label of a [[target|label]] link is kept, as the page shows it (and as Mo Betta kept it);
// - named and raid come from the wiki's categories (override 4), merchant from Category:Merchant. Nothing is inferred
//   from a name.

import { WIKI } from '../probe/wiki.ts';
import { CATEGORIES, treePages, type WikiSnapshot } from './types.ts';

/**
 * Every template and field the import reads, in one place. Keys are matched case-insensitively (the parser lowercases
 * them). NPC pages: Mo Betta read these four templates, so the comparison (ITEM 3) measures the same population;
 * {{Namedmobpage}} is the one the order names, and the summary counts blocks per template.
 */
export const TEMPLATE_FIELDS = {
  npcTemplates: ['Namedmobpage', 'Mobpage', 'NPCpage', 'Merchantpage'],
  npc: {
    name: 'name',
    zone: 'zone',
    level: 'level',
    race: 'race',
    class: 'class',
    location: 'location',
    /** Loot, in this order: known_loot's bullets, then common_loot's, de-duplicated. */
    loot: ['known_loot', 'common_loot'],
    factions: 'factions',
    opposingFactions: 'opposing_factions',
  },
  zoneTemplate: 'ZoneDetails',
  zone: { level: 'level', adjacent: 'adjacentzones' },
  /** Quest pages: the reward lines are the bullets under a level-2 heading that starts with "Reward". */
  questRewardHeading: /^reward/i,
} as const;

export const wikiPageUrl = (title: string) => `${WIKI}/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;

// ---------------------------------------------------------------- wikitext

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };
/** HTML entities decoded (named ones above, and numeric). */
export const decodeEntities = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });

const LINK = /\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g;

/**
 * The text a reader sees: links to their label, entities decoded, tags and bold/italic quotes removed, spaces collapsed.
 * `target`: a link to the page it names instead (the zone field: [[Rothold|the city]] names the zone page Rothold), as a
 * page title: without a "#section" or a leading ":", underscores as spaces (link markup, not a name normalisation).
 * References (<ref>…</ref>, <ref …/>) are footnotes, not the value: removed whole. A {{template}} inside a value is left
 * as it is; the parser stores such a value as NULL and counts it (hasTemplate).
 */
export function plain(s: string | undefined | null, opts: { target?: boolean } = {}): string {
  if (!s) return '';
  const page = (t: string) => t.split('#')[0].replace(/_/g, ' ').replace(/^\s*:/, '').trim();
  let t = s.replace(LINK, (_, target: string, label?: string) => (!opts.target && label?.trim() ? label : opts.target ? page(target) : target));
  const refs = (x: string) => x.replace(/<ref\b[^>]*\/>/gi, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  t = refs(decodeEntities(refs(t)));
  t = t.replace(/<[^>]*>/g, '').replace(/'''|''/g, '');
  return t.replace(/\s+/g, ' ').trim();
}
/** plain(), or NULL when nothing is left. */
export const text = (s: string | undefined | null): string | null => plain(s) || null;
/** A value that still holds a template after parsing: its text is not read (NULL, counted). */
export const hasTemplate = (s: string) => s.includes('{{');

/** The labels of a value's links, in order. */
export const links = (s: string | undefined | null): string[] =>
  [...(s ?? '').matchAll(LINK)].map((m) => plain(m[2]?.trim() ? m[2] : m[1])).filter((x) => x !== '');

/** A value's bullet lines ("* …"), each as plain text. */
export const bullets = (s: string | undefined | null): string[] =>
  (s ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('*'))
    .map((l) => plain(l.replace(/^\*+/, '')))
    .filter((x) => x !== '');

/**
 * Every {{name …}} block in a page, in page order: its fields as { lowercased key: raw value }. Nested {{…}} and [[…]]
 * are kept inside a value; a field without "=" (a positional one) is ignored.
 */
export function templates(page: string, name: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const head = new RegExp(`\\{\\{\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(?=\\||\\}\\}|\\n)`, 'gi');
  for (const m of page.matchAll(head)) {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    while (i < page.length && depth) {
      if (page.startsWith('{{', i)) (depth++, (i += 2));
      else if (page.startsWith('}}', i)) (depth--, (i += 2));
      else i++;
    }
    if (depth) continue; // an unclosed block: not a template
    const body = page.slice(start, i - 2);
    const parts: string[] = [];
    let buf = '';
    let braces = 0;
    let brackets = 0;
    for (let j = 0; j < body.length; j++) {
      const two = body.slice(j, j + 2);
      if (two === '{{' || two === '}}' || two === '[[' || two === ']]') {
        if (two === '{{') braces++;
        else if (two === '}}') braces = Math.max(0, braces - 1);
        else if (two === '[[') brackets++;
        else brackets = Math.max(0, brackets - 1);
        buf += two;
        j++;
        continue;
      }
      if (body[j] === '|' && !braces && !brackets) {
        parts.push(buf);
        buf = '';
      } else buf += body[j];
    }
    parts.push(buf);
    const fields: Record<string, string> = {};
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq > 0) fields[p.slice(0, eq).trim().toLowerCase()] = p.slice(eq + 1).trim();
    }
    out.push(fields);
  }
  return out;
}

// ---------------------------------------------------------------- the source rows

export interface WikiZone {
  name: string;
  level: string | null;
  adjacent: string[];
  url: string;
}
export interface WikiNpc {
  page: string;
  template: string;
  name: string;
  /** The block's zone text, markup removed; NULL: the block names no zone (never listed). */
  zone: string | null;
  kind: 'npc' | 'merchant';
  level: string | null;
  race: string | null;
  class: string | null;
  location: string | null;
  loot: string[];
  factions: string[];
  opposingFactions: string[];
  named: 0 | 1;
  raid: 0 | 1;
}
export interface WikiQuest {
  title: string;
  url: string;
  rewards: string[];
}
export interface WikiParse {
  zones: WikiZone[];
  npcs: WikiNpc[];
  quests: WikiQuest[];
  summary: {
    /** How deep the NPC tree's subcategories go (Category:NPCs is 0), and its categories and pages. */
    npcTree: { categories: number; depth: number; pages: number; pagesWithContent: number };
    npcBlocks: Record<string, number>;
    /** NPC pages using none of the templates. */
    npcPagesWithoutTemplate: string[];
    blocksWithoutZone: { page: string; name: string }[];
    /** Loot fields with text but no bullet line: their text is not read (reported, never guessed). */
    lootWithoutBullets: { page: string; field: string }[];
    /** Values (a loot bullet counts as one) still holding a {{template}} after parsing: stored NULL or left out; a name falls back to the title. */
    templateValues: { page: string; field: string }[];
    zonePages: number;
    zonePagesWithoutTemplate: string[];
    questPages: number;
    questsWithRewards: number;
    /** Category members: Named Mobs and Raid Encounters pages, and those of them outside the NPC tree (no row). */
    named: { pages: number; outsideTree: string[] };
    raid: { pages: number; outsideTree: string[] };
    merchantPages: number;
  };
}

/** A category's members, its subcategories' included (a page in a subcategory of Named Mobs is named). */
const members = treePages;

/** The level-2 section a line sits in, and the reward bullets (Mo Betta's rule, kept for the quest lines: order 25). */
export function questRewards(page: string): string[] {
  const out: string[] = [];
  let section = '';
  for (const raw of page.split('\n')) {
    const line = raw.trim();
    const h = /^(=+)\s*(.+?)\s*=+$/.exec(line);
    if (h) {
      if (h[1].length === 2) section = plain(h[2]);
      continue;
    }
    if (!TEMPLATE_FIELDS.questRewardHeading.test(section)) continue;
    if (line.startsWith('*') || line.includes('<li>')) {
      const r = plain(line.replace(/^\*+\s*/, ''));
      if (r) out.push(r);
    }
  }
  return out;
}

export function parseSnapshot(snap: WikiSnapshot): WikiParse {
  const F = TEMPLATE_FIELDS;
  const npcTree = Object.values(snap.categories).filter((c) => c.roots.includes(CATEGORIES.npcs));
  const npcPages = treePages(snap, CATEGORIES.npcs);
  const named = members(snap, CATEGORIES.named);
  const raid = members(snap, CATEGORIES.raid);
  const merchant = members(snap, CATEGORIES.merchant);
  const summary: WikiParse['summary'] = {
    npcTree: { categories: npcTree.length, depth: Math.max(0, ...npcTree.map((c) => c.depth ?? 0)), pages: npcPages.size, pagesWithContent: 0 },
    npcBlocks: Object.fromEntries(F.npcTemplates.map((t) => [t, 0])),
    npcPagesWithoutTemplate: [],
    blocksWithoutZone: [],
    lootWithoutBullets: [],
    templateValues: [],
    zonePages: 0,
    zonePagesWithoutTemplate: [],
    questPages: 0,
    questsWithRewards: 0,
    named: { pages: named.size, outsideTree: [...named].filter((t) => !npcPages.has(t)).sort() },
    raid: { pages: raid.size, outsideTree: [...raid].filter((t) => !npcPages.has(t)).sort() },
    merchantPages: merchant.size,
  };

  const npcs: WikiNpc[] = [];
  for (const title of [...npcPages].sort()) {
    const page = snap.pages[title];
    if (!page) continue;
    summary.npcTree.pagesWithContent++;
    let any = false;
    for (const template of F.npcTemplates)
      for (const b of templates(page.content, template)) {
        any = true;
        summary.npcBlocks[template]++;
        // A value still holding a template is not read: NULL, counted (a missing field is NULL, never guessed).
        const unread = (field: string) => void summary.templateValues.push({ page: title, field });
        const value = (field: string, opts?: { target?: boolean }): string | null => {
          const v = plain(b[field], opts) || null;
          if (v !== null && hasTemplate(v)) return (unread(field), null);
          return v;
        };
        const loot: string[] = [];
        for (const field of F.npc.loot) {
          const got = bullets(b[field]);
          if (!got.length && plain(b[field])) summary.lootWithoutBullets.push({ page: title, field });
          for (const l of got) {
            if (hasTemplate(l)) unread(field);
            else if (!loot.includes(l)) loot.push(l);
          }
        }
        const name = value(F.npc.name) ?? title;
        const zone = value(F.npc.zone, { target: true });
        if (!zone) summary.blocksWithoutZone.push({ page: title, name });
        npcs.push({
          page: title,
          template,
          name,
          zone,
          kind: merchant.has(title) ? 'merchant' : 'npc',
          level: value(F.npc.level),
          race: value(F.npc.race),
          class: value(F.npc.class),
          location: value(F.npc.location),
          loot,
          factions: links(b[F.npc.factions]),
          opposingFactions: links(b[F.npc.opposingFactions]),
          named: named.has(title) ? 1 : 0,
          raid: raid.has(title) ? 1 : 0,
        });
      }
    if (!any) summary.npcPagesWithoutTemplate.push(title);
  }

  const zones: WikiZone[] = [];
  for (const title of [...members(snap, CATEGORIES.zones)].sort()) {
    const page = snap.pages[title];
    if (!page) continue;
    summary.zonePages++;
    const [b] = templates(page.content, F.zoneTemplate);
    if (!b) {
      summary.zonePagesWithoutTemplate.push(title);
      continue;
    }
    const adjRaw = b[F.zone.adjacent];
    const adjacent = links(adjRaw).length ? links(adjRaw) : (adjRaw ?? '').split('\n').map((l) => plain(l.replace(/^\*+/, ''))).filter((x) => x !== '');
    zones.push({ name: title, level: text(b[F.zone.level])?.replace(/^-/, '').trim() || null, adjacent: [...new Set(adjacent)], url: wikiPageUrl(title) });
  }

  const quests: WikiQuest[] = [];
  for (const title of [...treePages(snap, CATEGORIES.quests)].sort()) {
    const page = snap.pages[title];
    if (!page) continue;
    summary.questPages++;
    const rewards = questRewards(page.content);
    if (rewards.length) summary.questsWithRewards++;
    quests.push({ title, url: wikiPageUrl(title), rewards });
  }
  return { zones, npcs, quests, summary };
}

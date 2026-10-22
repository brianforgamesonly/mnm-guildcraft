// Order 17, ITEM 2: the zone card. One D1 batch reads the zone, its mobs and NPCs, and its drops; nothing is written
// (the command's only write is its read audit row, 'zone.view', src/interactions.ts). Every field is fitted to Discord's
// limits here (fitLines), with "+N more" for what is left off; the paged lists show the rest.
import { EMBED_LIMITS, md, truncate, type Embed, type EmbedField } from '../discord.ts';
import { REMOVED_BIT } from '../gear/vocab.ts';
import { mergeCreature } from './creatures.ts';
import { levelSort, MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE, zoneNamesSql } from './names.ts';

// ---------------------------------------------------------------- copy (order 17; listed for approval in docs/COPY.md)

export const ZONE_COPY = {
  levels: (t: string | null) => `**Levels:** ${t ? md(t) : 'not recorded'}`,
  map: 'Map',
  noMap: 'No map yet',
  openAtlas: 'Open in MnM Atlas',
  wikiPage: 'Wiki page',
  gearHere: 'Gear here',
  moreCreatures: 'More creatures',
  moreDrops: 'More drops',
  adjacent: 'Adjacent zones',
  creatures: (n: number) => `Creatures (${n})`,
  drops: (n: number) => `Notable drops (${n})`,
  spots: 'Notable spots',
  findOnMap: 'find on map',
  more: (n: number) => `+${n} more`,
  missingName: 'Not recorded yet',
  missing: (parts: string[], atlas: string) =>
    `No ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}` : parts[0]} recorded for this zone yet. [MnM Atlas](${atlas}) may have more.`,
  missingParts: { creatures: 'creatures', drops: 'drops', level: 'level range', description: 'description' },
  atlasCredit: 'Map: MnM Atlas (mnmatlas.com) and its original map authors',
  mapCredit: (author: string | null, via: string) => `Map: ${author ? `${author} · ` : ''}via ${via}`,
  licence: (licence: string, licenceUrl: string, page: string) => `[${licence}](${licenceUrl}) · [file page](${page})`,
  footer: 'Sources: Monsters and Memories Wiki on Miraheze (CC BY-SA 4.0) · MnM Atlas · mnm-tools · Mo Betta',
  creaturesTitle: (zone: string) => `Creatures in ${zone}`,
  dropsTitle: (zone: string) => `Drops in ${zone}`,
  pageFooter: (page: number, pages: number, sort: string) => `Page ${page} of ${pages} · ${sort}`,
  creatureSort: 'by level, lowest first',
  dropSort: 'by AC, highest first, then name',
  previous: 'Previous',
  next: 'Next',
} as const;

// ---------------------------------------------------------------- MnM Atlas addresses (documented on mnmatlas.com/embed/)

export const ATLAS = 'https://www.mnmatlas.com';
/** encodeURIComponent, plus the brackets it leaves alone, which would end a markdown link early. */
const enc = (text: string) => encodeURIComponent(text).replace(/[()]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
/** A map's own address, "/<map id>/"; the atlas's front page when the zone has no atlas map. */
export const atlasMapUrl = (id: string | null) => (id ? `${ATLAS}/${enc(id)}/` : `${ATLAS}/`);
/** "/?find=<name>", which "looks on one map only" with &map= (the atlas's embed page). */
export const atlasFindUrl = (name: string, id: string | null) => `${ATLAS}/?find=${enc(name)}${id ? `&map=${enc(id)}` : ''}`;
/** The atlas's whole-zone picture: shown only while ATLAS_ZONE_IMAGES is on (order 17, override 3). */
export const atlasCardUrl = (id: string) => `${ATLAS}/assets/cards/${enc(id)}.jpg`;
/** A link from the data is used only when it is an https address (Discord rejects a whole message over a bad URL). */
export const safeUrl = (u: string | null) => (u && /^https:\/\/[^\s()<>]+$/.test(u) ? u : null);

// ---------------------------------------------------------------- data

export interface ZoneRecord {
  key: string;
  name: string;
  level: string | null;
  description: string | null;
  adjacent_json: string | null;
  atlas_id: string | null;
  wiki_url: string | null;
  map_json: string | null;
  markers_json: string | null;
}
export interface Creature {
  name: string;
  level: string | null;
}
export interface Drop {
  id: number;
  name: string;
  ac: number | null;
  wiki_url: string | null;
  /** 1 when the item is gear (a slot): what Gear here can find. */
  gear: number;
}
export interface ZoneData {
  zone: ZoneRecord;
  creatures: Creature[];
  drops: Drop[];
  /** D1's rows_read across the batch (order 17: reported per card). */
  rowsRead: number;
}

export const ZONE_SQL = 'SELECT key, name, level, description, adjacent_json, atlas_id, wiki_url, map_json, markers_json FROM zone WHERE key = ?1 AND active = 1';
/** The zone's mobs: a mob's zone names meet the zone through the mapping (zone_name). */
export const MOBS_SQL = `SELECT key, title, level, race, class, loot_json FROM mob WHERE active = 1 AND EXISTS (
  SELECT 1 FROM json_each(mob.zones_json) j WHERE j.value IN ${zoneNamesSql(MOB_ZONES_SOURCE)})`;
export const NPCS_SQL = 'SELECT name, kind, level, race, class, loot_json FROM npc WHERE zone_key = ?1 AND active = 1';
/**
 * The zone's items: wikiZones names the zone (through the mapping), Removed Items left out. One sort key at a time
 * (the owner, order 13: "no combined score"): AC, highest first, then name; items without AC last.
 */
export const DROPS_SQL = `SELECT id, name, ac, wiki_url, slot_mask <> 0 AS gear FROM item WHERE origin_json IS NOT NULL AND (source_mask & ${REMOVED_BIT}) = 0 AND EXISTS (
  SELECT 1 FROM json_each(item.origin_json, '$.wikiZones') j WHERE j.value IN ${zoneNamesSql(WIKI_ZONES_SOURCE)})
  ORDER BY ac DESC NULLS LAST, name COLLATE NOCASE`;

interface MobRow {
  key: string;
  title: string;
  level: string | null;
  race: string | null;
  class: string | null;
  loot_json: string | null;
}
interface NpcRow {
  name: string;
  kind: string | null;
  level: string | null;
  race: string | null;
  class: string | null;
  loot_json: string | null;
}

const list = (json: string | null): string[] => (json ? (JSON.parse(json) as string[]) : []);

/**
 * The zone's creatures: mnm-tools' mobs keep their fields, Mo Betta fills what a mob lacks (mergeCreature, the rule the
 * import reports with); Mo Betta's merchants are not creatures. By level (the first whole number), no level last, then name.
 */
export function creaturesOf(mobs: MobRow[], npcs: NpcRow[]): Creature[] {
  const merchants = new Set(npcs.filter((n) => n.kind === 'merchant').map((n) => n.name.toLowerCase()));
  const out: Creature[] = [];
  const used = new Set<NpcRow>();
  for (const m of mobs) {
    if (merchants.has(m.key.toLowerCase()) || merchants.has(m.title.toLowerCase())) continue;
    const npc = npcs.find((n) => n.kind !== 'merchant' && (n.name.toLowerCase() === m.key.toLowerCase() || n.name.toLowerCase() === m.title.toLowerCase()));
    if (npc) used.add(npc);
    const { merged } = mergeCreature(
      { level: m.level, race: m.race, class: m.class, loot: list(m.loot_json) },
      { level: npc?.level ?? null, race: npc?.race ?? null, class: npc?.class ?? null, loot: list(npc?.loot_json ?? null) },
    );
    out.push({ name: m.title, level: merged.level });
  }
  for (const n of npcs) if (n.kind !== 'merchant' && !used.has(n)) out.push({ name: n.name, level: n.level });
  return out.sort((a, b) => {
    const la = levelSort(a.level);
    const lb = levelSort(b.level);
    if (la !== lb) return la === null ? 1 : lb === null ? -1 : la - lb;
    return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
  });
}

export async function loadZone(db: D1Database, key: string): Promise<ZoneData | null> {
  const [z, mobs, npcs, drops] = await db.batch([
    db.prepare(ZONE_SQL).bind(key),
    db.prepare(MOBS_SQL).bind(key),
    db.prepare(NPCS_SQL).bind(key),
    db.prepare(DROPS_SQL).bind(key),
  ]);
  const zone = (z.results as ZoneRecord[])[0];
  if (!zone) return null;
  return {
    zone,
    creatures: creaturesOf(mobs.results as MobRow[], npcs.results as NpcRow[]),
    drops: drops.results as Drop[],
    rowsRead: [z, mobs, npcs, drops].reduce((n, r) => n + (r.meta?.rows_read ?? 0), 0),
  };
}

// ---------------------------------------------------------------- lines

export const creatureLine = (c: Creature, atlasId: string | null) =>
  `${md(c.name)}${c.level ? ` (L${md(c.level)})` : ''} · [${ZONE_COPY.findOnMap}](${atlasFindUrl(c.name, atlasId)})`;
export const dropLine = (d: Drop) => {
  const url = safeUrl(d.wiki_url);
  return `${url ? `[${md(d.name)}](${url})` : md(d.name)}${d.ac !== null ? ` · AC ${d.ac}` : ''}`;
};

/** Marker notes may hold URLs and line breaks: the URLs are dropped, the whitespace made one line, the rest kept short. */
export const cleanNotes = (s: string | null): string | null => {
  const t = (s ?? '').replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  return t ? md(truncate(t, 100)) : null;
};

/** The markers, grouped where label and category are the same, in the source's order; the first one's notes. */
export function spotLines(markersJson: string | null): string[] {
  const markers = markersJson ? (JSON.parse(markersJson) as { label: string; category: string | null; notes: string | null }[]) : [];
  const groups = new Map<string, { label: string; category: string | null; notes: string | null; n: number }>();
  for (const m of markers) {
    const k = `${m.category ?? ''}\u0000${m.label}`;
    const g = groups.get(k);
    if (g) g.n++;
    else groups.set(k, { label: m.label, category: m.category, notes: m.notes, n: 1 });
  }
  return [...groups.values()].map((g) => {
    const notes = cleanNotes(g.notes);
    return `${md(g.label)}${g.n > 1 ? ` ×${g.n}` : ''}${g.category ? ` (${md(g.category)})` : ''}${notes ? ` — ${notes}` : ''}`;
  });
}

/** Up to `cap` lines that fit `max` characters with the "+N more" line; N counts everything left off. */
export function fitLines(lines: string[], cap: number, max: number = EMBED_LIMITS.fieldValue): string {
  let shown = Math.min(cap, lines.length);
  const text = (k: number) => [...lines.slice(0, k), ...(lines.length > k ? [ZONE_COPY.more(lines.length - k)] : [])].join('\n');
  while (shown > 0 && text(shown).length > max) shown--;
  return truncate(text(shown), max);
}

// ---------------------------------------------------------------- the card

export const CARD_CREATURES = 10;
export const CARD_DROPS = 10;
export const CARD_SPOTS = 5;

/** The first line of the description, kept to one short line. */
const oneLine = (s: string | null) => (s ? md(truncate(s.split('\n')[0].trim(), 200)) : null);

interface MapImage {
  url: string;
  author: string | null;
  via: string;
  licence: string;
  licence_url: string;
  page: string;
}

/** The card's embeds: the zone, then its map (when one may be shown). `atlasImages`: ATLAS_ZONE_IMAGES is on. */
export function zoneEmbeds(d: ZoneData, atlasImages: boolean): Embed[] {
  const z = d.zone;
  const atlas = atlasMapUrl(z.atlas_id);
  const licensed = z.map_json ? (JSON.parse(z.map_json) as MapImage) : null;
  // The atlas's picture takes precedence over a licensed map (override 3), only while the setting is on.
  const mapEmbed: Embed | null =
    atlasImages && z.atlas_id
      ? { title: ZONE_COPY.atlasCredit, url: atlas, image: { url: atlasCardUrl(z.atlas_id) } }
      : licensed
        ? { title: truncate(ZONE_COPY.mapCredit(licensed.author, licensed.via), EMBED_LIMITS.title), url: licensed.page, image: { url: licensed.url }, description: ZONE_COPY.licence(licensed.licence, licensed.licence_url, licensed.page) }
        : null;

  const fields: EmbedField[] = [];
  if (!mapEmbed) fields.push({ name: ZONE_COPY.map, value: `${ZONE_COPY.noMap} · [${ZONE_COPY.openAtlas}](${atlas})` });
  const adjacent = list(z.adjacent_json);
  if (adjacent.length) fields.push({ name: ZONE_COPY.adjacent, value: truncate(adjacent.map(md).join(' · '), 300) });
  if (d.creatures.length) fields.push({ name: ZONE_COPY.creatures(d.creatures.length), value: fitLines(d.creatures.map((c) => creatureLine(c, z.atlas_id)), CARD_CREATURES) });
  if (d.drops.length) fields.push({ name: ZONE_COPY.drops(d.drops.length), value: fitLines(d.drops.map(dropLine), CARD_DROPS) });
  const spots = spotLines(z.markers_json);
  if (spots.length) fields.push({ name: ZONE_COPY.spots, value: fitLines(spots, CARD_SPOTS, 600) });
  const P = ZONE_COPY.missingParts;
  const missing = [
    ...(z.level ? [] : [P.level]),
    ...(z.description ? [] : [P.description]),
    ...(d.creatures.length ? [] : [P.creatures]),
    ...(d.drops.length ? [] : [P.drops]),
    // No map is already said, with the atlas link, in the Map field above.
  ];
  if (missing.length) fields.push({ name: ZONE_COPY.missingName, value: ZONE_COPY.missing(missing, atlas) });

  const main: Embed = {
    title: truncate(z.name, EMBED_LIMITS.title),
    ...(safeUrl(z.wiki_url) ? { url: safeUrl(z.wiki_url)! } : {}),
    description: [ZONE_COPY.levels(z.level), oneLine(z.description)].filter(Boolean).join('\n'),
    fields,
    footer: { text: ZONE_COPY.footer },
  };
  return mapEmbed ? [main, mapEmbed] : [main];
}

// ---------------------------------------------------------------- the paged lists (More creatures, More drops)

export const LIST_PAGE = 20;

export function listEmbed(d: ZoneData, kind: 'creatures' | 'drops', page: number): { embed: Embed; pages: number; page: number } {
  const lines = kind === 'creatures' ? d.creatures.map((c) => creatureLine(c, d.zone.atlas_id)) : d.drops.map(dropLine);
  const pages = Math.max(1, Math.ceil(lines.length / LIST_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const slice = lines.slice(p * LIST_PAGE, (p + 1) * LIST_PAGE);
  // Whole lines only: drop from the end while over the description limit (each line is well under it).
  while (slice.length > 1 && slice.join('\n').length > EMBED_LIMITS.description) slice.pop();
  return {
    embed: {
      title: truncate(kind === 'creatures' ? ZONE_COPY.creaturesTitle(d.zone.name) : ZONE_COPY.dropsTitle(d.zone.name), EMBED_LIMITS.title),
      description: slice.join('\n'),
      footer: { text: ZONE_COPY.pageFooter(p + 1, pages, kind === 'creatures' ? ZONE_COPY.creatureSort : ZONE_COPY.dropSort) },
    },
    pages,
    page: p,
  };
}

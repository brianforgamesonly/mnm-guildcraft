// Order 17, ITEM 1: the zone data. Three more public sources, each pinned to the commit that last changed it
// (scripts/import/source.ts), reconciled onto one zone list by a derived mapping (zone_name). Pure TypeScript, like
// core.ts: the nightly Action and the Workers-pool tests run exactly this code.
//
// Rules applied here (order 17, section D):
// - zone names match only after two normalisations, case and curly to straight apostrophes (zoneKey); anything else
//   that does not match is stored with zone_key NULL and reported, never guessed;
// - NPC zone text (Mo Betta's, and each wiki block's: order 28b's correction 1) is split only on ", " and " or ", then
//   de-duplicated, then mapped;
// - NPCs are keyed by name (case-insensitive) plus zone; mnm-tools' mobs keep their fields, Mo Betta fills only what a
//   mob lacks (src/zone/creatures.ts mergeCreature, shared with the card), and every conflict is reported;
// - a map image is kept only where a checked record states its licence and its author or source (map-licences.ts).

import { mergeCreature, type CreatureFields } from '../../src/zone/creatures.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE, zoneKey } from '../../src/zone/names.ts';
export { levelSort, zoneKey } from '../../src/zone/names.ts';
import { factionName } from '../../src/faction-aliases.ts';
import { MAP_LICENCES, type MapLicence } from './map-licences.ts';
import { factionQuestLines, type QuestLineRow, type QuestSummary } from './quests.ts';
import { parseSnapshot } from '../wiki/parse.ts';
import type { WikiSnapshot } from '../wiki/types.ts';

// ---------------------------------------------------------------- sources

/** The source files the zone data reads, besides wiki.json. `stale`: the import warns after 30 days without a change. */
export const ZONE_FILES = [
  { name: 'mnm-tools/maps.json', repo: 'Boisteroux/mnm-tools', path: 'mnmdb/maps.json', stale: true },
  // MnM Atlas's map registry rarely changes: exempt from the staleness warning (order 17, ITEM 1).
  { name: 'mnmatlas/maps.json', repo: 'ocombe/mnmatlas', path: 'data/maps.json', stale: false },
  // Order 28b, PR D (order 28's override 2): Mo Betta's zones.json, npcs.json and quests.json left here; the wiki snapshot
  // (ZoneInput.wiki) holds the zones, NPCs and quests.
] as const;
export type ZoneFileName = (typeof ZONE_FILES)[number]['name'];
export const STALE_DAYS = 30;

export interface SourceVersion {
  name: string;
  sha: string;
  /** The commit's date, from GitHub (the clones are shallow). */
  changedAt: string;
}
export interface ZoneInput {
  files: Record<ZoneFileName, unknown>;
  /** Every file read this run, wiki.json included. */
  versions: SourceVersion[];
  /**
   * Order 28: the wiki snapshot (scripts/wiki/snapshot.ts), parsed by scripts/wiki/parse.ts: the zones, NPCs and quests.
   * Order 28b, PR D: the only zone source (Mo Betta is no longer read). Without it the import leaves the zone tables as
   * they are (core.ts ImportOptions.zonesKept).
   */
  wiki: WikiSnapshot;
}
/** Order 28: the snapshot's entry in import_source: sha = its highest revid, changed_at = that revision's time. */
export const WIKI_SNAPSHOT_SOURCE = 'wiki/snapshot';
export const wikiVersion = (s: WikiSnapshot): SourceVersion => ({ name: WIKI_SNAPSHOT_SOURCE, sha: String(s.version.revid), changedAt: s.version.timestamp });
/** The files fetched from GitHub (ZONE_FILES), before the wiki snapshot joins them. */
export type ZoneSources = Omit<ZoneInput, 'wiki'>;
/** The zone input: the GitHub files and the wiki snapshot, its version recorded with the rest. */
export const withWiki = (z: ZoneSources, snap: WikiSnapshot): ZoneInput => ({ ...z, wiki: snap, versions: [...z.versions, wikiVersion(snap)] });

/** The mapping's sources: each names where a zone name was read. Order 28: the wiki's three replace Mo Betta's at the switch-over. */
export const NAME_SOURCES = [
  'mo-betta:zones', 'wiki:zones', 'mnm-tools:maps', WIKI_ZONES_SOURCE, MOB_ZONES_SOURCE, 'atlas:maps', 'mo-betta:adjacent', 'mo-betta:npcs', 'wiki:adjacent', 'wiki:npcs',
] as const;
export type NameSource = (typeof NAME_SOURCES)[number];
/** The registries after the zone source's own; in this order, the first one to use a zone's name gives its display name. */
const OTHER_REGISTRIES: readonly NameSource[] = ['mnm-tools:maps', 'mnm-tools:wikiZones', 'mnm-tools:mobs'];

/**
 * The zone source's rows, whichever source holds them (Mo Betta's files, or the wiki snapshot): the one shape the plan
 * reads. A value the source does not hold is null.
 */
interface SourceRows {
  registry: NameSource;
  adjacentSource: NameSource;
  npcSource: NameSource;
  zones: { name: string; level: string | null; description: string | null; adjacent: string[]; url: string | null; mapFile: string | null; map: string | null }[];
  npcs: {
    name: string;
    /** The zone names the record's zone text holds: split on ", " and " or ", then de-duplicated (npcZoneParts; Mo Betta's text and each wiki block's, order 28b). */
    zoneParts: string[];
    kind: string | null;
    level: string | null;
    race: string | null;
    class: string | null;
    location: string | null;
    loot: string[];
    factions: string[];
    opposingFactions: string[];
    named: number | null;
    raid: number | null;
  }[];
  /** factionQuestLines' input: { quests: [{ title, url, rewards }] }. */
  quests: unknown;
  questsLabel: string;
}

function wikiRows(snap: WikiSnapshot): SourceRows {
  const p = parseSnapshot(snap);
  if (!p.zones.length) throw new ZoneStructureError('wiki snapshot: no zone page uses {{ZoneDetails}}');
  if (!p.npcs.length) throw new ZoneStructureError('wiki snapshot: no NPC template block');
  return {
    registry: 'wiki:zones',
    adjacentSource: 'wiki:adjacent',
    npcSource: 'wiki:npcs',
    // Order 29: the description is the page's lead text (scripts/wiki/parse.ts leadText).
    zones: p.zones.map((z) => ({ name: z.name, level: z.level, description: z.description, adjacent: z.adjacent, url: z.url, mapFile: null, map: null })),
    npcs: p.npcs.map((n) => ({
      name: n.name,
      // Order 28b's correction 1 of override 6: a block's zone text is split exactly as Mo Betta's was.
      zoneParts: npcZoneParts(n.zone ?? ''),
      kind: n.kind,
      level: n.level,
      race: n.race,
      class: n.class,
      location: n.location,
      loot: n.loot,
      factions: n.factions,
      opposingFactions: n.opposingFactions,
      named: n.named,
      raid: n.raid,
    })),
    quests: { quests: p.quests },
    questsLabel: 'wiki snapshot quests',
  };
}

export class ZoneStructureError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []);
function list(raw: unknown, file: string, key: string): Record<string, unknown>[] {
  if (!isObj(raw) || !Array.isArray(raw[key])) throw new ZoneStructureError(`${file}: ${key} is not a list`);
  const rows = raw[key] as unknown[];
  if (!rows.length) throw new ZoneStructureError(`${file}: ${key} is empty`);
  rows.forEach((r, i) => {
    if (!isObj(r) || !str(r[key === 'maps' ? 'id' : 'name'])) throw new ZoneStructureError(`${file}: ${key}[${i}] has no ${key === 'maps' ? 'id' : 'name'}`);
  });
  return rows as Record<string, unknown>[];
}

// ---------------------------------------------------------------- names

/**
 * An NPC's zone text (Mo Betta's, or a wiki block's: order 28b): split only on ", " and " or ", then de-duplicated. Nothing is trimmed or guessed. Empty text
 * names no zone (counted as noZone), not an unmatched name.
 */
export const npcZoneParts = (text: string): string[] => (text === '' ? [] : [...new Set(text.split(/, | or /))]);

// ---------------------------------------------------------------- rows

export interface ZoneRow {
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
export interface ZoneNameRow {
  source: NameSource;
  name: string;
  zone_key: string | null;
}
export interface NpcRow {
  zone_key: string;
  name: string;
  /** Mo Betta's kind ("npc", "merchant"), NULL when it records none. */
  kind: string | null;
  level: string | null;
  race: string | null;
  class: string | null;
  location: string | null;
  loot_json: string | null;
  /** Order 28 (0022): the wiki's Category:Named Mobs and Category:Raid Encounters, 1 or 0; NULL from a source without tags. */
  named: number | null;
  raid: number | null;
}
/**
 * Order 24: an NPC row's faction, by the wiki infobox field it came from, under the wiki's own labels: factions is
 * "Reputation Lost" ('lost'), opposing_factions "Reputation Gained" ('gained'). Nothing else is inferred.
 */
export type FactionKind = 'lost' | 'gained';
export interface FactionLinkRow {
  zone_key: string;
  /** The npc row's name (the first record's spelling when records fold by case). */
  npc_name: string;
  faction: string;
  kind: FactionKind;
}
export interface MapImage {
  /** The image a card shows. */
  url: string;
  /** "Map: <author> · via <source>" parts. */
  author: string | null;
  via: string;
  licence: string;
  licence_url: string;
  /** The file page that states the licence. */
  page: string;
}
export interface Marker {
  label: string;
  category: string | null;
  notes: string | null;
}

/** What the mob table holds for the merge (core.ts MobRow, its zones already split). */
export interface MobForZones {
  key: string;
  title: string;
  level: string | null;
  race: string | null;
  class: string | null;
  zones: string[];
  loot: string[];
}

export type ZoneWarning =
  | { kind: 'stale_source'; source: string; changedAt: string; days: number }
  | { kind: 'zone_names_unmatched'; source: NameSource; names: string[] };

export interface ZoneSummary {
  zones: number;
  /** Per source: its distinct names, how many map to a zone, and the ones that do not (reported, never guessed). */
  names: Record<NameSource, { names: number; matched: number; unmatched: string[] }>;
  /** Zones and the sources that name them ("mo-betta:zones+atlas:maps+…"). */
  coverage: Record<string, string[]>;
  npcs: {
    source: number;
    merchants: number;
    rows: number;
    /** Mo Betta records whose zone text maps to no zone at all (each unmatched part is in names['mo-betta:npcs']). */
    noZone: number;
    /** Records folded into an earlier one with the same name (case-insensitive) and zone. */
    caseDuplicates: number;
    caseDuplicateConflicts: { zone: string; name: string; field: string; kept: string; dropped: string }[];
    /** Rows matching a mnm-tools mob (same name, case-insensitive, in a zone of that mob). */
    mobMatches: number;
    /** Fields Mo Betta fills where the mob has none. */
    mobFills: Record<string, number>;
    /** Both hold a value and they differ: the mob's is shown. */
    mobConflicts: { zone: string; name: string; field: string; mob: string; moBetta: string }[];
    mobsWithoutNpc: string[];
  };
  maps: { withImage: string[]; placeholderFiles: string[]; unchecked: { zone: string; file: string }[] };
  /** Order 24: the faction data, and what has no npc row to link to (an unmapped zone). */
  factions: {
    /** Mo Betta records naming at least one faction. */
    npcsWithFactions: number;
    /** Of those, records with no npc row (their zone text maps to no zone): their links are left out. */
    npcsWithoutRow: number;
    linksLeftOut: number;
    /** Distinct trimmed names stored (named by at least one NPC that has a row). */
    factions: number;
    /** Names only NPCs without a row carry: not stored, so no post. */
    namesWithoutRow: string[];
    links: { lost: number; gained: number };
    /** Order 25: approved misspellings in the source (src/faction-aliases.ts), each with the npc-row mentions mapped. */
    merged: { from: string; to: string; rows: number }[];
  };
  /** Order 25: quests.json's "Faction…" reward lines, and the faction names each mentions. */
  quests: QuestSummary;
  versions: SourceVersion[];
}

export interface ZonePlan {
  zones: ZoneRow[];
  names: ZoneNameRow[];
  npcs: NpcRow[];
  /** Order 24: the faction names, in source order, and every NPC row's links to them. */
  factions: string[];
  factionLinks: FactionLinkRow[];
  /** Order 25: one row per quest reward line and faction it mentions (scripts/import/quests.ts). */
  questLines: QuestLineRow[];
  versions: SourceVersion[];
  warnings: ZoneWarning[];
  summary: ZoneSummary;
}

const json = (v: unknown[] | null) => (v && v.length ? JSON.stringify(v) : null);
const fieldText = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : typeof v === 'number' ? String(v) : null);

/** mnm-tools' "source" ("wiki: Rothold map by skoop.png") and Mo Betta's map_file ("File:Rothold_map_by_skoop.png") as recorded. */
function mapImage(ref: string | null, url: string | null, licences: Record<string, MapLicence>): MapImage | null {
  if (!ref || !url) return null;
  const l = licences[ref];
  if (!l || !l.licence || !l.licence_url || !l.page || !(l.author || l.via)) return null;
  return { url, author: l.author, via: l.via, licence: l.licence, licence_url: l.licence_url, page: l.page };
}

export function buildZonePlan(input: ZoneInput, mobs: MobForZones[], wikiZones: string[], now: string, licences: Record<string, MapLicence> = MAP_LICENCES): ZonePlan {
  const mt = list(input.files['mnm-tools/maps.json'], 'mnm-tools/maps.json', 'zones');
  const mtPinned = input.versions.find((v) => v.name === 'mnm-tools/maps.json');
  const atlas = list(input.files['mnmatlas/maps.json'], 'mnmatlas/maps.json', 'maps');
  // Order 28b, PR D: the zone source is the wiki snapshot (Mo Betta is no longer read).
  if (!input.wiki) throw new ZoneStructureError('no wiki snapshot: the zone data needs one');
  const src = wikiRows(input.wiki);

  // 1. Every name each source uses, in source order.
  const used: Record<NameSource, string[]> = Object.fromEntries(NAME_SOURCES.map((s) => [s, []])) as never;
  const use = (s: NameSource, n: string) => void (used[s].includes(n) || used[s].push(n));
  for (const z of src.zones) use(src.registry, z.name);
  for (const z of mt) use('mnm-tools:maps', z.name as string);
  for (const n of wikiZones) use('mnm-tools:wikiZones', n);
  for (const m of mobs) for (const z of m.zones) use('mnm-tools:mobs', z);
  // Override 1: the atlas registry's map ids and titles only.
  for (const m of atlas) if (str(m.title)) use('atlas:maps', m.title as string);
  for (const z of src.zones) for (const a of z.adjacent) use(src.adjacentSource, a);
  for (const n of src.npcs) for (const p of n.zoneParts) use(src.npcSource, p);

  // 2. The zones: every registry name, keyed by zoneKey; the first registry to use a key names it.
  const display = new Map<string, string>();
  for (const s of [src.registry, ...OTHER_REGISTRIES]) for (const n of used[s]) if (!display.has(zoneKey(n))) display.set(zoneKey(n), n);
  const keyOf = (n: string) => (display.has(zoneKey(n)) ? zoneKey(n) : null);

  const names: ZoneNameRow[] = NAME_SOURCES.flatMap((source) => used[source].map((name) => ({ source, name, zone_key: keyOf(name) })));
  const nameSummary = Object.fromEntries(
    NAME_SOURCES.map((s) => {
      const rows = names.filter((r) => r.source === s);
      return [s, { names: rows.length, matched: rows.filter((r) => r.zone_key).length, unmatched: rows.filter((r) => !r.zone_key).map((r) => r.name) }];
    }),
  ) as ZoneSummary['names'];
  const warnings: ZoneWarning[] = NAME_SOURCES.filter((s) => nameSummary[s].unmatched.length).map((s) => ({
    kind: 'zone_names_unmatched' as const,
    source: s,
    names: nameSummary[s].unmatched,
  }));

  // 3. Map images. A map file that Mo Betta records for more than one zone is a placeholder, not that zone's map.
  const fileUse = new Map<string, number>();
  for (const z of src.zones) if (z.mapFile) fileUse.set(z.mapFile, (fileUse.get(z.mapFile) ?? 0) + 1);
  const placeholderFiles = [...fileUse].filter(([, n]) => n > 1).map(([f]) => f);
  const unchecked: { zone: string; file: string }[] = [];

  const zones = new Map<string, ZoneRow>();
  for (const [key, name] of display)
    zones.set(key, { key, name, level: null, description: null, adjacent_json: null, atlas_id: null, wiki_url: null, map_json: null, markers_json: null });
  const mbByKey = new Map<string, SourceRows['zones'][number]>();
  for (const z of src.zones) mbByKey.set(zoneKey(z.name), z); // a later record of the same key wins, as before
  for (const [key, z] of zones) {
    const mb = mbByKey.get(key);
    const tools = mt.find((m) => zoneKey(m.name as string) === key);
    if (mb) {
      z.level = mb.level;
      z.description = mb.description;
      z.adjacent_json = json(mb.adjacent);
      z.wiki_url = mb.url;
    }
    const atlasMap = atlas.find((m) => str(m.title) && zoneKey(m.title as string) === key);
    if (atlasMap) z.atlas_id = atlasMap.id as string;
    if (tools) {
      const markers: Marker[] = (Array.isArray(tools.markers) ? tools.markers : [])
        .filter((m): m is Record<string, unknown> => isObj(m) && str(m.label) !== null)
        .map((m) => ({ label: m.label as string, category: str(m.category), notes: str(m.notes) }));
      z.markers_json = json(markers);
    }
    // mnm-tools' image first (pinned to its maps.json commit); Mo Betta's map as the fallback, never a shared placeholder.
    const toolsUrl = tools && str(tools.image) && mtPinned ? `https://raw.githubusercontent.com/Boisteroux/mnm-tools/${mtPinned.sha}/mnmdb/maps/${tools.image}` : null;
    // Order 28: the wiki snapshot carries no map file (the fallback is dropped; mnm-tools' maps and MnM Atlas remain).
    const mbFile = mb && mb.mapFile && !placeholderFiles.includes(mb.mapFile) ? mb.mapFile : null;
    const image = mapImage(tools ? str(tools.source) : null, toolsUrl, licences) ?? mapImage(mbFile, mb ? mb.map : null, licences);
    if (image) z.map_json = JSON.stringify(image);
    else {
      if (tools && str(tools.source) && toolsUrl) unchecked.push({ zone: z.name, file: tools.source as string });
      if (mbFile) unchecked.push({ zone: z.name, file: mbFile });
    }
  }

  // 4. Mo Betta's NPCs, one row per zone their text maps to; records equal but for case fold into the first.
  const npcs = new Map<string, NpcRow>();
  let noZone = 0;
  let caseDuplicates = 0;
  const caseDuplicateConflicts: ZoneSummary['npcs']['caseDuplicateConflicts'] = [];
  // Order 24: each record's factions (trimmed), linked to every npc row the record has. Order 25: only the owner's four
  // approved merges re-spell a name (src/faction-aliases.ts), before the names are de-duplicated.
  const links = new Map<string, FactionLinkRow>();
  const factionNames: string[] = [];
  const unlinkedNames = new Set<string>();
  const fs = { withFactions: 0, withoutRow: 0, leftOut: 0 };
  /** Order 25: each approved misspelling the source still uses, and the npc rows it names (links written under the approved name). */
  const merged = new Map<string, number>();
  for (const n of src.npcs) {
    const keys = [...new Set(n.zoneParts.map(keyOf).filter((k): k is string => k !== null))];
    if (!keys.length) noZone++;
    const loot = n.loot;
    const names = (v: string[]) =>
      [...new Set(v.map((f) => f.trim()).filter((f) => f !== ''))].map((f) => {
        if (factionName(f) !== f && keys.length) merged.set(f, (merged.get(f) ?? 0) + keys.length);
        return factionName(f);
      }).filter((f, i, all) => all.indexOf(f) === i);
    const named: [string, FactionKind][] = [
      ...names(n.factions).map((f): [string, FactionKind] => [f, 'lost']),
      ...names(n.opposingFactions).map((f): [string, FactionKind] => [f, 'gained']),
    ];
    if (named.length) {
      fs.withFactions++;
      if (!keys.length) {
        fs.withoutRow++;
        fs.leftOut += named.length;
        for (const [f] of named) unlinkedNames.add(f);
      }
    }
    for (const zk of keys) {
      const rowName = npcs.get(`${zk}|${n.name.toLowerCase()}`)?.name ?? n.name;
      for (const [faction, kind] of named) {
        if (!factionNames.includes(faction)) factionNames.push(faction);
        const id = `${zk}|${rowName.toLowerCase()}|${faction}|${kind}`;
        if (!links.has(id)) links.set(id, { zone_key: zk, npc_name: rowName, faction, kind });
      }
    }
    for (const zk of keys) {
      const row: NpcRow = {
        zone_key: zk,
        name: n.name,
        kind: n.kind,
        level: n.level,
        race: n.race,
        class: n.class,
        location: n.location,
        loot_json: json(loot),
        named: n.named,
        raid: n.raid,
      };
      const id = `${zk}|${n.name.toLowerCase()}`;
      const prior = npcs.get(id);
      if (!prior) {
        npcs.set(id, row);
        continue;
      }
      caseDuplicates++;
      for (const f of ['kind', 'level', 'race', 'class', 'location', 'loot_json', 'named', 'raid'] as const) {
        if (prior[f] === null) (prior as unknown as Record<string, unknown>)[f] = row[f];
        else if (row[f] !== null && row[f] !== prior[f])
          caseDuplicateConflicts.push({ zone: zones.get(zk)!.name, name: prior.name, field: f, kept: String(prior[f]), dropped: String(row[f]) });
      }
    }
  }

  // 5. The merge with mnm-tools' mobs, reported here exactly as the card applies it (mergeCreature).
  const mobFills: Record<string, number> = {};
  const mobConflicts: ZoneSummary['npcs']['mobConflicts'] = [];
  let mobMatches = 0;
  const matchedMobs = new Set<string>();
  for (const row of npcs.values()) {
    const mob = mobs.find(
      (m) => (m.key.toLowerCase() === row.name.toLowerCase() || m.title.toLowerCase() === row.name.toLowerCase()) && m.zones.some((z) => keyOf(z) === row.zone_key),
    );
    if (!mob) continue;
    mobMatches++;
    matchedMobs.add(mob.key);
    const mobFields: CreatureFields = { level: mob.level, race: mob.race, class: mob.class, loot: mob.loot };
    const mbFields: CreatureFields = { level: row.level, race: row.race, class: row.class, loot: row.loot_json ? (JSON.parse(row.loot_json) as string[]) : [] };
    const { filled, conflicts } = mergeCreature(mobFields, mbFields);
    for (const f of filled) mobFills[f] = (mobFills[f] ?? 0) + 1;
    for (const c of conflicts) mobConflicts.push({ zone: zones.get(row.zone_key)!.name, name: row.name, ...c });
  }

  // Order 25, ITEM 1: quest reward lines, matched against the faction names above (after the approved merges).
  const quests = factionQuestLines(src.quests, factionNames, src.questsLabel);

  // 6. Staleness: a warning, never a failure.
  const nowMs = Date.parse(now);
  for (const v of input.versions) {
    const file = ZONE_FILES.find((f) => f.name === v.name);
    if (file && !file.stale) continue;
    const days = Math.floor((nowMs - Date.parse(v.changedAt)) / 86_400_000);
    if (days >= STALE_DAYS) warnings.push({ kind: 'stale_source', source: v.name, changedAt: v.changedAt, days });
  }

  const zoneRows = [...zones.values()];
  const coverage = Object.fromEntries(
    zoneRows.map((z) => [z.name, NAME_SOURCES.filter((s) => names.some((r) => r.source === s && r.zone_key === z.key))]),
  );
  const npcRows = [...npcs.values()];
  const linkRows = [...links.values()];
  return {
    zones: zoneRows,
    names,
    npcs: npcRows,
    factions: factionNames,
    factionLinks: linkRows,
    questLines: quests.rows,
    versions: input.versions,
    warnings,
    summary: {
      zones: zoneRows.length,
      names: nameSummary,
      coverage,
      npcs: {
        source: src.npcs.length,
        merchants: src.npcs.filter((n) => n.kind === 'merchant').length,
        rows: npcRows.length,
        noZone,
        caseDuplicates,
        caseDuplicateConflicts,
        mobMatches,
        mobFills,
        mobConflicts,
        mobsWithoutNpc: mobs.filter((m) => m.zones.length && !matchedMobs.has(m.key)).map((m) => m.key),
      },
      maps: { withImage: zoneRows.filter((z) => z.map_json).map((z) => z.name), placeholderFiles, unchecked },
      factions: {
        npcsWithFactions: fs.withFactions,
        npcsWithoutRow: fs.withoutRow,
        linksLeftOut: fs.leftOut,
        factions: factionNames.length,
        namesWithoutRow: [...unlinkedNames].filter((f) => !factionNames.includes(f)),
        links: { lost: linkRows.filter((l) => l.kind === 'lost').length, gained: linkRows.filter((l) => l.kind === 'gained').length },
        merged: [...merged].map(([from, rows]) => ({ from, to: factionName(from), rows })),
      },
      quests: quests.summary,
      versions: input.versions,
    },
  };
}

// Order 37 (ITEMs 1 and 2): what /gear upgrades' drop and vendor lines read, held in the Worker's memory per import.
//
// - The drop line names the creature with the lowest level, read exactly as the import reads it for the item's level
//   (scripts/import/levels.ts creatureIndex: the item's `from` list and every mob or NPC whose loot names it; a creature's
//   level is its mob row's when that parses, else its NPC rows', each read by order 35's parser parseLevel). So when the
//   item's level_kind is mob, the creature shown has level_low as its low.
// - The vendor line picks merchants and zones out of the source's vendor list by an exact lookup in data already held
//   (npc.name, zone_name.name), trimmed and case-insensitive, never by a partial match or a guess from names (order 4;
//   order 37's override 1). Anything that matches neither table is shown as recorded.
// The tables change only when an import writes them, so they are read once per import version (src/gear/index.ts's rule:
// the newest data_import row's id, status and finish time; nothing is cached while it has no finish time).
import { creatureIndex, type CreatureIndex, type Range } from '../../scripts/import/levels.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE } from '../zone/names.ts';
import type { ZoneRef } from '../zone/buttons.ts';

export const SOURCE_SQL = {
  mobs: 'SELECT key, title, level, zones_json, loot_json FROM mob WHERE active = 1',
  npcs: 'SELECT name, zone_key, level, loot_json FROM npc WHERE active = 1',
  zoneNames: 'SELECT source, name, zone_key FROM zone_name WHERE active = 1 AND zone_key IS NOT NULL',
  zones: 'SELECT key, name FROM zone WHERE active = 1',
} as const;

export interface SourceIndex {
  version: string | null;
  creatures: CreatureIndex;
  /** NPC zone keys (active zones only) by lower-cased NPC name. */
  npcZones: Map<string, string[]>;
  /** Zone keys by lower-cased zone_name.name, any source (distinct). */
  zoneKeysByName: Map<string, string[]>;
  /** The zone table's own name, by key (active zones). */
  zoneName: Map<string, string>;
  /** A (source, name) the zone buttons can match, per zone key: items' wikiZones names first, then mobs' zone names. */
  refs: Map<string, ZoneRef[]>;
  /** D1 rows_read for building it (0 when it came from memory). */
  rowsRead: number;
}

let cached: SourceIndex | null = null;
/** Tests only: forget the cached index. */
export const clearSourceIndex = () => {
  cached = null;
};

interface MobRow { key: string; title: string; level: string | null; zones_json: string | null; loot_json: string | null }
interface NpcRow { name: string; zone_key: string; level: string | null; loot_json: string | null }
interface ZoneNameRow { source: string; name: string; zone_key: string }
interface ZoneRow { key: string; name: string }

const list = (json: string | null): string[] => {
  if (!json) return [];
  const v = JSON.parse(json) as unknown;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};
const lower = (s: string) => s.toLowerCase();

export function buildSourceIndex(version: string | null, rows: { mobs: MobRow[]; npcs: NpcRow[]; zoneNames: ZoneNameRow[]; zones: ZoneRow[] }, rowsRead = 0): SourceIndex {
  const zoneName = new Map(rows.zones.map((z) => [z.key, z.name]));
  const creatures = creatureIndex({
    mobs: rows.mobs.map((m) => ({ key: m.key, title: m.title, level: m.level, zones: list(m.zones_json), loot: { json: m.loot_json } })),
    npcs: rows.npcs.map((n) => ({ name: n.name, zone_key: n.zone_key, level: n.level, loot: { json: n.loot_json } })),
    zoneNames: rows.zoneNames,
  });
  const npcZones = new Map<string, string[]>();
  for (const n of rows.npcs) {
    const k = lower(n.name.trim());
    const zs = npcZones.get(k) ?? [];
    if (zoneName.has(n.zone_key) && !zs.includes(n.zone_key)) zs.push(n.zone_key);
    npcZones.set(k, zs);
  }
  const zoneKeysByName = new Map<string, string[]>();
  const refs = new Map<string, ZoneRef[]>();
  for (const z of rows.zoneNames) {
    if (!zoneName.has(z.zone_key)) continue;
    const k = lower(z.name.trim());
    const ks = zoneKeysByName.get(k) ?? [];
    if (!ks.includes(z.zone_key)) ks.push(z.zone_key);
    zoneKeysByName.set(k, ks);
    if (z.source === WIKI_ZONES_SOURCE || z.source === MOB_ZONES_SOURCE) {
      const r = refs.get(z.zone_key) ?? [];
      r.push({ source: z.source, name: z.name });
      refs.set(z.zone_key, r);
    }
  }
  for (const r of refs.values()) r.sort((a, b) => Number(b.source === WIKI_ZONES_SOURCE) - Number(a.source === WIKI_ZONES_SOURCE));
  return { version, creatures, npcZones, zoneKeysByName, zoneName, refs, rowsRead };
}

/** The index for this import version: from memory when the key matches, else read (one batch of four statements). */
export async function sourceIndex(db: D1Database, version: string | null): Promise<SourceIndex> {
  const cacheable = version !== null && !version.endsWith(':');
  if (cacheable && cached?.version === version) return { ...cached, rowsRead: 0 };
  const r = await db.batch([db.prepare(SOURCE_SQL.mobs), db.prepare(SOURCE_SQL.npcs), db.prepare(SOURCE_SQL.zoneNames), db.prepare(SOURCE_SQL.zones)]);
  const idx = buildSourceIndex(
    version,
    { mobs: r[0].results as MobRow[], npcs: r[1].results as NpcRow[], zoneNames: r[2].results as ZoneNameRow[], zones: r[3].results as ZoneRow[] },
    r.reduce((n, x) => n + (x.meta?.rows_read ?? 0), 0),
  );
  if (cacheable) cached = idx;
  return idx;
}

// ---------------------------------------------------------------- ITEM 1: the drop line's creature

export interface DropPick {
  /** The creature, as the item's `from` list writes it, else as the mob or NPC row does. */
  name: string;
  /** Its level (null: no creature linked to the item has one). */
  range: Range | null;
  /** The zone shown with it: the zone table's name, and a name the zone buttons can match (none when nothing maps). */
  zone: { key: string; name: string; ref: ZoneRef | null } | null;
  /** The other creatures linked to the item. */
  more: number;
}

/**
 * The drop line's creature: the lowest parsed level; ties to the creature whose zone comes first in the item's wikiZones (in
 * recorded order), then the name; creatures with no level after every creature with one. Its zone: of the places it has that
 * level, the one first in wikiZones, then by the zone's name. Null when the data links no creature to the item.
 */
export function dropPick(idx: SourceIndex, itemKey: string, from: string[], wikiZones: string[]): DropPick | null {
  const names = idx.creatures.creaturesOf(itemKey, from);
  if (!names.length) return null;
  const wikiOrder = new Map<string, number>();
  wikiZones.forEach((z, i) => {
    for (const k of idx.zoneKeysByName.get(lower(z.trim())) ?? []) if (!wikiOrder.has(k)) wikiOrder.set(k, i);
  });
  const orderOf = (keys: string[]) => Math.min(Infinity, ...keys.map((k) => wikiOrder.get(k) ?? Infinity));
  const written = new Map(from.map((f) => [lower(f), f]));
  const shown = (n: string) => written.get(n) ?? idx.creatures.display(n) ?? n;
  // A tie is settled by the zones where the creature has its level (review fix), the zone the line then shows.
  const tieZones = (n: string, range: Range | null) =>
    range ? idx.creatures.spots(n).filter((s) => s.range?.low === range.low).map((s) => s.zone_key) : idx.creatures.zones(n);
  const scored = names.map((n) => {
    const range = idx.creatures.level(n);
    return { n, range, order: orderOf(tieZones(n, range)), label: shown(n) };
  });
  scored.sort((a, b) => (a.range ? 0 : 1) - (b.range ? 0 : 1) || (a.range && b.range ? a.range.low - b.range.low : 0) || a.order - b.order || a.label.localeCompare(b.label));
  const first = scored[0];
  const spots = idx.creatures
    .spots(first.n)
    .filter((s) => idx.zoneName.has(s.zone_key) && (!first.range || s.range?.low === first.range.low))
    .sort((a, b) => (wikiOrder.get(a.zone_key) ?? Infinity) - (wikiOrder.get(b.zone_key) ?? Infinity) || idx.zoneName.get(a.zone_key)!.localeCompare(idx.zoneName.get(b.zone_key)!));
  const key = spots[0]?.zone_key;
  const zone = key ? { key, name: idx.zoneName.get(key)!, ref: refFor(idx, key, wikiZones) } : null;
  return { name: first.label, range: first.range, zone, more: names.length - 1 };
}

/** A zone_name entry for the zone key, for the zone buttons: one of the item's own wikiZones names first. */
function refFor(idx: SourceIndex, key: string, wikiZones: string[]): ZoneRef | null {
  const rs = idx.refs.get(key) ?? [];
  const own = new Set(wikiZones);
  return rs.find((r) => r.source === WIKI_ZONES_SOURCE && own.has(r.name)) ?? rs[0] ?? null;
}

// ---------------------------------------------------------------- ITEM 2: the vendor line's merchants

export interface VendorParts {
  /** "Name, Zone", "Name (N zones)" or "Name", in the record's order. */
  merchants: string[];
  /** Zones not already shown with a merchant, and parts matching neither table, as recorded, in the record's order. */
  rest: string[];
  /** Zone keys the line names (the bench's counts read it; the vendor line offers no zone buttons). */
  zoneKeys: string[];
}

type Token = { kind: 'npc' | 'zone' | 'neither'; text: string; keys: string[] };

/**
 * The source's vendor list, split on commas; at each place the longest run of neighbouring parts (joined with ", ") that
 * matches a name exactly, trimmed and case-insensitive: an NPC (npc.name) first, then a zone (zone_name.name, any source).
 * An NPC is a merchant, shown with its zone (npc.zone_key joined to zone.key, the zone table's name); one NPC name in
 * several zones takes the zone the record also names, else "(N zones)"; an NPC whose zone is unknown takes the record's zone
 * before it (else the record's first zone). A zone already shown with a merchant is dropped; any other zone, and a part that
 * matches neither table, is shown as recorded, after the merchants.
 */
export function vendorParts(idx: SourceIndex, vendors: string[]): VendorParts {
  const parts = vendors.flatMap((v) => v.split(',')).map((p) => p.trim()).filter(Boolean);
  const tokens: Token[] = [];
  for (let i = 0; i < parts.length; ) {
    let hit: Token | null = null;
    let len = 1;
    for (let n = parts.length - i; n >= 1 && !hit; n--) {
      const text = parts.slice(i, i + n).join(', ');
      const k = lower(text);
      const npc = idx.npcZones.get(k);
      const zone = idx.zoneKeysByName.get(k);
      if (npc) hit = { kind: 'npc', text, keys: npc };
      else if (zone) hit = { kind: 'zone', text, keys: zone };
      if (hit) len = n;
    }
    tokens.push(hit ?? { kind: 'neither', text: parts[i], keys: [] });
    i += len;
  }
  const recordZones = tokens.filter((t) => t.kind === 'zone');
  const recordKeys = recordZones.flatMap((t) => t.keys);
  const used = new Set<Token>();
  const shownKeys = new Set<string>();
  const merchants: string[] = [];
  tokens.forEach((t, i) => {
    if (t.kind !== 'npc') return;
    let key: string | null = null;
    if (t.keys.length === 1) key = t.keys[0];
    else if (t.keys.length > 1) {
      // The record's zone nearest before it that is one of the NPC's, else any of the record's zones that is (review fix).
      const near = [...tokens.slice(0, i)].reverse().find((x) => x.kind === 'zone' && x.keys.some((k) => t.keys.includes(k)));
      key = near?.keys.find((k) => t.keys.includes(k)) ?? recordKeys.find((k) => t.keys.includes(k)) ?? null;
      if (!key) {
        merchants.push(`${t.text} (${t.keys.length} zones)`);
        return;
      }
    } else {
      // The NPC's own zone is unknown: the record's zone before it, else its first.
      const z = [...tokens.slice(0, i)].reverse().find((x) => x.kind === 'zone') ?? recordZones[0];
      if (z && z.keys.length) {
        used.add(z);
        key = z.keys[0];
      }
    }
    if (key) shownKeys.add(key);
    merchants.push(key ? `${t.text}, ${idx.zoneName.get(key)}` : t.text);
  });
  const rest: string[] = [];
  for (const t of tokens) {
    if (t.kind === 'npc' || used.has(t)) continue;
    if (t.kind === 'zone' && t.keys.some((k) => shownKeys.has(k))) continue;
    // A record with only zones names them as the zone table does; otherwise as recorded.
    rest.push(t.kind === 'zone' && !merchants.length && t.keys.length === 1 ? idx.zoneName.get(t.keys[0])! : t.text);
  }
  const zoneKeys = [...shownKeys, ...recordZones.filter((t) => t.keys.length === 1).map((t) => t.keys[0])].filter((k, i, a) => a.indexOf(k) === i);
  return { merchants, rest, zoneKeys };
}

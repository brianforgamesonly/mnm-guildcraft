// Order 37, PR B (Brian's check, 2026-11-06 15:03 ET): how to get an item, in one place. /gear upgrades' lines, the /item
// card and /gear find's results all decide an item's ways here (sourceWays), and /gear upgrades and the cards build the
// lines here (howToGet). Before this, the cards and /gear find decided from item.source_mask alone: order 13's mask, built
// from mnm-tools' own item fields (from, soldBy, categories) before the wiki snapshot's quests were imported (order 36
// follow-up, origin_json.quests) and before order 35's level kinds. So Scarab Helm, a reward of the snapshot's "Scarab Armor
// Quests" with no Quest category in mnm-tools, read "Unknown — source not recorded" on its card while /gear upgrades named
// the quest. Moved here from src/gear/upgrades.ts; this module reads no command module at run time, so the cards can use it.
import type { Ctx } from '../context.ts';
import { tierCrafters, type CrafterRow } from '../crafters.ts';
import { md, memberTag } from '../discord.ts';
import type { pageData } from '../commands/gear.ts';
import type { ZoneRef } from '../zone/buttons.ts';
import { WIKI_ZONES_SOURCE } from '../zone/names.ts';
import type { GearItem } from './score.ts';
import { dropPick, pageSources, sourceCache, vendorParts, type SourceIndex } from './sources.ts';
import { SOURCES } from './vocab.ts';

/** Order 37, ITEM 2: merchants named on a vendor line before "+N more". */
export const VENDOR_MERCHANTS = 2;
/**
 * A link's address with its parentheses encoded (review fix: wiki titles such as "Archer Starter Quest (Faelindral)" put
 * them in the address, which would end a markdown link early; src/board/factions.ts encodes them the same way).
 */
export const linkUrl = (url: string) => url.replace(/\(/g, '%28').replace(/\)/g, '%29');
export const range = (lo: number, hi: number | null) => (hi === null ? `${lo}+` : hi === lo ? `${lo}` : `${lo}–${hi}`);

/** The how-to-get lines' copy (part of src/gear/upgrades.ts UPGRADES_COPY; listed in docs/COPY.md). */
export const HOW_COPY = {
  drop: (mob: string, zone: string | null, level: string, more: number) => `Drop: ${md(mob)}${zone ? ` in ${md(zone)}` : ''} · ${level}${more ? ` · +${more} more` : ''}`,
  dropZones: (zones: string[], level: string) => `Drop: in ${zones.map(md).join(', ')} · ${level}`,
  dropNoMob: (level: string) => `Drop: creature not recorded · ${level}`,
  crafted: (skill: string, trivial: number | null, floor: string | null) => `Crafted: ${skill}, ${trivial === null ? 'trivial unknown' : `trivial ${trivial}`}${floor ? ` · ${floor}` : ''}`,
  craftedNoRecipe: 'Crafted (no recipe in the data)',
  youCanMake: (character: string, level: number) => `You can make this (${md(character)} ${level})`,
  reliable: (who: string[]) => `Reliable in your guild: ${who.join(', ')}`,
  noReliable: 'No Reliable crafter in the guild yet',
  // Order 37, ITEM 2: "Vendor: Master Tailor Sansha, Night Harbor · any level"; merchants "Name, Zone" or "Name (N zones)",
  // the first VENDOR_MERCHANTS, then "+N more" (merchants only); then what matched no table, as recorded.
  vendor: (merchants: string[], more: number, rest: string[]) => {
    const named = merchants.length ? `${merchants.map(md).join('; ')}${more > 0 ? ` +${more} more` : ''}` : '';
    return `Vendor: ${[named, rest.map(md).join(', ')].filter(Boolean).join('; ')} · any level`;
  },
  vendorUnnamed: 'Vendor: where not recorded · any level',
  harvest: 'Harvested, any level',
  quest: (level: string) => `Quest: the quest's name isn't recorded · ${level}`,
  questNamed: (name: string, level: string, more: number) => `Quest: ${name} · ${level}${more ? ` · +${more} more` : ''}`,
  mnmWiki: 'monstersandmemories.wiki',
  unknown: 'Source not recorded',
  /** The /item card's field. */
  cardField: 'How to get it',
} as const;

export interface Origin {
  from?: string[];
  wikiZones?: string[];
  soldBy?: { base?: number | null; shady?: number | null; vendors?: string[] };
  categories?: string[];
  /** Order 36 follow-up (scripts/import/core.ts questsByItem). */
  quests?: { name: string; level: number | null; wiki: string | null }[];
}
export const originOf = (s: string | null | undefined): Origin => (s ? JSON.parse(s) : {}) as Origin;

export type Way = 'drop' | 'crafted' | 'vendor' | 'harvest' | 'quest' | 'unknown';

/**
 * An item's ways, in order: its level kinds (order 35, primary first), then what source_mask holds (order 13's mnm-tools
 * fields), then what the recorded data holds (a quest from the wiki snapshot, a vendor, a creature or a drop zone). "unknown"
 * only when none of them names a way. The one decider for every surface (order 37, PR B).
 */
export function sourceWays(item: { levelKinds: string | null }, sourceMask: number, o: Origin): Way[] {
  const kindWay = (k: string): Way | null =>
    k === 'mob' || k === 'zone' ? 'drop' : k === 'crafted' || k === 'crafted_floor' ? 'crafted' : k === 'vendor' || k === 'harvest' || k === 'quest' ? k : null;
  const maskWay: Record<(typeof SOURCES)[number], Way | null> = { Drop: 'drop', Crafted: 'crafted', Vendor: 'vendor', Quest: 'quest', Unknown: null };
  const ways = [
    ...(item.levelKinds ?? '').split(',').map(kindWay),
    ...SOURCES.filter((_, i) => sourceMask & (1 << i)).map((s) => maskWay[s]),
    o.quests?.length ? 'quest' : null,
    o.soldBy?.vendors?.length ? 'vendor' : null,
    o.from?.length || o.wikiZones?.length ? 'drop' : null,
  ].filter((w): w is Way => w !== null);
  const out = [...new Set(ways)];
  return out.length ? out : ['unknown'];
}

export interface Extras {
  rows: Map<number, { origin_json: string | null; source_mask: number }>;
  d: Pick<Awaited<ReturnType<typeof pageData>>, 'recipes' | 'crafters'> & Partial<Awaited<ReturnType<typeof pageData>>>;
  /** Order 37: the creatures, NPCs and zones the drop and vendor lines read (src/gear/sources.ts). */
  src: SourceIndex | null;
  /** Order 37, PR B: the page's quests' monstersandmemories.wiki links (quest_site, linked rows only). */
  questLinks?: Map<string, string>;
  /** D1 rows_read of the source reads (the benches report it). */
  sourceRows?: number;
}

/** A quest's link, or none: an empty table, a missing row and a missing table (before migrations/0032) all mean no link. */
export const QUEST_LINKS_SQL = 'SELECT quest, url FROM quest_site WHERE linked = 1 AND quest IN (SELECT value FROM json_each(?1))';
export async function questLinks(db: D1Database, quests: string[]): Promise<Map<string, string>> {
  if (!quests.length) return new Map();
  try {
    const r = await db.prepare(QUEST_LINKS_SQL).bind(JSON.stringify(quests)).all<{ quest: string; url: string }>();
    return new Map(r.results.filter((x) => x.url.startsWith('https://')).map((x) => [x.quest, x.url]));
  } catch (e) {
    if (/no such table/i.test(String(e))) return new Map();
    throw e;
  }
}

/**
 * What the lines read besides the item rows and recipes: the source rows (once per import version), the NPC rows the
 * items' creatures and vendors name, and their quest links. Two round trips at most (the cache's, then the page's).
 */
export async function sourceExtras(c: Pick<Ctx, 'db'>, items: { key: string; origin_json: string | null }[], version: string | null): Promise<Pick<Extras, 'src' | 'questLinks' | 'sourceRows'>> {
  const cache = await sourceCache(c.db, version);
  const page = items.map((it) => ({ key: it.key, o: originOf(it.origin_json) }));
  const [ps, links] = await Promise.all([
    pageSources(c.db, cache, page.map((p) => ({ key: p.key, from: p.o.from ?? [], vendors: p.o.soldBy?.vendors ?? [] }))),
    questLinks(c.db, [...new Set(page.flatMap((p) => (p.o.quests?.[0] ? [p.o.quests[0].name] : [])))]),
  ]);
  return { src: ps.src, questLinks: links, sourceRows: cache.rowsRead + ps.rowsRead };
}

/**
 * How to get it, by its ways (sourceWays), primary first (one line per way), and the zone names the lines show. `skip`:
 * ways a surface shows elsewhere (the /item card's recipe embeds carry Crafted).
 */
export function howToGet(it: Pick<GearItem, 'id' | 'key' | 'levelLow' | 'levelHigh' | 'levelKind' | 'levelKinds'>, x: Extras, searcher: string, window: number, skip: Way[] = []): { lines: string[]; zones: ZoneRef[]; craftable: boolean } {
  const row = x.rows.get(it.id);
  const o = originOf(row?.origin_json ?? null);
  const ways = sourceWays(it, row?.source_mask ?? 0, o).filter((w) => !skip.includes(w));
  const lines: string[] = [];
  const zones: ZoneRef[] = [];
  const recipes = x.d.recipes.filter((r) => r.item_id === it.id);
  for (const w of ways) {
    if (w === 'drop') {
      // The item's own drop level (order 35: a mob's, or the zone fallback, named as such) when no creature row has one.
      const zoneLevel =
        it.levelLow === null ? 'level unknown' : it.levelKind === 'zone' ? `zone Lv ${range(it.levelLow, it.levelHigh)}` : it.levelKind === 'mob' ? `Lv ${range(it.levelLow, it.levelHigh)}` : 'level unknown';
      // Order 37, ITEM 1: the creature with the lowest level, read as the import reads it (src/gear/sources.ts dropPick).
      const pick = x.src ? dropPick(x.src, it.key, o.from ?? [], o.wikiZones ?? []) : null;
      if (pick) {
        if (pick.zone?.ref) zones.push(pick.zone.ref);
        const level = pick.range ? `Lv ${range(pick.range.low, pick.range.high)}` : zoneLevel;
        lines.push(HOW_COPY.drop(pick.name, pick.zone?.name ?? null, level, pick.more));
      } else if (o.wikiZones?.length) {
        zones.push(...o.wikiZones.map((name): ZoneRef => ({ source: WIKI_ZONES_SOURCE, name })));
        lines.push(HOW_COPY.dropZones(o.wikiZones.slice(0, 3), zoneLevel));
      } else lines.push(HOW_COPY.dropNoMob(zoneLevel));
    } else if (w === 'crafted') {
      const r = recipes[0];
      if (!r) {
        lines.push(HOW_COPY.craftedNoRecipe);
        continue;
      }
      const floor = it.levelKind === 'crafted_floor' && it.levelLow !== null ? `Lv ${it.levelLow}+` : null;
      lines.push(HOW_COPY.crafted(r.tradeskill, r.trivial, floor));
      const reliable = tierCrafters(x.d.crafters as CrafterRow[], r, window).reliable;
      const own = reliable.filter((k) => k.owner_user_id === searcher);
      const others: string[] = [];
      for (const k of reliable) {
        if (k.owner_user_id === searcher || others.length >= 3) continue;
        if (others.some((t) => t.startsWith(`<@${k.owner_user_id}>`))) continue;
        others.push(`${memberTag(k.owner_user_id, k.member)}: ${md(k.character)} ${k.level}`);
      }
      if (own.length) lines.push(HOW_COPY.youCanMake(own[0].character, own[0].level));
      if (others.length) lines.push(HOW_COPY.reliable(others));
      else if (!own.length) lines.push(HOW_COPY.noReliable);
    } else if (w === 'vendor') {
      // Order 37, ITEM 2: merchants and zones picked out by an exact lookup in npc and zone_name (src/gear/sources.ts
      // vendorParts); anything matching neither is shown as recorded.
      const v = o.soldBy?.vendors ?? [];
      const p = v.length && x.src ? vendorParts(x.src, v) : null;
      if (p && (p.merchants.length || p.rest.length)) lines.push(HOW_COPY.vendor(p.merchants.slice(0, VENDOR_MERCHANTS), p.merchants.length - VENDOR_MERCHANTS, p.rest));
      else lines.push(HOW_COPY.vendorUnnamed);
    } else if (w === 'harvest') lines.push(HOW_COPY.harvest);
    else if (w === 'quest') {
      // Order 36 follow-up: the quest's name (the import keeps it, origin_json.quests, lowest level first), linked to its
      // page on the Monsters and Memories Wiki when the snapshot holds one, and to monstersandmemories.wiki when that page
      // was verified (order 37, PR B: quest_site, kept by the monthly check). Neither link is offered for a page not known to
      // exist (order 17b).
      const q = o.quests?.[0];
      if (!q) lines.push(HOW_COPY.quest(it.levelKind === 'quest' && it.levelLow !== null ? `Lv ${range(it.levelLow, it.levelHigh)}` : 'level unknown'));
      else {
        const mnm = x.questLinks?.get(q.name);
        const name = `${q.wiki?.startsWith('https://') ? `[${md(q.name)}](${linkUrl(q.wiki)})` : md(q.name)}${mnm ? ` ([${HOW_COPY.mnmWiki}](${linkUrl(mnm)}))` : ''}`;
        lines.push(HOW_COPY.questNamed(name, q.level !== null ? `Lv ${q.level}+` : 'level unknown', (o.quests?.length ?? 1) - 1));
      }
    } else lines.push(HOW_COPY.unknown);
  }
  // Review fix: Request a craft only where the data holds a recipe (/request needs one; requestFromFind checks it too).
  return { lines, zones, craftable: recipes.length > 0 };
}

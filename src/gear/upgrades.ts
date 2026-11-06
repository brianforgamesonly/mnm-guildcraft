// Order 36, ITEM 3 (docs/PRD.md "Gear upgrades", part 2): /gear upgrades, and Find upgrades on the Gear panel.
//
// What beats each slot a character wears (src/gear/score.ts decides), smallest upgrade first, with how to get each item.
// - Private (order 2); Post to channel makes one page of one slot's list public, with no buttons (order 36's override of
//   order 2: it names no other member except as a Reliable crafter, as /item already does). Pages opened by an officer
//   for someone else's character (/officer edit-member's panel) have no Post to channel.
// - Levels are shown here, always with their kind (order 35's rule; order 36 ends PR A's "no derived level shown").
// - Every control re-checks the character's owner, or an officer (src/gear/wear.ts characterFor). custom_ids hold ids and
//   numbers only, never an item name (Discord: custom_id "1 to 100 characters").
// Discord's limits (docs.discord.com/developers/components/reference, read 2026-11-06): "An Action Row can contain up to 5
// Buttons"; a string select's options "max 25"; custom_id "a string of 1 to 100 characters"; "Messages allow up to 40 total
// components" (legacy messages: up to 5 action rows, src/zone/buttons.ts). Message content: 2,000 characters; embeds:
// src/discord.ts EMBED_LIMITS. The largest reply here is Pick a result's: 2 rows, 3 + 5 buttons.
import { MessageComponentTypes } from 'discord-interactions';
import type { Ctx } from '../context.ts';
import { tierCrafters, type CrafterRow } from '../crafters.ts';
import { button, EMBED_LIMITS, ephemeral, md, memberTag, optInt, optString, plural, row, STYLE_PRIMARY, truncate, updateMessage, type Embed, type MessageReply, type Option } from '../discord.ts';
import { findById, findByName, liveCharacters, noCharacters, type Character } from '../commands/character.ts';
import { pageData } from '../commands/gear.ts';
import type { GearRow } from './search.ts';
import { itemCard, POST_WHAT as ITEM_POST } from '../commands/item.ts';
import { POST_PREFIX, postedReply, searchReply } from '../commands/share.ts';
import { FROM_FIND_PREFIX } from '../requests.ts';
import { zoneButtons, withZoneButtons, type ZoneRef } from '../zone/buttons.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE } from '../zone/names.ts';
import { parseLevel } from '../../scripts/import/levels.ts';
import { gearIndex, VERSION_SQL, type GearIndex } from './index.ts';
import {
  breakdown, byGain, className, compareGroup, levelGroup, upgradeDiff, fmtHundredths, groupByKey, grouped, GROUPS, MAX_LEVEL_CAP, presetOf, sideLabel, SLOT_GROUPS, weightsFor, wornState, wornScore,
  type Context, type GearItem, type GroupResult, type LevelGroup, type Upgrade, type Wearer, type Weights, type Worn,
} from './score.ts';
import { characterFor, FIND_UPGRADES_PREFIX, wearById, WEAR_COPY } from './wear.ts';
import { raceLabel } from './vocab.ts';
// Order 36 follow-up: quest pages on monstersandmemories.wiki, each verified to exist (scripts/gear/quest-sites.ts).
import QUEST_SITES from './quest-sites.json' with { type: 'json' };

// ---------------------------------------------------------------- custom_ids (order 23: each has its own routing test)

/** gus:<character id>:<window>: Pick a slot (select; values: a slot group key). */
export const SLOT_PREFIX = 'gus:';
/** gup:<character id>:<group>:<window>:<page>: ◀ Smaller / Bigger ▶. */
export const PAGE_PREFIX = 'gup:';
/** gur:<character id>:<group>:<window>: Pick a result (select; values: item ids). */
export const RESULT_PREFIX = 'gur:';
/** guw:<character id>:<slot>:<window>:<item id>: I'm wearing it now. */
export const WEAR_NOW_PREFIX = 'guw:';
/** guo:<item id>: Open item (its /item card). */
export const OPEN_PREFIX = 'guo:';
/** Post to channel: "pub:gu:<character id>:<group>:<window>:<page>" (src/commands/share.ts POST_PREFIX). */
export const POST_WHAT = 'gu:';
export { FIND_UPGRADES_PREFIX };

export const PER_PAGE = 5;
export const SUMMARY_LINES = 8;

/**
 * Order 36 follow-up (the owner, 2026-11-06): a level cap, or none (null: the default). In a custom_id it is "c" (none) or
 * "c<level>". A control sent before this carries a window number there; it reads as no cap (order 18: still handled).
 */
export type Cap = number | null;
export const capState = (cap: Cap) => (cap === null ? 'c' : `c${cap}`);
export const capOf = (s: string | undefined): Cap => (s && /^c\d+$/.test(s) ? Number(s.slice(1)) : null);
/** An item name, linked to its wiki page when it has one (https only). */
const named = (it: Pick<GearItem, 'name' | 'wiki'>) => (it.wiki ? `[**${md(it.name)}**](${it.wiki})` : `**${md(it.name)}**`);

// ---------------------------------------------------------------- copy (order 36; listed for approval in docs/COPY.md)

const range = (lo: number, hi: number | null) => (hi === null ? `${lo}+` : hi === lo ? `${lo}` : `${lo}–${hi}`);

export const UPGRADES_COPY = {
  title: (name: string) => `Upgrades for ${name}`,
  slotTitle: (slot: string, name: string) => `${slot} upgrades for ${name}`,
  who: (ch: Character) => `**${md(ch.name)}** · ${md(className(ch.class))}${ch.level !== null ? ` ${ch.level}` : ''} · ${ch.race ? md(raceLabel(ch.race)) : 'any race'}`,
  weights: (cls: string) => `Uses your guild's ${cls} weights.`,
  capNote: (cap: number) => `Items up to Lv ${cap}.`,
  hidden: (n: number, cap: number) => `${plural(n, 'more')} above Lv ${cap} not shown.`,
  listedLine: (slot: string, u: Upgrade) => `**${slot}:** ${named(u.item)} **${fmtHundredths(u.gain)}** · ${levelText(u.item)}`,
  unknownLine: (slot: string) => `**${slot}:** only level-unknown upgrades`,
  footer: (more: number, none: number) =>
    [more ? `${plural(more, 'more slot')} with upgrades: pick a slot below` : null, none ? `${plural(none, 'slot')} with nothing better` : null].filter(Boolean).join(' · '),
  nothingAnywhere: (ch: string, cls: string) => `Nothing beats what ${md(ch)} wears, for a ${cls}, in any slot.`,
  nothing: (item: string, cls: string, slot: string) => `Nothing beats ${item} for a ${cls} in ${slot}.`,
  emptySlot: (slot: string) => `an empty ${slot}`,
  pickSlot: 'Pick a slot',
  pickSlotOption: (u: Upgrade) => truncate(`smallest: ${u.item.name} ${fmtHundredths(u.gain)}`, 100),
  head: { listed: 'Upgrades', unknown: 'Level unknown' } satisfies Record<(typeof GROUPS)[number], string>,
  worn: (slot: string, item: string, score: string) => `${slot}: ${item} (score ${score})`,
  wornEmpty: (slot: string) => `${slot}: empty (score 0.00)`,
  notCounted: { gone: 'counts 0: no longer listed', cantUse: (name: string) => `counts 0: ${md(name)} can't use it` },
  comparedWith: (slot: string) => `Compared with the weaker side, **${slot}**.`,
  twoHanded: (item: string) => `Two-handed candidates are compared with Primary and Secondary together; ${item} is in Primary.`,
  replaces: (slot: string) => `replaces ${slot}`,
  secondaryFree: 'replaces the two-hander: Secondary is then free',
  needsOneHand: 'needs a one-handed Primary',
  pickResult: 'Pick a result',
  smaller: '◀ Smaller',
  bigger: 'Bigger ▶',
  page: (n: number, of: number) => `Page ${n} of ${of}`,
  openItem: 'Open item',
  wearingNow: "I'm wearing it now",
  requestCraft: 'Request a craft',
  moreZones: (n: number) => `+${plural(n, 'more zone')}`,
  capRange: `max_level: is a number from 1 to ${MAX_LEVEL_CAP}.`,
  forSlot: (ch: string, slot: string) => `for ${md(ch)}'s ${slot}`,
  unknownSlot: 'Pick a slot from the list.',
  gone: 'That item is no longer in the data.',
  // How to get it.
  drop: (mob: string, zone: string | null, level: string, more: number) => `Drop: ${md(mob)}${zone ? ` in ${md(zone)}` : ''} · ${level}${more ? ` · +${more} more` : ''}`,
  dropZones: (zones: string[], level: string) => `Drop: in ${zones.map(md).join(', ')} · ${level}`,
  dropNoMob: (level: string) => `Drop: creature not recorded · ${level}`,
  crafted: (skill: string, trivial: number | null, floor: string | null) => `Crafted: ${skill}, ${trivial === null ? 'trivial unknown' : `trivial ${trivial}`}${floor ? ` · ${floor}` : ''}`,
  craftedNoRecipe: 'Crafted (no recipe in the data)',
  youCanMake: (character: string, level: number) => `You can make this (${md(character)} ${level})`,
  reliable: (who: string[]) => `Reliable in your guild: ${who.join(', ')}`,
  noReliable: 'No Reliable crafter in the guild yet',
  vendor: (sold: string[], more: number) => `Vendor: ${sold.map(md).join(', ')}${more > 0 ? ` +${more} more` : ''} · any level`,
  vendorUnnamed: 'Vendor: where not recorded · any level',
  harvest: 'Harvested, any level',
  quest: (level: string) => `Quest: the quest's name isn't recorded · ${level}`,
  questNamed: (name: string, level: string, more: number) => `Quest: ${name} · ${level}${more ? ` · +${more} more` : ''}`,
  mnmWiki: 'monstersandmemories.wiki',
  unknown: 'Source not recorded',
} as const;

// ---------------------------------------------------------------- levels, always with their kind (order 35)

/** An item's level with its kind: "Lv 22–25 (drop)", "zone Lv 20–30", "Lv 14+ (crafted, component floor)", "any level". */
export function levelText(it: Pick<GearItem, 'levelLow' | 'levelHigh' | 'levelKind'>): string {
  const lo = it.levelLow;
  if (lo === null) return 'level unknown';
  switch (it.levelKind) {
    case 'mob':
      return `Lv ${range(lo, it.levelHigh)} (drop)`;
    case 'zone':
      return `zone Lv ${range(lo, it.levelHigh)}`;
    case 'crafted':
      return `Lv ${lo} (crafted)`;
    case 'crafted_floor':
      return `Lv ${lo}+ (crafted, component floor)`;
    case 'quest':
      return `quest Lv ${range(lo, it.levelHigh)}`;
    case 'vendor':
      return 'any level (vendor)';
    case 'harvest':
      return 'any level (harvested)';
    default:
      return `Lv ${range(lo, it.levelHigh)} (${it.levelKind ?? 'kind unknown'})`;
  }
}

// ---------------------------------------------------------------- reading

interface Loaded {
  ch: Character;
  idx: GearIndex;
  ctx: Context;
  wearer: Wearer;
  weights: Weights;
  cls: string;
}

/** The character's saved gear and the gear index: 1 round trip (2 statements), plus the index when its key changed. */
export async function load(c: Ctx, ch: Character): Promise<Loaded> {
  const [gear, ver] = await c.db.batch([c.db.prepare('SELECT slot, item_key FROM character_gear WHERE character_id = ?').bind(ch.id), c.db.prepare(VERSION_SQL)]);
  const idx = await gearIndex(c.db, (ver.results as { v: string }[])[0]?.v ?? null);
  const wearer: Wearer = {
    classBit: ch.class ? (idx.classBits.get(ch.class.toUpperCase()) ?? null) : null,
    raceBit: ch.race ? (idx.raceBits.get(ch.race) ?? null) : null,
  };
  const worn = new Map<string, Worn>();
  for (const g of gear.results as { slot: string; item_key: string }[]) worn.set(g.slot, wornState(g.item_key, idx.byKey.get(g.item_key) ?? null, wearer));
  const weights = await weightsFor(c.db, c.guild.id, ch.class);
  return { ch, idx, wearer, weights, cls: className(ch.class), ctx: { weights, preset: presetOf(ch.class), worn } };
}

const compare = (L: Loaded, key: string) => compareGroup(groupByKey(key)!, L.ctx, L.wearer, L.idx.items);

// ---------------------------------------------------------------- the summary

export function summaryView(L: Loaded, cap: Cap): { embed: Embed; components: unknown[] } {
  // ITEM 5: one pass per slot for what the summary shows (no sort of every candidate): the smallest listed candidate (the
  // list's own order, byGain), whether any is level-unknown, and (with a cap) how many are above it, hidden.
  let hidden = 0;
  const per = SLOT_GROUPS.map((g) => {
    const r = compareGroup(g, L.ctx, L.wearer, L.idx.items);
    let listed: Upgrade | null = null;
    let unknown = false;
    let shownCount = 0;
    for (const u of r.upgrades) {
      const lg = levelGroup(u.item, cap);
      if (lg === 'above') {
        hidden++;
        continue;
      }
      shownCount++;
      if (lg === 'listed') listed = !listed || byGain(u, listed) < 0 ? u : listed;
      else unknown = true;
    }
    return { g, r, listed, unknown, shownCount };
  });
  const listed = per.filter((p) => p.listed).map((p) => ({ p, u: p.listed! })).sort((a, b) => a.u.gain - b.u.gain || a.p.g.label.localeCompare(b.p.g.label));
  const unknown = per.filter((p) => !p.listed && p.unknown);
  const none = per.filter((p) => !p.shownCount).length;
  const lines = [...listed.map((x) => UPGRADES_COPY.listedLine(x.p.g.label, x.u)), ...unknown.map((p) => UPGRADES_COPY.unknownLine(p.g.label))];
  const shown = lines.slice(0, SUMMARY_LINES);
  const notes = [UPGRADES_COPY.who(L.ch), ...(cap !== null ? [UPGRADES_COPY.capNote(cap)] : [])];
  const footer = [UPGRADES_COPY.footer(lines.length - shown.length, none), ...(cap !== null && hidden ? [UPGRADES_COPY.hidden(hidden, cap)] : [])].filter(Boolean).join(' · ');
  const embed: Embed = {
    title: truncate(UPGRADES_COPY.title(L.ch.name), EMBED_LIMITS.title),
    description: truncate([...notes, '', ...(shown.length ? shown : [UPGRADES_COPY.nothingAnywhere(L.ch.name, L.cls)])].join('\n'), EMBED_LIMITS.description),
    footer: { text: [footer, UPGRADES_COPY.weights(L.cls)].filter(Boolean).join(' · ') },
  };
  const withUps = per.filter((p) => p.shownCount);
  const components = withUps.length
    ? [
        row([
          {
            type: MessageComponentTypes.STRING_SELECT,
            custom_id: `${SLOT_PREFIX}${L.ch.id}:${capState(cap)}`,
            placeholder: UPGRADES_COPY.pickSlot,
            options: withUps.slice(0, 25).map((p) => ({ label: p.g.label, value: p.g.key, ...(p.listed ? { description: UPGRADES_COPY.pickSlotOption(p.listed) } : {}) })),
          },
        ]),
      ]
    : [];
  return { embed, components };
}

// ---------------------------------------------------------------- one slot's list

interface Extras {
  rows: Map<number, { origin_json: string | null; source_mask: number }>;
  d: Awaited<ReturnType<typeof pageData>>;
}

/**
 * The page's items' sources: their rows, then their mobs, recipes and crafters (pageData's batch). 2 round trips. A vendor
 * line shows soldBy's vendors as recorded: the source's list mixes zones, shops and merchants ("Night Harbor", "Mining
 * Supplies", "a miner") with nothing saying which is which, so nothing is picked out of it (order 4: no meaning from names).
 */
async function extras(c: Ctx, items: GearItem[]): Promise<Extras> {
  if (!items.length) return { rows: new Map(), d: { classes: [], mobs: [], recipes: [], crafters: [], version: null } };
  const { results } = await c.db
    .prepare('SELECT id, origin_json, source_mask FROM item WHERE id IN (SELECT value FROM json_each(?1))')
    .bind(JSON.stringify(items.map((i) => i.id)))
    .all<{ id: number; origin_json: string | null; source_mask: number }>();
  const d = await pageData(c, results as unknown as GearRow[], Infinity);
  return { rows: new Map(results.map((r) => [r.id, r])), d };
}

interface Origin {
  from?: string[];
  wikiZones?: string[];
  soldBy?: { vendors?: string[] };
  /** Order 36 follow-up (scripts/import/core.ts questsByItem). */
  quests?: { name: string; level: number | null; wiki: string | null }[];
}
const originOf = (s: string | null): Origin => (s ? JSON.parse(s) : {}) as Origin;

/** How to get it, by its level kinds, primary first (one line per way), and the zone names the lines show. */
export function howToGet(it: GearItem, x: Extras, searcher: string, window: number): { lines: string[]; zones: ZoneRef[]; craftable: boolean } {
  const o = originOf(x.rows.get(it.id)?.origin_json ?? null);
  const kinds = (it.levelKinds ?? 'unknown').split(',');
  const ways = [...new Set(kinds.map((k) => (k === 'mob' || k === 'zone' ? 'drop' : k === 'crafted_floor' ? 'crafted' : k)))];
  const lines: string[] = [];
  const zones: ZoneRef[] = [];
  const recipes = x.d.recipes.filter((r) => r.item_id === it.id);
  for (const w of ways) {
    if (w === 'drop') {
      const from = o.from ?? [];
      // The item's own drop level (order 35: a mob's, or the zone fallback, named as such) when no creature row has one.
      const zoneLevel =
        it.levelLow === null ? 'level unknown' : it.levelKind === 'zone' ? `zone Lv ${range(it.levelLow, it.levelHigh)}` : it.levelKind === 'mob' ? `Lv ${range(it.levelLow, it.levelHigh)}` : 'level unknown';
      if (from.length) {
        const mobs = from.map((name) => {
          const k = name.toLowerCase();
          const m = x.d.mobs.find((r) => r.key.toLowerCase() === k) ?? x.d.mobs.find((r) => r.title.toLowerCase() === k);
          return { name, m, lv: parseLevel(m?.level ?? null).range };
        });
        mobs.sort((a, b) => (a.lv?.low ?? Infinity) - (b.lv?.low ?? Infinity) || a.name.localeCompare(b.name));
        const first = mobs[0];
        const zone = first.m?.zones_json ? ((JSON.parse(first.m.zones_json) as string[])[0] ?? null) : null;
        if (zone) zones.push({ source: MOB_ZONES_SOURCE, name: zone });
        const level = first.lv ? `Lv ${range(first.lv.low, first.lv.high)}` : zoneLevel;
        lines.push(UPGRADES_COPY.drop(first.name, zone, level, from.length - 1));
      } else if (o.wikiZones?.length) {
        zones.push(...o.wikiZones.map((name): ZoneRef => ({ source: WIKI_ZONES_SOURCE, name })));
        lines.push(UPGRADES_COPY.dropZones(o.wikiZones.slice(0, 3), zoneLevel));
      } else lines.push(UPGRADES_COPY.dropNoMob(zoneLevel));
    } else if (w === 'crafted') {
      const r = recipes[0];
      if (!r) {
        lines.push(UPGRADES_COPY.craftedNoRecipe);
        continue;
      }
      const floor = it.levelKind === 'crafted_floor' && it.levelLow !== null ? `Lv ${it.levelLow}+` : null;
      lines.push(UPGRADES_COPY.crafted(r.tradeskill, r.trivial, floor));
      const reliable = tierCrafters(x.d.crafters as CrafterRow[], r, window).reliable;
      const own = reliable.filter((k) => k.owner_user_id === searcher);
      const others: string[] = [];
      for (const k of reliable) {
        if (k.owner_user_id === searcher || others.length >= 3) continue;
        if (others.some((t) => t.startsWith(`<@${k.owner_user_id}>`))) continue;
        others.push(`${memberTag(k.owner_user_id, k.member)}: ${md(k.character)} ${k.level}`);
      }
      if (own.length) lines.push(UPGRADES_COPY.youCanMake(own[0].character, own[0].level));
      if (others.length) lines.push(UPGRADES_COPY.reliable(others));
      else if (!own.length) lines.push(UPGRADES_COPY.noReliable);
    } else if (w === 'vendor') {
      const v = o.soldBy?.vendors ?? [];
      lines.push(v.length ? UPGRADES_COPY.vendor(v.slice(0, 3), v.length - 3) : UPGRADES_COPY.vendorUnnamed);
    } else if (w === 'harvest') lines.push(UPGRADES_COPY.harvest);
    else if (w === 'quest') {
      // Order 36 follow-up: the quest's name (the import keeps it, origin_json.quests, lowest level first), linked to its
      // page on the Monsters and Memories Wiki when the snapshot holds one, and to monstersandmemories.wiki when that page
      // was verified (src/gear/quest-sites.json). Neither link is offered for a page not known to exist (order 17b).
      const q = o.quests?.[0];
      if (!q) lines.push(UPGRADES_COPY.quest(it.levelKind === 'quest' && it.levelLow !== null ? `Lv ${range(it.levelLow, it.levelHigh)}` : 'level unknown'));
      else {
        const mnm = (QUEST_SITES.quests as Record<string, string>)[q.name];
        const name = `${q.wiki?.startsWith('https://') ? `[${md(q.name)}](${q.wiki})` : md(q.name)}${mnm ? ` ([${UPGRADES_COPY.mnmWiki}](${mnm}))` : ''}`;
        lines.push(UPGRADES_COPY.questNamed(name, q.level !== null ? `Lv ${q.level}+` : 'level unknown', (o.quests?.length ?? 1) - 1));
      }
    }
    else lines.push(UPGRADES_COPY.unknown);
  }
  // Review fix: Request a craft only where the data holds a recipe (/request needs one; requestFromFind checks it too).
  return { lines, zones, craftable: recipes.length > 0 };
}

/** One result's lines: its name and gain, the side or note, the breakdown, then how to get it. */
function resultLines(u: Upgrade, L: Loaded, how: string[]): string[] {
  const note = u.side ? UPGRADES_COPY.replaces(sideLabel(u.side)) : u.note === 'secondaryFree' ? UPGRADES_COPY.secondaryFree : u.note === 'needsOneHand' ? UPGRADES_COPY.needsOneHand : null;
  return [`${named(u.item)} **${fmtHundredths(u.gain)}** · ${levelText(u.item)}${note ? ` · ${note}` : ''}`, breakdown(upgradeDiff(u, L.ctx), L.weights), ...how.map((l) => `-# ${l}`)].filter(Boolean);
}

/** The header lines: what's worn in each slot compared with, and each one's score (0 with the reason it counts 0). */
function headerLines(L: Loaded, r: GroupResult): string[] {
  const out: string[] = [];
  const sides = r.group.token === 'PRIMARY' || (r.group.token === 'SECONDARY' && r.replaces[0] === 'primary') ? ['primary', ...(r.group.token === 'PRIMARY' ? ['secondary'] : [])] : r.group.sides;
  for (const side of sides) {
    const g = L.ctx.worn.get(side);
    const token = side === 'primary' ? 'PRIMARY' : side === 'secondary' ? 'SECONDARY' : r.group.token;
    const label = sideLabel(side);
    if (!g) out.push(UPGRADES_COPY.wornEmpty(label));
    else {
      const name = md(g.item?.name ?? g.key);
      const why = g.reason === 'gone' ? UPGRADES_COPY.notCounted.gone : g.reason === 'cantUse' ? UPGRADES_COPY.notCounted.cantUse(L.ch.name) : null;
      const line = UPGRADES_COPY.worn(label, name, fmtHundredths(wornScore(side, token, L.ctx), false));
      out.push(why ? `${line} · ${why}` : line);
    }
  }
  if (r.group.sides.length > 1) out.push(UPGRADES_COPY.comparedWith(sideLabel(r.replaces[0])));
  const p = L.ctx.worn.get('primary');
  if (r.group.token === 'PRIMARY' && p?.item?.twoHanded && p.reason === null) out.push(UPGRADES_COPY.twoHanded(md(p.item.name)));
  return out;
}

/** The candidates in display order (listed, then level unknown, each sorted), and how many a cap hid. */
const ordered = (r: GroupResult, cap: Cap) => {
  const by = grouped(r.upgrades, cap);
  return { all: GROUPS.flatMap((g) => by[g].map((u) => ({ g, u }))), hidden: by.above.length };
};

/** One page of one slot's list: the embed, and (unless `posted`) its controls. Pages count from 0. */
async function slotPage(c: Ctx, L: Loaded, key: string, cap: Cap, page: number, posted = false, note?: string): Promise<{ embed: Embed; components: unknown[] }> {
  const r = compare(L, key);
  const { all, hidden } = ordered(r, cap);
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const n = Math.min(Math.max(0, page), pages - 1);
  const shown = all.slice(n * PER_PAGE, n * PER_PAGE + PER_PAGE);
  const x = await extras(c, shown.map((s) => s.u.item));
  const body: string[] = [...(note ? [note, ''] : []), UPGRADES_COPY.who(L.ch), ...headerLines(L, r)];
  if (cap !== null) body.push(UPGRADES_COPY.capNote(cap));
  if (!all.length) {
    const worn = r.worn.filter((g) => g.reason === null && g.item);
    const what = worn.length ? worn.map((g) => md(g.item!.name)).join(' and ') : UPGRADES_COPY.emptySlot(r.group.label);
    body.push('', UPGRADES_COPY.nothing(what, L.cls, r.group.label));
  }
  let last: LevelGroup | null = null;
  for (const s of shown) {
    if (s.g !== last) body.push('', `__${UPGRADES_COPY.head[s.g as (typeof GROUPS)[number]]}__`);
    last = s.g;
    body.push(...resultLines(s.u, L, howToGet(s.u.item, x, c.userId, c.guild.learning_window).lines));
  }
  // The owner (2026-11-06): with a cap, a quiet count of what it hid, at the end of the list.
  if (cap !== null && hidden && n === pages - 1) body.push('', `-# ${UPGRADES_COPY.hidden(hidden, cap)}`);
  const embed: Embed = {
    title: truncate(UPGRADES_COPY.slotTitle(r.group.label, L.ch.name), EMBED_LIMITS.title),
    description: truncate(body.join('\n'), EMBED_LIMITS.description),
    footer: { text: [all.length > PER_PAGE ? UPGRADES_COPY.page(n + 1, pages) : null, UPGRADES_COPY.weights(L.cls)].filter(Boolean).join(' · ') },
  };
  if (posted || !shown.length) return { embed, components: [] };
  const state = `${L.ch.id}:${key}:${capState(cap)}`;
  const own = L.ch.owner_user_id === c.userId;
  const nav = [
    ...(pages > 1
      ? [button(`${PAGE_PREFIX}${state}:${Math.max(0, n - 1)}`, UPGRADES_COPY.smaller, undefined, n === 0), button(`${PAGE_PREFIX}${state}:${n + 1}`, UPGRADES_COPY.bigger, undefined, n >= pages - 1)]
      : []),
    // Pages an officer opened for someone else's character can't be posted.
    ...(own ? [button(`${POST_PREFIX}${POST_WHAT}${state}:${n}`, 'Post to channel')] : []),
  ];
  // Two disabled page buttons could share an id (page 0 of 1 never shows them): the ids differ whenever both show.
  const pick = row([
    {
      type: MessageComponentTypes.STRING_SELECT,
      custom_id: `${RESULT_PREFIX}${state}`,
      placeholder: UPGRADES_COPY.pickResult,
      options: shown.map((s) => ({ label: truncate(s.u.item.name, 100), value: String(s.u.item.id), description: truncate(`${fmtHundredths(s.u.gain)} · ${levelText(s.u.item)}`, 100) })),
    },
  ]);
  return { embed, components: [pick, ...(nav.length ? [row(nav)] : [])] };
}

// ---------------------------------------------------------------- the command and Find upgrades

/**
 * /gear upgrades [character:] [slot:] [max_level:]: the caller's own characters. No cap unless max_level: is given. A client
 * still holding the earlier definition may send levels: (a window above the character's level): it is read as the cap
 * level + levels for a character with a level, and ignored otherwise (order 35: the new code answers the old shape).
 */
export async function gearUpgrades(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const name = optString(opts, 'character');
  const key = optString(opts, 'slot');
  const max = optInt(opts, 'max_level');
  const oldLevels = optInt(opts, 'levels');
  if (max !== undefined && (max < 1 || max > MAX_LEVEL_CAP)) return ephemeral(UPGRADES_COPY.capRange);
  if (key !== undefined && !groupByKey(key)) return ephemeral(UPGRADES_COPY.unknownSlot);
  let ch: Character | null;
  if (name !== undefined) {
    ch = await findByName(c.db, c.guild.id, c.userId, name);
    if (!ch) return ephemeral(`You have no character named **${md(name)}**.`);
  } else {
    const live = await liveCharacters(c.db, c.guild.id, c.userId);
    if (!live.length) return ephemeral(noCharacters(c, c.userId));
    if (live.length > 1) return ephemeral(WEAR_COPY.severalCharacters(live.map((x) => x.name)));
    ch = live[0];
  }
  const cap: Cap = max ?? (oldLevels !== undefined && ch.level !== null ? Math.min(MAX_LEVEL_CAP, ch.level + oldLevels) : null);
  const L = await load(c, ch);
  const v = key ? await slotPage(c, L, key, cap, 0) : summaryView(L, cap);
  return ephemeral('', { embeds: [v.embed], components: v.components });
}

/** guf:<character id>: Find upgrades on the Gear panel: the summary, as a new private message. */
async function findUpgrades(c: Ctx, id: string): Promise<MessageReply> {
  const t = await characterFor(c, id.slice(FIND_UPGRADES_PREFIX.length));
  if ('reply' in t) return t.reply;
  const v = summaryView(await load(c, t.ch), null);
  return ephemeral('', { embeds: [v.embed], components: v.components });
}

const parts = (id: string, prefix: string) => id.slice(prefix.length).split(':');
const int = (s: string | undefined) => (s !== undefined && /^\d+$/.test(s) ? Number(s) : null);

/** gus:<character id>:<window>: a slot picked on the summary; its list replaces the summary. */
async function slotPicked(c: Ctx, id: string, values: string[]): Promise<MessageReply> {
  const [charId, w] = parts(id, SLOT_PREFIX);
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  const key = values[0] ?? '';
  if (!groupByKey(key)) return ephemeral(UPGRADES_COPY.unknownSlot);
  const v = await slotPage(c, await load(c, t.ch), key, capOf(w), 0);
  return updateMessage({ embeds: [v.embed], components: v.components });
}

/** gup:<character id>:<group>:<cap>:<page>: paging, in place. */
async function pagePressed(c: Ctx, id: string): Promise<MessageReply> {
  const [charId, key, w, p] = parts(id, PAGE_PREFIX);
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  if (!groupByKey(key ?? '')) return ephemeral(UPGRADES_COPY.unknownSlot);
  const v = await slotPage(c, await load(c, t.ch), key, capOf(w), int(p) ?? 0);
  return updateMessage({ embeds: [v.embed], components: v.components });
}

/** gur:<character id>:<group>:<window>: one result, as a new private message, with its controls. */
async function resultPicked(c: Ctx, id: string, values: string[]): Promise<MessageReply> {
  const [charId, key, w] = parts(id, RESULT_PREFIX);
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  if (!groupByKey(key ?? '')) return ephemeral(UPGRADES_COPY.unknownSlot);
  const L = await load(c, t.ch);
  const u = compare(L, key).upgrades.find((x) => x.item.id === Number(values[0]));
  if (!u) return ephemeral(UPGRADES_COPY.gone);
  return resultReply(c, L, key, capOf(w), u);
}

/**
 * The owner (2026-11-06): Pick a result opens the item's full /item card. Above it, the upgrade itself (its gain for this
 * character's slot, the breakdown and how to get it); under it, I'm wearing it now and Request a craft, then a button for
 * each zone the text and the card show (src/zone/buttons.ts, in the rows left; the rest named as "+N more zones").
 */
async function resultReply(c: Ctx, L: Loaded, key: string, cap: Cap, u: Upgrade): Promise<MessageReply> {
  const [x, k] = await Promise.all([extras(c, [u.item]), itemCard(c, u.item.id)]);
  if (!k) return ephemeral(UPGRADES_COPY.gone);
  const how = howToGet(u.item, x, c.userId, c.guild.learning_window);
  const slot = u.side ?? (key === 'secondary' ? 'secondary' : groupByKey(key)!.sides[0]);
  const buttons = [
    // Review fix: not under a two-hander (order 35's saved gear refuses Secondary there); the result says why instead.
    ...(u.note === 'needsOneHand' ? [] : [button(`${WEAR_NOW_PREFIX}${L.ch.id}:${slot}:${capState(cap)}:${u.item.id}`, UPGRADES_COPY.wearingNow, STYLE_PRIMARY)]),
    ...(how.craftable ? [button(`${FROM_FIND_PREFIX}${u.item.id}`, UPGRADES_COPY.requestCraft)] : []),
  ];
  const own = buttons.length ? [row(buttons)] : [];
  const z = await zoneButtons(c.db, [...how.zones, ...k.zones], own.length);
  const more = z.zones - z.shown;
  const label = sideLabel(slot);
  const content = [
    `${UPGRADES_COPY.who(L.ch)} · ${UPGRADES_COPY.forSlot(L.ch.name, label)}`,
    ...resultLines(u, L, how.lines),
    ...(more > 0 ? [`-# ${UPGRADES_COPY.moreZones(more)}`] : []),
    `-# ${UPGRADES_COPY.weights(L.cls)}`,
  ].join('\n');
  return ephemeral(truncate(content, 2000), { embeds: k.embeds, components: [...own, ...z.rows] });
}

/** guw:<character id>:<slot>:<window>:<item id>: saved through order 35's rules; then the slot's updated list, in place. */
async function wearNow(c: Ctx, id: string): Promise<MessageReply> {
  const [charId, slot, w, itemId] = parts(id, WEAR_NOW_PREFIX);
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  const saved = await wearById(c, t.ch, Number(itemId), slot ?? '');
  if (!saved) return ephemeral(UPGRADES_COPY.gone);
  // The character as it is now (a class or level change since the list was drawn applies).
  const ch = (await findById(c.db, c.guild.id, t.ch.id)) ?? t.ch;
  const key = SLOT_GROUPS.find((g) => g.sides.includes(slot ?? ''))!.key;
  const v = await slotPage(c, await load(c, ch), key, capOf(w), 0, false, saved.data.content);
  return updateMessage({ embeds: [v.embed], components: v.components });
}

/** guo:<item id>: the /item card, privately, as /item shows it. */
async function openItem(c: Ctx, id: string): Promise<MessageReply> {
  const itemId = Number(id.slice(OPEN_PREFIX.length));
  const k = Number.isInteger(itemId) ? await itemCard(c, itemId) : null;
  if (!k) return ephemeral(UPGRADES_COPY.gone);
  return withZoneButtons(c.db, searchReply({ content: k.note ?? undefined, embeds: k.embeds }, `${ITEM_POST}${itemId}`, k.links, [k.actions]), k.zones);
}

/** pub:gu:<character id>:<group>:<window>:<page>: this page, public, with no buttons. The character's owner only. */
export async function postUpgrades(c: Ctx, what: string): Promise<MessageReply> {
  const [charId, key, w, p] = what.split(':');
  const t = await characterFor(c, charId ?? '', true);
  if ('reply' in t) return t.reply;
  if (!groupByKey(key ?? '')) return ephemeral(UPGRADES_COPY.unknownSlot);
  const v = await slotPage(c, await load(c, t.ch), key, capOf(w), int(p) ?? 0, true);
  return postedReply({ embeds: [v.embed] }, c.userId);
}

/** The deferred /gear upgrades controls (null: not one). */
export function upgradesComponent(c: Ctx, id: string, values: string[]): Promise<MessageReply> | null {
  if (id.startsWith(FIND_UPGRADES_PREFIX)) return findUpgrades(c, id);
  if (id.startsWith(SLOT_PREFIX)) return slotPicked(c, id, values);
  if (id.startsWith(PAGE_PREFIX)) return pagePressed(c, id);
  if (id.startsWith(RESULT_PREFIX)) return resultPicked(c, id, values);
  if (id.startsWith(WEAR_NOW_PREFIX)) return wearNow(c, id);
  if (id.startsWith(OPEN_PREFIX)) return openItem(c, id);
  return null;
}

// /gear find (work order 13, ITEMs 3–4): gear by class, slot, weapon type, AC, ratio, stats and source, from the community
// wiki's data. Private, 10 per page, with Previous/Next and a details menu; the item card reuses /craft find's crafter
// groups, Stat image and Post to channel. No writes per search beyond the read audit row 'gear.find' (src/interactions.ts).
import type { Ctx } from '../context.ts';
import { craftersSql, tierCrafters, type CrafterRow } from '../crafters.ts';
import { button, EMBED_LIMITS, embedChars, ephemeral, linkButton, md, optInt, optString, plural, row, truncate, updateMessage, type Embed, type EmbedField, type MessageData, type MessageReply, type Option } from '../discord.ts';
import { decodeState, defaultSort, encodeState, roundRatio, sortByKey, SORTS, STAT_FILTERS, type GearQuery } from '../gear/options.ts';
import { withZoneButtons, zoneButtons, type ZoneButtons, type ZoneRef } from '../zone/buttons.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE, zoneKey } from '../zone/names.ts';
import { unknownZone } from '../zone/suggest.ts';
import { ZONE_STATE_MAX } from '../gear/options.ts';
import { GEAR_COLS, PAGE_SIZE, relaxStatement, searchStatement, type GearRow } from '../gear/search.ts';
import { ALL_CLASSES, SLOTS, SOURCES, WEAPON_TYPES, type Source } from '../gear/vocab.ts';
import { FINISHED_IMPORT } from '../import-status.ts';
import { CORRECTED_COLS, correctionJoin, visibleTo, type Acquisition } from '../recipes.ts';
import { IMAGE_PREFIX, findEmbeds, footerText, itemLinks, loadFind, statFields, trivialText } from './find.ts';
import { ITEM_REPORT_PREFIX } from './reports.ts';
import { postedReply, searchReply } from './share.ts';

export const PAGE_PREFIX = 'gp:';
export const DETAILS_PREFIX = 'gd:';
/** Order 17b: the sort select on one zone's results, "gs:<state>"; a pick redraws page 1 in place. */
export const SORT_PREFIX = 'gs:';
/** Post to channel for an item card: "pub:gear:<item id>" (src/commands/share.ts POST_PREFIX). */
export const POST_WHAT = 'gear:';

/** The wiki category that marks a page's stats as wrong. */
export const INCORRECT_STATS_CATEGORY = 'Pages with incorrect item stats';
const SHOWN_FLAGS = ['MAGIC', 'NO DROP', 'LORE'];
/** Mobs and zones on a result line, then "+N more". */
const LINE_MOBS = 3;
const LINE_ZONES = 3;
/** Room left for the one-time welcome embed on a first command (as src/commands/find.ts). */
const WELCOME_RESERVE = 1000;

// ---------------------------------------------------------------- copy (order 13; listed for approval in docs/COPY.md)

export const GEAR_COPY = {
  title: 'Gear finder',
  footer: (page: number, sort: string, version: string | null) => `Page ${page} · sorted by ${sort} · ${footerText(version)}`,
  noData: 'No gear is loaded yet. The data arrives with the nightly import from the community wiki.',
  none: 'No items match all of those filters.',
  relax: (label: string, n: number) => `The filter that removed the most is **${md(label)}**: without it, ${plural(n, 'item')} match. Try relaxing it.`,
  relaxNone: 'Even with any one filter removed, nothing matches. Try fewer filters.',
  unknownSource: 'source not recorded',
  incorrectStats: 'stats may be wrong (wiki)',
  allClasses: 'All',
  noClass: 'no class listed',
  details: 'Details: pick an item',
  /** Order 17b: one zone's results (Gear here, or /gear find zone:) say which zone, and carry a sort select. */
  fromZone: (zone: string) => `**Gear from ${md(zone)}**`,
  sortPlaceholder: 'Sort',
  sortOption: (label: string) => `Sort: ${label}`,
  previous: 'Previous',
  next: 'Next',
  gone: 'That item is no longer in the data. Run `/gear` again.',
  more: (n: number) => `+${n} more`,
  canMake: (n: number) => `${plural(n, 'guild character')} can make it`,
  withSkill: (n: number, skill: string) => `${plural(n, 'guild character')} with ${skill} (trivial unknown)`,
  vendorLine: (base: unknown) => `Vendor: ${typeof base === 'number' ? `price ${base}` : 'price not recorded'}`,
  /** /gear find's help, under every results page (order 13, ITEM 4). */
  help: [
    '-# Class is required: pick yours, or Any.',
    '-# Ratio = damage ÷ delay (none when delay is 0 or missing).',
    '-# Sources come from the community wiki; Unknown means the wiki has not recorded one.',
  ].join('\n'),
  reportButton: 'Report a problem',
  imageButton: 'Stat image',
  /** Order 19 (ITEM 5): a link button on results pages and the details card. */
  plannerButton: 'Character planner (Stories of MnM)',
} as const;

/** Stories of MnM's planner. Its page documents no class parameter, so the plain address (order 19, ITEM 5). */
export const PLANNER_URL = 'https://storiesofmnm.com/character-planner/';
const plannerLink = () => linkButton(GEAR_COPY.plannerButton, PLANNER_URL);

// ---------------------------------------------------------------- reading the options

export function parseQuery(opts: Option[]): GearQuery | string {
  const cls = optString(opts, 'class');
  if (!cls) return 'Pick a class (or Any).';
  const pick = <T extends string>(list: readonly T[], name: string) => {
    const v = optString(opts, name);
    return v !== undefined && (list as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  const ratio = opts.find((o) => o.name === 'min_ratio')?.value;
  const stats = [1, 2, 3].map((n) => STAT_FILTERS.find((s) => s.key === optString(opts, `stat${n}`))).filter((s) => s !== undefined);
  const q: Omit<GearQuery, 'sort'> = {
    cls,
    slot: pick(SLOTS, 'slot'),
    weaponType: pick(WEAPON_TYPES, 'weapon_type'),
    minAc: optInt(opts, 'min_ac'),
    minRatio: typeof ratio === 'number' ? roundRatio(ratio) : undefined,
    stats: [...new Set(stats)],
    source: pick(SOURCES, 'source'),
  };
  // Order 17: the zone by its key (case and apostrophes folded, as the zone table's keys are).
  const zone = optString(opts, 'zone');
  return { ...q, ...(zone ? { zone: zoneKey(zone) } : {}), sort: sortByKey(optString(opts, 'sort')) ?? defaultSort(q) };
}

// ---------------------------------------------------------------- the data behind a page

interface Origin {
  from?: string[];
  wikiZones?: string[];
  soldBy?: { base?: number | null; shady?: number | null; vendors?: string[] };
  categories?: string[];
}
interface MobRow {
  key: string;
  title: string;
  level: string | null;
  zones_json: string | null;
}
interface RecipeRow {
  id: number;
  item_id: number;
  tradeskill: string;
  trivial: number | null;
  acquisition: Acquisition;
  trivial_corrected: number;
  trivial_unconfirmed: number;
}
interface PageData {
  classes: { code: string; bit: number }[];
  mobs: MobRow[];
  recipes: RecipeRow[];
  crafters: CrafterRow[];
  version: string | null;
}

const parse = <T>(s: string | null): T => (s ? JSON.parse(s) : {}) as T;
const sourcesOf = (mask: number): Source[] => SOURCES.filter((_, i) => mask & (1 << i));

/**
 * The mobs the page's items name (first LINE_MOBS each, or all for a card), their recipes and their crafters. One batch.
 * `withRecipes` false (order 18's /item card, which reads them with /craft find's loadFind) leaves the recipes out.
 */
export async function pageData(c: Pick<Ctx, 'db' | 'guild'>, rows: GearRow[], mobsPerItem = LINE_MOBS, withRecipes = true): Promise<PageData> {
  const names = [...new Set(rows.flatMap((r) => (parse<Origin>(r.origin_json).from ?? []).slice(0, mobsPerItem)))];
  const crafted = withRecipes ? rows.filter((r) => sourcesOf(r.source_mask).includes('Crafted')).map((r) => r.id) : [];
  const db = c.db;
  const [classes, mobs, recipes, version, ...crafters] = await db.batch([
    db.prepare('SELECT code, bit FROM game_class WHERE item_count > 0 AND bit IS NOT NULL'),
    // key and title are NOCASE columns: the match is case-insensitive, by key first, then by title (mobFor).
    db.prepare('SELECT key, title, level, zones_json FROM mob WHERE active = 1 AND (key IN (SELECT value FROM json_each(?1)) OR title IN (SELECT value FROM json_each(?1)))').bind(JSON.stringify(names)),
    db
      .prepare(
        `SELECT r.id, r.result_item_id AS item_id, t.name AS tradeskill, ${CORRECTED_COLS},
           CASE WHEN rc.trivial IS NULL THEN r.trivial_unconfirmed ELSE 0 END AS trivial_unconfirmed
         FROM recipe r JOIN tradeskill t ON t.id = r.tradeskill_id ${correctionJoin('?1')}
         WHERE r.result_item_id IN (SELECT value FROM json_each(?2)) AND ${visibleTo('?1')} ORDER BY t.name COLLATE NOCASE, r.source_key`,
      )
      .bind(c.guild.id, JSON.stringify(crafted)),
    db.prepare(`SELECT source_version FROM data_import WHERE ${FINISHED_IMPORT} ORDER BY id DESC LIMIT 1`),
    ...crafted.map((id) => db.prepare(craftersSql('?1')).bind(id, c.guild.id)),
  ]);
  return {
    classes: classes.results as PageData['classes'],
    mobs: mobs.results as MobRow[],
    recipes: recipes.results as RecipeRow[],
    crafters: crafters.flatMap((r) => r.results as CrafterRow[]),
    version: (version.results as { source_version: string }[])[0]?.source_version ?? null,
  };
}

/** A from-name's mob: by key, then by title (case-insensitive), or none. */
function mobFor(d: PageData, name: string): MobRow | undefined {
  const k = name.toLowerCase();
  return d.mobs.find((m) => m.key.toLowerCase() === k) ?? d.mobs.find((m) => m.title.toLowerCase() === k);
}

// ---------------------------------------------------------------- one result

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const fmtRatio = (r: number) => String(Math.round(r * 1000) / 1000);

export function classesText(mask: number, classes: PageData['classes']): string {
  if (mask === ALL_CLASSES) return GEAR_COPY.allClasses;
  const codes = classes.filter((c) => mask & (1 << c.bit)).map((c) => c.code).sort();
  return codes.length ? codes.join(' ') : GEAR_COPY.noClass;
}

/** "AC 12 · ratio 0.333 (5/15)", then the sorted and filtered stats in bold, then the others: briefly. */
function statsText(r: GearRow, q: GearQuery, maxOthers: number): string {
  const s = parse<Record<string, unknown>>(r.stats_json);
  const head: string[] = [];
  if (r.ac !== null) head.push(`AC ${r.ac}`);
  if (r.ratio !== null) head.push(`ratio ${fmtRatio(r.ratio)} (${s.dmg}/${s.delay})`);
  const valued = STAT_FILTERS.map((k) => {
    const [, group, key] = k.path.split('.');
    const v = key ? (s[group] as Record<string, unknown> | undefined)?.[key] : s[group];
    return { k, v: typeof v === 'number' ? v : null };
  }).filter((x) => x.v !== null && x.v !== 0);
  const picked = new Set([...q.stats.map((x) => x.key), q.sort.key]);
  const strong = valued.filter((x) => picked.has(x.k.key)).map((x) => `**${x.k.label} ${signed(x.v!)}**`);
  const others = valued.filter((x) => !picked.has(x.k.key)).map((x) => `${x.k.label} ${signed(x.v!)}`);
  const shown = others.slice(0, maxOthers);
  if (q.sort.key === 'TOTAL') strong.unshift(`**total stats ${r.total_stats}**`);
  return [...head, ...strong, ...shown, ...(others.length > shown.length ? [GEAR_COPY.more(others.length - shown.length)] : [])].join(' · ');
}

/** `shown` (order 23) collects the zone names the line shows, in its order: each shown mob's first zone, then wikiZones. */
function dropLine(o: Origin, d: PageData, maxMobs: number, maxZones: number, shown: ZoneRef[] = []): string {
  const from = o.from ?? [];
  const zones = o.wikiZones ?? [];
  const mob = (name: string) => {
    const m = mobFor(d, name);
    const zone = m?.zones_json ? (JSON.parse(m.zones_json) as string[])[0] : null;
    if (zone) shown.push({ source: MOB_ZONES_SOURCE, name: zone });
    const bits = [m?.level ? `L${m.level}` : null, zone].filter(Boolean);
    return `${md(name)}${bits.length ? ` (${bits.map((b) => md(String(b))).join(', ')})` : ''}`;
  };
  const parts: string[] = [];
  if (from.length) parts.push(from.slice(0, maxMobs).map(mob).join(', ') + (from.length > maxMobs ? ` ${GEAR_COPY.more(from.length - maxMobs)}` : ''));
  shown.push(...zones.slice(0, maxZones).map((name): ZoneRef => ({ source: WIKI_ZONES_SOURCE, name })));
  if (zones.length) parts.push(`zones: ${zones.slice(0, maxZones).map(md).join(', ')}${zones.length > maxZones ? ` ${GEAR_COPY.more(zones.length - maxZones)}` : ''}`);
  return `Drop: ${parts.join(' · ')}`;
}

function craftedLine(itemId: number, d: PageData, window: number): string {
  const rs = d.recipes.filter((r) => r.item_id === itemId);
  if (!rs.length) return 'Crafted';
  const r = rs[0];
  const tiers = tierCrafters(d.crafters, r, window);
  const who = r.trivial === null ? GEAR_COPY.withSkill(tiers.unknown.length, r.tradeskill) : GEAR_COPY.canMake(tiers.reliable.length);
  return `Crafted: ${r.tradeskill}, ${trivialText(r)}, ${who}${rs.length > 1 ? ` · ${GEAR_COPY.more(rs.length - 1)}` : ''}`;
}

function vendorLine(o: Origin, maxVendors: number): string {
  const v = o.soldBy?.vendors ?? [];
  const shown = v.slice(0, maxVendors).map(md).join(', ');
  return `${GEAR_COPY.vendorLine(o.soldBy?.base)}${shown ? ` · ${shown}` : ''}${v.length > maxVendors ? ` ${GEAR_COPY.more(v.length - maxVendors)}` : ''}`;
}

/** The source lines, one per source the item has (Drop, Crafted, Vendor, Quest), or "Unknown: source not recorded". */
function sourceLines(r: GearRow, d: PageData, window: number, caps: { mobs: number; zones: number; vendors: number }, shown?: ZoneRef[]): string[] {
  const o = parse<Origin>(r.origin_json);
  return sourcesOf(r.source_mask).map((s) => {
    switch (s) {
      case 'Drop':
        return dropLine(o, d, caps.mobs, caps.zones, shown);
      case 'Crafted':
        return craftedLine(r.id, d, window);
      case 'Vendor':
        return vendorLine(o, caps.vendors);
      case 'Quest':
        return 'Quest';
      case 'Unknown':
        return `Unknown: ${GEAR_COPY.unknownSource}`;
    }
  });
}

function flagsOf(r: GearRow): string[] {
  const s = parse<{ flags?: string[] }>(r.stats_json);
  return (s.flags ?? []).filter((f) => SHOWN_FLAGS.includes(f));
}
export const incorrectStats = (r: GearRow) => (parse<Origin>(r.origin_json).categories ?? []).includes(INCORRECT_STATS_CATEGORY);

export function resultEntry(r: GearRow, q: GearQuery, d: PageData, window: number, caps = { mobs: LINE_MOBS, zones: LINE_ZONES, vendors: 3, stats: 4 }, shown?: ZoneRef[]): string {
  const name = r.wiki_url ? `**[${md(r.name)}](${r.wiki_url})**` : `**${md(r.name)}**`;
  const meta = [`Classes: ${classesText(r.class_mask, d.classes)}`, ...flagsOf(r), ...(incorrectStats(r) ? [`⚠ ${GEAR_COPY.incorrectStats}`] : [])].join(' · ');
  const stats = statsText(r, q, caps.stats);
  return [`${name} · ${(r.slot ?? '').toUpperCase()}`, stats, meta, ...sourceLines(r, d, window, caps, shown).map((l) => `-# ${l}`)].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- the page

/** Ever smaller lines until the page fits the description and the message total (less the welcome's reserve). */
const CAPS = [
  { mobs: 3, zones: 3, vendors: 3, stats: 4 },
  { mobs: 2, zones: 2, vendors: 2, stats: 2 },
  { mobs: 1, zones: 1, vendors: 1, stats: 0 },
];

export const pageEmbed = (rows: GearRow[], q: GearQuery, d: PageData, page: number, window: number): Embed => pageView(rows, q, d, page, window).embed;

/** The page's embed, and (order 23) the zone names its text shows after the line caps, in the order they appear. */
export function pageView(rows: GearRow[], q: GearQuery, d: PageData, page: number, window: number): { embed: Embed; zones: ZoneRef[] } {
  const footer = { text: GEAR_COPY.footer(page + 1, q.sort.label, d.version) };
  const title = GEAR_COPY.title;
  const budget = Math.min(EMBED_LIMITS.description, EMBED_LIMITS.total - WELCOME_RESERVE - title.length - footer.text.length);
  let entries: { text: string; zones: ZoneRef[] }[] = [];
  const text = () => entries.map((e) => e.text).join('\n\n');
  for (const caps of CAPS) {
    entries = rows.map((r) => {
      const zones: ZoneRef[] = [];
      return { text: resultEntry(r, q, d, window, caps, zones), zones };
    });
    if (text().length <= budget) break;
  }
  // Still over: whole entries are left off the end (the details menu still lists every row), never cut mid-markdown.
  while (entries.length > 1 && text().length > budget) entries.pop();
  // A last entry still cut by the truncation (one entry over the whole description) may lose its zones from view: all
  // its zones get no button, even any still visible before the cut. Safe, and no real entry is that long.
  const seen = text().length > budget ? entries.slice(0, -1) : entries;
  return { embed: { title, description: truncate(text(), budget), footer }, zones: seen.flatMap((e) => e.zones) };
}

function pageComponents(rows: GearRow[], q: GearQuery, page: number, hasNext: boolean): unknown[] {
  const state = encodeState(q);
  const nav = row([
    button(`${PAGE_PREFIX}${page - 1}:${state}`, GEAR_COPY.previous, undefined, page === 0),
    button(`${PAGE_PREFIX}${page + 1}:${state}`, GEAR_COPY.next, undefined, !hasNext),
    plannerLink(),
  ]);
  const select = row([
    {
      type: 3,
      custom_id: DETAILS_PREFIX,
      placeholder: GEAR_COPY.details,
      options: rows.map((r) => ({ label: truncate(r.name, 100), value: String(r.id), description: truncate(r.slot ?? '', 100) || undefined })),
    },
  ]);
  if (q.zone === undefined) return [nav, select];
  // A select holds 25 options; the sort list is shorter (src/gear/options.ts SORTS).
  const sorts = row([
    {
      type: 3,
      custom_id: `${SORT_PREFIX}${state}`,
      placeholder: GEAR_COPY.sortPlaceholder,
      options: SORTS.slice(0, 25).map((s, i) => ({ label: GEAR_COPY.sortOption(s.label), value: String(i), ...(s.key === q.sort.key ? { default: true } : {}) })),
    },
  ]);
  return [nav, select, sorts];
}

/** "Gear from <zone>" above one zone's results; nothing for other searches, or a zone gone from the data. */
async function zoneHeading(c: Ctx, q: GearQuery): Promise<string | null> {
  if (q.zone === undefined) return null;
  const name = (await c.db.prepare('SELECT name FROM zone WHERE key = ? AND active = 1').bind(q.zone).first<{ name: string }>())?.name;
  return name ? GEAR_COPY.fromZone(name) : null;
}
const withHeading = (heading: string | null) => (heading ? `${heading}\n${GEAR_COPY.help}` : GEAR_COPY.help);

async function zeroResults(c: Ctx, q: GearQuery): Promise<MessageReply> {
  const relax = relaxStatement(c.db, q);
  if (!relax) return ephemeral(GEAR_COPY.noData);
  const counts = (await relax.stmt.first<Record<string, number | null>>()) ?? {};
  const best = relax.labels.map((label, i) => ({ label, n: Number(counts[`f${i}`] ?? 0) })).sort((a, b) => b.n - a.n)[0];
  return ephemeral([GEAR_COPY.none, best && best.n > 0 ? GEAR_COPY.relax(best.label, best.n) : GEAR_COPY.relaxNone, GEAR_COPY.help].join('\n'));
}

async function page(c: Ctx, q: GearQuery, n: number): Promise<{ rows: GearRow[]; hasNext: boolean; data: PageData } | null> {
  const { results } = await searchStatement(c.db, q, n).all<GearRow>();
  if (!results.length) return null;
  const rows = results.slice(0, PAGE_SIZE);
  return { rows, hasNext: results.length > PAGE_SIZE, data: await pageData(c, rows) };
}

/**
 * Results page n, as the member sees it (first, paged or re-sorted): the heading, the embed and the components, with
 * (order 23) a button for each zone the text shows in the rows the page leaves, never one for the results' own zone.
 */
export async function resultsPage(c: Ctx, q: GearQuery, n: number): Promise<{ data: Omit<MessageData, 'flags'>; zones: ZoneButtons } | null> {
  const p = await page(c, q, n);
  if (!p) return null;
  const v = pageView(p.rows, q, p.data, n, c.guild.learning_window);
  const own = pageComponents(p.rows, q, n, p.hasNext);
  const [heading, zones] = await Promise.all([zoneHeading(c, q), zoneButtons(c.db, v.zones, own.length, q.zone)]);
  return { data: { content: withHeading(heading), embeds: [v.embed], components: [...own, ...zones.rows] }, zones };
}

export async function gearFind(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const q = parseQuery(opts);
  if (typeof q === 'string') return ephemeral(q);
  // Order 17: a zone must be one the data holds (and short enough for the paging state); otherwise, suggestions.
  if (q.zone !== undefined) {
    const known = q.zone.length <= ZONE_STATE_MAX && (await c.db.prepare('SELECT 1 FROM zone WHERE key = ? AND active = 1').bind(q.zone).first());
    if (!known) return unknownZone(c.db, optString(opts, 'zone') ?? '');
  }
  return gearResults(c, q, false);
}

/**
 * The first results page for a query: a new private message, or (`inPlace`: /zone's Gear here, or a new sort) an edit.
 * One zone's results carry "Gear from <zone>" above the help, so the zone filter stays visible.
 */
export async function gearResults(c: Ctx, q: GearQuery, inPlace: boolean): Promise<MessageReply> {
  const p = await resultsPage(c, q, 0);
  if (!p) {
    const zero = await zeroResults(c, q);
    return inPlace ? updateMessage({ content: zero.data.content, embeds: [], components: [] }) : zero;
  }
  const { content, ...data } = p.data;
  return inPlace ? updateMessage(p.data) : ephemeral(content ?? '', data);
}

/** gs:<state>: a sort picked on one zone's results; page 1 in that sort replaces the results. */
export async function gearSort(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const q = decodeState(customId.slice(SORT_PREFIX.length));
  const sort = SORTS[Number(values[0])];
  if (!q || !sort) return ephemeral(GEAR_COPY.gone);
  return gearResults(c, { ...q, sort }, true);
}

/** gp:<page>:<state>: Previous / Next, editing the private results in place. */
export async function gearPage(c: Ctx, customId: string): Promise<MessageReply> {
  const [, n, state] = /^gp:(\d+):(.*)$/.exec(customId) ?? [];
  const q = state === undefined ? null : decodeState(state);
  if (!q) return ephemeral(GEAR_COPY.gone);
  const p = await resultsPage(c, q, Number(n));
  if (!p) return updateMessage({ content: GEAR_COPY.none, embeds: [], components: [] });
  return updateMessage(p.data);
}

// ---------------------------------------------------------------- the item card

/** A card line, with where each zone name in it ends (order 23: a zone cut off by the line's truncation is not shown). */
interface CardLine {
  text: string;
  zones: { ref: ZoneRef; end: number }[];
}
function mobLine(d: PageData, name: string): CardLine {
  const m = mobFor(d, name);
  const zones = (m?.zones_json ? (JSON.parse(m.zones_json) as string[]) : []).filter(Boolean);
  const bits = [...(m?.level ? [{ text: `L${m.level}`, zone: null }] : []), ...zones.map((z) => ({ text: z, zone: z }))];
  let text = md(name);
  const out: CardLine['zones'] = [];
  bits.forEach((b, i) => {
    text += `${i ? ', ' : ' ('}${md(b.text)}`;
    if (b.zone) out.push({ ref: { source: MOB_ZONES_SOURCE, name: b.zone }, end: text.length });
  });
  return { text: bits.length ? `${text})` : text, zones: out };
}

/**
 * Full sources on the card: every mob (up to the field limit), the zones, the vendors as recorded. Each field carries
 * (order 23) the zone names its value shows, in order.
 */
export function cardSources(r: GearRow, d: PageData): { field: EmbedField; zones: ZoneRef[] }[] {
  const o = parse<Origin>(r.origin_json);
  const f: { field: EmbedField; zones: ZoneRef[] }[] = [];
  const push = (field: EmbedField, zones: ZoneRef[] = []) => f.push({ field, zones });
  const fitted = (name: string, lines: CardLine[]) => {
    const { value, shown } = fitCardLines(lines.map((l) => l.text));
    push({ name, value }, lines.slice(0, shown).flatMap((l) => l.zones.filter((z) => z.end <= (l.text.length > CARD_LINE ? CARD_LINE - 1 : Infinity)).map((z) => z.ref)));
  };
  for (const s of sourcesOf(r.source_mask)) {
    if (s === 'Drop') {
      const lines = (o.from ?? []).map((name) => mobLine(d, name));
      if (lines.length) fitted('Drop: mobs', lines);
      if (o.wikiZones?.length) fitted('Drop: zones', o.wikiZones.map((name) => ({ text: md(name), zones: [{ ref: { source: WIKI_ZONES_SOURCE, name }, end: md(name).length }] })));
    } else if (s === 'Vendor') {
      const sb = o.soldBy ?? {};
      const price = [typeof sb.base === 'number' ? `price ${sb.base}` : null, typeof sb.shady === 'number' ? `shady price ${sb.shady}` : null].filter(Boolean).join(' · ');
      push({ name: 'Vendor', value: truncate([price || 'price not recorded', ...(sb.vendors ?? []).map(md)].join('\n'), EMBED_LIMITS.fieldValue) });
    } else if (s === 'Quest') push({ name: 'Quest', value: (o.categories ?? []).filter((x) => x === 'Quest Items' || x === 'Reward').join(', ') || 'Quest' });
    else if (s === 'Unknown') push({ name: 'Unknown', value: GEAR_COPY.unknownSource });
    // Crafted: the recipe embeds below carry it, with the crafter groups.
  }
  return f;
}

/** A card's fields (its stats, then its sources, to the field limit) and the zone names the fields kept show. */
export function cardFields(stats: EmbedField[], r: GearRow, d: PageData): { fields: EmbedField[]; zones: ZoneRef[] } {
  const sources = cardSources(r, d);
  const kept = sources.slice(0, Math.max(0, EMBED_LIMITS.fields - stats.length));
  return { fields: [...stats, ...kept.map((s) => s.field)].slice(0, EMBED_LIMITS.fields), zones: kept.flatMap((s) => s.zones) };
}

/** A card line's limit: one very long name never leaves the field with no entries. */
const CARD_LINE = 200;

/** Lines that fit one field value, then "+N more"; `shown` lines were kept. */
function fitCardLines(lines: string[], maxChars = 600): { value: string; shown: number } {
  lines = lines.map((l) => truncate(l, CARD_LINE));
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 12 > maxChars) break;
    out.push(l);
    used += l.length + 1;
  }
  return { value: out.length < lines.length ? `${out.join('\n')}\n${GEAR_COPY.more(lines.length - out.length)}` : out.join('\n'), shown: out.length };
}

const cardActions = (itemId: number) => row([button(`${ITEM_REPORT_PREFIX}${itemId}`, GEAR_COPY.reportButton), button(`${IMAGE_PREFIX}${itemId}`, GEAR_COPY.imageButton), plannerLink()]);

async function card(c: Ctx, itemId: number): Promise<{ embeds: Embed[]; links: unknown[]; zones: ZoneRef[] } | null> {
  const r = await c.db.prepare(`SELECT ${GEAR_COLS}, NULL AS sort_value, total_stats FROM item WHERE id = ?`).bind(itemId).first<GearRow>();
  if (!r) return null;
  const d = await pageData(c, [r], Infinity);
  const item = { id: r.id, name: r.name, icon_url: r.icon_url, slot: r.slot, stats_json: r.stats_json, wiki_url: r.wiki_url, source: r.source };
  const { fields, zones } = cardFields(statFields(item), r, d);
  const head: Embed = {
    title: truncate(r.name, EMBED_LIMITS.title),
    ...(r.wiki_url ? { url: r.wiki_url } : {}),
    ...(r.icon_url ? { thumbnail: { url: r.icon_url } } : {}),
    description: [`Classes: ${classesText(r.class_mask, d.classes)}`, ...(incorrectStats(r) ? [`⚠ ${GEAR_COPY.incorrectStats}`] : [])].join('\n'),
    fields,
    footer: { text: footerText(d.version) },
  };
  let embeds = [head];
  if (sourcesOf(r.source_mask).includes('Crafted')) {
    const f = await loadFind(c.db, c.guild.id, { id: r.id });
    if (f.item && f.isResult) {
      const recipes = findEmbeds(f, c.guild.learning_window).embeds.slice(1);
      // Keep the whole message inside the limit with the welcome's reserve: drop recipe embeds from the end if needed.
      while (recipes.length && embedChars([head, ...recipes]) > EMBED_LIMITS.total - WELCOME_RESERVE) recipes.pop();
      embeds = [head, ...recipes];
    }
  }
  return { embeds, links: itemLinks(item), zones };
}

/** gd: (the details menu): the item card, privately, as a new message, with its zone buttons (order 23). */
export async function gearDetails(c: Ctx, values: string[]): Promise<MessageReply> {
  const id = Number(values[0]);
  const k = Number.isInteger(id) ? await card(c, id) : null;
  if (!k) return ephemeral(GEAR_COPY.gone);
  return withZoneButtons(c.db, searchReply({ embeds: k.embeds }, `${POST_WHAT}${id}`, k.links, [cardActions(id)]), k.zones);
}

/** pub:gear:<id>: the item card, posted publicly; its buttons (zone buttons too) answer each presser privately. */
export async function postGear(c: Ctx, itemId: number): Promise<MessageReply> {
  const k = await card(c, itemId);
  if (!k) return ephemeral(GEAR_COPY.gone);
  return withZoneButtons(c.db, postedReply({ embeds: k.embeds }, c.userId, k.links, [cardActions(itemId)]), k.zones);
}

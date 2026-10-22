// /gear find (work order 13, ITEMs 3–4): gear by class, slot, weapon type, AC, ratio, stats and source, from the community
// wiki's data. Private, 10 per page, with Previous/Next and a details menu; the item card reuses /craft find's crafter
// groups, Stat image and Post to channel. No writes per search beyond the read audit row 'gear.find' (src/interactions.ts).
import type { Ctx } from '../context.ts';
import { craftersSql, tierCrafters, type CrafterRow } from '../crafters.ts';
import { button, EMBED_LIMITS, embedChars, ephemeral, md, optInt, optString, plural, row, truncate, updateMessage, type Embed, type EmbedField, type MessageReply, type Option } from '../discord.ts';
import { decodeState, defaultSort, encodeState, roundRatio, sortByKey, SORTS, STAT_FILTERS, type GearQuery } from '../gear/options.ts';
import { zoneKey } from '../zone/names.ts';
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
} as const;

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

function dropLine(o: Origin, d: PageData, maxMobs: number, maxZones: number): string {
  const from = o.from ?? [];
  const zones = o.wikiZones ?? [];
  const mob = (name: string) => {
    const m = mobFor(d, name);
    const zone = m?.zones_json ? (JSON.parse(m.zones_json) as string[])[0] : null;
    const bits = [m?.level ? `L${m.level}` : null, zone].filter(Boolean);
    return `${md(name)}${bits.length ? ` (${bits.map((b) => md(String(b))).join(', ')})` : ''}`;
  };
  const parts: string[] = [];
  if (from.length) parts.push(from.slice(0, maxMobs).map(mob).join(', ') + (from.length > maxMobs ? ` ${GEAR_COPY.more(from.length - maxMobs)}` : ''));
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
function sourceLines(r: GearRow, d: PageData, window: number, caps: { mobs: number; zones: number; vendors: number }): string[] {
  const o = parse<Origin>(r.origin_json);
  return sourcesOf(r.source_mask).map((s) => {
    switch (s) {
      case 'Drop':
        return dropLine(o, d, caps.mobs, caps.zones);
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

export function resultEntry(r: GearRow, q: GearQuery, d: PageData, window: number, caps = { mobs: LINE_MOBS, zones: LINE_ZONES, vendors: 3, stats: 4 }): string {
  const name = r.wiki_url ? `**[${md(r.name)}](${r.wiki_url})**` : `**${md(r.name)}**`;
  const meta = [`Classes: ${classesText(r.class_mask, d.classes)}`, ...flagsOf(r), ...(incorrectStats(r) ? [`⚠ ${GEAR_COPY.incorrectStats}`] : [])].join(' · ');
  const stats = statsText(r, q, caps.stats);
  return [`${name} · ${(r.slot ?? '').toUpperCase()}`, stats, meta, ...sourceLines(r, d, window, caps).map((l) => `-# ${l}`)].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- the page

/** Ever smaller lines until the page fits the description and the message total (less the welcome's reserve). */
const CAPS = [
  { mobs: 3, zones: 3, vendors: 3, stats: 4 },
  { mobs: 2, zones: 2, vendors: 2, stats: 2 },
  { mobs: 1, zones: 1, vendors: 1, stats: 0 },
];

export function pageEmbed(rows: GearRow[], q: GearQuery, d: PageData, page: number, window: number): Embed {
  const footer = { text: GEAR_COPY.footer(page + 1, q.sort.label, d.version) };
  const title = GEAR_COPY.title;
  const budget = Math.min(EMBED_LIMITS.description, EMBED_LIMITS.total - WELCOME_RESERVE - title.length - footer.text.length);
  let entries: string[] = [];
  for (const caps of CAPS) {
    entries = rows.map((r) => resultEntry(r, q, d, window, caps));
    if (entries.join('\n\n').length <= budget) break;
  }
  // Still over: whole entries are left off the end (the details menu still lists every row), never cut mid-markdown.
  while (entries.length > 1 && entries.join('\n\n').length > budget) entries.pop();
  return { title, description: truncate(entries.join('\n\n'), budget), footer };
}

function pageComponents(rows: GearRow[], q: GearQuery, page: number, hasNext: boolean): unknown[] {
  const state = encodeState(q);
  const nav = row([
    button(`${PAGE_PREFIX}${page - 1}:${state}`, GEAR_COPY.previous, undefined, page === 0),
    button(`${PAGE_PREFIX}${page + 1}:${state}`, GEAR_COPY.next, undefined, !hasNext),
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
  const p = await page(c, q, 0);
  if (!p) {
    const zero = await zeroResults(c, q);
    return inPlace ? updateMessage({ content: zero.data.content, embeds: [], components: [] }) : zero;
  }
  const content = withHeading(await zoneHeading(c, q));
  const data = { embeds: [pageEmbed(p.rows, q, p.data, 0, c.guild.learning_window)], components: pageComponents(p.rows, q, 0, p.hasNext) };
  return inPlace ? updateMessage({ content, ...data }) : ephemeral(content, data);
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
  const p = await page(c, q, Number(n));
  if (!p) return updateMessage({ content: GEAR_COPY.none, embeds: [], components: [] });
  return updateMessage({ content: withHeading(await zoneHeading(c, q)), embeds: [pageEmbed(p.rows, q, p.data, Number(n), c.guild.learning_window)], components: pageComponents(p.rows, q, Number(n), p.hasNext) });
}

// ---------------------------------------------------------------- the item card

/** Full sources on the card: every mob (up to the field limit), the zones, the vendors as recorded. */
export function cardSourceFields(r: GearRow, d: PageData): EmbedField[] {
  const o = parse<Origin>(r.origin_json);
  const f: EmbedField[] = [];
  for (const s of sourcesOf(r.source_mask)) {
    if (s === 'Drop') {
      const lines = (o.from ?? []).map((name) => {
        const m = mobFor(d, name);
        const bits = [m?.level ? `L${m.level}` : null, ...(m?.zones_json ? (JSON.parse(m.zones_json) as string[]) : [])].filter(Boolean);
        return `${md(name)}${bits.length ? ` (${bits.map((b) => md(String(b))).join(', ')})` : ''}`;
      });
      if (lines.length) f.push({ name: 'Drop: mobs', value: fitLinesBy(lines) });
      if (o.wikiZones?.length) f.push({ name: 'Drop: zones', value: fitLinesBy(o.wikiZones.map(md)) });
    } else if (s === 'Vendor') {
      const sb = o.soldBy ?? {};
      const price = [typeof sb.base === 'number' ? `price ${sb.base}` : null, typeof sb.shady === 'number' ? `shady price ${sb.shady}` : null].filter(Boolean).join(' · ');
      f.push({ name: 'Vendor', value: truncate([price || 'price not recorded', ...(sb.vendors ?? []).map(md)].join('\n'), EMBED_LIMITS.fieldValue) });
    } else if (s === 'Quest') f.push({ name: 'Quest', value: (o.categories ?? []).filter((x) => x === 'Quest Items' || x === 'Reward').join(', ') || 'Quest' });
    else if (s === 'Unknown') f.push({ name: 'Unknown', value: GEAR_COPY.unknownSource });
    // Crafted: the recipe embeds below carry it, with the crafter groups.
  }
  return f;
}

/** Lines that fit one field value, then "+N more". */
function fitLinesBy(lines: string[], maxChars = 600): string {
  lines = lines.map((l) => truncate(l, 200)); // one very long name never leaves the field with no entries
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 12 > maxChars) break;
    out.push(l);
    used += l.length + 1;
  }
  return out.length < lines.length ? `${out.join('\n')}\n${GEAR_COPY.more(lines.length - out.length)}` : out.join('\n');
}

const cardActions = (itemId: number) => row([button(`${ITEM_REPORT_PREFIX}${itemId}`, GEAR_COPY.reportButton), button(`${IMAGE_PREFIX}${itemId}`, GEAR_COPY.imageButton)]);

async function card(c: Ctx, itemId: number): Promise<{ embeds: Embed[]; links: unknown[] } | null> {
  const r = await c.db.prepare(`SELECT ${GEAR_COLS}, NULL AS sort_value, total_stats FROM item WHERE id = ?`).bind(itemId).first<GearRow>();
  if (!r) return null;
  const d = await pageData(c, [r], Infinity);
  const item = { id: r.id, name: r.name, icon_url: r.icon_url, slot: r.slot, stats_json: r.stats_json, wiki_url: r.wiki_url, source: r.source };
  const head: Embed = {
    title: truncate(r.name, EMBED_LIMITS.title),
    ...(r.wiki_url ? { url: r.wiki_url } : {}),
    ...(r.icon_url ? { thumbnail: { url: r.icon_url } } : {}),
    description: [`Classes: ${classesText(r.class_mask, d.classes)}`, ...(incorrectStats(r) ? [`⚠ ${GEAR_COPY.incorrectStats}`] : [])].join('\n'),
    fields: [...statFields(item), ...cardSourceFields(r, d)].slice(0, EMBED_LIMITS.fields),
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
  return { embeds, links: itemLinks(item) };
}

/** gd: (the details menu): the item card, privately, as a new message. */
export async function gearDetails(c: Ctx, values: string[]): Promise<MessageReply> {
  const id = Number(values[0]);
  const k = Number.isInteger(id) ? await card(c, id) : null;
  if (!k) return ephemeral(GEAR_COPY.gone);
  return searchReply({ embeds: k.embeds }, `${POST_WHAT}${id}`, k.links, [cardActions(id)]);
}

/** pub:gear:<id>: the item card, posted publicly; its buttons answer each presser privately. */
export async function postGear(c: Ctx, itemId: number): Promise<MessageReply> {
  const k = await card(c, itemId);
  if (!k) return ephemeral(GEAR_COPY.gone);
  return postedReply({ embeds: k.embeds }, c.userId, k.links, [cardActions(itemId)]);
}

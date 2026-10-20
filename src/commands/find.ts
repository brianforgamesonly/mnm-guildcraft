// /craft find item: (PRD FR-3, FR-3.1 note, FR-6 layers 1 and 3). One D1 batch reads the item, its
// recipes, their components, the crafters and the data version; crafters are tiered by src/crafters.ts.
import type { Ctx } from '../context.ts';
import { craftersSql, tierCrafters, type CrafterRow, type Tier } from '../crafters.ts';
import { button, EMBED_LIMITS, embedChars, ephemeral, linkButton, md, optString, plural, row, STYLE_PRIMARY, truncate, type Embed, type EmbedField, type MessageReply, type Option } from '../discord.ts';
import { FINISHED_IMPORT } from '../import-status.ts';
import { CORRECTED_COLS, correctionJoin, isGated, type Acquisition } from '../recipes.ts';
import { postedReply, searchReply } from './share.ts';

export interface ItemRecord {
  id: number;
  name: string;
  icon_url: string | null;
  slot: string | null;
  stats_json: string | null;
  wiki_url: string | null;
  source: string;
}

/** One recipe with this guild's corrections applied (src/recipes.ts). */
interface RecipeRow {
  id: number;
  tradeskill: string;
  trivial: number | null;
  trivial_unconfirmed: number;
  unknown_components: number;
  result_qty: number;
  station: string | null;
  acquisition: Acquisition;
  faction: string | null;
  note: string | null;
  trivial_corrected: number;
  acquisition_corrected: number;
}

// ---------------------------------------------------------------- links (FR-6 layer 3)

/** MnMdb's item id is slugify(name) (mnm-tools mnmdb/app.js:140, used for wiki items at :3714, resolved by route() :3694 → renderItem :722). */
export const mnmdbSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
export const mnmdbUrl = (name: string) => `https://mnm-db.com/#/item/${encodeURIComponent(mnmdbSlug(name))}`;
/**
 * MNM Realm: its own search page. Item pages exist at /items/<slug>, but not for every item (order 3
 * check: 6 of 20 sampled recipe results had none), so the search link never lands on a 404.
 */
export const mnmrealmUrl = (name: string) => `https://mnmrealm.com/items?q=${encodeURIComponent(name)}`;

export function itemLinks(item: ItemRecord): unknown[] {
  // A stub (a result with no item record) has no page on any site.
  if (item.source === 'stub') return [];
  return [
    ...(item.wiki_url ? [linkButton('Wiki', item.wiki_url)] : []),
    linkButton('MnMdb', mnmdbUrl(item.name)),
    linkButton('MNM Realm', mnmrealmUrl(item.name)),
  ];
}

// ---------------------------------------------------------------- the item card (FR-6 layer 1)

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const pairs = (o: unknown) =>
  o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o as Record<string, unknown>).filter(([, v]) => typeof v === 'number') : [];

/** Key stats as compact inline fields; only the ones the item has. */
export function statFields(item: ItemRecord): EmbedField[] {
  const s = (item.stats_json ? JSON.parse(item.stats_json) : {}) as Record<string, unknown>;
  const f: EmbedField[] = [];
  const add = (name: string, value: unknown) => {
    if (value !== undefined && value !== null && value !== '') f.push({ name, value: truncate(String(value), EMBED_LIMITS.fieldValue), inline: true });
  };
  add('Slot', item.slot);
  add('AC', s.ac);
  if (typeof s.dmg === 'number') add('Damage', `${s.dmg}${typeof s.delay === 'number' ? ` / ${s.delay} delay` : ''}${s.skill ? ` · ${s.skill}` : ''}${s.handed ? ` · ${s.handed}` : ''}`);
  add('HP', typeof s.hp === 'number' ? signed(s.hp) : undefined);
  add('Mana', typeof s.mana === 'number' ? signed(s.mana) : undefined);
  const stats = pairs(s.stats).map(([k, v]) => `${k} ${signed(v as number)}`);
  if (stats.length) add('Stats', stats.join(' · '));
  const res = pairs(s.resists).map(([k, v]) => `${k} ${signed(v as number)}`);
  if (res.length) add('Resists', res.join(' · '));
  for (const k of ['hpRegen', 'manaRegen', 'haste'] as const) if (typeof s[k] === 'number') add(k === 'haste' ? 'Haste' : k === 'hpRegen' ? 'HP regen' : 'Mana regen', s[k]);
  const effect = s.effect as { name?: string; trigger?: string } | undefined;
  if (effect?.name) add('Effect', `${effect.name}${effect.trigger ? ` (${effect.trigger})` : ''}`);
  if (typeof s.weight === 'number' || s.size) add('Weight · Size', [typeof s.weight === 'number' ? `${s.weight} wt` : null, s.size].filter(Boolean).join(' · '));
  if (s.class || s.race) add('Class / Race', `${s.class ?? '?'} / ${s.race ?? '?'}`);
  if (Array.isArray(s.flags) && s.flags.length) add('Flags', s.flags.join(' '));
  return f.slice(0, EMBED_LIMITS.fields);
}

/** "e19cc75… / 2026-10-19T17:35:56.514Z" → "e19cc75 (2026-10-19)". */
export function shortVersion(v: string | null | undefined): string {
  if (!v) return 'not loaded';
  const [sha, at] = v.split(' / ');
  return `${sha.slice(0, 7)}${at && /^\d{4}-\d\d-\d\d/.test(at) ? ` (${at.slice(0, 10)})` : ''}`;
}

export const footerText = (version: string | null | undefined) => `Item data: Monsters and Memories Wiki, CC BY-SA 4.0 · data ${shortVersion(version)}`;

function itemCard(item: ItemRecord, version: string | null): Embed {
  const e: Embed = { title: truncate(item.name, EMBED_LIMITS.title), footer: { text: footerText(version) } };
  if (item.source === 'stub') return e; // name only: no item record, so no icon or stats
  if (item.icon_url) e.thumbnail = { url: item.icon_url };
  const fields = statFields(item);
  if (fields.length) e.fields = fields;
  return e;
}

// ---------------------------------------------------------------- recipes and crafters

/** The marker on a field the guild has corrected (order 9, ITEM 2). */
export const CORRECTED_MARK = '(guild-corrected)';

export function trivialText(r: Pick<RecipeRow, 'trivial' | 'trivial_unconfirmed'> & { trivial_corrected?: number }): string {
  if (r.trivial === null) return 'trivial unknown';
  if (r.trivial_corrected) return `trivial ${r.trivial} ${CORRECTED_MARK}`;
  return `trivial ${r.trivial}${r.trivial_unconfirmed ? '?' : ''}`;
}

export function ingredientsText(components: { name: string; qty: number }[], unknown: number): string {
  if (!components.length) return `Ingredients unknown (${unknown})`;
  const lines = components.map((c) => `${c.qty} × ${md(c.name)}`);
  if (unknown > 0) lines.push(`plus ${plural(unknown, 'unknown ingredient')}`);
  return lines.join('\n');
}

/** Lines that fit `maxChars`, at most `maxLines`, then "+M more". */
export function fitLines(lines: string[], maxLines: number, maxChars = EMBED_LIMITS.fieldValue): string {
  const out: string[] = [];
  let used = 0;
  for (const [i, l] of lines.entries()) {
    const restAfter = lines.length - i - 1;
    const more = restAfter > 0 ? `\n+${restAfter} more`.length : 0;
    if (out.length >= maxLines || used + l.length + 1 + more > maxChars) break;
    out.push(l);
    used += l.length + 1;
  }
  const hidden = lines.length - out.length;
  return hidden > 0 ? [...out, `+${hidden} more`].join('\n') : out.join('\n');
}

/** Carried by every character who marked the recipe known, in every tier (FR-3.1). */
export const KNOWN_MARK = '📜';
const crafterLine = (r: CrafterRow) => `**${md(r.character)}** ${r.level}${r.knows_recipe ? ` ${KNOWN_MARK}` : ''}`;

const TIER_TITLES: [Exclude<Tier, 'below'>, (r: RecipeRow, ts: string, w: number) => string][] = [
  ['reliable', (r, ts) => `Reliable (${ts} ${r.trivial}+)`],
  ['learning', (r, ts, w) => `Still learning (${ts} ${Math.max(0, r.trivial! - w)}–${r.trivial! - 1})`],
  ['unknown', (_r, ts) => `Trivial unknown: everyone with ${ts}`],
  ['unconfirmed', (r) => (r.acquisition === 'reputation' ? `Has skill, needs reputation${r.faction ? ` (${r.faction})` : ''}` : 'Has skill, recipe not marked known')],
];

/** FR-3.1's Unknown note, kept to one short line: today every recipe is Unknown (order 9, ITEM 1). */
export const CONFIRM_NOTE = '-# How this recipe is obtained is not recorded: check the crafter has it.';

/** One line on how the recipe is obtained, per FR-3.1's table. */
export function sourceLine(r: Pick<RecipeRow, 'acquisition' | 'faction' | 'note' | 'acquisition_corrected'>): string {
  const mark = r.acquisition_corrected && r.acquisition !== 'unknown' ? ` ${CORRECTED_MARK}` : '';
  const note = r.note ? ` · Note: ${md(r.note)}` : '';
  switch (r.acquisition) {
    case 'vendor':
      return `**Vendor recipe**: may need buying first${note}.${mark}`;
    case 'reputation':
      return `**Reputation recipe**${r.faction ? ` (${md(r.faction)})` : ''}: only characters who marked it known (${KNOWN_MARK}) count as able${note}.${mark}`;
    case 'discovery':
      return `**Discovery recipe**: only characters who marked it known (${KNOWN_MARK}) count as able${note}.${mark}`;
    default:
      return CONFIRM_NOTE;
  }
}

function recipeEmbed(r: RecipeRow, index: number, total: number, comps: { components: { name: string; qty: number }[]; corrected: boolean }, crafters: CrafterRow[], window: number, maxLines: number): Embed {
  const tiers = tierCrafters(crafters, r, window);
  const head = [
    comps.corrected ? `${ingredientsText(comps.components, 0)}\n-# Ingredients ${CORRECTED_MARK}` : ingredientsText(comps.components, r.unknown_components),
    r.result_qty > 1 ? `Makes ${r.result_qty}` : null,
    r.station ? `Station: ${md(r.station)}` : null,
  ].filter(Boolean);
  const fields: EmbedField[] = [];
  for (const [tier, title] of TIER_TITLES)
    if (tiers[tier].length) fields.push({ name: truncate(`${title(r, r.tradeskill, window)} · ${tiers[tier].length}`, EMBED_LIMITS.fieldName), value: fitLines(tiers[tier].map(crafterLine), maxLines) });
  const anyKnown = crafters.some((c) => c.recipe_id === r.id && c.knows_recipe);
  const tail = [
    tiers.below.length ? `Further below: ${tiers.below.length}` : null,
    !crafters.length ? `No one in the guild has recorded ${r.tradeskill} yet.` : null,
    sourceLine(r),
    anyKnown && !isGated(r.acquisition) ? `-# ${KNOWN_MARK} marked this recipe known` : null,
  ].filter(Boolean);
  return {
    title: truncate(`${total > 1 ? `Recipe ${index + 1} of ${total}: ` : ''}${r.tradeskill} · ${trivialText(r)}`, EMBED_LIMITS.title),
    description: truncate([...head, '', ...tail].join('\n').trim(), EMBED_LIMITS.description),
    ...(fields.length ? { fields } : {}),
  };
}

// ---------------------------------------------------------------- the reply

export interface FindData {
  item: ItemRecord | null;
  isResult: boolean;
  recipes: RecipeRow[];
  components: { recipe_id: number; name: string; qty: number }[];
  /** This guild's corrected component lists (recipe_correction_component); a recipe listed here ignores `components`. */
  corrected: { recipe_id: number; name: string; qty: number }[];
  crafters: CrafterRow[];
  version: string | null;
}

/** The component list a recipe shows: the guild's correction when it has one, otherwise the imported list. */
export function componentsFor(d: Pick<FindData, 'components' | 'corrected'>, recipeId: number): { components: { name: string; qty: number }[]; corrected: boolean } {
  const fixed = d.corrected.filter((c) => c.recipe_id === recipeId);
  return fixed.length ? { components: fixed, corrected: true } : { components: d.components.filter((c) => c.recipe_id === recipeId), corrected: false };
}

const ITEM_COLS = 'id, name, icon_url, slot, stats_json, wiki_url, source';
/** One round trip. `by` selects the item: its name (case-insensitive) or its id (Post to channel). */
export async function loadFind(db: D1Database, guildId: string, by: { key: string } | { id: number }): Promise<FindData> {
  const sel = 'key' in by ? 'SELECT id FROM item WHERE name_key = ?1' : 'SELECT id FROM item WHERE id = ?1';
  const arg = 'key' in by ? by.key : by.id;
  const shared = '(r.guild_id IS NULL OR r.guild_id = ?2)';
  const [item, recipes, components, corrected, crafters, version] = await db.batch([
    db.prepare(`SELECT ${ITEM_COLS} FROM item WHERE id = (${sel})`).bind(arg),
    db
      .prepare(
        `SELECT r.id, t.name AS tradeskill, ${CORRECTED_COLS}, CASE WHEN rc.trivial IS NULL THEN r.trivial_unconfirmed ELSE 0 END AS trivial_unconfirmed,
           r.unknown_components, r.result_qty, r.station
         FROM recipe r JOIN tradeskill t ON t.id = r.tradeskill_id ${correctionJoin('?2')}
         WHERE r.result_item_id = (${sel}) AND r.active = 1 AND ${shared} ORDER BY t.name COLLATE NOCASE, r.source_key`,
      )
      .bind(arg, guildId),
    db
      .prepare(
        `SELECT rc.recipe_id, i.name, rc.qty FROM recipe_component rc JOIN recipe r ON r.id = rc.recipe_id JOIN item i ON i.id = rc.item_id
         WHERE r.result_item_id = (${sel}) AND r.active = 1 AND ${shared} ORDER BY i.name COLLATE NOCASE`,
      )
      .bind(arg, guildId),
    db
      .prepare(
        `SELECT cc.recipe_id, i.name, cc.qty FROM recipe_correction_component cc JOIN recipe r ON r.id = cc.recipe_id JOIN item i ON i.id = cc.item_id
         WHERE cc.guild_id = ?2 AND r.result_item_id = (${sel}) AND r.active = 1 ORDER BY i.name COLLATE NOCASE`,
      )
      .bind(arg, guildId),
    db.prepare(craftersSql(`(${sel})`)).bind(arg, guildId),
    db.prepare(`SELECT source_version FROM data_import WHERE ${FINISHED_IMPORT} ORDER BY id DESC LIMIT 1`),
  ]);
  const recipeRows = (recipes.results as RecipeRow[]) ?? [];
  return {
    item: ((item.results as ItemRecord[]) ?? [])[0] ?? null,
    isResult: recipeRows.length > 0,
    recipes: recipeRows,
    components: (components.results as FindData['components']) ?? [],
    corrected: (corrected.results as FindData['corrected']) ?? [],
    crafters: (crafters.results as CrafterRow[]) ?? [],
    version: ((version.results as { source_version: string }[]) ?? [])[0]?.source_version ?? null,
  };
}

/** Max recipe embeds: one embed is the item card. */
const MAX_RECIPES = EMBED_LIMITS.embeds - 1;
const LINE_STEPS = [15, 10, 6, 3, 1];
/** Room left for the one-time welcome embed (src/commands/welcome.ts, about 520 characters) on a first command. */
const WELCOME_RESERVE = 1000;

/** The embeds, shrinking the per-tier line count until the whole message is inside the 6,000 limit. */
export function findEmbeds(d: FindData, window: number): { embeds: Embed[]; note: string | null } {
  const item = d.item!;
  const shown = d.recipes.slice(0, MAX_RECIPES);
  let embeds: Embed[] = [];
  for (const maxLines of LINE_STEPS) {
    embeds = [
      itemCard(item, d.version),
      ...shown.map((r, i) => recipeEmbed(r, i, d.recipes.length, componentsFor(d, r.id), d.crafters, window, maxLines)),
    ];
    if (embedChars(embeds) <= EMBED_LIMITS.total - WELCOME_RESERVE) break;
  }
  return { embeds, note: d.recipes.length > shown.length ? `Showing ${shown.length} of ${d.recipes.length} recipes.` : null };
}

export const noRecipe = (typed: string) => `No recipe found for **${md(typed)}**. Pick an item from the list as you type.`;

export async function craftFind(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = (optString(opts, 'item') ?? '').trim();
  const d = await loadFind(c.db, c.guild.id, { key: typed.toLowerCase() });
  if (!d.item || !d.isResult) {
    const wiki = d.item?.wiki_url;
    return ephemeral(noRecipe(typed || '(nothing)'), wiki ? { components: [{ type: 1, components: [linkButton('Wiki', wiki)] }] } : {});
  }
  const { embeds, note } = findEmbeds(d, c.guild.learning_window);
  return searchReply({ content: note ?? undefined, embeds }, `find:${d.item.id}`, itemLinks(d.item), [findActions(d.item.id)]);
}

// ---------------------------------------------------------------- the reply's action buttons (order 9)

export const KNOW_PREFIX = 'know:';
export const REPORT_PREFIX = 'rpt:';
export const IMAGE_PREFIX = 'img:';
/**
 * I know this recipe, Report a problem, Stat image. They work for whoever presses them, on the private reply and on a
 * posted copy alike, and always answer with a new private message: one member's press never changes a public post.
 */
export const findActions = (itemId: number) =>
  row([button(`${KNOW_PREFIX}${itemId}`, 'I know this recipe', STYLE_PRIMARY), button(`${REPORT_PREFIX}${itemId}`, 'Report a problem'), button(`${IMAGE_PREFIX}${itemId}`, 'Stat image')]);

/** Post to channel: the same reply, rebuilt now, posted publicly. */
export async function postFind(c: Ctx, itemId: number): Promise<MessageReply> {
  const d = await loadFind(c.db, c.guild.id, { id: itemId });
  if (!d.item || !d.isResult) return ephemeral('That item no longer has a recipe. Run `/craft find` again.');
  const { embeds, note } = findEmbeds(d, c.guild.learning_window);
  return postedReply({ content: note ?? undefined, embeds }, c.userId, itemLinks(d.item), [findActions(d.item.id)]);
}

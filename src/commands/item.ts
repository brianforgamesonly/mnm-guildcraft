// /item name: [screenshot] (work order 18, CHECKLIST A20): one card for any item, replacing /craft find, /item image,
// /craft know and /craft report as commands. The card: stats and where the item comes from (/gear find's card), its
// recipes and crafters when it has any (/craft find's), and the recipes that use it as an ingredient. Private, with
// Post to channel. A screenshot attached goes to the officers for approval (/item image's path). No writes per card
// beyond the read audit row 'craft.find' (src/interactions.ts; the PRD's action name, kept so history stays comparable).
import type { Ctx } from '../context.ts';
import { button, EMBED_LIMITS, embedChars, ephemeral, md, optString, plural, row, STYLE_PRIMARY, truncate, type Embed, type EmbedField, type MessageReply, type Option } from '../discord.ts';
import { GEAR_COLS, type GearRow } from '../gear/search.ts';
import { correctionJoin, CORRECTED, visibleTo } from '../recipes.ts';
import { FROM_FIND_PREFIX } from '../requests.ts';
import { fitLines, findEmbeds, footerText, IMAGE_PREFIX, itemLinks, KNOW_PREFIX, loadFind, REPORT_PREFIX, statFields } from './find.ts';
import { cardSourceFields, classesText, GEAR_COPY, incorrectStats, pageData } from './gear.ts';
import { submitImage } from './images.ts';
import { ITEM_REPORT_PREFIX, missingId } from './reports.ts';
import { postedReply, searchReply } from './share.ts';

/** Post to channel: "pub:item:<item id>" (src/commands/share.ts POST_PREFIX). */
export const POST_WHAT = 'item:';
/** Room left for the one-time welcome embed on a first command (as src/commands/find.ts). */
const WELCOME_RESERVE = 1000;
/** "Used in" lines shown before "+N more". */
const USED_IN_LINES = 25;
const USED_IN_CHARS = 1500;

// ---------------------------------------------------------------- copy (order 18; listed for approval in docs/COPY.md)

export const ITEM_COPY = {
  noItem: (typed: string) => `No item called **${md(typed)}**. Pick one from the list as you type. If it's a craftable item the data is missing, report it below.`,
  missingButton: 'Report a missing recipe',
  usedIn: (n: number) => `Used in ${plural(n, 'recipe')}`,
  showing: (shown: number, total: number) => `Showing ${shown} of ${total} recipes.`,
  gone: 'That item is no longer in the data. Run `/item` again.',
  knowButton: 'I know this recipe',
  reportButton: 'Report a problem',
  recipeReportButton: 'Report a recipe problem',
  itemReportButton: 'Report item data',
  requestButton: 'Request a craft',
  imageButton: 'Stat image',
} as const;

// ---------------------------------------------------------------- the data

interface UsedIn {
  item: string;
  tradeskill: string;
  trivial: number | null;
}

/**
 * The recipes this guild sees that take the item as an ingredient: the imported ingredients, or the guild's corrected
 * list where it has one (src/recipes.ts, order 9). One statement; recipe_component has no item index, so it reads that
 * table once (2,446 rows on the 2026-10-21 data, measured by scripts/bench/item-cards.ts).
 */
export const USED_IN_SQL = `SELECT i.name AS item, t.name AS tradeskill, ${CORRECTED.trivial} AS trivial
  FROM recipe r JOIN item i ON i.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id ${correctionJoin('?2')}
  WHERE r.id IN (SELECT recipe_id FROM recipe_component WHERE item_id = ?1 UNION SELECT recipe_id FROM recipe_correction_component WHERE guild_id = ?2 AND item_id = ?1)
    AND ${visibleTo('?2')}
    AND (EXISTS (SELECT 1 FROM recipe_correction_component cc WHERE cc.guild_id = ?2 AND cc.recipe_id = r.id AND cc.item_id = ?1)
      OR NOT EXISTS (SELECT 1 FROM recipe_correction_component cc WHERE cc.guild_id = ?2 AND cc.recipe_id = r.id))
  ORDER BY i.name COLLATE NOCASE, t.name COLLATE NOCASE`;

export const usedInLine = (u: UsedIn) => `**${md(u.item)}** · ${u.tradeskill} · ${u.trivial === null ? 'trivial unknown' : `trivial ${u.trivial}`}`;

export interface ItemCard {
  embeds: Embed[];
  links: unknown[];
  actions: unknown;
  note: string | null;
  craftable: boolean;
}

/** The card for one item: 2 round trips (the item and its uses; then its sources and its recipes, together). */
export async function itemCard(c: Pick<Ctx, 'db' | 'guild'>, itemId: number): Promise<ItemCard | null> {
  const [head, uses] = await c.db.batch([
    c.db.prepare(`SELECT ${GEAR_COLS}, NULL AS sort_value, total_stats FROM item WHERE id = ?`).bind(itemId),
    c.db.prepare(USED_IN_SQL).bind(itemId, c.guild.id),
  ]);
  const r = (head.results as GearRow[])[0];
  if (!r) return null;
  const usedIn = uses.results as UsedIn[];
  const [d, f] = await Promise.all([pageData(c, [r], Infinity, false), loadFind(c.db, c.guild.id, { id: itemId })]);
  const item = { id: r.id, name: r.name, icon_url: r.icon_url, slot: r.slot, stats_json: r.stats_json, wiki_url: r.wiki_url, source: r.source };
  const about = [...(r.slot ? [`Classes: ${classesText(r.class_mask, d.classes)}`] : []), ...(incorrectStats(r) ? [`⚠ ${GEAR_COPY.incorrectStats}`] : [])];
  const fields: EmbedField[] = [...statFields(item), ...cardSourceFields(r, d)].slice(0, EMBED_LIMITS.fields);
  const top: Embed = {
    title: truncate(r.name, EMBED_LIMITS.title),
    ...(r.wiki_url ? { url: r.wiki_url } : {}),
    ...(r.icon_url ? { thumbnail: { url: r.icon_url } } : {}),
    ...(about.length ? { description: about.join('\n') } : {}),
    ...(fields.length ? { fields } : {}),
    footer: { text: footerText(d.version) },
  };
  const used: Embed[] = usedIn.length ? [{ title: ITEM_COPY.usedIn(usedIn.length), description: fitLines(usedIn.map(usedInLine), USED_IN_LINES, USED_IN_CHARS) }] : [];
  // The recipes, as /craft find shows them, in the room the top card and the uses leave: the 10 embeds less one for the
  // one-time welcome, and the 6,000 characters less the welcome's reserve. Crafter lines shrink first (findEmbeds counts
  // the card and the uses); then whole recipes are left off the end, and the note says so.
  const all = f.isResult ? findEmbeds(f, c.guild.learning_window, [top, ...used]).embeds.slice(1) : [];
  const recipes = all.slice(0, EMBED_LIMITS.embeds - 2 - used.length);
  while (recipes.length && embedChars([top, ...recipes, ...used]) > EMBED_LIMITS.total - WELCOME_RESERVE) recipes.pop();
  const total = f.recipes.length;
  return {
    embeds: [top, ...recipes, ...used],
    links: itemLinks(item),
    actions: actionRow(itemId, f.isResult),
    note: total > recipes.length ? ITEM_COPY.showing(recipes.length, total) : null,
    craftable: f.isResult,
  };
}

/**
 * The card's buttons, private or posted: each answers the presser with a new private message (order 9). Craftable: I know
 * this recipe, Report a recipe problem (recipe issues), Report item data (item issues), Request a craft, Stat image: five,
 * a row's maximum. Otherwise Report a problem (item issues) and Stat image. The custom_ids are /craft find's and /gear
 * find's, so cards posted before order 18 keep working.
 */
const actionRow = (itemId: number, craftable: boolean) =>
  row(
    craftable
      ? [
          button(`${KNOW_PREFIX}${itemId}`, ITEM_COPY.knowButton, STYLE_PRIMARY),
          button(`${REPORT_PREFIX}${itemId}`, ITEM_COPY.recipeReportButton),
          button(`${ITEM_REPORT_PREFIX}${itemId}`, ITEM_COPY.itemReportButton),
          button(`${FROM_FIND_PREFIX}${itemId}`, ITEM_COPY.requestButton),
          button(`${IMAGE_PREFIX}${itemId}`, ITEM_COPY.imageButton),
        ]
      : [button(`${ITEM_REPORT_PREFIX}${itemId}`, ITEM_COPY.reportButton), button(`${IMAGE_PREFIX}${itemId}`, ITEM_COPY.imageButton)],
  );

// ---------------------------------------------------------------- the command and Post to channel

export async function itemCommand(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = (optString(opts, 'name') ?? '').trim();
  const shot = optString(opts, 'screenshot');
  if (shot !== undefined) return submitImage(c, typed, shot, 'screenshot');
  const found = await c.db.prepare('SELECT id FROM item WHERE name_key = ?').bind(typed.toLowerCase()).first<{ id: number }>();
  const k = found ? await itemCard(c, found.id) : null;
  if (!found || !k) return ephemeral(ITEM_COPY.noItem(typed || '(nothing)'), { components: [row([button(missingId(typed), ITEM_COPY.missingButton)])] });
  return searchReply({ content: k.note ?? undefined, embeds: k.embeds }, `${POST_WHAT}${found.id}`, k.links, [k.actions]);
}

/** pub:item:<id>: the card, rebuilt now and posted publicly; its buttons answer each presser privately. */
export async function postItem(c: Ctx, itemId: number): Promise<MessageReply> {
  const k = await itemCard(c, itemId);
  if (!k) return ephemeral(ITEM_COPY.gone);
  return postedReply({ content: k.note ?? undefined, embeds: k.embeds }, c.userId, k.links, [k.actions]);
}

// Known recipes and how recipes are obtained (order 9, ITEMs 1–2; PRD FR-2, FR-3.1, FR-7):
//   /craft know recipe: [character] · /craft forget recipe: [character] · the "I know this recipe" button on /craft find
//   /recipe source item: how: [faction] [note] · /recipe override item: [trivial] [components] [reset]   (officers)
//   /roster recipes [skill]
// /recipe writes this guild's correction layer (src/recipes.ts, migration 0009), never the shared recipe row.
// DRAFT copy throughout: approved by the operator before launch (ORDER-RULES, order 9; docs/COPY.md).
import { audit, now } from '../access.ts';
import type { Ctx } from '../context.ts';
import { button, EMBED_LIMITS, ephemeral, md, optBool, optInt, optString, publicReply, row, STYLE_SECONDARY, truncate, updateMessage, type Embed, type MessageReply, type Option } from '../discord.ts';
import { ACQUISITION_LABEL, ACQUISITIONS, CORRECTED, correctionJoin, FACTION_MAX, GATED, GUILD_RECIPE_COLS, guildRecipeFrom, RECIPE_VALUE, recipeLabel, visibleTo, type Acquisition, type GuildRecipe } from '../recipes.ts';
import { findById, liveCharacters, noCharacters, resolveCharacter, type Character } from './character.ts';
import { postButton, postedReply, SEARCH_REPLIES_PRIVATE } from './share.ts';
import { SELECT_MAX_OPTIONS, type Tradeskill } from './skills.ts';

/** The recipe an option names: a picked choice (#id), or an item name with exactly one recipe. One D1 read. */
export async function resolveRecipe(db: D1Database, guildId: string, raw: string | undefined): Promise<{ recipe: GuildRecipe } | { reply: MessageReply }> {
  const typed = (raw ?? '').trim();
  const picked = RECIPE_VALUE.exec(typed);
  const where = picked ? 'r.id = ?1' : 'i.name_key = ?1';
  const { results } = await db
    .prepare(`SELECT ${GUILD_RECIPE_COLS} ${guildRecipeFrom('?2')} WHERE ${where} AND ${visibleTo('?2')} ORDER BY t.name COLLATE NOCASE, r.source_key`)
    .bind(picked ? Number(picked[1]) : typed.toLowerCase(), guildId)
    .all<GuildRecipe>();
  if (!results.length) return { reply: ephemeral(`No recipe found for **${md(typed || '(nothing)')}**. Pick a recipe from the list as you type.`) };
  if (results.length > 1)
    return {
      reply: ephemeral(
        `**${md(results[0].item)}** has ${results.length} recipes (${results.map((r) => `${r.tradeskill}, ${r.trivial === null ? 'trivial unknown' : `trivial ${r.trivial}`}`).join('; ')}). Pick the one you mean from the list as you type.`,
      ),
    };
  return { recipe: results[0] };
}

// ---------------------------------------------------------------- marking known (FR-2)

/** INSERT OR IGNORE: marking twice writes nothing the second time. Two writes on a first mark: the row and its audit. */
function markStatements(c: Ctx, ch: Character, r: GuildRecipe): D1PreparedStatement[] {
  return [
    c.db.prepare('INSERT OR IGNORE INTO character_recipe (character_id, recipe_id, created_at) VALUES (?, ?, ?)').bind(ch.id, r.id, now()),
    audit(c.db, c.guild.id, c.userId, 'recipe.know', `character:${ch.id}`, null, { recipe: r.id }),
  ];
}

const markedText = (ch: Pick<Character, 'name'>, r: GuildRecipe, already: boolean) =>
  already
    ? `**${md(ch.name)}** already has **${md(recipeLabel(r))}** marked known.`
    : `Marked **${md(recipeLabel(r))}** as known for **${md(ch.name)}**. \`/craft find\` now shows ${md(ch.name)} with the known-recipe marker; \`/craft forget\` undoes it.`;

async function markKnown(c: Ctx, ch: Character, r: GuildRecipe): Promise<string> {
  const known = await c.db.prepare('SELECT 1 FROM character_recipe WHERE character_id = ? AND recipe_id = ?').bind(ch.id, r.id).first();
  if (known) return markedText(ch, r, true);
  await c.db.batch(markStatements(c, ch, r));
  return markedText(ch, r, false);
}

export async function craftKnow(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const target = await resolveCharacter(c, c.userId, optString(opts, 'character'));
  if ('reply' in target) return target.reply;
  const found = await resolveRecipe(c.db, c.guild.id, optString(opts, 'recipe'));
  if ('reply' in found) return found.reply;
  return ephemeral(await markKnown(c, target.character, found.recipe));
}

export async function craftForget(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const target = await resolveCharacter(c, c.userId, optString(opts, 'character'));
  if ('reply' in target) return target.reply;
  const ch = target.character;
  const found = await resolveRecipe(c.db, c.guild.id, optString(opts, 'recipe'));
  if ('reply' in found) return found.reply;
  const r = found.recipe;
  const [del] = await c.db.batch([
    c.db.prepare('DELETE FROM character_recipe WHERE character_id = ? AND recipe_id = ?').bind(ch.id, r.id),
    audit(c.db, c.guild.id, c.userId, 'recipe.forget', `character:${ch.id}`, { recipe: r.id }, null),
  ]);
  if (!del.meta.changes) return ephemeral(`**${md(ch.name)}** didn't have **${md(recipeLabel(r))}** marked known, so nothing changed.`);
  return ephemeral(`**${md(ch.name)}** no longer has **${md(recipeLabel(r))}** marked known.`);
}

// ---------------------------------------------------------------- the "I know this recipe" button (FR-3.1)

export const KNOW_SELECT_PREFIX = 'knows:';

/**
 * know:<item id>, on a /craft find reply, private or posted. The presser's own characters, never the original asker's.
 * One character and one recipe: marked at once. Otherwise a dropdown of character × recipe, then the mark. Always a new
 * private message (type 4 with the private flag after a type 6 defer): a press never edits a public post.
 */
export async function knowButton(c: Ctx, itemId: number): Promise<MessageReply> {
  const [chars, recipes] = await Promise.all([
    liveCharacters(c.db, c.guild.id, c.userId),
    c.db
      .prepare(`SELECT ${GUILD_RECIPE_COLS} ${guildRecipeFrom('?2')} WHERE r.result_item_id = ?1 AND ${visibleTo('?2')} ORDER BY t.name COLLATE NOCASE, r.source_key`)
      .bind(itemId, c.guild.id)
      .all<GuildRecipe>()
      .then((r) => r.results),
  ]);
  if (!chars.length) return ephemeral(noCharacters(c, c.userId));
  if (!recipes.length) return ephemeral('That item no longer has a recipe. Run `/craft find` again.');
  if (chars.length === 1 && recipes.length === 1) return ephemeral(await markKnown(c, chars[0], recipes[0]));
  const pairs = chars.flatMap((ch) => recipes.map((r) => ({ ch, r })));
  const shown = pairs.slice(0, SELECT_MAX_OPTIONS);
  return ephemeral(
    [`Which character knows which recipe?${pairs.length > shown.length ? ` (showing ${shown.length} of ${pairs.length}: use \`/craft know\` for the rest)` : ''}`].join('\n'),
    {
      components: [
        row([
          {
            type: 3,
            custom_id: `${KNOW_SELECT_PREFIX}${itemId}`,
            placeholder: 'Pick a character and recipe',
            min_values: 1,
            max_values: 1,
            options: shown.map(({ ch, r }) => ({
              label: truncate(`${ch.name}${chars.length > 1 && ch.is_main ? ' (main)' : ''}`, 100),
              description: truncate(`${r.tradeskill} · ${r.trivial === null ? 'trivial unknown' : `trivial ${r.trivial}`}`, 100),
              value: `${ch.id}:${r.id}`,
            })),
          },
        ]),
      ],
    },
  );
}

/** knows:<item id>, the dropdown's pick "<character id>:<recipe id>": re-checked (the presser's live character, a visible recipe). */
export async function knowSelected(c: Ctx, values: string[]): Promise<MessageReply> {
  const [chId, recipeId] = (values[0] ?? '').split(':').map(Number);
  const ch = Number.isInteger(chId) ? await findById(c.db, c.guild.id, chId) : null;
  if (!ch || ch.owner_user_id !== c.userId) return updateMessage({ content: 'That character is no longer available. Run `/craft find` again.', components: [] });
  const found = await resolveRecipe(c.db, c.guild.id, `#${recipeId}`);
  if ('reply' in found) return updateMessage({ content: 'That recipe is no longer in the data. Run `/craft find` again.', components: [] });
  // The dropdown is the presser's own private message: replacing it with the answer changes no one else's view.
  return updateMessage({ content: await markKnown(c, ch, found.recipe), components: [] });
}

/** /craft me's known-recipe lines, per character (short; truncated with a count). */
export async function knownRecipesOf(db: D1Database, guildId: string, characterIds: number[]): Promise<Map<number, string[]>> {
  const out = new Map<number, string[]>();
  if (!characterIds.length) return out;
  const { results } = await db
    .prepare(
      `SELECT k.character_id, i.name AS item, t.name AS tradeskill FROM character_recipe k JOIN recipe r ON r.id = k.recipe_id
       JOIN item i ON i.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id
       WHERE k.character_id IN (${characterIds.map(() => '?').join(', ')}) AND ${visibleTo('?')} ORDER BY i.name COLLATE NOCASE`,
    )
    .bind(...characterIds, guildId)
    .all<{ character_id: number; item: string; tradeskill: string }>();
  for (const r of results) out.set(r.character_id, [...(out.get(r.character_id) ?? []), `${md(r.item)} (${r.tradeskill})`]);
  return out;
}

export const KNOWN_SHOWN = 6;
export const knownLine = (list: string[] | undefined) =>
  list?.length ? `Known recipes: ${list.slice(0, KNOWN_SHOWN).join(', ')}${list.length > KNOWN_SHOWN ? ` +${list.length - KNOWN_SHOWN} more` : ''}` : null;

// ---------------------------------------------------------------- /recipe source and /recipe override (officers)

const upsertCorrection = (c: Ctx, recipeId: number, set: string, binds: unknown[]) =>
  c.db
    .prepare(
      `INSERT INTO recipe_correction (guild_id, recipe_id, updated_by, updated_at, ${set.split(',').map((s) => s.split('=')[0].trim()).join(', ')})
       VALUES (?1, ?2, ?3, ?4, ${binds.map((_, i) => `?${i + 5}`).join(', ')})
       ON CONFLICT (guild_id, recipe_id) DO UPDATE SET updated_by = excluded.updated_by, updated_at = excluded.updated_at, ${set}`,
    )
    .bind(c.guild.id, recipeId, c.userId, now(), ...binds);

const NOTE_MAX = 200;

export async function recipeSource(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const found = await resolveRecipe(c.db, c.guild.id, optString(opts, 'item'));
  if ('reply' in found) return found.reply;
  const r = found.recipe;
  const how = optString(opts, 'how') as Acquisition | undefined;
  if (!how || !ACQUISITIONS.includes(how)) return ephemeral(`\`how\` must be one of: ${ACQUISITIONS.join(', ')}.`);
  const faction = optString(opts, 'faction')?.trim() || null;
  const note = optString(opts, 'note')?.trim() || null;
  if (how === 'reputation' && !faction) return ephemeral('A reputation recipe needs `faction:`, the faction that sells it, so members know what to work toward. Nothing was changed.');
  if ((faction?.length ?? 0) > FACTION_MAX || (note?.length ?? 0) > NOTE_MAX) return ephemeral(`Keep \`faction\` to ${FACTION_MAX} and \`note\` to ${NOTE_MAX} characters. Nothing was changed.`);
  // Faction only means something for reputation; unknown clears the note too.
  const keepFaction = how === 'reputation' ? faction : null;
  const keepNote = how === 'unknown' ? null : note;
  await c.db.batch([
    upsertCorrection(c, r.id, 'acquisition = excluded.acquisition, faction = excluded.faction, note = excluded.note', [how, keepFaction, keepNote]),
    audit(c.db, c.guild.id, c.userId, 'recipe.source', `recipe:${r.id}`, { acquisition: r.acquisition, faction: r.faction, note: r.note }, { acquisition: how, faction: keepFaction, note: keepNote }),
  ]);
  const effect =
    how === 'reputation' || how === 'discovery'
      ? `Only characters who marked it known now count as able to make it; others with ${r.tradeskill} show as ${how === 'reputation' ? `"has skill, needs reputation (${md(keepFaction!)})"` : '"has skill, recipe not marked known"'}.`
      : how === 'vendor'
        ? '`/craft find` uses the skill tiers and says it may need buying first.'
        : '`/craft find` uses the skill tiers, with a note to check the crafter has the recipe.';
  return ephemeral(`Saved for this server: **${md(recipeLabel(r))}** is now **${ACQUISITION_LABEL[how]}**${keepFaction ? ` (${md(keepFaction)})` : ''}${keepNote ? ` · ${md(keepNote)}` : ''}. ${effect}\n-# Other servers and the nightly import are not affected.`);
}

/** "2 Copper Bar, 1 Flux" → [{qty 2, name}, ...]. A missing quantity is 1. null when a part cannot be read. */
export function parseComponents(text: string): { qty: number; name: string }[] | null {
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out: { qty: number; name: string }[] = [];
  for (const p of parts) {
    const m = /^(?:(\d{1,3})\s*[x×]?\s+)?(.+)$/i.exec(p);
    if (!m || (m[1] !== undefined && Number(m[1]) < 1)) return null;
    out.push({ qty: m[1] === undefined ? 1 : Number(m[1]), name: m[2].trim() });
  }
  return out;
}

export async function recipeOverride(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const found = await resolveRecipe(c.db, c.guild.id, optString(opts, 'item'));
  if ('reply' in found) return found.reply;
  const r = found.recipe;
  if (optBool(opts, 'reset')) {
    const [del, upd] = await c.db.batch([
      c.db.prepare('DELETE FROM recipe_correction_component WHERE guild_id = ? AND recipe_id = ?').bind(c.guild.id, r.id),
      c.db.prepare('UPDATE recipe_correction SET trivial = NULL, updated_by = ?, updated_at = ? WHERE guild_id = ? AND recipe_id = ? AND trivial IS NOT NULL').bind(c.userId, now(), c.guild.id, r.id),
      // The source (/recipe source) is its own correction; a row left with nothing corrected goes.
      c.db.prepare('DELETE FROM recipe_correction WHERE guild_id = ? AND recipe_id = ? AND trivial IS NULL AND acquisition IS NULL AND faction IS NULL AND note IS NULL').bind(c.guild.id, r.id),
      audit(c.db, c.guild.id, c.userId, 'recipe.override.reset', `recipe:${r.id}`, null, null),
    ]);
    return ephemeral(`Reset **${md(recipeLabel(r))}**: its trivial and components come from the imported data again${del.meta.changes + upd.meta.changes ? '' : ' (they already did)'}.`);
  }
  const trivial = optInt(opts, 'trivial');
  const text = optString(opts, 'components');
  if (trivial === undefined && text === undefined) return ephemeral('Give `trivial:`, `components:` or both, or `reset:True` to remove this server\'s correction.');
  if (trivial !== undefined && (!Number.isInteger(trivial) || trivial < 0 || trivial > c.guild.skill_cap)) return ephemeral(`\`trivial\` must be a whole number from 0 to ${c.guild.skill_cap}. Nothing was changed.`);
  let parts: { qty: number; name: string; id: number }[] = [];
  if (text !== undefined) {
    const parsed = parseComponents(text);
    if (!parsed) return ephemeral('I couldn\'t read `components`. Write them like `2 Copper Bar, 1 Flux`. Nothing was changed.');
    // Exact names only (case-insensitive): never a guess.
    const { results } = await c.db
      .prepare(`SELECT id, name_key FROM item WHERE name_key IN (SELECT value FROM json_each(?))`)
      .bind(JSON.stringify(parsed.map((p) => p.name.toLowerCase())))
      .all<{ id: number; name_key: string }>();
    const byKey = new Map(results.map((x) => [x.name_key, x.id]));
    const unmatched = parsed.filter((p) => !byKey.has(p.name.toLowerCase()));
    if (unmatched.length) return ephemeral(`Nothing was changed. No item is named exactly: ${unmatched.map((p) => `**${md(p.name)}**`).join(', ')}. Check the spelling against \`/craft find\`.`);
    const ids = parsed.map((p) => byKey.get(p.name.toLowerCase())!);
    if (new Set(ids).size !== ids.length) return ephemeral('Nothing was changed: an item is listed twice. Give each item once, with its total quantity.');
    parts = parsed.map((p, i) => ({ ...p, id: ids[i] }));
  }
  const stmts: D1PreparedStatement[] = [
    trivial !== undefined
      ? upsertCorrection(c, r.id, 'trivial = excluded.trivial', [trivial])
      : upsertCorrection(c, r.id, 'trivial = recipe_correction.trivial', [null]),
  ];
  if (text !== undefined)
    stmts.push(
      c.db.prepare('DELETE FROM recipe_correction_component WHERE guild_id = ? AND recipe_id = ?').bind(c.guild.id, r.id),
      ...parts.map((p) => c.db.prepare('INSERT INTO recipe_correction_component (guild_id, recipe_id, item_id, qty) VALUES (?, ?, ?, ?)').bind(c.guild.id, r.id, p.id, p.qty)),
    );
  stmts.push(audit(c.db, c.guild.id, c.userId, 'recipe.override', `recipe:${r.id}`, null, { trivial: trivial ?? null, components: parts.map((p) => [p.id, p.qty]) }));
  await c.db.batch(stmts);
  const bits = [trivial !== undefined ? `trivial **${trivial}**` : null, text !== undefined ? `components ${parts.map((p) => `${p.qty} × ${md(p.name)}`).join(', ')}` : null].filter(Boolean);
  return ephemeral(`Saved for this server: **${md(recipeLabel(r))}** now shows ${bits.join(' and ')}, marked guild-corrected on \`/craft find\`. \`reset:True\` removes the correction.\n-# Other servers and the nightly import are not affected.`);
}

// ---------------------------------------------------------------- /roster recipes [skill] (FR-3.1)

export const RECIPES_PAGE_PREFIX = 'rr:';
const PAGE_SIZE = 15;

interface KnownRare {
  id: number;
  item: string;
  tradeskill: string;
  acquisition: Acquisition;
  faction: string | null;
  who: string;
}

async function loadRare(c: Ctx, skillId: number | null): Promise<KnownRare[]> {
  const { results } = await c.db
    .prepare(
      `SELECT r.id, i.name AS item, t.name AS tradeskill, ${CORRECTED.acquisition} AS acquisition, ${CORRECTED.faction} AS faction,
         group_concat(ch.name, ', ') AS who
       FROM character_recipe k JOIN character ch ON ch.id = k.character_id AND ch.deleted_at IS NULL
       JOIN member m ON m.guild_id = ch.guild_id AND m.discord_user_id = ch.owner_user_id AND m.status = 'active'
       JOIN recipe r ON r.id = k.recipe_id JOIN item i ON i.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id
       ${correctionJoin('?1')}
       WHERE ch.guild_id = ?1 AND ${visibleTo('?1')} AND ${CORRECTED.acquisition} IN (SELECT value FROM json_each(?2))
         AND (?3 IS NULL OR r.tradeskill_id = ?3)
       GROUP BY r.id ORDER BY i.name COLLATE NOCASE, t.name COLLATE NOCASE`,
    )
    .bind(c.guild.id, JSON.stringify(GATED), skillId)
    .all<KnownRare>();
  return results;
}

export const RARE_EMPTY =
  'No one has marked a reputation or discovery recipe as known yet. Officers set how a recipe is obtained with `/recipe source`; members then mark the ones they know with `/craft know` or the **I know this recipe** button on `/craft find`.';

function rareEmbed(list: KnownRare[], page: number, skill: string | null): Embed {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const lines = list
    .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
    .map((r) => `**${md(r.item)}** · ${r.tradeskill} · ${ACQUISITION_LABEL[r.acquisition]}${r.faction ? ` (${md(r.faction)})` : ''}: ${md(r.who)}`);
  return {
    title: truncate(`Reputation and discovery recipes${skill ? ` · ${skill}` : ''}: ${list.length}`, EMBED_LIMITS.title),
    description: truncate(lines.length ? lines.join('\n') : RARE_EMPTY, EMBED_LIMITS.description),
    footer: { text: `Page ${page + 1} of ${pages}` },
  };
}

const rarePageId = (skillId: number | null, page: number) => `${RECIPES_PAGE_PREFIX}${skillId ?? 0}:${page}`;

function rareRows(list: KnownRare[], skillId: number | null, page: number): unknown[] {
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  return [
    row([
      button(rarePageId(skillId, page - 1), '◀ Previous', STYLE_SECONDARY, page === 0),
      button(rarePageId(skillId, page + 1), 'Next ▶', STYLE_SECONDARY, page >= pages - 1),
      ...(SEARCH_REPLIES_PRIVATE ? [postButton(`rr:${skillId ?? 0}:${page}`)] : []),
    ]),
  ];
}

async function rarePage(c: Ctx, skillId: number | null, page: number): Promise<{ embed: Embed; rows: unknown[] }> {
  const [list, skill] = await Promise.all([
    loadRare(c, skillId),
    skillId === null ? Promise.resolve(null) : c.db.prepare('SELECT name FROM tradeskill WHERE id = ?').bind(skillId).first<{ name: string }>(),
  ]);
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  return { embed: rareEmbed(list, p, skill?.name ?? null), rows: rareRows(list, skillId, p) };
}

export async function rosterRecipes(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = optString(opts, 'skill')?.trim();
  let skillId: number | null = null;
  if (typed) {
    const skill = await c.db.prepare('SELECT id, name FROM tradeskill WHERE name = ? COLLATE NOCASE').bind(typed).first<Tradeskill>();
    if (!skill) return ephemeral(`I don't know a tradeskill called **${md(typed)}**. Pick one from the list as you type.`);
    skillId = skill.id;
  }
  const { embed, rows } = await rarePage(c, skillId, 0);
  return SEARCH_REPLIES_PRIVATE ? ephemeral('', { embeds: [embed], components: rows }) : publicReply({ embeds: [embed], components: rows });
}

/** rr:<skill id or 0>:<page>: Previous / Next on /roster recipes. */
export async function rosterRecipesPage(c: Ctx, customId: string): Promise<MessageReply> {
  const [skill, page] = customId.slice(RECIPES_PAGE_PREFIX.length).split(':').map(Number);
  const { embed, rows } = await rarePage(c, skill || null, page);
  return updateMessage({ embeds: [embed], components: rows });
}

/** Post to channel for /roster recipes ("rr:<skill>:<page>"). */
export async function postRosterRecipes(c: Ctx, args: string[]): Promise<MessageReply> {
  const [skill, page] = args.map(Number);
  const { embed } = await rarePage(c, skill || null, page);
  return postedReply({ embeds: [embed] }, c.userId);
}

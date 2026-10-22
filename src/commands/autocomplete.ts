// Autocomplete. At most one D1 statement per keystroke, and never a write (order 3, ITEM 3.2):
// - skill, class, item: public game data, not role-gated; one statement that checks the import key and
//   reads the list only when it changed (src/gamedata.ts).
// - character: the caller's own characters (an officer who filled member: sees that member's), with the
//   member-role gate and the officer check inside the same statement (src/access.ts SQL_*).
// - recipe (order 9): every recipe, one choice each, labelled with its tradeskill and trivial so an item's recipes
//   can be told apart (public game data, cached like the item list). /recipe source and /recipe override pick a
//   recipe through their item: option. /craft forget offers only the recipes that character has marked known.
// - faction (order 10): /recipe source's free-text faction, with this guild's earlier factions as suggestions.
import { SQL_IS_OFFICER, SQL_PASSES_MEMBER_GATE, sqlAccessParams } from '../access.ts';
import { focused, matchChoices, optString, subcommand, truncate, type Choice, type Interaction, type Option } from '../discord.ts';
import { gameList, type GameList } from '../gamedata.ts';
import { FACTION_MAX, recipeLabel, recipeValue } from '../recipes.ts';
import { ALL_SKILLS } from './requests.ts';

const CHOICE_MAX = 100;

const asChoices = (names: string[]): Choice[] => names.map((n) => ({ name: truncate(n, CHOICE_MAX), value: n }));

const CHARACTERS_SQL = `SELECT c.name FROM character c
  WHERE c.guild_id = ?1 AND c.deleted_at IS NULL AND ${SQL_PASSES_MEMBER_GATE}
    AND c.owner_user_id = CASE WHEN ?4 IS NOT NULL AND ${SQL_IS_OFFICER} THEN ?4 ELSE ?5 END
  ORDER BY c.is_main DESC, c.name COLLATE NOCASE`;

/** The recipes the caller's named character (or main, when ?4 is NULL) has marked known: the caller's own only. */
const KNOWN_SQL = `SELECT i.name AS item, t.name AS tradeskill, r.trivial, r.id FROM character_recipe k
  JOIN character c ON c.id = k.character_id JOIN recipe r ON r.id = k.recipe_id
  JOIN item i ON i.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id
  WHERE c.guild_id = ?1 AND ${SQL_PASSES_MEMBER_GATE} AND c.owner_user_id = ?5 AND c.deleted_at IS NULL
    AND c.id = CASE WHEN ?4 IS NULL
      THEN (SELECT id FROM character WHERE guild_id = ?1 AND owner_user_id = ?5 AND deleted_at IS NULL ORDER BY is_main DESC, created_at, id LIMIT 1)
      ELSE (SELECT id FROM character WHERE guild_id = ?1 AND owner_user_id = ?5 AND deleted_at IS NULL AND name_key = lower(trim(?4))) END
  ORDER BY i.name COLLATE NOCASE, t.name COLLATE NOCASE`;

/** Recipe choices; labels made unique so two variants with the same skill and trivial stay distinct. */
function recipeChoices(rows: { item: string; tradeskill: string; trivial: number | null; id: number }[], typed: string): Choice[] {
  const seen = new Map<string, number>();
  const byLabel = new Map<string, number>();
  for (const r of rows) {
    const base = recipeLabel(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    byLabel.set(n > 1 ? `${base} (${n})` : base, r.id);
  }
  return matchChoices([...byLabel.keys()], typed).map((label) => ({ name: truncate(label, CHOICE_MAX), value: recipeValue(byLabel.get(label)!) }));
}

/** The factions this guild's corrections already name (the correction layer; read only). */
const FACTIONS_SQL = 'SELECT min(faction) AS faction FROM recipe_correction WHERE guild_id = ?1 AND faction IS NOT NULL GROUP BY lower(faction) ORDER BY faction COLLATE NOCASE';

/**
 * /recipe source faction: the typed name first, exactly as typed (up to FACTION_MAX), then this guild's factions that
 * match it. Discord accepts free text in an autocomplete option anyway; echoing it keeps a pick from replacing it.
 */
export function factionChoices(used: string[], typed: string): Choice[] {
  const own = typed.trim().slice(0, FACTION_MAX);
  const rest = matchChoices(used, own).filter((n) => n.toLowerCase() !== own.toLowerCase());
  return [...(own ? [own] : []), ...rest].slice(0, 25).map((n) => ({ name: truncate(n, CHOICE_MAX), value: n }));
}

const parseRecipe = (s: string) => {
  const [item, tradeskill, trivial, id] = s.split('\u001f');
  return { item, tradeskill, trivial: trivial === '' ? null : Number(trivial), id: Number(id) };
};

/** Order 18: /item name: every item, craftable ones marked (src/gamedata.ts 'allItems' ends their names with ␟). */
export const CRAFTABLE_MARK = ' (craftable)';
const CRAFTABLE = '\u001f';
export function itemChoices(names: string[], typed: string): Choice[] {
  const plain = names.map((n) => (n.endsWith(CRAFTABLE) ? n.slice(0, -1) : n));
  const craftable = new Set(names.filter((n) => n.endsWith(CRAFTABLE)).map((n) => n.slice(0, -1)));
  return matchChoices(plain, typed).map((n) => ({ name: craftable.has(n) ? `${truncate(n, CHOICE_MAX - CRAFTABLE_MARK.length)}${CRAFTABLE_MARK}` : truncate(n, CHOICE_MAX), value: n }));
}

interface Asked {
  db: D1Database;
  i: Interaction & { guild_id: string; member: NonNullable<Interaction['member']> };
  options: Option[];
  typed: string;
}
type Lister = (a: Asked) => Promise<Choice[]>;

const game = (list: GameList): Lister => async (a) => asChoices(matchChoices(await gameList(a.db, list), a.typed));
const allRecipes: Lister = async (a) => recipeChoices((await gameList(a.db, 'recipes')).map(parseRecipe), a.typed);
/** /craft forget: only the recipes that character has marked known. */
const knownRecipes: Lister = async ({ db, i, options, typed }) => {
  const { results } = await db
    .prepare(KNOWN_SQL)
    .bind(...sqlAccessParams(i.guild_id, i.member), optString(options, 'character') ?? null, i.member.user.id)
    .all<{ item: string; tradeskill: string; trivial: number | null; id: number }>();
  return recipeChoices(results, typed);
};
const factions: Lister = async ({ db, i, typed }) => {
  const { results } = await db.prepare(FACTIONS_SQL).bind(i.guild_id).all<{ faction: string }>();
  return factionChoices(results.map((r) => r.faction), typed);
};
/** The caller's own characters (an officer who filled member: sees that member's). */
const characters: Lister = async ({ db, i, options, typed }) => {
  const { results } = await db
    .prepare(CHARACTERS_SQL)
    .bind(...sqlAccessParams(i.guild_id, i.member), optString(options, 'member') ?? null, i.member.user.id)
    .all<{ name: string }>();
  return asChoices(matchChoices(results.map((r) => r.name), typed));
};
// Order 16: /craft notify's tradeskill, with All first.
const skillsWithAll: Lister = async (a) => asChoices(matchChoices([ALL_SKILLS, ...(await gameList(a.db, 'skills'))], a.typed));
const allItems: Lister = async (a) => itemChoices(await gameList(a.db, 'allItems'), a.typed);

/**
 * Order 18: each list is chosen by command and option ("/command [subcommand] option"), never by the option's name alone,
 * so /item name: (every item) and /request item: (items with a recipe) keep their own lists. Every autocomplete option in
 * the definitions has an entry, and every entry names one (test/worker/autocomplete.test.ts).
 */
export const LISTS: Record<string, Lister> = {
  '/character add class': game('classes'),
  '/character edit class': game('classes'),
  '/character edit name': characters,
  '/character remove name': characters,
  '/craft set skill': game('skills'),
  '/craft set character': characters,
  '/craft update character': characters,
  '/craft me character': characters,
  '/craft find item': game('items'),
  '/craft know recipe': allRecipes,
  '/craft know character': characters,
  '/craft forget recipe': knownRecipes,
  '/craft forget character': characters,
  '/craft report item': game('items'),
  '/craft request item': game('items'),
  '/craft notify tradeskill': skillsWithAll,
  '/item image item': game('items'),
  // Order 17: the zone list (25 of the ~29 as the member types).
  '/gear find zone': game('zones'),
  '/zone name': game('zones'),
  '/recipe source item': allRecipes,
  '/recipe source faction': factions,
  '/recipe override item': allRecipes,
  '/roster skill skill': game('skills'),
  '/roster recipes skill': game('skills'),
  // Order 18's list.
  '/skills skill': game('skills'),
  '/skills character': characters,
  '/item name': allItems,
  '/gear zone': game('zones'),
  '/request item': game('items'),
  '/officer recipe-source item': allRecipes,
  '/officer recipe-source faction': factions,
  '/officer recipe-fix item': allRecipes,
};

export const listKey = (command: string | undefined, sub: string | undefined, option: string) => `/${command}${sub ? ` ${sub}` : ''} ${option}`;

export async function autocomplete(db: D1Database, i: Interaction): Promise<Choice[]> {
  const { name: sub, options } = subcommand(i);
  const f = focused(options);
  if (!f || !i.member || !i.guild_id) return [];
  const list = LISTS[listKey(i.data?.name, sub, f.name)];
  if (!list) return [];
  return list({ db, i: i as Asked['i'], options, typed: typeof f.value === 'string' ? f.value : '' });
}

// Autocomplete. At most one D1 statement per keystroke, and never a write (order 3, ITEM 3.2):
// - tradeskills, items, zones: public game data, not role-gated; one statement that checks the import key and
//   reads the list only when it changed (src/gamedata.ts). /item name: offers every item, /request item: the recipe results.
// - character: the caller's own characters (an officer who filled member: sees that member's), with the
//   member-role gate and the officer check inside the same statement (src/access.ts SQL_*).
// - recipe (order 9): every recipe, one choice each, labelled with its tradeskill and trivial so an item's recipes
//   can be told apart (public game data, cached like the item list). /officer recipe-source and recipe-fix pick a
//   recipe through their item: option.
// - faction (order 10): /officer recipe-source's free-text faction, with this guild's earlier factions as suggestions.
import { SQL_IS_OFFICER, SQL_PASSES_MEMBER_GATE, sqlAccessParams } from '../access.ts';
import { focused, matchChoices, optString, subcommand, truncate, type Choice, type Interaction, type Option } from '../discord.ts';
import { gameList, type GameList } from '../gamedata.ts';
import { FACTION_MAX, recipeLabel, recipeValue } from '../recipes.ts';
import { openAuctionChoices } from '../dkp/auction.ts';
import { DKP_COPY } from '../dkp/copy.ts';
import { OPEN_RAID_CREATURES_SQL, zoneCreatures } from '../dkp/creatures.ts';
import { POOL_GUILD } from '../dkp/ledger.ts';
import { ownWishlist } from '../dkp/wishlist.ts';
import { zoneKey } from '../zone/names.ts';

const CHOICE_MAX = 100;

const asChoices = (names: string[]): Choice[] => names.map((n) => ({ name: truncate(n, CHOICE_MAX), value: n }));

const CHARACTERS_SQL = `SELECT c.name FROM character c
  WHERE c.guild_id = ?1 AND c.deleted_at IS NULL AND ${SQL_PASSES_MEMBER_GATE}
    AND c.owner_user_id = CASE WHEN ?4 IS NOT NULL AND ${SQL_IS_OFFICER} THEN ?4 ELSE ?5 END
  ORDER BY c.is_main DESC, c.name COLLATE NOCASE`;

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
const allItems: Lister = async (a) => itemChoices(await gameList(a.db, 'allItems'), a.typed);
/** Order 27: a DKP pool: the guild pool first, then the zones (one statement: the cached zone list). */
const dkpPools: Lister = async (a) => [{ name: DKP_COPY.guildPool, value: POOL_GUILD }, ...asChoices(matchChoices(await gameList(a.db, 'zones'), a.typed, 24))];
/** Order 27: the zone's creatures (src/dkp/creatures.ts), for the zone already filled in; one statement. */
const dkpCreatures: Lister = async ({ db, options, typed }) => {
  const zone = optString(options, 'zone');
  return zone ? asChoices(matchChoices((await zoneCreatures(db, zoneKey(zone))).map((c) => c.name), typed)) : [];
};
/**
 * Order 27: /dkp kill named: the open raid's creatures, and first what was typed, as typed (a creature the data doesn't
 * list is accepted and stored as typed). One statement.
 */
const dkpOpenRaidCreatures: Lister = async ({ db, i, typed }) => {
  const names = (await db.prepare(OPEN_RAID_CREATURES_SQL).bind(i.guild_id).all<{ name: string }>()).results.map((r) => r.name);
  return factionChoices(names, typed.slice(0, 100));
};
/** Order 27: /dkp correct kill: the latest raid's kills, newest first, by id. One statement. */
const dkpKills: Lister = async ({ db, i, typed }) => {
  const { results } = await db
    .prepare(
      `SELECT k.id, coalesce(k.name, 'Flat payout') AS name, k.at FROM dkp_kill k WHERE k.raid_id = (SELECT id FROM dkp_raid WHERE guild_id = ?1 ORDER BY closed_at IS NULL DESC, id DESC LIMIT 1) ORDER BY k.id DESC LIMIT 100`,
    )
    .bind(i.guild_id)
    .all<{ id: number; name: string; at: string }>();
  const q = typed.trim().toLowerCase();
  return results
    .filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.id) === q)
    .slice(0, 25)
    .map((r) => ({ name: truncate(`${r.name} · ${r.at.slice(11, 19)} UTC · #${r.id}`, CHOICE_MAX), value: String(r.id) }));
};

/**
 * Order 18: each list is chosen by command and option ("/command [subcommand] option"), never by the option's name alone,
 * so /item name: (every item) and /request item: (items with a recipe) keep their own lists. Every autocomplete option in
 * the definitions has an entry, and every entry names one (test/worker/autocomplete.test.ts).
 */
export const LISTS: Record<string, Lister> = {
  // Order 17: the zone list (25 of the ~29 as the member types).
  '/zone name': game('zones'),
  '/gear zone': game('zones'),
  '/roster skill skill': game('skills'),
  '/roster recipes skill': game('skills'),
  '/skills skill': game('skills'),
  '/skills character': characters,
  '/me character': characters,
  '/item name': allItems,
  '/request item': game('items'),
  '/officer recipe-source item': allRecipes,
  '/officer recipe-source faction': factions,
  '/officer recipe-fix item': allRecipes,
  // Order 27: /dkp (a per-server definition, src/dkp/definition.ts).
  '/dkp adjust pool': dkpPools,
  '/dkp named-value zone': game('zones'),
  '/dkp named-value named': dkpCreatures,
  '/dkp raid zone': game('zones'),
  '/dkp kill named': dkpOpenRaidCreatures,
  '/dkp correct kill': dkpKills,
  '/dkp history pool': dkpPools,
  // Order 29: any item, as /item name lists them (one statement per keystroke: the cached item list).
  '/dkp auction item': allItems,
  // Order 31: this server's open auctions, which their cards already show to everyone. One statement per keystroke.
  '/dkp cancel auction': ({ db, i, typed }) => openAuctionChoices(db, i.guild_id, typed, Date.now()),
  // Order 29, PR C: wishlists (a subcommand group's subcommand: "wishlist add").
  '/dkp wishlist add item': allItems,
  '/dkp shop add item': allItems,
  '/dkp wishlist add character': characters,
  '/dkp wishlist remove item': async ({ db, i, typed }) => asChoices(await ownWishlist(db, i.guild_id, i.member.user.id, typed)),
  // Order 32: /event (a per-server definition, src/events/definition.ts). The class list is game_class's, cached.
  '/event settings class': game('classes'),
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

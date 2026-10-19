// "Who can make this" (PRD FR-3, FR-3.1): the one place crafters are tiered (ORDER-RULES Data: one
// decision has one decider). The query is docs/PRD-core-query.sql's joins and filters; the tier CASE of
// that file, plus the 25-point window and the "further below" count it leaves to code, is crafterTier.

export type Tier = 'reliable' | 'learning' | 'below' | 'unknown' | 'unconfirmed';

export interface TierRecipe {
  trivial: number | null;
  acquisition: string;
}

/**
 * - unconfirmed: a reputation or discovery recipe the character has not marked known (FR-3.1);
 * - unknown: the recipe's trivial is unknown (everyone with the tradeskill, by level);
 * - reliable: skill at or above the trivial;
 * - learning: within `window` points below the trivial (guild.learning_window, default 25);
 * - below: further below; shown as a count only.
 */
export function crafterTier(level: number, recipe: TierRecipe, knowsRecipe: boolean, window: number): Tier {
  if ((recipe.acquisition === 'reputation' || recipe.acquisition === 'discovery') && !knowsRecipe) return 'unconfirmed';
  if (recipe.trivial === null) return 'unknown';
  if (level >= recipe.trivial) return 'reliable';
  if (level >= recipe.trivial - window) return 'learning';
  return 'below';
}

export interface CrafterRow {
  recipe_id: number;
  character: string;
  class: string | null;
  char_level: number | null;
  level: number;
  knows_recipe: number;
}

/**
 * Every live character of an active member of this guild with the tradeskill of a recipe for the item,
 * highest skill first. Removed characters (deleted_at) and departed members (status 'left') never appear.
 * Binds: ?2 guild id; `item` is the item id expression (default ?1).
 */
export const craftersSql = (item = '?1') => `SELECT r.id AS recipe_id, c.name AS character, c.class, c.level AS char_level, cs.level,
    EXISTS (SELECT 1 FROM character_recipe k WHERE k.character_id = c.id AND k.recipe_id = r.id) AS knows_recipe
  FROM recipe r
  JOIN character_skill cs ON cs.tradeskill_id = r.tradeskill_id
  JOIN character c ON c.id = cs.character_id AND c.deleted_at IS NULL
  JOIN member m ON m.guild_id = c.guild_id AND m.discord_user_id = c.owner_user_id
  WHERE r.result_item_id = ${item} AND r.active = 1 AND (r.guild_id IS NULL OR r.guild_id = ?2)
    AND c.guild_id = ?2 AND m.status = 'active'
  ORDER BY cs.level DESC, c.name COLLATE NOCASE`;

/** Splits one recipe's crafters into tiers, keeping the query's order (highest skill first) within each. */
export function tierCrafters(rows: CrafterRow[], recipe: TierRecipe & { id: number }, window: number): Record<Tier, CrafterRow[]> {
  const out: Record<Tier, CrafterRow[]> = { reliable: [], learning: [], below: [], unknown: [], unconfirmed: [] };
  for (const r of rows) if (r.recipe_id === recipe.id) out[crafterTier(r.level, recipe, r.knows_recipe === 1, window)].push(r);
  return out;
}

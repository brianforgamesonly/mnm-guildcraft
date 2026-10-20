// Recipes as one guild sees them (order 9, ITEMs 1–2; PRD FR-2, FR-3.1, FR-7).
//
// The guild correction layer (migration 0009, order 9 override 2): recipe_correction holds one guild's acquisition,
// faction, note and trivial for a recipe, and recipe_correction_component its corrected component list. Every reader
// uses the guild's value where one is set and the imported value otherwise; the import never touches the layer.
// CORRECTED below is the one place that rule is written. Pure: the command definitions (scripts/discord/register.ts)
// read the lists from this file.

/** How a recipe is obtained (PRD FR-3.1), held once: command choices, the CHECK in migration 0009 and the tiers. */
export const ACQUISITIONS = ['vendor', 'reputation', 'discovery', 'unknown'] as const;
export type Acquisition = (typeof ACQUISITIONS)[number];
export const ACQUISITION_LABEL: Record<Acquisition, string> = { vendor: 'Vendor', reputation: 'Reputation', discovery: 'Discovery', unknown: 'Unknown' };
/** Only characters who marked the recipe known count as able to make it (FR-3.1). */
export const GATED: readonly Acquisition[] = ['reputation', 'discovery'];
export const isGated = (a: string) => (GATED as readonly string[]).includes(a);

/** Report issues (FR-7 as amended by order 9 override 4), held once: the command's choices and the modal's select. */
export const REPORT_ISSUES = [
  { value: 'trivial', label: 'Wrong trivial' },
  { value: 'components', label: 'Wrong components' },
  { value: 'source', label: 'Wrong source (how it is obtained)' },
  { value: 'missing', label: 'Missing recipe' },
  { value: 'other', label: 'Other' },
] as const;
export const issueLabel = (v: string) => REPORT_ISSUES.find((i) => i.value === v)?.label ?? v;

/** A recipe with this guild's corrections applied. */
export interface GuildRecipe {
  id: number;
  item_id: number;
  item: string;
  tradeskill: string;
  trivial: number | null;
  acquisition: Acquisition;
  faction: string | null;
  note: string | null;
  /** Which fields come from the guild's correction (the "guild-corrected" marker). */
  trivial_corrected: number;
  acquisition_corrected: number;
}

/** Longest faction name /recipe source accepts: the command option's max_length and the handler's check. */
export const FACTION_MAX = 80;

/**
 * "Guild value, else imported", for recipe `r` and its correction `rc` (correctionJoin): the one place the rule is
 * written (order 10, ITEM 1.3). `CORRECTED.acquisition` is the bare expression, for WHERE clauses.
 */
export const CORRECTED = {
  trivial: 'coalesce(rc.trivial, r.trivial)',
  acquisition: 'coalesce(rc.acquisition, r.acquisition)',
  faction: 'coalesce(rc.faction, r.faction)',
  note: 'coalesce(rc.note, r.acquisition_note)',
} as const;
/** Every corrected column, aliased, with the "guild-corrected" markers. */
export const CORRECTED_COLS = `${Object.entries(CORRECTED).map(([k, e]) => `${e} AS ${k}`).join(', ')},
  rc.trivial IS NOT NULL AS trivial_corrected, rc.acquisition IS NOT NULL AS acquisition_corrected`;
/** This guild's correction for recipe `r`; `guild` is the guild id's parameter. */
export const correctionJoin = (guild: string) => `LEFT JOIN recipe_correction rc ON rc.recipe_id = r.id AND rc.guild_id = ${guild}`;

/** The columns of a GuildRecipe for recipe `r` joined to tradeskill `t`, item `i` and correction `rc`. */
export const GUILD_RECIPE_COLS = `r.id, r.result_item_id AS item_id, i.name AS item, t.name AS tradeskill, ${CORRECTED_COLS}`;
/** The joins for GUILD_RECIPE_COLS; `guild` is the guild id's parameter. */
export const guildRecipeFrom = (guild: string) => `FROM recipe r JOIN tradeskill t ON t.id = r.tradeskill_id JOIN item i ON i.id = r.result_item_id
  ${correctionJoin(guild)}`;
/** Recipes this guild can see: shared ones and its own (guild-private recipes arrive after launch). */
export const visibleTo = (guild: string) => `r.active = 1 AND (r.guild_id IS NULL OR r.guild_id = ${guild})`;

/** A recipe-choice value from autocomplete: "#<recipe id>". Anything else is an item name the member typed. */
export const RECIPE_VALUE = /^#(\d+)$/;
export const recipeValue = (id: number) => `#${id}`;

/** "Copper Sword · Blacksmithing · trivial 20": how a recipe is told apart from the item's other recipes. */
export const recipeLabel = (r: Pick<GuildRecipe, 'item' | 'tradeskill' | 'trivial'>) => `${r.item} · ${r.tradeskill} · ${r.trivial === null ? 'trivial unknown' : `trivial ${r.trivial}`}`;

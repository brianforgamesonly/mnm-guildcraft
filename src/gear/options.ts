// /gear find's options (work order 13, ITEM 3): every choice list is derived from src/gear/vocab.ts (or, for classes,
// from game_class at registration), never typed twice. Pure: the command definitions and the registration script read it.
import { RESISTS, SLOTS, SOURCES, STATS, WEAPON_TYPES } from './vocab.ts';

/** A value an item can carry and a member can filter or sort by, with the stats_json path that holds it. */
export interface StatKey {
  key: string;
  label: string;
  path: string;
}
const stat = (k: string): StatKey => ({ key: k, label: k, path: `$.stats.${k}` });
const resist = (k: string): StatKey => ({ key: k, label: k, path: `$.resists.${k}` });
const HP: StatKey = { key: 'HP', label: 'HP', path: '$.hp' };
const MANA: StatKey = { key: 'MANA', label: 'Mana', path: '$.mana' };
const HASTE: StatKey = { key: 'HASTE', label: 'Haste', path: '$.haste' };
const HP_REGEN: StatKey = { key: 'HPREGEN', label: 'HP regen', path: '$.hpRegen' };
const MANA_REGEN: StatKey = { key: 'MANAREGEN', label: 'Mana regen', path: '$.manaRegen' };

/** stat1..stat3: the stats, resists, HP, mana, haste and regen (an item "has" one when its value is above 0). */
export const STAT_FILTERS: StatKey[] = [...STATS.map(stat), ...RESISTS.map(resist), HP, MANA, HASTE, HP_REGEN, MANA_REGEN];

/** "Total stats": the sum of the seven stats (STATS). */
export const TOTAL_STATS_SQL = `(${STATS.map((k) => `ifnull(json_extract(stats_json, '$.stats.${k}'), 0)`).join(' + ')})`;
export const statSql = (s: StatKey) => `json_extract(stats_json, '${s.path}')`;

/** A sort: highest first, except Name (A→Z). */
export interface Sort {
  key: string;
  label: string;
  sql: string;
  asc?: true;
}
export const SORTS: Sort[] = [
  { key: 'AC', label: 'AC', sql: 'ac' },
  { key: 'RATIO', label: 'Ratio', sql: 'ratio' },
  ...[HP, MANA, HASTE].map((s) => ({ key: s.key, label: s.label, sql: statSql(s) })),
  { key: 'TOTAL', label: 'Total stats', sql: 'total_stats' }, // the generated column (migrations/0011), = TOTAL_STATS_SQL
  ...[...STATS.map(stat), ...RESISTS.map(resist)].map((s) => ({ key: s.key, label: s.label, sql: statSql(s) })),
  { key: 'NAME', label: 'Name', sql: 'name COLLATE NOCASE', asc: true },
];
export const sortByKey = (k: string | undefined) => SORTS.find((s) => s.key === k);

export const ANY = 'Any';
/** The source option: Any, then each source (src/gear/vocab.ts SOURCES). */
export const SOURCE_CHOICES = [ANY, ...SOURCES] as const;

// ---------------------------------------------------------------- the command's options

const STRING = 3;
const INTEGER = 4;
const NUMBER = 10;
/** Upper bounds that keep the paging state inside a custom_id (see encodeState). */
export const MIN_AC_MAX = 9999;
export const MIN_RATIO_MAX = 99;

const choice = (name: string, value = name) => ({ name, value });

/**
 * /gear find's options, in the order Brian set (2026-10-20). `classes` is the game_class list at registration
 * (scripts/discord/register.ts); "Any" is the first choice.
 */
export function gearFindOptions(classes: readonly string[]) {
  return [
    { type: STRING, name: 'class', description: 'Your class, or Any (required)', required: true, choices: [choice(ANY), ...classes.map((c) => choice(c))] },
    { type: STRING, name: 'slot', description: 'Only items for this slot', choices: SLOTS.map((s) => choice(s)) },
    { type: STRING, name: 'weapon_type', description: 'Only weapons of this type (the code the wiki uses)', choices: WEAPON_TYPES.map((w) => choice(w)) },
    { type: INTEGER, name: 'min_ac', description: 'Only items with at least this much AC', min_value: 0, max_value: MIN_AC_MAX },
    { type: NUMBER, name: 'min_ratio', description: 'Only weapons with at least this damage ÷ delay', min_value: 0, max_value: MIN_RATIO_MAX },
    ...[1, 2, 3].map((n) => ({
      type: STRING,
      name: `stat${n}`,
      description: 'Only items with all the stats you pick',
      choices: STAT_FILTERS.map((s) => choice(s.label, s.key)),
    })),
    { type: STRING, name: 'source', description: 'Where it comes from, as the wiki records it', choices: SOURCE_CHOICES.map((s) => choice(s)) },
    { type: STRING, name: 'sort', description: 'Highest first (Name: A→Z). Default: Ratio for weapons, otherwise AC', choices: SORTS.map((s) => choice(s.label, s.key)) },
    // Order 17: the zone list is data (the zone table), so it is offered by autocomplete, not as choices.
    { type: STRING, name: 'zone', description: 'Only items the wiki lists for this zone', autocomplete: true, max_length: 100 },
  ];
}

// ---------------------------------------------------------------- a search, and its state in a custom_id

export interface GearQuery {
  /** A class code, or ANY. */
  cls: string;
  slot?: (typeof SLOTS)[number];
  weaponType?: (typeof WEAPON_TYPES)[number];
  minAc?: number;
  minRatio?: number;
  stats: StatKey[];
  source?: (typeof SOURCES)[number];
  sort: Sort;
  /** Order 17: a zone key (src/zone/names.ts zoneKey): items whose wikiZones name that zone. */
  zone?: string;
}

/** A zone key longer than this does not fit the paging state (see encodeState); /zone's Gear here is then left off. */
export const ZONE_STATE_MAX = 40;

/** The default sort: Ratio when weapon_type or min_ratio is set, otherwise AC. */
export const defaultSort = (q: Pick<GearQuery, 'weaponType' | 'minRatio'>) => sortByKey(q.weaponType || q.minRatio !== undefined ? 'RATIO' : 'AC')!;

/** min_ratio is kept to 3 decimals, so the paging state stays short (and 0.3333… reads as 0.333). */
export const roundRatio = (n: number) => Math.round(n * 1000) / 1000;

const idx = <T>(list: readonly T[], v: T | undefined) => (v === undefined ? '' : String(list.indexOf(v)));
const at = <T>(list: readonly T[], s: string | undefined): T | undefined => (s === undefined || s === '' ? undefined : list[Number(s)]);

/**
 * The query as a compact string: "<class>.<slot>.<weapon>.<min_ac>.<min_ratio ×1000>.<stats>.<source>.<sort>", each list
 * value as its index (stats as up to three indexes joined by '-'). Worst case (every option set, the longest values)
 * is checked in test/worker/gear.test.ts against Discord's 100-character custom_id.
 * Order 17: then ".<zone key>" when a zone is set, last, so a "." in a zone name cannot split the state.
 */
export function encodeState(q: GearQuery): string {
  return [
    ...stateFields(q),
    ...(q.zone === undefined ? [] : [q.zone]),
  ].join('.');
}

function stateFields(q: GearQuery): (string | number)[] {
  return [
    q.cls === ANY ? '' : q.cls,
    idx(SLOTS, q.slot),
    idx(WEAPON_TYPES, q.weaponType),
    q.minAc ?? '',
    q.minRatio === undefined ? '' : Math.round(q.minRatio * 1000), // thousandths: a '.' would split the state
    q.stats.map((s) => STAT_FILTERS.indexOf(s)).join('-'),
    idx(SOURCES, q.source),
    String(SORTS.indexOf(q.sort)),
  ];
}

export function decodeState(s: string): GearQuery | null {
  const all = s.split('.');
  if (all.length < 8) return null;
  const p = all.slice(0, 8);
  const zone = all.length > 8 ? all.slice(8).join('.') : undefined;
  const sort = at(SORTS, p[7]);
  if (!sort) return null;
  const num = (v: string) => (v === '' ? undefined : Number(v));
  return {
    cls: p[0] || ANY,
    slot: at(SLOTS, p[1]),
    weaponType: at(WEAPON_TYPES, p[2]),
    minAc: num(p[3]),
    minRatio: p[4] === '' ? undefined : Number(p[4]) / 1000,
    stats: p[5] ? p[5].split('-').map((i) => STAT_FILTERS[Number(i)]).filter(Boolean) : [],
    source: at(SOURCES, p[6]),
    sort,
    ...(zone === undefined ? {} : { zone }),
  };
}

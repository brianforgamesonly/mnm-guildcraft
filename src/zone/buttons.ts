// Order 23: zone buttons under /gear results, the /item card and /gear's item card. One button per distinct zone the text
// shows, in the order it first appears; each opens that zone's card as /zone does ("zo:<zone key>", src/commands/zone.ts
// zoneOpen). A name gets a button only when the derived mapping (zone_name) maps it to an active zone, so a button never
// leads to a dead end; an unmatched name (zone_key NULL) stays text. Discord's limits (docs.discord.com/developers/
// components/reference): "Legacy messages allow up to 5 action rows as top-level components"; an action row holds "up to
// 5" buttons; custom_id "1 to 100 characters"; a label "max 80 characters"; "Multiple components on the same message
// must not share the same custom_id".
import { button, row, truncate, type MessageReply } from '../discord.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE } from './names.ts';

/** A zone button: "zo:<zone key>". */
export const OPEN_PREFIX = 'zo:';
export const MESSAGE_ROWS = 5;
export const ROW_BUTTONS = 5;
export const LABEL_MAX = 80;
export const CUSTOM_ID_MAX = 100;

/** A zone name as the text shows it, and the mapping's source it is looked up in. */
export interface ZoneRef {
  source: typeof WIKI_ZONES_SOURCE | typeof MOB_ZONES_SOURCE;
  name: string;
}
export interface ZoneMatch {
  source: string;
  name: string;
  key: string;
  zone: string;
}

/** The shown names' zones, one statement: zone_name by its primary key (source, name), then the active zone. */
export const ZONE_MATCH_SQL = `SELECT zn.source, zn.name, z.key, z.name AS zone FROM zone_name zn JOIN zone z ON z.key = zn.zone_key AND z.active = 1
  WHERE zn.active = 1 AND (zn.source, zn.name) IN (SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]') FROM json_each(?1))`;

export async function matchZones(db: D1Database, refs: ZoneRef[]): Promise<{ matches: ZoneMatch[]; rowsRead: number }> {
  if (!refs.length) return { matches: [], rowsRead: 0 };
  const r = await db.prepare(ZONE_MATCH_SQL).bind(JSON.stringify(refs.map((z) => [z.source, z.name]))).all<ZoneMatch>();
  return { matches: r.results, rowsRead: r.meta?.rows_read ?? 0 };
}

export interface ZoneButtons {
  rows: unknown[];
  /** Distinct matched zones the text shows (the page's own zone left out). */
  zones: number;
  /** Those that got a button: the rest did not fit the rows left, or had a key too long for a custom_id. */
  shown: number;
  tooLong: number;
  /** D1's rows_read for the lookup (0 when the text names no zone: nothing is read). */
  rowsRead: number;
}

/**
 * The buttons, in the rows a message leaves (`usedRows` of 5), de-duplicated by zone key, in the order the names appear.
 * `exclude`: the zone the results are already from (/gear find zone:, Gear here).
 */
export function layoutZoneButtons(refs: ZoneRef[], matches: ZoneMatch[], usedRows: number, exclude?: string): Omit<ZoneButtons, 'rowsRead'> {
  const byName = new Map(matches.map((m) => [`${m.source}\u0000${m.name}`, m]));
  const zones = new Map<string, string>();
  for (const z of refs) {
    const m = byName.get(`${z.source}\u0000${z.name}`);
    if (m && m.key !== exclude && !zones.has(m.key)) zones.set(m.key, m.zone);
  }
  const fits = [...zones].filter(([key]) => OPEN_PREFIX.length + key.length <= CUSTOM_ID_MAX);
  const shown = fits.slice(0, Math.max(0, MESSAGE_ROWS - usedRows) * ROW_BUTTONS);
  const rows: unknown[] = [];
  for (let i = 0; i < shown.length; i += ROW_BUTTONS) rows.push(row(shown.slice(i, i + ROW_BUTTONS).map(([key, name]) => button(`${OPEN_PREFIX}${key}`, truncate(name, LABEL_MAX)))));
  return { rows, zones: zones.size, shown: shown.length, tooLong: zones.size - fits.length };
}

export async function zoneButtons(db: D1Database, refs: ZoneRef[], usedRows: number, exclude?: string): Promise<ZoneButtons> {
  const { matches, rowsRead } = await matchZones(db, refs);
  return { ...layoutZoneButtons(refs, matches, usedRows, exclude), rowsRead };
}

/** A reply with its zone buttons added under its own rows. */
export async function withZoneButtons(db: D1Database, reply: MessageReply, refs: ZoneRef[]): Promise<MessageReply> {
  const own = (reply.data.components ?? []) as unknown[];
  const z = await zoneButtons(db, refs, own.length);
  return z.rows.length ? { ...reply, data: { ...reply.data, components: [...own, ...z.rows] } } : reply;
}

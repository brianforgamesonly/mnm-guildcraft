// What the boards are rendered from (order 5, PRD FR-5; order 24: the factions board). Read-only SELECTs, in one D1
// batch, so the read-only dry run (scripts/board/run.mjs) can load exactly what the Worker loads.
import { NAME_ORDER } from '../collation.ts';
import { renderFactionIndex, renderFactionPost, type FactionLine } from './factions.ts';
import { FACTION_SHOWN, FACTIONS, TRADESKILLS, type BoardKind } from './kinds.ts';
import { renderIndex, renderSkillPost, type BoardLine, type BoardMessage, type LineMode } from './render.ts';

/** A board's guild settings, read from its own columns (src/board/kinds.ts) under these names. */
export interface BoardGuild {
  id: string;
  board_channel_id: string | null;
  stale_days: number;
  board_index_thread_id: string | null;
  board_index_message_id: string | null;
  board_index_hash: string | null;
  /** Order 6: when /guildcraft rebuild-board was asked for (NULL = no rebuild in progress). */
  board_rebuild_since: string | null;
}

export interface BoardPostRow {
  /** The tradeskill's or faction's id (kind.key). */
  topic_id: number;
  thread_id: string;
  message_ids_json: string;
  content_hash: string | null;
  dirty: number;
  last_rendered_at: string | null;
}

export type Topic = { id: number; name: string };

/** One board, loaded: what the refresh needs, whatever the kind. */
export interface BoardSource {
  kind: BoardKind;
  guild: BoardGuild;
  /** One post per topic: the list comes from a table the import derives (tradeskill, faction). */
  topics: Topic[];
  posts: Map<number, BoardPostRow>;
  /** A post whose data changed after it was rendered (order 24: faction.changed_at), besides its dirty flag. */
  stale: (topicId: number) => boolean;
  render: (t: Topic, nowMs: number, line: LineMode) => BoardMessage[];
  index: (threadOf: (topicId: number) => string | null, nowMs: number, line: LineMode) => { message: BoardMessage; hashable: string };
}

/** The tradeskill board, with its ranked lines (the dry run prints them pseudonymised). */
export interface BoardData extends BoardSource {
  tradeskills: Topic[];
  lines: Map<number, BoardLine[]>;
}

const guildColumns = (k: BoardKind) =>
  `id, ${k.channel} AS board_channel_id, stale_days, ${k.indexThread} AS board_index_thread_id, ${k.indexMessage} AS board_index_message_id, ` +
  `${k.indexHash} AS board_index_hash, ${k.rebuild} AS board_rebuild_since`;
const postsSql = (k: BoardKind) => `SELECT ${k.key} AS topic_id, thread_id, message_ids_json, content_hash, dirty, last_rendered_at FROM ${k.table} WHERE guild_id = ?`;

/** The statements boardFromResults reads, in order. Removed characters and departed members never appear. */
export function boardStatements(db: D1Database, guildId: string): D1PreparedStatement[] {
  return [
    db.prepare(`SELECT ${guildColumns(TRADESKILLS)} FROM guild WHERE id = ?`).bind(guildId),
    db.prepare(`SELECT id, name FROM tradeskill ORDER BY ${NAME_ORDER}`),
    db.prepare(postsSql(TRADESKILLS)).bind(guildId),
    db
      .prepare(
        `SELECT cs.tradeskill_id, c.name AS character, c.owner_user_id, m.display_name AS member, cs.level, cs.updated_at
         FROM character_skill cs JOIN character c ON c.id = cs.character_id
         JOIN member m ON m.guild_id = c.guild_id AND m.discord_user_id = c.owner_user_id
         WHERE c.guild_id = ? AND c.deleted_at IS NULL AND m.status = 'active'
         ORDER BY cs.tradeskill_id, cs.level DESC, c.name COLLATE NOCASE`,
      )
      .bind(guildId),
  ];
}

const postMap = (rows: unknown[]) => new Map((rows as BoardPostRow[]).map((p) => [p.topic_id, p]));

export function boardFromResults(results: D1Result[]): BoardData | null {
  const [g, ts, posts, lines] = results;
  const guild = (g.results as BoardGuild[])[0];
  if (!guild) return null;
  const byskill = new Map<number, BoardLine[]>();
  for (const l of lines.results as BoardLine[]) byskill.set(l.tradeskill_id, [...(byskill.get(l.tradeskill_id) ?? []), l]);
  const tradeskills = ts.results as Topic[];
  return {
    kind: TRADESKILLS,
    guild,
    topics: tradeskills,
    tradeskills,
    posts: postMap(posts.results),
    lines: byskill,
    stale: () => false,
    render: (t, nowMs, line) => renderSkillPost(t.name, byskill.get(t.id) ?? [], guild.stale_days, nowMs, line),
    index: (threadOf, nowMs, line) =>
      renderIndex(tradeskills.map((t) => ({ skill: t.name, thread_id: threadOf(t.id), lines: (byskill.get(t.id) ?? []).length })), nowMs, line),
  };
}

export async function loadBoard(db: D1Database, guildId: string): Promise<BoardData | null> {
  return boardFromResults(await db.batch(boardStatements(db, guildId)));
}

// ---------------------------------------------------------------- order 24: the factions board

/** The factions board's statements, in order: the guild, the shown factions, the posts, every creature line. */
export function factionStatements(db: D1Database, guildId: string): D1PreparedStatement[] {
  return [
    db.prepare(`SELECT ${guildColumns(FACTIONS)} FROM guild WHERE id = ?`).bind(guildId),
    db.prepare(`SELECT f.id, f.name, f.changed_at FROM faction f WHERE ${FACTION_SHOWN} ORDER BY ${NAME_ORDER}`),
    db.prepare(postsSql(FACTIONS)).bind(guildId),
    // Zones A→Z, then creatures A→Z, within each faction and section (src/board/factions.ts groups them in this order).
    db.prepare(
      `SELECT l.faction_id, l.kind, n.name AS creature, z.name AS zone, n.level, n.location
       FROM npc_faction l JOIN npc n ON n.zone_key = l.zone_key AND n.name = l.npc_name JOIN zone z ON z.key = l.zone_key
       WHERE l.active = 1 AND n.active = 1 AND z.active = 1
       ORDER BY l.faction_id, l.kind, z.name COLLATE NOCASE, n.name COLLATE NOCASE`,
    ),
  ];
}

export interface FactionData extends BoardSource {
  lines: Map<number, FactionLine[]>;
}

export function factionsFromResults(results: D1Result[]): FactionData | null {
  const [g, fs, posts, lines] = results;
  const guild = (g.results as BoardGuild[])[0];
  if (!guild) return null;
  const byFaction = new Map<number, FactionLine[]>();
  for (const l of lines.results as FactionLine[]) byFaction.set(l.faction_id, [...(byFaction.get(l.faction_id) ?? []), l]);
  const factions = fs.results as (Topic & { changed_at: string | null })[];
  const changed = new Map(factions.map((f) => [f.id, f.changed_at]));
  const postsBy = postMap(posts.results);
  const creatures = (id: number) => new Set((byFaction.get(id) ?? []).map((l) => `${l.zone}\n${l.creature.toLowerCase()}`)).size;
  return {
    kind: FACTIONS,
    guild,
    topics: factions.map(({ id, name }) => ({ id, name })),
    posts: postsBy,
    lines: byFaction,
    // ISO strings in one format (toISOString and the import's strftime) compare in time order.
    stale: (id) => {
      const at = changed.get(id);
      const p = postsBy.get(id);
      return !!at && !!p && (p.last_rendered_at === null || p.last_rendered_at < at);
    },
    render: (t, _nowMs, line: LineMode) => renderFactionPost(t.name, byFaction.get(t.id) ?? [], line),
    index: (threadOf, nowMs, line) => renderFactionIndex(factions.map((f) => ({ faction: f.name, thread_id: threadOf(f.id), creatures: creatures(f.id) })), nowMs, line),
  };
}

/** One board's statements and reader, by kind. */
export const sourceOf = (kind: BoardKind) =>
  kind.name === 'factions'
    ? { statements: factionStatements, fromResults: factionsFromResults as (r: D1Result[]) => BoardSource | null }
    : { statements: boardStatements, fromResults: boardFromResults as (r: D1Result[]) => BoardSource | null };

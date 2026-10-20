// What the board is rendered from (order 5, PRD FR-5). Read-only SELECTs, in one D1 batch, so the
// read-only dry run (scripts/board/run.ts) can load exactly what the Worker loads.
import { NAME_ORDER } from '../collation.ts';
import type { BoardLine } from './render.ts';

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
  tradeskill_id: number;
  thread_id: string;
  message_ids_json: string;
  content_hash: string | null;
  dirty: number;
  last_rendered_at: string | null;
}

export interface BoardData {
  guild: BoardGuild;
  /** One post per tradeskill: the list comes from the tradeskill table, which the import derives. */
  tradeskills: { id: number; name: string }[];
  posts: Map<number, BoardPostRow>;
  lines: Map<number, BoardLine[]>;
}

export const BOARD_GUILD_COLUMNS = 'id, board_channel_id, stale_days, board_index_thread_id, board_index_message_id, board_index_hash, board_rebuild_since';

/** The statements boardFromResults reads, in order. Removed characters and departed members never appear. */
export function boardStatements(db: D1Database, guildId: string): D1PreparedStatement[] {
  return [
    db.prepare(`SELECT ${BOARD_GUILD_COLUMNS} FROM guild WHERE id = ?`).bind(guildId),
    db.prepare(`SELECT id, name FROM tradeskill ORDER BY ${NAME_ORDER}`),
    db.prepare('SELECT tradeskill_id, thread_id, message_ids_json, content_hash, dirty, last_rendered_at FROM board_post WHERE guild_id = ?').bind(guildId),
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

export function boardFromResults(results: D1Result[]): BoardData | null {
  const [g, ts, posts, lines] = results;
  const guild = (g.results as BoardGuild[])[0];
  if (!guild) return null;
  const byskill = new Map<number, BoardLine[]>();
  for (const l of lines.results as BoardLine[]) byskill.set(l.tradeskill_id, [...(byskill.get(l.tradeskill_id) ?? []), l]);
  return {
    guild,
    tradeskills: ts.results as { id: number; name: string }[],
    posts: new Map((posts.results as BoardPostRow[]).map((p) => [p.tradeskill_id, p])),
    lines: byskill,
  };
}

export async function loadBoard(db: D1Database, guildId: string): Promise<BoardData | null> {
  return boardFromResults(await db.batch(boardStatements(db, guildId)));
}

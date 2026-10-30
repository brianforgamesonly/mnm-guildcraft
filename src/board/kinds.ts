// Order 24 (ITEM 2): the two forum boards the same machinery keeps (src/board/refresh.ts): the tradeskill board (order 5)
// and the factions board. Each names its own guild columns, posts table and key; nothing else differs in the refresh
// (A→Z by creation order, dirty refresh, the call cap, NO_MENTIONS, the index, the lease and the rebuild).
//
// The names below are fixed identifiers written into SQL, never input.
export type BoardName = 'tradeskills' | 'factions';

export interface BoardKind {
  name: BoardName;
  /** How /guildcraft rebuild-board's which: lists it. */
  label: string;
  /** The guild row's columns: the forum, the index post, its hash, the lease, the rebuild. */
  channel: string;
  indexThread: string;
  indexMessage: string;
  indexHash: string;
  lock: string;
  rebuild: string;
  /** The posts table and its topic column. */
  table: string;
  key: string;
  /**
   * Whether the nightly run re-renders every post and keeps it from auto-archiving. The tradeskill board does (its stale
   * markers change with time; order 6). The factions board does not: its posts change only with the data, and bumping
   * them would cost more calls than a night's run holds (order 24, ITEM 2: the archive policy).
   */
  nightly: boolean;
  /** The thread name of the pinned index post. */
  indexTitle: string;
  /**
   * Order 30: the forum's post guidelines (its `topic`). Set only when GuildCraft creates the forum (one backfill covered
   * those that existed); never read or written after that, so an officer's edit or clear stands. Discord: "0-4096
   * characters" on a forum.
   */
  guidelines: string;
}

export const TRADESKILLS: BoardKind = {
  name: 'tradeskills',
  label: 'Tradeskills',
  channel: 'board_channel_id',
  indexThread: 'board_index_thread_id',
  indexMessage: 'board_index_message_id',
  indexHash: 'board_index_hash',
  lock: 'board_lock_until',
  rebuild: 'board_rebuild_since',
  table: 'board_post',
  key: 'tradeskill_id',
  nightly: true,
  indexTitle: 'Index: how to get listed',
  // Order 30: member-facing copy, listed in docs/COPY.md.
  guidelines:
    "Who in the guild can craft what: one post per tradeskill, ranked by skill level. GuildCraft writes and updates these posts. To get listed, use /me to add a character, then /skills. To ask for a craft, use /request: it opens a private thread in GC-Craft Requests.",
};

export const FACTIONS: BoardKind = {
  name: 'factions',
  label: 'Factions',
  channel: 'faction_board_channel_id',
  indexThread: 'faction_index_thread_id',
  indexMessage: 'faction_index_message_id',
  indexHash: 'faction_index_hash',
  lock: 'faction_lock_until',
  rebuild: 'faction_rebuild_since',
  table: 'faction_post',
  key: 'faction_id',
  nightly: false,
  // Order 24: the factions board's pinned post (docs/COPY.md).
  indexTitle: 'Index: how to read this board',
  // Order 30: member-facing copy, listed in docs/COPY.md.
  guidelines:
    "Which creatures raise or lower each faction: one post per faction, from the Monsters and Memories Wiki. GuildCraft writes and updates these posts. A missing or wrong creature is fixed on the wiki. To ask for a craft, use /request: it opens a private thread in GC-Craft Requests.",
};

/** In the order a run serves them: the tradeskill board keeps priority on the shared call budget (order 24, ITEM 2). */
export const BOARDS: readonly BoardKind[] = [TRADESKILLS, FACTIONS];

export const boardNamed = (name: string): BoardKind | undefined => BOARDS.find((b) => b.name === name);

/** The factions that get a post: active, and named by at least one active link (SQL; the alias f is the faction). */
export const FACTION_SHOWN = 'f.active = 1 AND EXISTS (SELECT 1 FROM npc_faction l WHERE l.faction_id = f.id AND l.active = 1)';

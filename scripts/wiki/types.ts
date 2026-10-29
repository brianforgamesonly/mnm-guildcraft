// Order 28: the wiki snapshot's shape, as ITEM 1's job writes it (snapshot.json) and ITEM 2's parser reads it.

/** The categories the snapshot reads (ITEM 1) and the parser uses (ITEM 2). */
export const CATEGORIES = { npcs: 'Category:NPCs', quests: 'Category:Quests', zones: 'Category:Zones', named: 'Category:Named Mobs', raid: 'Category:Raid Encounters', merchant: 'Category:Merchant' } as const;
/** The trees read in full, every subcategory followed. */
export const TREES = [CATEGORIES.npcs, CATEGORIES.quests] as const;

export interface SnapshotPage {
  pageid: number;
  title: string;
  ns: number;
  revid: number;
  /** The revision's timestamp (ISO 8601). */
  timestamp: string;
  content: string;
}

export interface SnapshotCategory {
  /** Members in the main namespace, by title. */
  pages: string[];
  /** Subcategories, by title ("Category:…"). */
  subcats: string[];
  /** Steps below the root it was reached from (the root is 0); null for a category read on its own. */
  depth: number | null;
  /** The root it was reached from. */
  root: string | null;
}

export interface WikiSnapshot {
  /** "Monsters and Memories Wiki · MediaWiki 1.46.2", from siteinfo. */
  site: string;
  fetchedAt: string;
  /** The highest revid fetched, and its timestamp: the snapshot's version (import_source sha and changed_at). */
  version: { revid: number; timestamp: string };
  categories: Record<string, SnapshotCategory>;
  /** Every page whose content was fetched, by title. */
  pages: Record<string, SnapshotPage>;
  buckets: Record<string, { schema: string | null; fields: string[]; rows: Record<string, unknown>[] | null; error?: string }>;
  /** ITEM 3: main-namespace edits and creations in the 24 hours before the fetch. */
  recentChanges: { since: string; changes: { title: string; timestamp: string }[] };
  requests: { count: number; bytes: number; maxlagWaits: number; log: { shape: string; status: number | null; bytes: number; attempts: number }[] };
}

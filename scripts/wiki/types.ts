// Order 28: the wiki snapshot's shape, as ITEM 1's job writes it (snapshot.json) and ITEM 2's parser reads it.

/** The categories the snapshot reads (ITEM 1) and the parser uses (ITEM 2). */
export const CATEGORIES = { npcs: 'Category:NPCs', quests: 'Category:Quests', zones: 'Category:Zones', named: 'Category:Named Mobs', raid: 'Category:Raid Encounters', merchant: 'Category:Merchant' } as const;
/** Every category is read as a tree, every subcategory followed; the content of these trees' pages is fetched. */
export const TREES = [CATEGORIES.npcs, CATEGORIES.quests, CATEGORIES.zones] as const;
/** Read for membership only (titles; no page content). */
export const MEMBERSHIP = [CATEGORIES.named, CATEGORIES.raid, CATEGORIES.merchant] as const;
/** A category tree's pages: the root's and those of every category reached from it. */
export const treePages = (snap: Pick<WikiSnapshot, 'categories'>, root: string): Set<string> =>
  new Set(Object.values(snap.categories).filter((c) => c.roots.includes(root)).flatMap((c) => c.pages));

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
  /** Steps below the root it was first reached from (that root is 0). */
  depth: number;
  /** Every root it is reached from (a category under two roots counts for both). */
  roots: string[];
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

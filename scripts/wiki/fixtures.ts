// Order 28b, ITEM 3: the parser's fixtures, cut from a real snapshot artifact (ITEM 1's job), never from the live wiki.
//   node scripts/wiki/fixtures.ts --snapshot <artifact dir> --out test/fixtures/wiki-pages.json --run <wiki-snapshot run id>
// The fixture is a small snapshot: FIXTURE_PAGES as fetched (revid and timestamp kept, so each page's history on the wiki
// names its authors), and every category that lists one of them, its list cut to them. CC BY-SA 4.0: the credit travels
// in the file itself.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { WikiSnapshot } from './types.ts';

/** The pages the order names (ITEM 3), each standing for one case the parser must hold. */
export const FIXTURE_PAGES = [
  'A bandit', // one page, several blocks, several zones
  'A myconid prince', // named, through a subcategory of Named Mobs
  'Rothold', // a zone page ({{ZoneDetails}})
  'A blacksmith', // a merchant
  'Weakened Red Dragon', // a raid encounter
  'Mining Picks for Hull', // a quest with a "Faction…" reward line
  'A bag merchant', // several zones in one block: "[[Faelindral]], [[Night Harbor]]"
  'A stablemaster', // " or ": "[[Keeper's Bight]] or [[Night Harbor]]"
  'A golbin shore reaver', // name typo: name field "a goblin shore reaver"
] as const;

export const CREDIT =
  'Page text from the Monsters and Memories Wiki (https://monstersandmemories.miraheze.org), written by its contributors and licensed under CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/). Each page\'s history on the wiki lists its authors; each page here keeps the revision it was taken from.';

export type WikiFixture = WikiSnapshot & { credit: string; from: string };

export function cutFixture(snap: WikiSnapshot, from: string): WikiFixture {
  const want = new Set<string>(FIXTURE_PAGES);
  const missing = FIXTURE_PAGES.filter((t) => !snap.pages[t]);
  if (missing.length) throw new Error(`not in the snapshot: ${missing.join(', ')}`);
  const pages = Object.fromEntries(FIXTURE_PAGES.map((t) => [t, snap.pages[t]]));
  const categories = Object.fromEntries(
    Object.entries(snap.categories)
      .map(([name, c]) => [name, { ...c, pages: c.pages.filter((p) => want.has(p)) }] as const)
      .filter(([, c]) => c.pages.length),
  );
  const top = Object.values(pages).reduce((a, p) => (p.revid > a.revid ? p : a));
  return {
    credit: CREDIT,
    from,
    site: snap.site,
    fetchedAt: snap.fetchedAt,
    version: { revid: top.revid, timestamp: top.timestamp },
    categories,
    pages,
    buckets: {},
    recentChanges: { since: snap.recentChanges.since, changes: [] },
    requests: { count: 0, bytes: 0, maxlagWaits: 0, log: [] },
  };
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { snapshot: { type: 'string' }, out: { type: 'string' }, run: { type: 'string' } } });
  if (!args.snapshot || !args.out || !/^\d+$/.test(args.run ?? '')) throw new Error('--snapshot, --out and --run <the wiki-snapshot run id> are required');
  const snap = JSON.parse(readFileSync(join(args.snapshot, 'snapshot.json'), 'utf8')) as WikiSnapshot;
  writeFileSync(args.out, JSON.stringify(cutFixture(snap, `wiki-snapshot run ${args.run}`), null, 2) + '\n');
  console.log(`${FIXTURE_PAGES.length} pages written to ${args.out}`);
}

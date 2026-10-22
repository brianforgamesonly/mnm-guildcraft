// Order 17b, ITEM 3: the zone card's site links (src/zone/sites.json, derived by scripts/zone/sites.ts).
//   - Every link has its site's page shape; none is an index (the Zone connections button is the index), none is Miraheze.
//   - A zone the file holds keeps every link it held on the base branch (ZONE_SITES_BASE, default origin/main): a link that
//     disappears fails CI, and the owner decides. The zones are the file's own, written from the database's active zones.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lostLinks, SITE_KEYS, SITES_FILE, storiesIndex, storiesName, wikiSlug, type SitesFile } from '../zone/sites.ts';

const head = JSON.parse(readFileSync(SITES_FILE, 'utf8')) as SitesFile;
const SHAPES = { mnmWiki: /^https:\/\/monstersandmemories\.wiki\/zones\/[a-z0-9-]+$/, stories: /^https:\/\/storiesofmnm\.com\/zone\/[a-z0-9-]+\/$/ } as const;

test('every zone has an entry for each site, and each link has its site\'s page shape', () => {
  assert.ok(Object.keys(head.zones).length > 0, 'the file holds no zones');
  for (const [key, z] of Object.entries(head.zones)) {
    assert.equal(typeof z.name, 'string', key);
    for (const s of SITE_KEYS) {
      assert.ok(s in z, `${key}: no ${s} entry`);
      if (z[s] !== null) assert.match(z[s]!, SHAPES[s], `${key}: ${s}`);
    }
  }
  assert.doesNotMatch(readFileSync(SITES_FILE, 'utf8'), /miraheze/i);
});

test('a link held on the base branch is still held for every zone the file still holds', () => {
  const ref = process.env.ZONE_SITES_BASE || 'origin/main';
  let base: SitesFile;
  try {
    base = JSON.parse(execFileSync('git', ['show', `${ref}:src/zone/sites.json`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })) as SitesFile;
  } catch (e) {
    // Only the first pull request that adds the file has no base copy; any other failure (no such ref) fails.
    const message = String((e as { stderr?: string }).stderr ?? e);
    if (/exists on disk, but not in|does not exist in/.test(message)) return;
    throw e;
  }
  assert.deepEqual(lostLinks(base, head), []);
});

test('the comparison names a lost link, and ignores a zone gone from the database', () => {
  const entry = (mnmWiki: string | null, stories: string | null) => ({ name: 'Rothold', mnmWiki, stories });
  const file = (zones: SitesFile['zones']): SitesFile => ({ about: '', checkedAt: '', zones });
  const before = file({ rothold: entry('https://monstersandmemories.wiki/zones/rothold', 'https://storiesofmnm.com/zone/rothold/') });
  assert.deepEqual(lostLinks(before, file({ rothold: entry('https://monstersandmemories.wiki/zones/rothold', null) })), ['Rothold: stories https://storiesofmnm.com/zone/rothold/']);
  assert.deepEqual(lostLinks(before, file({})), []);
  assert.deepEqual(lostLinks(file({ rothold: entry(null, null) }), file({ rothold: entry('https://monstersandmemories.wiki/zones/rothold', null) })), []);
});

test('slugs and the Stories of MnM index', () => {
  assert.equal(wikiSlug("Keeper's Bight"), 'keepers-bight');
  assert.equal(wikiSlug('Ail’Vorith'), 'ailvorith');
  assert.equal(wikiSlug('Tomb of the Last Wyrmsbane'), 'tomb-of-the-last-wyrmsbane');
  assert.equal(storiesName('Keeper’s Bight'), storiesName("keeper's bight"));
  const html =
    '<a href="https://storiesofmnm.com/zone/keepers-bight/">Keeper&#8217;s Bight</a> <a href="/zone/ailvorith-zone-info-and-map/"><span>Ail&#039;Vorith</span></a>' +
    '<a href="https://storiesofmnm.com/zones/">Zones</a> <a href="https://storiesofmnm.com/zone/fallen-pass/">Fallen Pass</a>';
  assert.deepEqual([...storiesIndex(html)], [
    ["keeper's bight", 'https://storiesofmnm.com/zone/keepers-bight/'],
    ["ail'vorith", 'https://storiesofmnm.com/zone/ailvorith-zone-info-and-map/'],
    ['fallen pass', 'https://storiesofmnm.com/zone/fallen-pass/'],
  ]);
});

// Order 28: the relay's allow-list and its 403s, the snapshot client's polite-guest rules, the snapshot walk, the parser
// and the zone plan built from a snapshot. Every wiki here is a stand-in: nothing contacts the wiki.
//   node --test scripts/wiki/wiki.test.ts
// The synthetic page text below imitates the wiki's templates as the order describes them; the fixtures taken from a
// real snapshot artifact come with it (order 28, ITEM 2).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allowed } from './allowed.ts';
import { parseSnapshot, plain, templates, bullets, links, questRewards } from './parse.ts';
import { Relay, REQUEST_CAP, SnapshotStop, takeSnapshot, type Getter } from './snapshot.ts';
import { CATEGORIES, type WikiSnapshot } from './types.ts';
import { USER_AGENT } from '../probe/wiki.ts';
import { buildZonePlan, wikiVersion } from '../import/zones.ts';
import { zoneInput } from '../../test/fixtures/zones-small.ts';
import { compare, markdown } from './compare.ts';
import { checkStructure } from '../import/core.ts';
import { readFileSync } from 'node:fs';

const q = (s: string) => new URLSearchParams(s);

// ---------------------------------------------------------------- the allow-list

test('allowed: each of ITEM 1’s requests passes, and the relay adds format, formatversion and maxlag=5', () => {
  const ok = [
    'action=query&meta=siteinfo',
    'action=query&list=categorymembers&cmtitle=Category:NPCs&cmtype=page|subcat&cmnamespace=0|14&cmprop=title&cmlimit=500&cmcontinue=page|x|1&continue=-||',
    'action=query&generator=categorymembers&gcmtitle=Category:Named Mobs&gcmnamespace=0&gcmlimit=50&prop=revisions&rvprop=ids|timestamp|content&rvslots=main&gcmcontinue=a&continue=gcmcontinue||',
    'action=query&prop=revisions&titles=Bucket:Quests|Bucket:Factions&rvprop=ids|timestamp|content&rvslots=main',
    'action=query&list=recentchanges&rcend=2026-10-28T00:00:00Z&rcnamespace=0&rctype=edit|new&rcprop=title|timestamp&rclimit=500',
    "action=bucket&query=bucket('quests').select('page_name','rewards').limit(5000).offset(0).run()",
    'action=query&meta=siteinfo&format=json&formatversion=2&maxlag=5',
  ];
  for (const s of ok) {
    const v = allowed(q(s));
    assert.equal(v.ok, true, s);
    if (v.ok) {
      const sent = q(v.query);
      assert.equal(sent.get('maxlag'), '5');
      assert.equal(sent.get('format'), 'json');
      assert.equal(sent.get('formatversion'), '2');
    }
  }
});

test('allowed: everything else is refused', () => {
  const refused = [
    '',
    'action=edit&title=X&text=y',
    'action=parse&page=Rothold&prop=wikitext',
    'action=query&prop=revisions&titles=Rothold&rvprop=content&rvslots=main',
    'action=query&prop=revisions&titles=Bucket:Quests|Main Page&rvprop=content&rvslots=main',
    'action=query&list=allpages',
    'action=query&meta=userinfo',
    'action=query&meta=siteinfo&maxlag=0',
    'action=query&meta=siteinfo&format=xml',
    'action=query&meta=siteinfo&meta=siteinfo',
    'action=query&list=categorymembers&cmtitle=Rothold',
    'action=query&generator=categorymembers&gcmtitle=Category:NPCs&prop=revisions&rvprop=ids&rvslots=main',
    'action=query&generator=categorymembers&gcmtitle=Category:NPCs&prop=revisions|imageinfo&rvprop=content&rvslots=main',
    "action=bucket&query=bucket('items').select('name').run()",
    "action=bucket&query=bucket('quests').select('*').run()",
    "action=bucket&query=bucket('quests').where('a','b').run()",
    "action=bucket&query=bucket('quests').select('a') os.exit() .run()",
    'action=query&list=recentchanges&rcuser=Someone',
  ];
  for (const s of refused) assert.equal(allowed(q(s)).ok, false, s);
});

// ---------------------------------------------------------------- the relay Worker

test('relay: one wiki request per allowed call, unparsed, with the named User-Agent; everything else 403 without a request', async () => {
  const token = 'x'.repeat(40);
  (globalThis as Record<string, unknown>).RELAY_TOKEN = token;
  const calls: { url: string; ua: string | null }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), ua: new Headers(init?.headers).get('User-Agent') });
    return new Response('{"from":"wiki"}', { status: 418 });
  }) as typeof fetch;
  try {
    const { default: relay } = await import('./relay.ts');
    const call = (path: string, init: RequestInit = {}) => relay.fetch(new Request(`https://relay.example${path}`, { headers: { 'x-relay-token': token }, ...init }));
    for (const [path, init] of [
      ['/api?action=query&meta=siteinfo', { method: 'POST' }],
      ['/other?action=query&meta=siteinfo', {}],
      ['/api?action=query&meta=siteinfo', { headers: { 'x-relay-token': 'y'.repeat(40) } }],
      ['/api?action=query&meta=siteinfo', { headers: {} }],
      ['/api?action=parse&page=Rothold&prop=wikitext', {}],
      ['/api?action=query&list=allusers', {}],
    ] as [string, RequestInit][]) {
      const res = await call(path, init);
      assert.equal(res.status, 403, path);
    }
    assert.equal(calls.length, 0, 'a refused call contacts nothing');
    const res = await call('/api?action=query&meta=siteinfo');
    assert.equal(res.status, 418, 'the wiki’s answer comes back as it is');
    assert.equal(await res.text(), '{"from":"wiki"}');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/monstersandmemories\.miraheze\.org\/w\/api\.php\?/);
    assert.equal(new URL(calls[0].url).searchParams.get('maxlag'), '5');
    assert.equal(calls[0].ua, USER_AGENT);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------- the client's rules

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  ({ attempts: 1, res: new Response(null, { status, headers }), bytes: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)) }) as const;

test('client: a maxlag answer is waited out for its Retry-After, at most 3 times, each attempt counted', async () => {
  const waits: number[] = [];
  let n = 0;
  const lagged: Getter = async () => (n++, answer(200, { error: { code: 'maxlag', info: 'lagged' } }, { 'retry-after': '2' }));
  const relay = new Relay('https://r', 't', lagged, async (ms) => void waits.push(ms));
  await assert.rejects(relay.call('siteinfo', { action: 'query', meta: 'siteinfo' }), SnapshotStop);
  assert.deepEqual(waits, [2000, 2000, 2000]);
  assert.equal(relay.count, 4);
  n = 0;
  const once: Getter = async () => (n++ === 0 ? answer(200, { error: { code: 'maxlag' } }, { 'retry-after': '1' }) : answer(200, { ok: 1 }));
  const r2 = new Relay('https://r', 't', once, async () => {});
  assert.deepEqual(await r2.call('siteinfo', {}), { ok: 1 });
  assert.equal(r2.count, 2);
});

test('client: a 403, a 429 or a challenge stops the run at once, never retried', async () => {
  for (const [status, headers] of [[403, {}], [429, { 'retry-after': '1' }], [503, { 'cf-mitigated': 'challenge' }]] as [number, Record<string, string>][]) {
    let n = 0;
    const relay = new Relay('https://r', 't', async () => (n++, answer(status, 'Checking your connection', headers)), async () => {});
    await assert.rejects(relay.call('siteinfo', {}), (e: Error) => e instanceof SnapshotStop && /refused/.test(e.message));
    assert.equal(n, 1);
  }
});

test('client: the request cap stops the run; the network retry is refused when it would pass the cap', async () => {
  const relay = new Relay('https://r', 't', async () => answer(200, { ok: 1 }), async () => {}, 3);
  for (let i = 0; i < 3; i++) await relay.call('siteinfo', {});
  await assert.rejects(relay.call('siteinfo', {}), /request cap/);
  assert.equal(relay.count, 3);
  let asked: boolean | undefined;
  const last = new Relay('https://r', 't', async (_u, o) => ((asked = o.mayRetry?.()), { attempts: 1, error: 'TypeError: fetch failed' }), async () => {}, 1);
  await assert.rejects(last.call('siteinfo', {}), /no answer/);
  assert.equal(asked, false);
  assert.equal(REQUEST_CAP, 150);
});

// ---------------------------------------------------------------- the snapshot walk, on a stand-in wiki

const BANDIT = `{{Namedmobpage
|name = a bandit
|zone = [[Shaded Dunes]]
|level = 10-12
|known_loot =
* [[Rusty Dagger]]&lt;/li&gt;
* [[Bandit Mask|a bandit mask]]
* {{Item|Rusty Sword}}
|common_loot =
* [[Rusty Dagger]]
|factions = [[Vermahn's Brood]]
|opposing_factions = [[Guards of Rothold]]
}}
{{Namedmobpage
|name = a bandit
|zone = Scarwood
|level = 12
}}
{{Namedmobpage
|name = a bandit
|zone = [[Rothold#Inn|the city of Rothold]]
}}`;
const PRINCE = `{{Namedmobpage
|zone = [[Glinting_Hollow]]
|level = 25<ref name="p">patch notes</ref><ref name="q" />
|location = Deep in the caves, {{Coords|1|2}}
}}`;
const DRAGON = `{{Namedmobpage
|name = Weakened Red Dragon
|zone =
}}`;
const MERCHANT = `{{Merchantpage
|zone = Rothold
|race = Human
}}`;
const ZONE = (level: string, adj: string) => `[[File:Some map.png]]\n{{ZoneDetails\n|Level = ${level}\n|AdjacentZones = ${adj}\n|NotableNPC = [[x]]\n}}`;
const QUEST = `{{Quest\n|Start zone = Rothold\n}}\n== Walkthrough ==\n* not a reward\n== Rewards ==\n* Faction with [[Guards of Rothold]] increased\n* 50 copper\n`;

function standIn(): { pages: Record<string, string>; cats: Record<string, string[]> } {
  return {
    pages: {
      'A bandit': BANDIT,
      'A myconid prince': PRINCE,
      'Weakened Red Dragon': DRAGON,
      'Supplier Jul': MERCHANT,
      'A rat': '{{Mobpage\n|zone = [[Shaded Dunes]]\n}}',
      'Shaded Dunes': ZONE('-10-20', '[[Scarwood]], [[Rothold]]'),
      Scarwood: ZONE('15-25', '[[Shaded Dunes]]'),
      Rothold: ZONE('1-5', '[[Shaded Dunes]]'),
      'Glinting Hollow': ZONE('-20-30', ''),
      'Starting City by Race, Class, and Deity': 'A table, no template.',
      'Guard Duty': QUEST,
    },
    cats: {
      'Category:NPCs': ['A bandit', 'Supplier Jul', 'Category:Named Mobs', 'Category:Mobs', 'Category:Shared'],
      'Category:Named Mobs': ['A bandit', 'Category:Named in Glinting Hollow', 'Category:Raid Encounters'],
      'Category:Named in Glinting Hollow': ['A myconid prince'],
      'Category:Raid Encounters': ['Weakened Red Dragon'],
      'Category:Mobs': ['A rat', 'A bandit'],
      'Category:Merchant': ['Supplier Jul'],
      'Category:Zones': ['Shaded Dunes', 'Scarwood', 'Rothold', 'Starting City by Race, Class, and Deity', 'Category:Dungeons'],
      'Category:Dungeons': ['Glinting Hollow'],
      'Category:Quests': ['Category:Class Quests'],
      'Category:Class Quests': ['Category:Shared'],
      // Under both trees: its pages count for both.
      'Category:Shared': ['Guard Duty'],
    },
  };
}

/** A stand-in for the relay and the wiki behind it: answers the allowed shapes from memory, one member per page of results. */
function fakeWiki(w = standIn()): { get: Getter; urls: string[] } {
  const urls: string[] = [];
  const revid = (t: string) => 1000 + Object.keys(w.pages).indexOf(t);
  const get: Getter = async (url) => {
    urls.push(url);
    const p = new URL(url).searchParams;
    const v = allowed(p);
    assert.equal(v.ok, true, `the client sent a request the relay refuses: ${url}`);
    const page = (t: string) => ({ pageid: revid(t), ns: 0, title: t, revisions: [{ revid: revid(t), timestamp: `2026-10-2${revid(t) % 9}T00:00:00Z`, slots: { main: { content: w.pages[t] } } }] });
    let body: unknown;
    if (p.get('meta') === 'siteinfo') body = { query: { general: { sitename: 'Monsters and Memories Wiki', generator: 'MediaWiki 1.46.2' } } };
    else if (p.get('list') === 'categorymembers') {
      const all = w.cats[p.get('cmtitle')!] ?? [];
      const at = Number(p.get('cmcontinue') ?? 0);
      const slice = all.slice(at, at + 2); // two per answer: continuation is exercised
      body = { query: { categorymembers: slice.map((t) => ({ ns: t.startsWith('Category:') ? 14 : 0, title: t })) }, ...(at + 2 < all.length ? { continue: { cmcontinue: String(at + 2), continue: '-||' } } : {}) };
    } else if (p.get('generator') === 'categorymembers') {
      const all = (w.cats[p.get('gcmtitle')!] ?? []).filter((t) => !t.startsWith('Category:'));
      const at = Number(p.get('gcmcontinue') ?? 0);
      const slice = all.slice(at, at + 2);
      body = { query: { pages: slice.map(page) }, ...(at + 2 < all.length ? { continue: { gcmcontinue: String(at + 2), continue: 'gcmcontinue||' } } : {}) };
    } else if (p.get('titles')) body = { query: { pages: [{ ns: 9000, title: 'Bucket:Quests', pageid: 1, revisions: [{ revid: 5, timestamp: '2026-01-01T00:00:00Z', slots: { main: { content: '{"rewards":{"type":"TEXT","repeated":true},"page_name":{"type":"PAGE"}}' } } }] }, { ns: 9000, title: 'Bucket:Factions', missing: true }] } };
    else if (p.get('action') === 'bucket') body = { bucketQuery: p.get('query'), bucket: [{ page_name: 'Guard Duty', rewards: ['Faction with Guards of Rothold increased'] }] };
    else if (p.get('list') === 'recentchanges') body = { query: { recentchanges: [{ title: 'A bandit', timestamp: '2026-10-29T01:00:00Z' }] } };
    else assert.fail(`unexpected ${url}`);
    return answer(200, body);
  };
  return { get, urls };
}

async function snapshot(): Promise<{ snap: WikiSnapshot; urls: string[] }> {
  const { get, urls } = fakeWiki();
  const relay = new Relay('https://relay.example', 't'.repeat(40), get, async () => {});
  return { snap: await takeSnapshot(relay, new Date('2026-10-29T12:00:00Z')), urls };
}

test('snapshot: the trees are walked to the bottom, every page fetched once, buckets read after their schema', async () => {
  const { snap, urls } = await snapshot();
  assert.equal(snap.site, 'Monsters and Memories Wiki · MediaWiki 1.46.2');
  assert.equal(snap.categories['Category:Raid Encounters'].depth, 2, 'NPCs → Named Mobs → Raid Encounters');
  assert.deepEqual(snap.categories['Category:Shared'].roots, [CATEGORIES.npcs, CATEGORIES.quests]);
  assert.ok(snap.categories['Category:Named in Glinting Hollow'].roots.includes(CATEGORIES.named));
  assert.ok(snap.categories['Category:Dungeons'].roots.includes(CATEGORIES.zones));
  // A membership category outside the content trees (here Merchant) is read as titles only: no content request for it.
  assert.ok(urls.every((u) => new URL(u).searchParams.get('gcmtitle') !== CATEGORIES.merchant));
  assert.equal(urls.filter((u) => new URL(u).searchParams.get('cmtitle') === 'Category:Shared').length, 1, 'listed once, though under two trees');
  assert.deepEqual(Object.keys(snap.pages).sort(), Object.keys(standIn().pages).sort());
  assert.equal(snap.requests.count, urls.length);
  assert.ok(urls.every((u) => u.startsWith('https://relay.example/api?')));
  // Category:Mobs's pages: A bandit is fetched with Category:NPCs; A rat needs Category:Mobs's content once.
  assert.equal(urls.filter((u) => new URL(u).searchParams.get('gcmtitle') === 'Category:Mobs').length, 1);
  assert.deepEqual(snap.buckets.quests.fields, ['rewards', 'page_name']);
  assert.equal(snap.buckets.quests.rows?.length, 1);
  assert.equal(snap.buckets.factions.rows, null);
  assert.equal(snap.recentChanges.changes.length, 1);
  assert.equal(snap.recentChanges.since, '2026-10-28T12:00:00Z');
  const max = Math.max(...Object.values(snap.pages).map((p) => p.revid));
  assert.equal(snap.version.revid, max);
  assert.deepEqual(wikiVersion(snap), { name: 'wiki/snapshot', sha: String(max), changedAt: snap.version.timestamp });
});

// ---------------------------------------------------------------- the parser

test('parse: link markup, entities, tags and quotes are removed; labels kept; bullets and links read', () => {
  assert.equal(plain("[[Rothold|the city]] &amp; [[Scarwood]]&lt;/li&gt; '''bold'''"), 'the city & Scarwood bold');
  assert.equal(plain('10<ref>patch notes</ref> &lt;ref name="x"/&gt;'), '10', 'a reference is removed whole, encoded or not');
  assert.equal(plain('[[Rothold_Keep#Inn|the keep]] and [[:Scarwood]]', { target: true }), 'Rothold Keep and Scarwood', 'a link target as a page title');
  assert.deepEqual(links('[[A]], [[B|b]] and [[C|]]'), ['A', 'b', 'C']);
  assert.deepEqual(bullets('intro\n* [[X]]&lt;/li&gt;\n** Y\nnot\n*'), ['X', 'Y']);
  const blocks = templates(BANDIT + '\n{{Namedmobpages|zone=no}}', 'Namedmobpage');
  assert.equal(blocks.length, 3, 'one block per zone; a longer template name is not this one');
  assert.equal(templates(PRINCE, 'Namedmobpage')[0].location, 'Deep in the caves, {{Coords|1|2}}', 'a nested template stays inside its value');
  assert.deepEqual(questRewards(QUEST), ['Faction with Guards of Rothold increased', '50 copper']);
});

test('parse: one row per block, name else title, flags and merchant from categories, no-zone blocks counted', async () => {
  const { snap } = await snapshot();
  const p = parseSnapshot(snap);
  const bandit = p.npcs.filter((n) => n.page === 'A bandit');
  assert.deepEqual(bandit.map((n) => n.zone), ['Shaded Dunes', 'Scarwood', 'Rothold'], 'a piped zone link names its page');
  assert.ok(bandit.every((n) => n.name === 'a bandit' && n.named === 1 && n.raid === 0));
  assert.deepEqual(bandit[0].loot, ['Rusty Dagger', 'a bandit mask'], 'known_loot then common_loot, de-duplicated, stray </li> gone');
  assert.deepEqual(bandit[0].factions, ["Vermahn's Brood"]);
  assert.deepEqual(bandit[1].loot, []);
  assert.equal(bandit[1].level, '12');
  const prince = p.npcs.find((n) => n.page === 'A myconid prince')!;
  assert.equal(prince.name, 'A myconid prince', 'no name field: the page title');
  assert.equal(prince.zone, 'Glinting Hollow');
  assert.equal(prince.level, '25', 'references removed');
  assert.equal(prince.location, null, 'a value holding a template is not read');
  assert.equal(prince.named, 1, 'named through a subcategory of Named Mobs');
  assert.deepEqual(p.summary.templateValues, [
    { page: 'A bandit', field: 'known_loot' },
    { page: 'A myconid prince', field: 'location' },
  ]);
  const dragon = p.npcs.find((n) => n.page === 'Weakened Red Dragon')!;
  assert.equal(dragon.zone, null);
  assert.equal(dragon.raid, 1);
  assert.deepEqual(p.summary.blocksWithoutZone, [{ page: 'Weakened Red Dragon', name: 'Weakened Red Dragon' }]);
  const jul = p.npcs.find((n) => n.page === 'Supplier Jul')!;
  assert.equal(jul.kind, 'merchant');
  assert.equal(jul.race, 'Human');
  assert.equal(p.npcs.find((n) => n.page === 'A rat')!.named, 0);
  assert.deepEqual(p.summary.npcBlocks, { Namedmobpage: 5, Mobpage: 1, NPCpage: 0, Merchantpage: 1 });
  assert.equal(p.summary.npcTree.depth, 2);
  assert.deepEqual(p.summary.named.outsideTree, []);
  assert.ok(p.zones.some((z) => z.name === 'Glinting Hollow'), 'a zone in a subcategory of Category:Zones');
  assert.deepEqual(p.summary.npcPagesWithoutTemplate, ['Guard Duty']);
  const dunes = p.zones.find((z) => z.name === 'Shaded Dunes')!;
  assert.equal(dunes.level, '10-20', 'the leading "-" removed');
  assert.deepEqual(dunes.adjacent, ['Scarwood', 'Rothold']);
  assert.equal(dunes.url, 'https://monstersandmemories.miraheze.org/wiki/Shaded_Dunes');
  assert.deepEqual(p.summary.zonePagesWithoutTemplate, ['Starting City by Race, Class, and Deity']);
  assert.deepEqual(p.quests.map((x) => [x.title, x.rewards.length]), [['Guard Duty', 2]]);
});

test('zone plan from the snapshot: wiki:zones names the zones, one npc row per block’s zone, flags stored, no-zone block unlisted', async () => {
  const { snap } = await snapshot();
  const input = zoneInput();
  input.wiki = snap;
  input.versions = [...input.versions, wikiVersion(snap)];
  const plan = buildZonePlan(input, [], [], '2026-10-29T12:00:00Z');
  const scarwood = plan.zones.find((z) => z.key === 'scarwood')!;
  assert.equal(scarwood.name, 'Scarwood');
  assert.equal(scarwood.description, null);
  assert.equal(scarwood.wiki_url, 'https://monstersandmemories.miraheze.org/wiki/Scarwood');
  const rows = plan.npcs.filter((n) => n.name === 'a bandit').map((n) => n.zone_key).sort();
  assert.deepEqual(rows, ['rothold', 'scarwood', 'shaded dunes'], 'one row per block’s zone');
  // A block whose zone text maps to no zone is stored unmatched and reported (override 6).
  const odd = zoneInput();
  odd.wiki = structuredClone(snap);
  odd.wiki.pages['A rat'].content = '{{Mobpage\n|zone = Nowhere Land\n}}';
  const oddPlan = buildZonePlan(odd, [], [], '2026-10-29T12:00:00Z');
  assert.ok(oddPlan.names.some((n) => n.source === 'wiki:npcs' && n.name === 'Nowhere Land' && n.zone_key === null));
  assert.ok(oddPlan.warnings.some((w) => w.kind === 'zone_names_unmatched' && w.source === 'wiki:npcs'));
  assert.ok(plan.npcs.every((n) => n.name !== 'Weakened Red Dragon'));
  const prince = plan.npcs.find((n) => n.name === 'A myconid prince')!;
  assert.deepEqual([prince.zone_key, prince.named, prince.raid], ['glinting hollow', 1, 0]);
  assert.ok(plan.names.every((n) => !n.source.startsWith('mo-betta:')), 'Mo Betta is not read when the snapshot is given');
  assert.ok(plan.factionLinks.some((l) => l.npc_name === 'a bandit' && l.faction === "Vermahn's Brood" && l.zone_key === 'shaded dunes'));
  assert.deepEqual(plan.questLines.map((l) => [l.faction, l.quest]), [['Guards of Rothold', 'Guard Duty']]);
});

test('compare: both plans from the import code; the gate lists what is missing, and line 6 waits for the owner', async () => {
  const { snap } = await snapshot();
  const wiki = checkStructure(JSON.parse(readFileSync(new URL('../../test/fixtures/wiki-small.json', import.meta.url), 'utf8')));
  const c = compare(snap, zoneInput(), wiki, '2026-10-29T12:00:00Z');
  assert.deepEqual(c.gate.map((g) => g.line), [1, 2, 3, 4, 6]);
  assert.equal(c.gate.find((g) => g.line === 6)!.pass, false);
  // The stand-in wiki has none of Mo Betta's fixture NPCs: each missing one is listed with a reason.
  assert.ok(c.npcs.missing.length > 0);
  assert.ok(c.npcs.missing.every((m) => m.why.length > 0));
  assert.equal(c.npcs.multiZone.names, 1, 'a bandit');
  assert.ok(c.tags.some((t) => t.zone === 'Glinting Hollow' && t.named === 1));
  assert.equal(c.recentChanges.zoneData, 1);
  assert.match(markdown(c), /### The gate/);
});

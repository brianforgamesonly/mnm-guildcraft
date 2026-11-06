// Order 37, PR B (ITEM 4): the monthly quest-page check's rules (scripts/gear/quest-sites.ts), with a fake site.
//   node --test scripts/gear/quest-sites.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, COUNT_GAP_DAYS, questUrl, robotsAllows, upsertSql, type Answer, type CopyRows, type Row } from './quest-sites.ts';

const NOW = '2026-12-01T09:23:00.000Z';
const daysBefore = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString();
const ROBOTS_OK = 'User-agent: *\nDisallow: /admin\nDisallow: /private-data/\n';

/** A site answering by path: robots.txt, the control (any guildcraft-no-such-quest path) and each quest page. */
function site(pages: Record<string, number | Answer>, robots: number | string = ROBOTS_OK, control = 404) {
  const asked: string[] = [];
  const get = async (url: string): Promise<Answer> => {
    asked.push(url);
    const path = new URL(url).pathname;
    if (path === '/robots.txt') return typeof robots === 'number' ? { status: robots, finalUrl: url } : { status: 200, finalUrl: url, text: robots };
    if (path.includes('guildcraft-no-such-quest')) return { status: control, finalUrl: url };
    const a = pages[path] ?? 404;
    return typeof a === 'number' ? { status: a, finalUrl: url } : a;
  };
  return { asked, io: { get, sleep: async () => {} } };
}
const path = (q: string) => new URL(questUrl(q)).pathname;
const row = (quest: string, o: Partial<Row> = {}): Row => ({ quest, url: questUrl(quest), linked: 1, last_result: '200', counted_at: null, fails: 0, ...o });
const copy = (rows: Row[], name = 'dev'): CopyRows => ({ name, rows: new Map(rows.map((r) => [r.quest, r])) });

test('the control does not answer 404: stop, nothing changes', async () => {
  const s = site({ [path('A Sweet Treat')]: 200 }, ROBOTS_OK, 200);
  const o = await check(s.io, ['A Sweet Treat'], [copy([])], NOW, true);
  assert.match(o.stop!, /control/);
  assert.equal(o.copies[0].writes.length, 0);
  assert.equal(s.asked.length, 2); // robots.txt and the control; no quest asked
});

test('robots.txt disallows the quest pages: stop, nothing changes; a 404 robots.txt is allowed; a 5xx or no answer stops', async () => {
  for (const robots of ['User-agent: *\nDisallow: /quests/\n', 'User-agent: GuildCraft\nDisallow: /\n', 'User-agent: *\nDisallow: /q\n', 'User-agent: *\nDisallow: /quests/a-s\n', 'User-agent: *\nDisallow: /quests/*-treat$\n']) {
    const o = await check(site({}, robots).io, ['A Sweet Treat'], [copy([])], NOW, true);
    assert.match(o.stop!, /robots\.txt disallows/, robots);
    assert.equal(o.copies[0].writes.length, 0);
  }
  assert.equal((await check(site({ [path('A Sweet Treat')]: 200 }, 404).io, ['A Sweet Treat'], [copy([])], NOW, true)).stop, undefined);
  assert.match((await check(site({}, 503).io, ['A Sweet Treat'], [copy([])], NOW, true)).stop!, /503/);
  const none = { io: { get: async (u: string) => (u.endsWith('robots.txt') ? { status: null, finalUrl: null, error: 'timeout' } : { status: 404, finalUrl: u }), sleep: async () => {} } };
  assert.match((await check(none.io, ['A Sweet Treat'], [copy([])], NOW, true)).stop!, /no answer/);
  // The GuildCraft group, when there is one, decides over "*"; Allow wins a tie on length.
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: GuildCraft\nAllow: /\n', '/quests/x'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /quests/\nAllow: /quests/\n', '/quests/x'), true);
});

test('one counted 404: the link is kept, the counter is 1; the second counted 404 removes it', async () => {
  const s = site({});
  const first = await check(s.io, ['Left Behind'], [copy([row('Left Behind')])], NOW, true);
  assert.deepEqual(first.copies[0].writes, [row('Left Behind', { last_result: '404', counted_at: NOW, fails: 1 })]);
  assert.deepEqual(first.copies[0].removed, []);
  const later = new Date(Date.parse(NOW) + COUNT_GAP_DAYS * 86_400_000).toISOString();
  const second = await check(s.io, ['Left Behind'], [copy([row('Left Behind', { last_result: '404', counted_at: NOW, fails: 1 })])], later, true);
  assert.deepEqual(second.copies[0].writes, [row('Left Behind', { linked: 0, last_result: '404', counted_at: later, fails: 2 })]);
  assert.deepEqual(second.copies[0].removed, ['Left Behind']);
});

test('a check within 25 days of the last counted one, and any dispatch, changes no counter: the 404 is reported only', async () => {
  const held = row('Left Behind', { last_result: '404', counted_at: daysBefore(COUNT_GAP_DAYS - 1), fails: 1 });
  const soon = await check(site({}).io, ['Left Behind'], [copy([held])], NOW, true);
  assert.deepEqual(soon.copies[0].writes, []);
  assert.deepEqual(soon.uncounted404, ['Left Behind']);
  const dispatched = await check(site({}).io, ['Left Behind'], [copy([row('Left Behind', { fails: 1, counted_at: daysBefore(40) })])], NOW, false);
  assert.deepEqual(dispatched.copies[0].writes, []);
  assert.equal(dispatched.copies[0].counted, 0);
});

test('a removed link whose page answers 200 again is added back (a dispatch too); a new quest gets its link', async () => {
  const back = await check(site({ [path('Left Behind')]: 200 }).io, ['Left Behind'], [copy([row('Left Behind', { linked: 0, last_result: '404', counted_at: daysBefore(40), fails: 2 })])], NOW, false);
  assert.deepEqual(back.copies[0].added, ['Left Behind']);
  assert.deepEqual(back.copies[0].writes, [row('Left Behind', { counted_at: daysBefore(40) })]);
  const fresh = await check(site({ [path('A New Quest')]: 200 }).io, ['A New Quest'], [copy([])], NOW, true);
  assert.deepEqual(fresh.copies[0].added, ['A New Quest']);
  assert.deepEqual(fresh.copies[0].writes, [row('A New Quest', { counted_at: NOW })]);
});

test('a 5xx, a timeout or another answer changes nothing and is reported; a 403 or 429 stops the run', async () => {
  const pages = { [path('A')]: 503, [path('B')]: { status: null, finalUrl: null, error: 'timeout' }, [path('C')]: { status: 200, finalUrl: 'https://monstersandmemories.wiki/quests' } };
  const o = await check(site(pages).io, ['A', 'B', 'C'], [copy([row('A'), row('B'), row('C')])], NOW, true);
  assert.deepEqual(o.copies[0].writes, []);
  assert.deepEqual(o.errors, ['A: 503', 'B: timeout']);
  assert.deepEqual(o.other, ['C: 200 at /quests']);
  // Every page failing is no check: it stops (never recorded as a success); a 5xx between counted 404s keeps the counter.
  assert.match((await check(site({ [path('A')]: 503 }).io, ['A'], [copy([row('A', { fails: 1 })])], NOW, true)).stop!, /every quest page failed/);
  const mixed = await check(site({ [path('A')]: 503, [path('B')]: 200 }).io, ['A', 'B'], [copy([row('A', { fails: 1, counted_at: daysBefore(40) }), row('B')])], NOW, true);
  assert.equal(mixed.copies[0].writes.some((w) => w.quest === 'A'), false);
  // The 25-day boundary: 24.9 days does not count, 25 does.
  const at = (d: number) => check(site({}).io, ['L'], [copy([row('L', { counted_at: daysBefore(d) })])], NOW, true);
  assert.equal((await at(24.9)).copies[0].counted, 0);
  assert.equal((await at(25)).copies[0].counted, 1);
  for (const status of [403, 429]) {
    const b = await check(site({ [path('A')]: status }).io, ['A'], [copy([row('A')])], NOW, true);
    assert.match(b.stop!, new RegExp(String(status)));
  }
});

test('unchanged rows are not written; the address follows the slug rule', async () => {
  const o = await check(site({ [path('Wilna\'s Ring')]: 200 }).io, ["Wilna's Ring"], [copy([row("Wilna's Ring")])], NOW, false);
  assert.deepEqual(o.copies[0].writes, []);
  assert.equal(questUrl("Wilna's Ring"), 'https://monstersandmemories.wiki/quests/wilnas-ring');
  assert.match(upsertSql(row("Wilna's Ring")), /'Wilna''s Ring'/);
});

test('dev and production with different quests: production\'s list is checked; a quest only dev holds is never asked or written', async () => {
  const s = site({ [path('Shared')]: 200, [path('Prod Only')]: 200 });
  const o = await check(s.io, ['Prod Only', 'Shared'], [copy([row('Shared'), row('Dev Only')], 'dev'), copy([row('Shared')], 'production')], NOW, false);
  assert.ok(!s.asked.some((u) => u.includes('dev-only')));
  for (const c of o.copies) {
    assert.deepEqual(c.added, ['Prod Only'], c.name);
    assert.deepEqual(c.writes.map((w) => w.quest), ['Prod Only'], c.name);
  }
});

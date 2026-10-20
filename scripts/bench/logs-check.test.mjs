// Red/green tests for the Workers Logs completeness check (order 7, ITEM 1.1). Run: node --test scripts/bench/
// The fixture is the real 2026-10-19 22:00 → 2026-10-20 01:53 UTC window as read back by timings run 39355923958:
// cron schedule created by the 22:21 deploy, a second deploy at 01:10, runs in every slot but 23:30.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile, SLOT_MS } from './logs-check.mjs';

const t = (s) => Date.parse(s);
const from = t('2026-10-19T22:00:00Z');
const to = t('2026-10-20T01:53:41Z');
const deploys = [t('2026-10-19T22:20:47Z'), t('2026-10-20T01:10:15Z')];
const cronSince = deploys[0];
const seenSlots = [];
for (let s = t('2026-10-19T22:30:00Z'); s <= t('2026-10-20T01:45:00Z'); s += SLOT_MS) if (s !== t('2026-10-19T23:30:00Z')) seenSlots.push(s);
const crons = (slots) => slots.map((s) => ({ at: s + 38_000, path: 'board sweep', kind: 'cron' }));
const interactions = [
  { at: t('2026-10-20T00:29:56.643Z'), path: 'command guildcraft setup', kind: 'interaction' },
  { at: t('2026-10-20T00:33:32.074Z'), path: 'autocomplete craft set :skill', kind: 'interaction' },
  { at: t('2026-10-20T00:33:47.850Z'), path: 'command craft set', kind: 'interaction' },
  { at: t('2026-10-20T01:33:55.365Z'), path: 'command guildcraft status', kind: 'interaction' },
];
const audit = [
  { action: 'guild.setup', actor: 'u', at: t('2026-10-20T00:29:55.956Z') },
  { action: 'skill.set', actor: 'u', at: t('2026-10-20T00:33:47.507Z') },
];
const missingOf = (r, type) => r.rows.find((x) => x.type === type)?.missing;

test('red: the real window fails on the missing 23:30 run', () => {
  const r = reconcile({ from, to, requests: [...crons(seenSlots), ...interactions], audit, deploys, cronSince });
  assert.equal(r.ok, false);
  assert.deepEqual(missingOf(r, 'cron run per 15-minute slot'), ['2026-10-19T23:30:00.000Z']);
  assert.deepEqual(missingOf(r, 'audit guild.setup → log'), []);
  assert.deepEqual(missingOf(r, 'audit skill.set → log'), []);
});

test('green: the same window with the 23:30 run present passes', () => {
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions], audit, deploys, cronSince });
  assert.equal(r.ok, true, JSON.stringify(r.rows));
  // 22:30 and 01:15 fall inside a deploy's 15-minute propagation window: not counted either way.
  assert.match(r.rows.find((x) => x.type.startsWith('cron')).note, /^2 slot/);
});

test('red: an audit row whose interaction is not in the logs', () => {
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions.filter((x) => x.path !== 'command craft set')], audit, deploys, cronSince });
  assert.equal(r.ok, false);
  assert.deepEqual(missingOf(r, 'audit skill.set → log'), ['2026-10-20T00:33:47.507Z']);
});

test('red: a read that names its audit action but has no row; green once the row exists', () => {
  const read = { at: t('2026-10-20T01:40:00Z'), path: 'command craft find', kind: 'interaction', audit: 'craft.find' };
  const all = [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions, read];
  const red = reconcile({ from, to, requests: all, audit, deploys, cronSince });
  assert.deepEqual(missingOf(red, 'read log (audit named) → audit row'), ['2026-10-20T01:40:00.000Z craft.find']);
  const green = reconcile({ from, to, requests: all, audit: [...audit, { action: 'craft.find', actor: 'u', at: read.at + 300 }], deploys, cronSince });
  assert.equal(green.ok, true, JSON.stringify(green.rows));
});

test('one log event never satisfies two audit rows', () => {
  const two = [...audit, { action: 'skill.set', actor: 'u', at: t('2026-10-20T00:33:48.000Z') }];
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions], audit: two, deploys, cronSince });
  assert.equal(missingOf(r, 'audit skill.set → log').length, 1);
});

test('system rows (the departure run) are not matched to interactions', () => {
  const r = reconcile({ from, to, requests: [...crons([...seenSlots, t('2026-10-19T23:30:00Z')]), ...interactions], audit: [...audit, { action: 'member.left', actor: 'system', at: t('2026-10-20T00:15:40Z') }], deploys, cronSince });
  assert.equal(r.ok, true);
});

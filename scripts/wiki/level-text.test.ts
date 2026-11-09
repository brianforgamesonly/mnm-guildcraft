// Order 41, ITEM 1: every level text the committed wiki snapshot holds (zones and NPCs, as the import parses them) goes
// through src/level-text.ts shownLevel, the one function every surface uses. Derived from the data, never a typed list:
// a "?" form the snapshot gains is checked the day the snapshot is refreshed.
//   node --test scripts/wiki/level-text.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSnapshot } from './parse.ts';
import { COMMITTED_SNAPSHOT, readSnapshot } from '../import/zone-files.ts';
import { questionReading, shownLevel } from '../../src/level-text.ts';

const parsed = parseSnapshot(readSnapshot(COMMITTED_SNAPSHOT));
const texts = [...parsed.zones.map((z) => z.level), ...parsed.npcs.map((n) => n.level)].filter((t): t is string => t !== null);
/** A bound made only of question marks: a run of "?" not directly after a digit or a "+". */
const QUESTION_BOUND = /(^|[^\d+?])\?+/;

test('the snapshot holds level texts, some with "?" (else this check checks nothing)', () => {
  assert.ok(texts.length > 100, `${texts.length} level texts`);
  assert.ok(texts.some((t) => t.includes('?')), 'no "?" text in the snapshot');
});

test('no bound made only of question marks survives shownLevel', () => {
  for (const t of texts.filter((x) => x.includes('?'))) {
    const shown = shownLevel(t);
    if (shown !== null) assert.doesNotMatch(shown, QUESTION_BOUND, `${JSON.stringify(t)} shows as ${JSON.stringify(shown)}`);
    if (questionReading(t) === 'as recorded') assert.equal(shown, t);
  }
});

test('a text with no "?" shows exactly as recorded', () => {
  for (const t of texts.filter((x) => !x.includes('?'))) assert.equal(shownLevel(t), t);
});

// Order 12, ITEM 3: the OperatorText guard (src/operator-text.ts). Compile time: tsc on the misuse fixture fails on
// exactly the lines marked MISUSE (the population is read from the fixture, never typed here). Run time: every string
// conversion the types cannot see throws, and render() shows operator segments in dev only.
//   node --test scripts/ci/operator-text.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { joinSegments, operatorText, render } from '../../src/operator-text.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURE = 'test/fixtures/operator-text-misuse.ts';

test('tsc rejects every deliberate misuse in the fixture, and nothing else in it', () => {
  const misuse = readFileSync(`${root}${FIXTURE}`, 'utf8')
    .split('\n')
    .flatMap((l, k) => (/\/\/ MISUSE:/.test(l) ? [k + 1] : []));
  assert.ok(misuse.length >= 6, `the fixture marks ${misuse.length} misuses`);
  const tsc = spawnSync(process.execPath, [`${root}node_modules/typescript/bin/tsc`, '--noEmit', '-p', `${root}test/fixtures/tsconfig.misuse.json`], { encoding: 'utf8' });
  assert.notEqual(tsc.status, 0, 'tsc accepted the misuse fixture');
  const failed = [...new Set([...tsc.stdout.matchAll(/operator-text-misuse\.ts\((\d+),\d+\): error TS\d+/g)].map((m) => Number(m[1])))];
  assert.deepEqual(failed.sort((x, y) => x - y), misuse, tsc.stdout);
});

test('the conversions the types cannot see throw at run time', () => {
  const op = operatorText('push refused: 403');
  for (const convert of [(x: unknown) => String(x), (x: unknown) => [x].join(''), (x: unknown) => JSON.stringify(x), (x: unknown) => `${x as string}`])
    assert.throws(() => convert(op), /OperatorText turned into a string outside render/);
});

test('render: dev shows every segment; production and unset drop the operator segments, and a line that held only them', () => {
  const lines = [operatorText('**Copy:** dev'), ['**Backup:** last x · latest run y **failed**', operatorText(': push refused'), '. If this repeats, tell Joegandomi.'], 'plain'];
  assert.equal(render('dev', lines), '**Copy:** dev\n**Backup:** last x · latest run y **failed**: push refused. If this repeats, tell Joegandomi.\nplain');
  for (const copy of ['production', undefined, 'Dev', ''])
    assert.equal(render(copy, lines), '**Backup:** last x · latest run y **failed**. If this repeats, tell Joegandomi.\nplain');
  assert.equal(render('production', ['', 'a']), '\na', 'an empty guild line is kept');
  assert.deepEqual(joinSegments([['a'], [], ['b', 'c']], ' · '), ['a', ' · ', 'b', 'c']);
});

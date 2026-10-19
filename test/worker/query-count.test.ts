// ITEM 3.1 (a) / 3.2: D1 round trips per autocomplete path, counted exactly by wrapping the binding.
// Target (3.2): at most one query per keystroke, and never a write.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { countD1 } from '../../src/telemetry.ts';
import { reset } from '../db.ts';
import { as, auto, cmd, send } from '../discord.ts';

const ann = as('100000000000000001');

beforeEach(async () => {
  await reset();
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
});

const PATHS: [string, ReturnType<typeof auto>][] = [
  ['skill', auto(ann, 'craft', 'set', { skill: 'Bla' }, 'skill')],
  ['class', auto(ann, 'character', 'add', { name: 'X', class: 'c' }, 'class')],
  ['item', auto(ann, 'craft', 'find', { item: 'Tarn' }, 'item')],
  ['character', auto(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 1, character: 'Te' }, 'character')],
];

describe('autocomplete: D1 queries per keystroke', () => {
  for (const [path, body] of PATHS)
    it(`${path}: at most one query, no writes`, async () => {
      const counted = countD1(env.DB);
      await send(body, { env: { DB: counted.db } });
      // Repeated keystrokes in the same isolate: the second must not cost more than the first.
      const first = counted.calls.length;
      await send(body, { env: { DB: counted.db } });
      console.log(`[query-count] ${path}: first keystroke ${first}, second ${counted.calls.length - first}`, JSON.stringify(counted.calls.map((c) => c.op)));
      expect(first).toBeLessThanOrEqual(1);
      expect(counted.calls.length - first).toBeLessThanOrEqual(1);
      expect(counted.calls.every((c) => c.op === 'first' || c.op === 'all' || c.op === 'raw')).toBe(true);
    });
});

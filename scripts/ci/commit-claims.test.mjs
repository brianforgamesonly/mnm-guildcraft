// Order 36, ITEM 1: scripts/ci/commit-claims.mjs, on order 35's real slip and on what must pass.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { problems, RULES_FILE } from './commit-claims.mjs';

test("order 35's push 80ee0ae fails: a rule claimed, only the test changed", () => {
  const subject = 'Order 35 rule: a command whose shape changes is registered after its deploy; test that an old-shape /gear is answered as /gear search, identically (order 35, PR B)';
  assert.equal(problems('80ee0aefe135', subject, ['test/worker/wear.test.ts']).length, 1);
});

test('the same commit with the rules file passes; other subjects pass', () => {
  assert.deepEqual(problems('a', 'Order 35 rule: x', [RULES_FILE, 'test/worker/wear.test.ts']), []);
  assert.deepEqual(problems('b', 'Order 36 rules, and the missed order 35 rule', [RULES_FILE]), []);
  assert.equal(problems('c', 'order 36b rules: weights', ['src/gear/score.ts']).length, 1);
  assert.deepEqual(problems('d', 'Review fixes: the rule check (order 36, PR A)', ['src/x.ts']), []);
  assert.deepEqual(problems('e', 'Gear upgrades, part 2: scoring (order 36, PR A)', ['src/gear/score.ts']), []);
});

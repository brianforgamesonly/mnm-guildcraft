// Order 26: a workflow that runs on a pull request never runs a script with --remote (the benches' switch to a Cloudflare
// database; a push to main deploys, and its migration of the live databases is deploy.yml's own). What it checks is that
// switch, not every read: ci.yml's reach job still makes the health dry runs' small reads of both copies (a few hundred
// rows per pull request, order 26 ITEM 1), named there.
// From the dev copy, CI's zone benches read about 450,000 D1 rows per run, and 2026-10-27's eight CI runs took the account
// to 79.4% of D1 Free's daily reads (order 26, ITEM 1). The population is every workflow file and its triggers, read here.
//   node --test scripts/ci/ci-reads.test.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const dir = new URL('../../.github/workflows/', import.meta.url);
const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

/** The workflow's `on:` block, as text: the top-level key and its indented lines. */
function triggers(text: string): string {
  const m = /^["']?on["']?:(.*)\n((?:[ \t]+.*\n|\s*\n)*)/m.exec(text);
  return m ? `${m[1]}\n${m[2]}` : '';
}
const onCode = (text: string) => /\b(pull_request|pull_request_target|workflow_run)\b/.test(triggers(text));

test('the workflows were read, and ci.yml is among those that run on a pull request', () => {
  assert.ok(files.length > 5, `only ${files.length} workflow files found in ${dir.pathname}`);
  assert.ok(onCode(readFileSync(new URL('ci.yml', dir), 'utf8')));
  assert.ok(!onCode(readFileSync(new URL('usage.yml', dir), 'utf8')));
});

test('no workflow that runs on a pull request passes --remote', () => {
  for (const f of files) {
    const text = readFileSync(new URL(f, dir), 'utf8');
    if (!onCode(text)) continue;
    const lines = text.split('\n').flatMap((l, i) => (/--remote\b/.test(l.replace(/#.*$/, '')) ? [`${f}:${i + 1}: ${l.trim()}`] : []));
    assert.deepEqual(lines, [], 'a code-triggered workflow reads a remote D1; use a local D1 filled by the import (ci.yml local-data)');
  }
});

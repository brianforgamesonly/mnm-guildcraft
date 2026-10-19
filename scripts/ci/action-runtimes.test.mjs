// node --test scripts/ci/action-runtimes.test.mjs — no network: a fake fetch serves action.yml files.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALLOWED_NODE_RUNTIME, check, classify, runsUsing, usesOf } from './action-runtimes.mjs';

const RAW = 'https://raw.githubusercontent.com/';
const fakeFetch = (files, { failAll = false } = {}) => async (url) => {
  if (failAll) throw new Error('network down');
  if (!url.startsWith(RAW)) throw new Error(`unexpected ${url}`);
  const body = files[url.slice(RAW.length)];
  return body === undefined ? new Response('', { status: 404 }) : new Response(body);
};
const node = (v, quote = '') => `name: x\nruns:\n  using: ${quote}${v}${quote}\n  main: index.js\n`;

test('the allowed runtime is one named constant', () => assert.equal(ALLOWED_NODE_RUNTIME, 'node24'));

test('usesOf reads list items, quotes and trailing comments', () => {
  const wf = "steps:\n  - uses: actions/checkout@v7 # pinned\n  - uses: 'actions/setup-node@v7'\n  - run: echo uses: nope\n    uses: \"a/b@c\"\n";
  assert.deepEqual(usesOf(wf), ['actions/checkout@v7', 'actions/setup-node@v7', 'a/b@c']);
});

test('classify skips local, docker and reusable workflows; keeps sub-path actions and SHA refs', () => {
  assert.deepEqual(classify('./.github/actions/x'), { skip: 'local action' });
  assert.deepEqual(classify('docker://alpine:3'), { skip: 'docker image' });
  assert.deepEqual(classify('o/r/.github/workflows/build.yml@main'), { skip: 'reusable workflow' });
  assert.deepEqual(classify('github/codeql-action/init@v3'), { owner: 'github', repo: 'codeql-action', dir: 'init', ref: 'v3', sha: false });
  assert.equal(classify(`a/b@${'0'.repeat(40)}`).sha, true);
});

test('runsUsing reads only the top-level runs block', () => {
  assert.equal(runsUsing(node('node24', "'")), 'node24');
  assert.equal(runsUsing('inputs:\n  using: node12\nruns:\n  using: node20\n'), 'node20');
  assert.equal(runsUsing('name: no runs\n'), null);
});

test('a node20 action fails, a node24 action passes, action.yaml is the fallback', async () => {
  const files = { 'a/old/v4/action.yml': node('node20'), 'a/new/v7/action.yaml': node('node24') };
  const r = await check({ 'w.yml': '- uses: a/old@v4\n- uses: a/new@v7\n' }, fakeFetch(files));
  assert.deepEqual(r.problems, ['w.yml: a/old@v4 runs on node20; allowed: node24']);
  assert.deepEqual(r.rows.map((x) => x.runtime), ['node20', 'node24']);
});

test('composite actions are followed into their steps', async () => {
  const files = {
    'c/comp/v1/action.yml': 'runs:\n  using: composite\n  steps:\n    - uses: a/old@v4\n    - uses: ./local\n',
    'a/old/v4/action.yml': node('node16'),
  };
  const r = await check({ 'w.yml': 'uses: c/comp@v1\n' }, fakeFetch(files));
  assert.deepEqual(r.problems, ['c/comp@v1 (composite): a/old@v4 runs on node16; allowed: node24']);
  assert.equal(r.rows.find((x) => x.uses === './local').note, 'skipped: local action');
});

test('docker-based actions are not a Node runtime and pass', async () => {
  const r = await check({ 'w.yml': 'uses: d/img@v1\n' }, fakeFetch({ 'd/img/v1/action.yml': "runs:\n  using: 'docker'\n  image: Dockerfile\n" }));
  assert.deepEqual(r.problems, []);
});

test('a network failure fails the check instead of passing it', async () => {
  const r = await check({ 'w.yml': 'uses: a/new@v7\n' }, fakeFetch({}, { failAll: true }));
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /could not fetch/);
});

test('a missing action.yml fails the check', async () => {
  const r = await check({ 'w.yml': 'uses: a/gone@v1\n' }, fakeFetch({}));
  assert.match(r.problems[0], /no action\.yml or action\.yaml/);
});

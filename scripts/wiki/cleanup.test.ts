// Order 37, ITEM 3: the temporary Worker cleanup (scripts/wiki/cleanup.ts), with a fake Cloudflare API.
//   node --test scripts/wiki/cleanup.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHECK_ATTEMPTS, cleanup, refuseUnlessTemporary, TEMP_WORKER_PREFIX, workerName, type Fetch } from './cleanup.ts';
import { copies } from '../copies.ts';

/** A fake API answering each call in turn (a number is a status, an Error is thrown), recording the calls. */
function api(answers: (number | Error)[]) {
  const calls: string[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push(`${init.method} ${url.replace(/.*\/workers\/scripts\//, '')}`);
    const a = answers.shift();
    if (a === undefined) throw new Error('no answer left');
    if (a instanceof Error) throw a;
    return { status: a };
  };
  const waits: number[] = [];
  return { calls, waits, run: (name = 'guildcraft-wiki-relay') => cleanup({ name, accountId: 'acct', apiToken: 'tok', fetch, sleep: async (ms) => void waits.push(ms) }) };
}

test('already gone: the delete answers 404 and the check confirms it; no warning, no failure', async () => {
  const a = api([404, 404]);
  assert.deepEqual(await a.run(), { verdict: 'gone', deleted: 'already gone', checks: ['HTTP 404'] });
  assert.deepEqual(a.calls, ['DELETE guildcraft-wiki-relay', 'GET guildcraft-wiki-relay']);
});

test('deleted: the delete answers 200 and the check 404', async () => {
  const a = api([200, 404]);
  assert.deepEqual(await a.run(), { verdict: 'gone', deleted: 'deleted', checks: ['HTTP 404'] });
});

test('still there: 200 on every check, with backoff between them, fails', async () => {
  const a = api([200, 200, 200, 200]);
  const o = await a.run();
  assert.equal(o.verdict, 'there');
  assert.equal(o.checks.length, CHECK_ATTEMPTS);
  assert.deepEqual(a.waits, [2_000, 5_000]);
});

test('a transient API error is retried and never fails: a 5xx then a 404 is gone; errors only are unconfirmed', async () => {
  assert.equal((await api([200, 503, 404]).run()).verdict, 'gone');
  const o = await api([new Error('ECONNRESET'), new Error('ECONNRESET'), 502, new Error('ETIMEDOUT')]).run();
  assert.equal(o.verdict, 'unknown');
  assert.equal(o.deleted, 'network error (ECONNRESET)');
  // A 200 then an error is not "confirmed still there" either.
  assert.equal((await api([200, 200, 500, 200]).run()).verdict, 'unknown');
});

test('a name without the temporary prefix is refused before any request; none of GuildCraft\'s own Workers has it', async () => {
  const a = api([200, 404]);
  await assert.rejects(a.run('mnm-guildcraft'), /refused/);
  assert.deepEqual(a.calls, []);
  const own = [workerName(readFileSync('wrangler.jsonc', 'utf8')), ...copies().map((c) => c.worker)];
  for (const name of own) assert.throws(() => refuseUnlessTemporary(name), /refused/, name);
});

test('the name comes from the config the deploy used: the relay and the probe', () => {
  for (const file of ['scripts/wiki/wrangler.jsonc', 'scripts/probe/wrangler.jsonc']) assert.ok(workerName(readFileSync(file, 'utf8')).startsWith(TEMP_WORKER_PREFIX), file);
});

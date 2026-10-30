// Order 27 (override 4): /dkp is a per-server definition. Against a fake Discord that applies the documented semantics
// (a bulk PUT "overwrit[es] the existing command list for this application for the targeted guild"; a create upserts by
// name), dev's registration (the guild-scoped PUT, then the DKP upserts) leaves /dkp registered on the test server, and
// the PUT itself never carries /dkp. The registration script runs exactly that sequence (checked by reading it).
//   node --test scripts/discord/dkp.test.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { COMMANDS } from '../../src/commands/definitions.ts';
import { DKP_COMMAND, DKP_NAME } from '../../src/dkp/definition.ts';
import { GUARD_PATH, verifyGuard } from '../../src/dkp/guard.ts';
import { callDecayGuard, DKP_ON_SQL, upsertDkp } from './dkp.ts';

const APP = '1';
const TEST_GUILD = '900';

function fakeDiscord() {
  const guild = new Map<string, { name: string }[]>();
  const calls: { method: string; path: string; body: any }[] = [];
  const call = async (method: string, path: string, body?: any) => {
    calls.push({ method, path, body });
    const m = path.match(/^\/applications\/\d+\/guilds\/(\d+)\/commands$/);
    if (!m) return { status: 404, text: '' };
    const list = guild.get(m[1]) ?? [];
    if (method === 'PUT') guild.set(m[1], (body as { name: string }[]).map((c) => ({ name: c.name })));
    else if (method === 'POST') {
      const had = list.some((c) => c.name === body.name);
      guild.set(m[1], [...list.filter((c) => c.name !== body.name), { name: body.name }]);
      return { status: had ? 200 : 201, text: '{}' };
    }
    return { status: 200, text: '[]' };
  };
  return { guild, calls, call };
}

test("dev's bulk PUT, then the DKP upserts, leaves /dkp registered on the test server; the PUT never carries it", async () => {
  const d = fakeDiscord();
  // DKP was on in the test server: /dkp is there before the run (Add DKP created it).
  await d.call('POST', `/applications/${APP}/guilds/${TEST_GUILD}/commands`, DKP_COMMAND);
  await d.call('PUT', `/applications/${APP}/guilds/${TEST_GUILD}/commands`, COMMANDS);
  assert.equal(d.guild.get(TEST_GUILD)!.some((c) => c.name === DKP_NAME), false, 'the PUT alone removes /dkp (the fake applies Discord\'s rule)');
  const r = await upsertDkp(d.call, APP, [TEST_GUILD]);
  assert.equal(r.failed, 0);
  assert.equal(d.guild.get(TEST_GUILD)!.some((c) => c.name === DKP_NAME), true);
  for (const c of d.calls.filter((c) => c.method === 'PUT')) assert.equal((c.body as { name: string }[]).some((x) => x.name === DKP_NAME), false);
  assert.equal((COMMANDS as readonly { name: string }[]).some((c) => c.name === DKP_NAME), false);
});

test('register.ts upserts /dkp on the copy\'s DKP-on servers after the PUT, and never globally', () => {
  const src = readFileSync(new URL('./register.ts', import.meta.url), 'utf8');
  const put = src.indexOf("discord('PUT', commandsPath, COMMANDS)");
  const upsert = src.indexOf('upsertDkp(call, appId, dkpOn)');
  assert.ok(put > 0 && upsert > put, 'the upserts follow the PUT');
  assert.match(src, /db\.all<\{ guild_id: string \}>\(DKP_ON_SQL\)/);
  assert.equal(DKP_ON_SQL, 'SELECT guild_id FROM dkp_guild WHERE enabled = 1 ORDER BY guild_id');
  // upsertDkp only ever calls the guild route.
  const calls: string[] = [];
  return upsertDkp(async (_m, p) => (calls.push(p), { status: 201, text: '' }), APP, ['5', '6']).then(() => assert.deepEqual(calls, [`/applications/${APP}/guilds/5/commands`, `/applications/${APP}/guilds/6/commands`]));
});

test('order 30: register.ts asks the live Worker for the decay guard after the upserts, and a refusal only warns', () => {
  const src = readFileSync(new URL('./register.ts', import.meta.url), 'utf8');
  assert.ok(src.indexOf('callDecayGuard(url, botToken, false)') > src.indexOf('upsertDkp(call, appId, dkpOn)'));
  assert.match(src, /::warning::the decay guard answered/);
});

test('order 30: the guard call is signed, pages through every guild and adds up; a refusal is returned, never thrown', async () => {
  const seen: { url: string; time: string | null; signature: string | null }[] = [];
  const pages = [
    { guilds: 40, checked: 39, counts: { kept: 38, added: 1, 'would-add': 0, off: 0, failed: 0 }, next: 39 },
    { guilds: 40, checked: 1, counts: { kept: 1, added: 0, 'would-add': 0, off: 0, failed: 0 }, next: null },
  ];
  const fetcher = (async (url: string, init: RequestInit) => {
    const h = new Headers(init.headers);
    seen.push({ url, time: h.get('X-Guard-Time'), signature: h.get('X-Guard-Signature') });
    return new Response(JSON.stringify(pages[seen.length - 1]));
  }) as typeof fetch;
  const r = await callDecayGuard('https://w.example/', 'token', false, fetcher);
  assert.deepEqual(r, { guilds: 40, checked: 40, counts: { kept: 39, added: 1, 'would-add': 0, off: 0, failed: 0 } });
  assert.deepEqual(seen.map((s) => s.url), [`https://w.example${GUARD_PATH}?dry=0&offset=0`, `https://w.example${GUARD_PATH}?dry=0&offset=39`]);
  assert.equal(await verifyGuard('token', Number(seen[1].time), false, 39, seen[1].signature!, Date.now()), true);
  assert.deepEqual(await callDecayGuard('https://w.example/', 'token', true, (async () => new Response('', { status: 404 })) as typeof fetch), { status: 404 });
});

test('register-commands.yml runs register.ts, so each registration after a deploy carries the upserts', () => {
  const wf = readFileSync(new URL('../../.github/workflows/register-commands.yml', import.meta.url), 'utf8');
  assert.match(wf, /node scripts\/discord\/register\.ts/);
});

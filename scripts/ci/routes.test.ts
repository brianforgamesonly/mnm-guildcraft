// Order 10, ITEM 3: the bot-token routes in the code and src/permissions.ts ROUTES agree, both ways. The population
// is read from the code (every '/channels/...' or '/guilds/...' path literal in src/ and the board job), never typed.
// Application routes (/applications/...) and interaction webhooks (/webhooks/...) need no server permission.
//   node --test scripts/ci/routes.test.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { INSTALL_PERMISSIONS, ROUTES, channelPermissions } from '../../src/permissions.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const files = (dir: string): string[] =>
  readdirSync(join(root, dir)).flatMap((f) => (statSync(join(root, dir, f)).isDirectory() ? files(join(dir, f)) : /\.(ts|mjs)$/.test(f) ? [join(dir, f)] : []));

/** Every Discord path the code builds: a string or template literal starting /channels/ or /guilds/. */
function codePaths(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of [...files('src'), 'scripts/board/run.mjs']) {
    if (f.endsWith('permissions.ts')) continue;
    // Line comments only (a // after whitespace or at a line start), so https:// in a URL survives.
    const text = readFileSync(join(root, f), 'utf8').replace(/(^|\s)\/\/[^\n]*/gm, '$1');
    // A path alone, after ${DISCORD_API}, or after the full https://discord.com/api/v10 base.
    for (const m of text.matchAll(/[`'](?:\$\{DISCORD_API\}|https:\/\/discord\.com\/api\/v\d+)?(\/(?:channels|guilds)\/[^`'\s]*)[`']/g)) {
      const path = m[1].replace(/\$\{[^}]*\}/g, '{}').replace(/\?.*$/, '');
      out.set(path, [...(out.get(path) ?? []), f]);
    }
  }
  return out;
}

test('every route the code calls is in ROUTES, and every ROUTES path is still called', () => {
  const code = codePaths();
  assert.ok(code.size >= 8, `found ${code.size} paths: the scan is broken`);
  const known = new Set(ROUTES.map((r) => r.path));
  for (const [p, where] of code) assert.ok(known.has(p), `${p} (${where.join(', ')}) is not in src/permissions.ts ROUTES`);
  for (const p of known) assert.ok(code.has(p), `${p} is in ROUTES but no code calls it`);
});

test('the install permissions are the union of the routes; Create Public Threads is not among them', () => {
  // Order 16: 292057893888 + Create Private Threads (1 << 36 = 68719476736).
  assert.equal(INSTALL_PERMISSIONS, 360777370624n);
  assert.equal(INSTALL_PERMISSIONS - 292057893888n, 1n << 36n);
  assert.equal(INSTALL_PERMISSIONS & (1n << 35n), 0n);
  // Each channel's check is a subset of the install permissions, so a fresh install passes setup.
  for (const k of ['board', 'review', 'vault', 'requests'] as const) for (const [b] of channelPermissions(k)) assert.equal(INSTALL_PERMISSIONS & b, b, k);
});

test('docs/LAUNCH-GUIDE.md carries the same permissions number as the code', () => {
  const guide = readFileSync(join(root, 'docs/LAUNCH-GUIDE.md'), 'utf8');
  const numbers = [...guide.matchAll(/permissions=(\d+)/g)].map((m) => m[1]);
  assert.ok(numbers.length > 0, 'the guide has no install link');
  for (const n of numbers) assert.equal(n, String(INSTALL_PERMISSIONS));
  const selfHosting = readFileSync(join(root, 'docs/SELF-HOSTING.md'), 'utf8');
  for (const m of selfHosting.matchAll(/permissions=(\d+)/g)) assert.equal(m[1], String(INSTALL_PERMISSIONS));
});

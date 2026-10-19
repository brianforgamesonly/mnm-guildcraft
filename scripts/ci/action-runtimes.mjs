// Every action a workflow uses must run on the allowed Node runtime (order 4, ITEM 4).
//
// The runtime is derived, never listed: for each `uses: owner/repo[/path]@ref` in .github/workflows/,
// the action's own action.yml (or action.yaml) is fetched at that ref and its `runs.using` is read.
// Composite actions are followed into their own `uses:` steps. Nothing in an action's metadata says a
// runtime is deprecated, so which runtime is allowed is the one named constant below.
//
// Skipped: local actions (./...), docker:// images, and reusable workflows (owner/repo/.github/workflows/x.yml@ref),
// which have no action.yml. A commit-SHA ref is fetched the same way as a tag or branch (raw content at
// that SHA). A Docker-based action (`using: docker`) is not a Node runtime and passes.
// A network failure, after retries, FAILS the check: a check that passes when it could not look would
// pass the very regression it exists to catch.
//
// Usage: node scripts/ci/action-runtimes.mjs [workflows dir]   Exit 1 on any disallowed runtime or fetch failure.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ALLOWED_NODE_RUNTIME = 'node24';

/** The `uses:` values in a workflow or action file, with comments and quotes stripped. */
export function usesOf(yamlText) {
  const out = [];
  for (const line of yamlText.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/);
    if (!m) continue;
    const v = m[1].replace(/\s+#.*$/, '').replace(/^['"]|['"]$/g, '').trim();
    if (v) out.push(v);
  }
  return out;
}

/** What a `uses:` value refers to: an action to fetch, or a reason it is skipped. */
export function classify(uses) {
  if (uses.startsWith('./') || uses.startsWith('.\\')) return { skip: 'local action' };
  if (uses.startsWith('docker://')) return { skip: 'docker image' };
  const at = uses.lastIndexOf('@');
  if (at === -1) return { skip: 'no ref' };
  const path = uses.slice(0, at);
  const ref = uses.slice(at + 1);
  if (/\/\.github\/workflows\/[^/]+\.ya?ml$/.test(path)) return { skip: 'reusable workflow' };
  const [owner, repo, ...sub] = path.split('/');
  if (!owner || !repo) return { skip: 'unrecognised' };
  return { owner, repo, dir: sub.join('/'), ref, sha: /^[0-9a-f]{40}$/.test(ref) };
}

/** runs.using from an action.yml (the first `using:` inside the top-level `runs:` block). */
export function runsUsing(actionYaml) {
  const lines = actionYaml.split(/\r?\n/);
  const start = lines.findIndex((l) => /^runs:\s*(#.*)?$/.test(l));
  if (start === -1) return null;
  for (const l of lines.slice(start + 1)) {
    if (/^\S/.test(l)) break; // next top-level key
    const m = l.match(/^\s+using:\s*['"]?([\w.-]+)['"]?/);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/** Fetches a URL's text with retries; returns null on 404, throws on any other persistent failure. */
async function fetchText(url, fetchImpl, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetchImpl(url);
      if (res.status === 404) return null;
      if (res.ok) return await res.text();
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
  }
  throw new Error(`could not fetch ${url}: ${last?.message ?? last}`);
}

/** The action's metadata file at its ref: action.yml, else action.yaml. */
export async function actionMetadata(a, fetchImpl = fetch) {
  const base = `https://raw.githubusercontent.com/${a.owner}/${a.repo}/${a.ref}/${a.dir ? `${a.dir}/` : ''}`;
  for (const name of ['action.yml', 'action.yaml']) {
    const text = await fetchText(base + name, fetchImpl);
    if (text !== null) return text;
  }
  throw new Error(`no action.yml or action.yaml at ${a.owner}/${a.repo}${a.dir ? `/${a.dir}` : ''}@${a.ref}`);
}

/**
 * Checks every `uses:` in the given files. Returns one row per action reached (composite steps included)
 * and the problems found. `files` maps a file name to its text.
 */
export async function check(files, fetchImpl = fetch) {
  const rows = [];
  const problems = [];
  // One fetch per distinct action; every occurrence is still reported.
  const cache = new Map();
  const visit = async (uses, from, depth) => {
    const c = classify(uses);
    if ('skip' in c) {
      rows.push({ from, uses, runtime: null, note: `skipped: ${c.skip}` });
      return;
    }
    if (!cache.has(uses)) cache.set(uses, actionMetadata(c, fetchImpl));
    let meta;
    try {
      meta = await cache.get(uses);
    } catch (e) {
      problems.push(`${from}: ${uses}: ${e.message}`);
      rows.push({ from, uses, runtime: null, note: 'fetch failed' });
      return;
    }
    const runtime = runsUsing(meta);
    rows.push({ from, uses, runtime, note: c.sha ? 'commit-SHA ref' : '' });
    if (runtime === null) problems.push(`${from}: ${uses}: no runs.using in its action.yml`);
    else if (runtime === 'composite') {
      if (depth >= 5) problems.push(`${from}: ${uses}: composite nesting deeper than 5 (or a cycle)`);
      else for (const inner of usesOf(meta)) await visit(inner, `${uses} (composite)`, depth + 1);
    } else if (runtime.startsWith('node') && runtime !== ALLOWED_NODE_RUNTIME)
      problems.push(`${from}: ${uses} runs on ${runtime}; allowed: ${ALLOWED_NODE_RUNTIME}`);
  };
  for (const [name, text] of Object.entries(files)) for (const u of usesOf(text)) await visit(u, name, 0);
  return { rows, problems };
}

async function main() {
  const dir = process.argv[2] ?? '.github/workflows';
  const files = Object.fromEntries(
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => [f, readFileSync(join(dir, f), 'utf8')]),
  );
  const { rows, problems } = await check(files);
  for (const r of rows) console.log([r.from, r.uses, r.runtime ?? '-', r.note].join('\t'));
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log(`OK: ${rows.filter((r) => r.runtime).length} action uses, every Node runtime is ${ALLOWED_NODE_RUNTIME}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

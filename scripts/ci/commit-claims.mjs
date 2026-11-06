// Order 36, ITEM 1: a commit message describes only what its tree contains.
//
// Order 35's slip (push 80ee0ae): the commit "Order 35 rule: …" was made in the same batch of tool calls as the edit that
// was to add the rule to docs/ORDER-RULES.md. The edit failed ("String to replace not found"), the commit and push ran
// without seeing it, and `git commit -am` recorded only the test file. Nothing compared the message with the tree.
//
// This check runs on every pull request (ci.yml): for each commit the pull request adds, a subject that says it adds a
// rule ("Order 35 rule: …", "Order 36 rules …") must change docs/ORDER-RULES.md in that same commit. The rule's text
// itself is checked after each push with git show <sha>:docs/ORDER-RULES.md | grep -F (docs/ORDER-RULES.md, Order 36).
//
// Usage: node scripts/ci/commit-claims.mjs <base ref> [head ref]   Exit 1 when a commit claims a rule its tree lacks.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const RULES_FILE = 'docs/ORDER-RULES.md';
/** A subject that claims a rule: it starts "Order <n>[letter] rule" or "… rules" (case-insensitive). */
export const CLAIMS_RULE = /^order \d+[a-z]? rules?\b/i;

/** The problems with one commit: its subject and the files it changed. */
export function problems(sha, subject, files) {
  if (CLAIMS_RULE.test(subject.trim()) && !files.includes(RULES_FILE)) return [`${sha.slice(0, 7)} "${subject}" claims a rule but does not change ${RULES_FILE}`];
  return [];
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' });

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [base, head = 'HEAD'] = process.argv.slice(2);
  if (!base) {
    console.error('usage: node scripts/ci/commit-claims.mjs <base ref> [head ref]');
    process.exit(2);
  }
  const out = [];
  const commits = git('log', '--no-merges', '--format=%H%x00%s', `${base}..${head}`).split('\n').filter(Boolean);
  for (const line of commits) {
    const [sha, subject] = line.split('\0');
    const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha).split('\n').filter(Boolean);
    out.push(...problems(sha, subject, files));
  }
  console.log(`${commits.length} commits checked`);
  for (const p of out) console.log(`::error::${p}`);
  process.exit(out.length ? 1 : 0);
}

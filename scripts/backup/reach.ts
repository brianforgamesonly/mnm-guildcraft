// The backup token's reach, read-only (order 8, ITEM 0): run in the pull request's CI, where a same-repository run
// receives secrets (workflow_dispatch works only once a workflow is on the default branch).
//   node scripts/backup/reach.ts      Environment: BACKUP_REPO_TOKEN (unset: reported, not a failure).
// Prints the HTTP status, whether the repository is private, whether the expiry header came, and whether git can list
// its heads. Never the token.
import { BACKUP_REPO, git, REPO_URL } from './lib.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.BACKUP_REPO_TOKEN) {
  console.log('BACKUP_REPO_TOKEN: not set (setup step missing); the backup cannot push until Brian adds it');
  process.exit(0);
}
console.log(`BACKUP_REPO_TOKEN: set (${process.env.BACKUP_REPO_TOKEN.length} characters)`);
const res = await fetch(`https://api.github.com/repos/${BACKUP_REPO}`, {
  headers: { Authorization: `Bearer ${process.env.BACKUP_REPO_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'mnm-guildcraft-backup' },
});
const repo = (await res.json().catch(() => ({}))) as { private?: boolean; size?: number };
const header = res.headers.get('github-authentication-token-expiration');
console.log(JSON.stringify({ http: res.status, private: repo.private ?? null, expiry_header: header ? header.slice(0, 10) : 'absent' }));
const dir = mkdtempSync(join(tmpdir(), 'reach-'));
let heads = 'unread';
try {
  git(dir, ['init', '-q']);
  heads = git(dir, ['ls-remote', '--heads', REPO_URL]).trim() ? 'has branches' : 'empty repository';
} catch (e) {
  heads = `git refused: ${e instanceof Error ? e.message.slice(0, 200) : e}`;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`git ls-remote: ${heads}`);
if (!res.ok || repo.private !== true || heads.startsWith('git refused')) process.exitCode = 1;

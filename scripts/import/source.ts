// Fetches mnmdb/wiki.json pinned to the commit SHA that last changed it, resolved at run time.
// Freshness is recorded as that SHA plus the file's generatedAt, never as our fetch time.

export const SOURCE_REPO = 'Boisteroux/mnm-tools';
export const SOURCE_PATH = 'mnmdb/wiki.json';

export async function fetchSource(githubToken?: string): Promise<{ sha: string; raw: unknown }> {
  const headers: Record<string, string> = { 'User-Agent': 'mnm-guildcraft-import', Accept: 'application/vnd.github+json' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const res = await fetch(`https://api.github.com/repos/${SOURCE_REPO}/commits?path=${SOURCE_PATH}&per_page=1`, { headers });
  if (!res.ok) throw new Error(`GitHub commits lookup failed: HTTP ${res.status}`);
  const commits = (await res.json()) as { sha?: string }[];
  const sha = commits[0]?.sha;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error('GitHub commits lookup returned no SHA');
  const file = await fetch(`https://raw.githubusercontent.com/${SOURCE_REPO}/${sha}/${SOURCE_PATH}`);
  if (!file.ok) throw new Error(`wiki.json fetch failed: HTTP ${file.status}`);
  return { sha, raw: await file.json() };
}

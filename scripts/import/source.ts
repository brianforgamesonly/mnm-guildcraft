// Fetches mnmdb/wiki.json pinned to the commit SHA that last changed it, resolved at run time.
// Freshness is recorded as that SHA plus the file's generatedAt, never as our fetch time.
// Order 17: the zone sources (scripts/import/zones.ts ZONE_FILES) are fetched the same way, each with its commit's date.

import { ZONE_FILES, type SourceVersion, type ZoneFileName, type ZoneSources } from './zones.ts';

export const SOURCE_REPO = 'Boisteroux/mnm-tools';
export const SOURCE_PATH = 'mnmdb/wiki.json';
export const SOURCE_NAME = 'mnm-tools/wiki.json';

async function fetchPinned(repo: string, path: string, githubToken?: string): Promise<{ sha: string; changedAt: string; raw: unknown }> {
  const headers: Record<string, string> = { 'User-Agent': 'mnm-guildcraft-import', Accept: 'application/vnd.github+json' };
  if (githubToken) headers.Authorization = `Bearer ${githubToken}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/commits?path=${path}&per_page=1`, { headers });
  if (!res.ok) throw new Error(`GitHub commits lookup for ${repo}/${path} failed: HTTP ${res.status}`);
  const commits = (await res.json()) as { sha?: string; commit?: { committer?: { date?: string } } }[];
  const sha = commits[0]?.sha;
  const changedAt = commits[0]?.commit?.committer?.date;
  if (!sha || !/^[0-9a-f]{40}$/.test(sha)) throw new Error(`GitHub commits lookup for ${repo}/${path} returned no SHA`);
  if (!changedAt || Number.isNaN(Date.parse(changedAt))) throw new Error(`GitHub commits lookup for ${repo}/${path} returned no commit date`);
  const file = await fetch(`https://raw.githubusercontent.com/${repo}/${sha}/${path}`);
  if (!file.ok) throw new Error(`${repo}/${path} fetch failed: HTTP ${file.status}`);
  return { sha, changedAt, raw: await file.json() };
}

export async function fetchSource(githubToken?: string): Promise<{ sha: string; changedAt: string; raw: unknown }> {
  return fetchPinned(SOURCE_REPO, SOURCE_PATH, githubToken);
}

/** The zone sources, each pinned; `wiki` is wiki.json's own version, so its staleness is judged with the rest. */
export async function fetchZoneSources(wiki: SourceVersion, githubToken?: string): Promise<ZoneSources> {
  const files = {} as Record<ZoneFileName, unknown>;
  const versions: SourceVersion[] = [wiki];
  for (const f of ZONE_FILES) {
    const { sha, changedAt, raw } = await fetchPinned(f.repo, f.path, githubToken);
    files[f.name] = raw;
    versions.push({ name: f.name, sha, changedAt });
  }
  return { files, versions };
}

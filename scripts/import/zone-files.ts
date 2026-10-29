// Order 17: the zone sources as local files, for measuring an import on the local D1 first (order 13, section D).
//   node scripts/import/zone-files.ts --out <dir>   fetches every source pinned (as the nightly run does) into <dir>
// A directory holds one file per source (its name with "/" as "__") and manifest.json, the versions read.
// Locally it reads no credential (GitHub's public API, unauthenticated). Order 28: in a workflow, the job's own
// GITHUB_TOKEN (when set) lifts the unauthenticated rate limit a shared runner address can hit.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fetchSource, fetchZoneSources, SOURCE_NAME } from './source.ts';
import { ZONE_FILES, type SourceVersion, type ZoneFileName, type ZoneInput } from './zones.ts';

const fileName = (name: string) => name.replace('/', '__');

export function readZoneDir(dir: string): ZoneInput {
  const versions = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as SourceVersion[];
  const files = Object.fromEntries(ZONE_FILES.map((f) => [f.name, JSON.parse(readFileSync(join(dir, fileName(f.name)), 'utf8'))])) as Record<ZoneFileName, unknown>;
  return { files, versions };
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { out: { type: 'string' } } });
  if (!args.out) throw new Error('--out is required');
  mkdirSync(args.out, { recursive: true });
  const wiki = await fetchSource(process.env.GITHUB_TOKEN);
  writeFileSync(join(args.out, fileName(SOURCE_NAME)), JSON.stringify(wiki.raw));
  const z = await fetchZoneSources({ name: SOURCE_NAME, sha: wiki.sha, changedAt: wiki.changedAt }, process.env.GITHUB_TOKEN);
  for (const f of ZONE_FILES) writeFileSync(join(args.out, fileName(f.name)), JSON.stringify(z.files[f.name]));
  writeFileSync(join(args.out, 'manifest.json'), JSON.stringify(z.versions, null, 2));
  for (const v of z.versions) console.log(`${v.name} ${v.sha} ${v.changedAt}`);
}

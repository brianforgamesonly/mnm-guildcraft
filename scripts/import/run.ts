// Import CLI — the same code locally and in the nightly Action.
//   node scripts/import/run.ts --local  [--dry-run] [--file wiki.json --sha <sha> [--zones-dir <dir>]] [--wiki-snapshot <dir>]
//   node scripts/import/run.ts --remote [--dry-run] (--wiki-snapshot <dir> | --zones-kept <reason>)
//     (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID from the environment)
// Prints counts and IDs only, never a credential.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { previousImportFailing, runImport, type Db } from './core.ts';
import { isFailing } from '../../src/import-status.ts';
import { currentCopy } from '../copies.ts';
import { copyDatabaseId, localDb, remoteDb } from './db.ts';
import { fetchSource, fetchZoneSources, SOURCE_NAME } from './source.ts';
import { COMMITTED_SNAPSHOT, readSnapshot, readZoneDir } from './zone-files.ts';
import { withWiki, type ZoneSources } from './zones.ts';
import { alarm } from '../ci/alarm.ts';

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    remote: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    file: { type: 'string' },
    sha: { type: 'string' },
    'zones-dir': { type: 'string' },
    // Order 28b, PR D: the zone data's wiki snapshot directory (import.yml's wiki job's artifact). Locally it defaults to
    // the committed snapshot (data/wiki-snapshot, order 28's override 8).
    'wiki-snapshot': { type: 'string' },
    // Order 28's override 9: the wiki job failed (its reason here): the game data imports, the zone tables keep
    // yesterday's data, and the run is recorded as zones-kept (failing, so the alarm notifies).
    'zones-kept': { type: 'string' },
  },
});

if (args.local === args.remote) throw new Error('pass exactly one of --local or --remote');
if (args['wiki-snapshot'] && args['zones-kept']) throw new Error('pass --wiki-snapshot or --zones-kept, not both');
if (args.remote && !args['wiki-snapshot'] && !args['zones-kept']) throw new Error('--remote needs --wiki-snapshot <dir>, or --zones-kept <reason> when the wiki job failed');

let db: Db;
let dispose = async () => {};
if (args.local) {
  ({ db, dispose } = await localDb());
} else {
  const apiToken = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiToken || !accountId) throw new Error('CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set');
  db = remoteDb({ apiToken, accountId, databaseId: copyDatabaseId() });
  console.log(`copy: ${currentCopy().name} (${currentCopy().database})`);
}

try {
  // Order 17: the zone sources come with wiki.json (fetched pinned), or from a directory zone-files.ts wrote (--zones-dir).
  let sha: string, raw: unknown, sources: ZoneSources | undefined;
  if (args.file) {
    sha = args.sha ?? 'local-file';
    raw = JSON.parse(readFileSync(args.file, 'utf8')) as unknown;
    sources = args['zones-dir'] ? readZoneDir(args['zones-dir']) : undefined;
  } else {
    const wiki = await fetchSource(process.env.GITHUB_TOKEN);
    ({ sha, raw } = wiki);
    sources = await fetchZoneSources({ name: SOURCE_NAME, sha, changedAt: wiki.changedAt }, process.env.GITHUB_TOKEN);
  }
  if (args['wiki-snapshot'] && !sources) throw new Error('--wiki-snapshot needs the zone sources: pass --zones-dir with --file');
  // Order 28b, PR D: the zone part reads the wiki snapshot, unless the wiki job failed (zones-kept: the tables stay).
  const zonesKept = args['zones-kept'];
  const zones = sources && !zonesKept ? withWiki(sources, readSnapshot(args['wiki-snapshot'] ?? COMMITTED_SNAPSHOT)) : undefined;
  if (zones) console.log(`wiki snapshot: revid ${zones.wiki.version.revid} (${zones.wiki.version.timestamp}), fetched ${zones.wiki.fetchedAt}`);
  if (zonesKept) console.log(`::warning::zone data kept (yesterday's): ${zonesKept}`);
  const result = await runImport(db, raw, {
    sourceSha: sha,
    now: () => new Date().toISOString(),
    dryRun: args['dry-run'],
    requireDryRun: args.remote,
    zones,
    zonesKept,
  });
  console.log(JSON.stringify({ target: args.local ? 'local' : 'remote', ...result }, null, 2));
  // Order 13: a new value for a /gear find choice list, or a stop at the write ceiling, shows in the run's summary as a
  // warning annotation; neither fails the run.
  for (const w of result.warnings ?? [])
    if (w.kind === 'vocab_drift') console.log(`::warning::/gear find ${w.list} list: ${w.values.map((v) => `${v.value} (${v.items})`).join(', ')} — ${w.note}`);
    else if (w.kind === 'write_ceiling')
      console.log(`::warning::import stopped at the write ceiling (${w.written} of ${w.ceiling} rows); ${w.deferredStatements} statements left for the next run`);
    // Order 17: a source unchanged for 30 days (its maintainer refreshes it by hand), and zone names matching no zone.
    else if (w.kind === 'stale_source') console.log(`::warning::${w.source} has not changed for ${w.days} days (last commit ${w.changedAt}); the zone data may be stale`);
    else if (w.kind === 'zone_names_unmatched') console.log(`::warning::${w.source}: ${w.names.length} zone name(s) match no zone: ${w.names.map((n) => JSON.stringify(n)).join(', ')}`);
  if (result.rowsWritten !== undefined) console.log(`rows written: ${result.rowsWritten} (ceiling ${result.ceiling})`);
  if (result.writeBound !== undefined) console.log(`dry run: at most ${result.writeBound} rows (ceiling ${result.ceiling}; the bound counts every index for every row)`);
  // Order 8 alarm rule (scripts/ci/alarm.ts): state = the newest row in the alarm state (src/import-status.ts); a
  // failure after a failure does not re-notify. Order 9: a refused run is failing, and now leaves its own row.
  const failed = isFailing(result.status);
  const previousFailing = !args['dry-run'] && args.remote ? await previousImportFailing(db) : null;
  alarm({ job: 'import', failed, reason: result.error ?? result.status, previousFailing });
} finally {
  await dispose();
}

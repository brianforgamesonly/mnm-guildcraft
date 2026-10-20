// Import CLI — the same code locally and in the nightly Action.
//   node scripts/import/run.ts --local  [--dry-run] [--file wiki.json --sha <sha>]
//   node scripts/import/run.ts --remote [--dry-run]   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID from the environment)
// Prints counts and IDs only, never a credential.

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { previousImportFailing, runImport, type Db } from './core.ts';
import { isFailing } from '../../src/import-status.ts';
import { currentCopy } from '../copies.ts';
import { copyDatabaseId, localDb, remoteDb } from './db.ts';
import { fetchSource } from './source.ts';
import { alarm } from '../ci/alarm.ts';

const { values: args } = parseArgs({
  options: {
    local: { type: 'boolean', default: false },
    remote: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    file: { type: 'string' },
    sha: { type: 'string' },
  },
});

if (args.local === args.remote) throw new Error('pass exactly one of --local or --remote');

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
  const { sha, raw } = args.file
    ? { sha: args.sha ?? 'local-file', raw: JSON.parse(readFileSync(args.file, 'utf8')) as unknown }
    : await fetchSource(process.env.GITHUB_TOKEN);
  const result = await runImport(db, raw, {
    sourceSha: sha,
    now: () => new Date().toISOString(),
    dryRun: args['dry-run'],
    requireDryRun: args.remote,
  });
  console.log(JSON.stringify({ target: args.local ? 'local' : 'remote', ...result }, null, 2));
  // Order 8 alarm rule (scripts/ci/alarm.ts): state = the newest row in the alarm state (src/import-status.ts); a
  // failure after a failure does not re-notify. Order 9: a refused run is failing, and now leaves its own row.
  const failed = isFailing(result.status);
  const previousFailing = !args['dry-run'] && args.remote ? await previousImportFailing(db) : null;
  alarm({ job: 'import', failed, reason: result.error ?? result.status, previousFailing });
} finally {
  await dispose();
}

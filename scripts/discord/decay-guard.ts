// Order 30 (ITEM 4): runs the decay guard on one copy by dispatch, without registering commands (a label change registers
// nothing). DRY_RUN=1 (the default) reports what it finds and writes nothing. Prints counts only, never a guild id.
// Env: GUILDCRAFT_COPY, DRY_RUN, DISCORD_BOT_TOKEN, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID.
import { currentCopy } from '../copies.ts';
import { callDecayGuard, workerUrl } from './dkp.ts';

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set`);
  return v;
}

const dry = process.env.DRY_RUN !== '0';
const copy = currentCopy();
const url = await workerUrl(copy.worker, need('CLOUDFLARE_ACCOUNT_ID'), need('CLOUDFLARE_API_TOKEN'));
const r = await callDecayGuard(url, need('DISCORD_BOT_TOKEN'), dry);
console.log(JSON.stringify({ copy: copy.name, dry_run: dry, ...r }));
if ('status' in r || r.counts.failed) process.exitCode = 1;

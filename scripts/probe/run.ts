// Work order 14, ITEM 1: the wiki reachability test from this machine or a GitHub-hosted runner, or (--from) the
// Cloudflare path's saved answer. Exits 0 whatever the wiki answers: a refusal is the result being measured.
//   node scripts/probe/run.ts --path local|github
//   node scripts/probe/run.ts --from cloudflare.json
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { probe, table, type ProbeResult } from './wiki.ts';

const { values } = parseArgs({ options: { path: { type: 'string' }, from: { type: 'string' } } });

let path: string;
let results: ProbeResult[];
let colo: string | undefined;
if (values.from) {
  const saved = JSON.parse(readFileSync(values.from, 'utf8')) as { path: string; colo?: string; results: ProbeResult[] };
  ({ path, colo, results } = saved);
} else {
  if (!values.path) throw new Error('--path local|github, or --from <file>');
  path = values.path;
  results = await probe();
}

console.log(JSON.stringify({ path, colo, results }, null, 2));
const md = `### Wiki reachability: ${path}${colo ? ` (Cloudflare colo ${colo})` : ''}\n\n${table(path, results)}\n`;
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');

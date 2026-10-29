// Order 28b, PR D: what the parser read from a wiki snapshot, for the job summary (it replaces order 28's comparison
// with Mo Betta, whose work ended with ITEM 3's gate). Writes nothing.
//   node scripts/wiki/report.ts --snapshot <dir>
// Public log: it prints wiki page titles and names only (game data), never guild data.
import { parseArgs } from 'node:util';
import { readSnapshot } from '../import/zone-files.ts';
import { parseSnapshot, type WikiParse } from './parse.ts';
import type { WikiSnapshot } from './types.ts';

const list = (xs: string[], max = 40) => (xs.length ? xs.slice(0, max).map((x) => `- ${x}`).join('\n') + (xs.length > max ? `\n- … and ${xs.length - max} more` : '') : '- none');

export function report(snap: WikiSnapshot, p: WikiParse = parseSnapshot(snap)): string {
  const s = p.summary;
  return [
    '## The wiki snapshot, as parsed',
    `Snapshot: revid ${snap.version.revid} (${snap.version.timestamp}), fetched ${snap.fetchedAt}. Requests: ${snap.requests.count} (maxlag waits ${snap.requests.maxlagWaits}), ${snap.requests.bytes} bytes.`,
    `Zones: ${p.zones.length} (pages without {{ZoneDetails}}: ${s.zonePagesWithoutTemplate.join(', ') || 'none'}). NPC blocks: ${p.npcs.length} (${Object.entries(s.npcBlocks).map(([t, n]) => `${t} ${n}`).join(', ')}); NPC pages with no template: ${s.npcPagesWithoutTemplate.length}. Quests: ${s.questPages}, ${s.questsWithRewards} with reward lines.`,
    `Named Mobs: ${s.named.pages} pages; Raid Encounters: ${s.raid.pages}; Merchant: ${s.merchantPages}.`,
    `Blocks with no zone (no row): ${s.blocksWithoutZone.map((b) => b.page).join(', ') || 'none'}.`,
    `Values holding a template (not read): ${s.templateValues.length}. Loot fields with text but no bullets: ${s.lootWithoutBullets.length}.`,
    // Order 28b: names are kept as written; these are for fixing on the wiki.
    `Names that differ from their page title by more than the first letter's case (${s.nameMismatches.length}; fix on the wiki):\n${list(s.nameMismatches.map((m) => `"${m.name}" on page "${m.page}"`), 60)}`,
  ].join('\n\n');
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { snapshot: { type: 'string' } } });
  if (!args.snapshot) throw new Error('--snapshot is required');
  console.log(report(readSnapshot(args.snapshot)));
}

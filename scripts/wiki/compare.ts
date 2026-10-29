// Order 28, ITEM 3: the wiki snapshot against Mo Betta, and the gate. Writes nothing to any database.
//   node scripts/wiki/compare.ts --snapshot <dir with snapshot.json> --zones-dir <dir from scripts/import/zone-files.ts> [--json <file>]
// Both zone plans are built by the import's own code (scripts/import/zones.ts buildZonePlan), with the same mnm-tools
// mobs and maps, so a difference is the zone source's. Prints Markdown (the job summary); public game data only.
// Gate line 5 (the first import's writes) is measured separately, on a local D1 (scripts/import/run.ts --wiki-snapshot).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildPlan, checkStructure, zoneInputsOf, type ExistingState, type WikiData } from '../import/core.ts';
import { readZoneDir } from '../import/zone-files.ts';
import { buildZonePlan, wikiVersion, type NpcRow, type ZoneInput, type ZonePlan } from '../import/zones.ts';
import { parseSnapshot, type WikiParse } from './parse.ts';
import { CATEGORIES, treePages, type WikiSnapshot } from './types.ts';

const emptyExisting = (): ExistingState => ({
  tradeskills: new Map(), items: new Map(), recipes: new Map(), activeWikiRecipes: 0, classes: new Map(), mobs: new Map(), zones: new Map(),
  zoneNames: new Map(), npcs: new Map(), factions: new Map(), factionLinks: new Map(), questLines: new Map(), importSources: new Map(), indexes: {},
});

const npcKey = (n: Pick<NpcRow, 'zone_key' | 'name'>) => `${n.zone_key}|${n.name.toLowerCase()}`;
const NPC_COMPARED = ['kind', 'level', 'race', 'class', 'location', 'loot_json'] as const;

export interface Comparison {
  zones: { moBetta: number; wiki: number; onlyMoBetta: string[]; onlyWiki: string[]; fields: Record<string, FieldDiff> };
  npcs: {
    moBetta: number;
    wiki: number;
    added: number;
    missing: { zone: string; name: string; why: string }[];
    /** Wiki NPC names with rows in more than one zone, and how many of them Mo Betta held in one zone only. */
    multiZone: { names: number; moBettaSingleZone: number; examples: string[] };
    fields: Record<string, FieldDiff>;
  };
  factions: { moBetta: number; wiki: number; added: string[]; removed: string[]; links: { moBetta: number; wiki: number; lost: number; gained: number; missing: string[] } };
  quests: { moBetta: number; wiki: number; lost: string[]; bucket: { fields: string[]; rows: number | null; error?: string } };
  tags: { zone: string; named: number; raid: number }[];
  parse: WikiParse['summary'];
  gate: { line: number; text: string; pass: boolean; detail: string[] }[];
  recentChanges: { total: number; zoneData: number; titles: string[] };
  requests: Omit<WikiSnapshot['requests'], 'log'>;
}
interface FieldDiff {
  both: number;
  same: number;
  differ: number;
  onlyMoBetta: number;
  onlyWiki: number;
  /** A field that is 100% identical or 100% different is checked by hand (order 28, B 13). */
  flag: string | null;
  examples: { name: string; moBetta: string | null; wiki: string | null }[];
}

function fieldDiffs<T>(pairs: [string, T, T][], fields: readonly (keyof T & string)[]): Record<string, FieldDiff> {
  const out: Record<string, FieldDiff> = {};
  for (const f of fields) {
    const d: FieldDiff = { both: 0, same: 0, differ: 0, onlyMoBetta: 0, onlyWiki: 0, flag: null, examples: [] };
    for (const [name, a, b] of pairs) {
      const x = (a[f] ?? null) as string | null;
      const y = (b[f] ?? null) as string | null;
      if (x === null && y === null) continue;
      if (x === null) d.onlyWiki++;
      else if (y === null) d.onlyMoBetta++;
      else {
        d.both++;
        if (x === y) d.same++;
        else {
          d.differ++;
          if (d.examples.length < 3) d.examples.push({ name, moBetta: x, wiki: y });
        }
      }
    }
    if (d.both > 0 && (d.same === d.both || d.differ === d.both)) d.flag = d.same === d.both ? '100% identical' : '100% different';
    out[f] = d;
  }
  return out;
}

/** The zones a plan gives creatures: an npc row that is not a merchant, or a mob whose zone name maps there (as DKP reads them). */
function creatureZones(plan: ZonePlan, mobs: { zones: string[] }[]): Set<string> {
  const mapped = new Map(plan.names.filter((n) => n.source === 'mnm-tools:mobs' && n.zone_key).map((n) => [n.name, n.zone_key!]));
  const zones = new Set(plan.npcs.filter((n) => (n.kind ?? '').toLowerCase() !== 'merchant').map((n) => n.zone_key));
  for (const m of mobs) for (const z of m.zones) if (mapped.has(z)) zones.add(mapped.get(z)!);
  return zones;
}

export function compare(snap: WikiSnapshot, zones: ZoneInput, wiki: WikiData, now: string): Comparison {
  const plan = buildPlan(wiki, emptyExisting());
  const { mobs, wikiZones } = zoneInputsOf(wiki, plan);
  const mo = buildZonePlan(zones, mobs, wikiZones, now);
  const wk = buildZonePlan({ ...zones, versions: [...zones.versions, wikiVersion(snap)], wiki: snap }, mobs, wikiZones, now);
  const parsed = parseSnapshot(snap);
  const zoneName = (p: ZonePlan, k: string) => p.zones.find((z) => z.key === k)?.name ?? k;

  // Zones: the zone source's own registry, and the zone rows' fields where both have the zone.
  const reg = (p: ZonePlan, s: string) => new Set(p.names.filter((n) => n.source === s).map((n) => n.zone_key ?? `(unmatched) ${n.name}`));
  const moReg = reg(mo, 'mo-betta:zones');
  const wkReg = reg(wk, 'wiki:zones');
  const wkZones = new Map(wk.zones.map((z) => [z.key, z]));
  const zonePairs = mo.zones.filter((z) => wkZones.has(z.key)).map((z): [string, typeof z, typeof z] => [z.name, z, wkZones.get(z.key)!]);

  // NPCs: unique name × zone.
  const moN = new Map(mo.npcs.map((n) => [npcKey(n), n]));
  const wkN = new Map(wk.npcs.map((n) => [npcKey(n), n]));
  const byPage = new Map<string, WikiParse['npcs']>();
  for (const n of parsed.npcs) byPage.set(n.page.toLowerCase(), [...(byPage.get(n.page.toLowerCase()) ?? []), n]);
  const npcTree = new Set([...treePages(snap, CATEGORIES.npcs)].map((t) => t.toLowerCase()));
  const pageTitles = new Map(Object.keys(snap.pages).map((t) => [t.toLowerCase(), t]));
  const why = (n: NpcRow): string => {
    const elsewhere = wk.npcs.filter((w) => w.name.toLowerCase() === n.name.toLowerCase()).map((w) => zoneName(wk, w.zone_key));
    if (elsewhere.length) return `the wiki has it in ${elsewhere.join(', ')}`;
    const blocks = byPage.get(n.name.toLowerCase());
    if (blocks?.length) return `its page's blocks name ${blocks.map((b) => (b.zone ? `"${b.zone}"` : 'no zone')).join(', ')}${blocks.some((b) => b.name.toLowerCase() !== n.name.toLowerCase()) ? ` (name field: ${blocks.map((b) => b.name).join(', ')})` : ''}`;
    if (npcTree.has(n.name.toLowerCase())) return 'its page uses none of the NPC templates';
    if (pageTitles.has(n.name.toLowerCase())) return 'its page is not under Category:NPCs';
    return 'no page of that title in the snapshot';
  };
  const missing = mo.npcs.filter((n) => !wkN.has(npcKey(n))).map((n) => ({ zone: zoneName(mo, n.zone_key), name: n.name, why: why(n) }));
  // Order 28b: a miss whose wiki page names it differently (a name field that differs from its title) is explained by
  // wiki content, not by the parser: Mo Betta keyed it by the page title, the import by the name field.
  const renamed = new Set(parsed.summary.nameMismatches.map((m) => m.page.toLowerCase()));
  const byWikiContent = (m: { name: string }) => renamed.has(m.name.toLowerCase());
  const zonesOf = (p: ZonePlan) => {
    const m = new Map<string, Set<string>>();
    for (const n of p.npcs) m.set(n.name.toLowerCase(), (m.get(n.name.toLowerCase()) ?? new Set()).add(n.zone_key));
    return m;
  };
  const moZ = zonesOf(mo);
  const multi = [...zonesOf(wk)].filter(([, z]) => z.size > 1);
  const npcPairs = mo.npcs.filter((n) => wkN.has(npcKey(n))).map((n): [string, NpcRow, NpcRow] => [`${n.name} (${zoneName(mo, n.zone_key)})`, n, wkN.get(npcKey(n))!]);

  // Factions, their links, and the posts a change would retire (a faction is shown while it has an active link).
  const linkId = (l: { zone_key: string; npc_name: string; faction: string; kind: string }) => `${l.zone_key}|${l.npc_name.toLowerCase()}|${l.faction}|${l.kind}`;
  const moL = new Set(mo.factionLinks.map(linkId));
  const wkL = new Set(wk.factionLinks.map(linkId));
  const linked = (p: ZonePlan) => new Set(p.factionLinks.map((l) => l.faction));
  const moF = linked(mo);
  const wkF = linked(wk);
  const lostLinks = [...moL].filter((l) => !wkL.has(l));

  // Quests with "Faction…" lines.
  const questsWith = (p: ZonePlan) => new Set(p.questLines.map((q) => q.quest));
  const moQ = questsWith(mo);
  const wkQ = questsWith(wk);

  // Named and raid, per zone.
  const tags = new Map<string, { named: number; raid: number }>();
  for (const n of wk.npcs)
    if (n.named || n.raid) {
      const t = tags.get(n.zone_key) ?? { named: 0, raid: 0 };
      t.named += n.named ?? 0;
      t.raid += n.raid ?? 0;
      tags.set(n.zone_key, t);
    }

  // The gate (lines 1-4 and 6; line 5 is measured on a local D1).
  const moCz = creatureZones(mo, mobs);
  const wkCz = creatureZones(wk, mobs);
  const zonesLost = [...moCz].filter((z) => !wkCz.has(z)).map((z) => zoneName(mo, z));
  const lostQuests = [...moQ].filter((q) => !wkQ.has(q)).sort();
  const gate: Comparison['gate'] = [
    { line: 1, text: 'Every zone that has creatures today still has creatures', pass: zonesLost.length === 0, detail: zonesLost },
    {
      line: 2,
      text: `The wiki's NPC count (unique name × zone) is at least Mo Betta's (${wkN.size} against ${moN.size}), or each missing one is listed and explained`,
      pass: wkN.size >= moN.size || missing.every(byWikiContent),
      detail: missing.map((m) => `${m.name} (${m.zone}): ${m.why}${byWikiContent(m) ? ' — wiki content (name field ≠ page title)' : ' — NOT explained by wiki content'}`),
    },
    { line: 3, text: `Faction links are at least today's (${wk.factionLinks.length} against ${mo.factionLinks.length})`, pass: wk.factionLinks.length >= mo.factionLinks.length, detail: lostLinks },
    { line: 4, text: `Quests with "Faction…" lines: none lost (${wkQ.size} against ${moQ.size})`, pass: lostQuests.length === 0, detail: lostQuests },
    {
      line: 6,
      text: "Factions added or deactivated, and faction posts retired, listed for Brian's OK",
      pass: false, // never passes by itself: it waits for the owner's OK on the list
      detail: [
        ...[...wkF].filter((f) => !moF.has(f)).sort().map((f) => `added: ${f}`),
        ...[...moF].filter((f) => !wkF.has(f)).sort().map((f) => `deactivated (its post retired in every guild that has one): ${f}`),
      ],
    },
  ];

  const zoneTitles = treePages(snap, CATEGORIES.zones);
  const questTitles = treePages(snap, CATEGORIES.quests);
  const npcTitles = treePages(snap, CATEGORIES.npcs);
  const changed = [...new Set(snap.recentChanges.changes.map((c) => c.title))];
  const zoneData = changed.filter((t) => npcTitles.has(t) || zoneTitles.has(t) || questTitles.has(t));
  const { log: _log, ...requests } = snap.requests;

  return {
    zones: {
      moBetta: moReg.size,
      wiki: wkReg.size,
      onlyMoBetta: [...moReg].filter((k) => !wkReg.has(k)).map((k) => zoneName(mo, k)).sort(),
      onlyWiki: [...wkReg].filter((k) => !moReg.has(k)).map((k) => zoneName(wk, k)).sort(),
      fields: fieldDiffs(zonePairs, ['level', 'description', 'adjacent_json', 'wiki_url', 'map_json'] as const),
    },
    npcs: {
      moBetta: moN.size,
      wiki: wkN.size,
      added: [...wkN.keys()].filter((k) => !moN.has(k)).length,
      missing,
      multiZone: { names: multi.length, moBettaSingleZone: multi.filter(([n]) => (moZ.get(n)?.size ?? 0) === 1).length, examples: multi.slice(0, 5).map(([n, z]) => `${n}: ${[...z].map((k) => zoneName(wk, k)).join(', ')}`) },
      fields: fieldDiffs(npcPairs, NPC_COMPARED),
    },
    factions: {
      moBetta: moF.size,
      wiki: wkF.size,
      added: [...wkF].filter((f) => !moF.has(f)).sort(),
      removed: [...moF].filter((f) => !wkF.has(f)).sort(),
      links: { moBetta: mo.factionLinks.length, wiki: wk.factionLinks.length, lost: lostLinks.length, gained: [...wkL].filter((l) => !moL.has(l)).length, missing: lostLinks },
    },
    quests: {
      moBetta: moQ.size,
      wiki: wkQ.size,
      lost: lostQuests,
      bucket: { fields: snap.buckets.quests?.fields ?? [], rows: snap.buckets.quests?.rows?.length ?? null, ...(snap.buckets.quests?.error ? { error: snap.buckets.quests.error } : {}) },
    },
    tags: [...tags].map(([k, t]) => ({ zone: zoneName(wk, k), ...t })).sort((a, b) => a.zone.localeCompare(b.zone)),
    parse: parsed.summary,
    gate,
    recentChanges: { total: changed.length, zoneData: zoneData.length, titles: zoneData },
    requests,
  };
}

const list = (xs: string[], max = 40) => (xs.length ? xs.slice(0, max).map((x) => `- ${x}`).join('\n') + (xs.length > max ? `\n- … and ${xs.length - max} more` : '') : '- none');
const fieldTable = (fs: Record<string, FieldDiff>) =>
  ['| Field | Both hold | Same | Differ | Only Mo Betta | Only wiki | Check |', '|---|---|---|---|---|---|---|']
    .concat(Object.entries(fs).map(([f, d]) => `| ${f} | ${d.both} | ${d.same} | ${d.differ} | ${d.onlyMoBetta} | ${d.onlyWiki} | ${d.flag ?? ''} |`))
    .join('\n');

export function markdown(c: Comparison): string {
  const p = c.parse;
  return [
    '## Order 28, ITEM 3: the wiki snapshot against Mo Betta',
    `Requests: ${c.requests.count} (maxlag waits ${c.requests.maxlagWaits}), ${c.requests.bytes} bytes.`,
    `NPC tree: ${p.npcTree.categories} categories, ${p.npcTree.depth} level(s) of subcategories, ${p.npcTree.pages} pages (${p.npcTree.pagesWithContent} with content). Blocks: ${Object.entries(p.npcBlocks).map(([t, n]) => `${t} ${n}`).join(', ')}. Pages with none: ${p.npcPagesWithoutTemplate.length}. Blocks with no zone: ${p.blocksWithoutZone.map((b) => b.page).join(', ') || 'none'}. Loot fields with text but no bullets: ${p.lootWithoutBullets.length}. Values holding a template (not read): ${p.templateValues.length} (${[...new Set(p.templateValues.map((v) => v.field))].join(', ') || 'none'}).`,
    `Named Mobs: ${p.named.pages} pages (outside the NPC tree: ${p.named.outsideTree.join(', ') || 'none'}). Raid Encounters: ${p.raid.pages} (outside: ${p.raid.outsideTree.join(', ') || 'none'}). Merchant: ${p.merchantPages}. Zone pages: ${p.zonePages} (no {{ZoneDetails}}: ${p.zonePagesWithoutTemplate.join(', ') || 'none'}). Quest pages: ${p.questPages}, ${p.questsWithRewards} with reward lines.`,
    // Order 28b: the name field is kept as written (the title only when there is none); these are for fixing on the wiki.
    `Names that differ from their page title by more than the first letter's case (${p.nameMismatches.length}; fix on the wiki):\n${list(p.nameMismatches.map((m) => `"${m.name}" on page "${m.page}"`), 60)}`,
    '### Zones',
    `Registry zones: Mo Betta ${c.zones.moBetta}, wiki ${c.zones.wiki}.`,
    `Only Mo Betta:\n${list(c.zones.onlyMoBetta)}`,
    `Only the wiki:\n${list(c.zones.onlyWiki)}`,
    fieldTable(c.zones.fields),
    '### NPCs (unique name × zone)',
    `Mo Betta ${c.npcs.moBetta}, wiki ${c.npcs.wiki}; added ${c.npcs.added}, missing ${c.npcs.missing.length}. In more than one zone on the wiki: ${c.npcs.multiZone.names} names, ${c.npcs.multiZone.moBettaSingleZone} of which Mo Betta held in one zone.`,
    list(c.npcs.multiZone.examples, 5),
    fieldTable(c.npcs.fields),
    '### Factions',
    `Factions with links: Mo Betta ${c.factions.moBetta}, wiki ${c.factions.wiki}. Links: Mo Betta ${c.factions.links.moBetta}, wiki ${c.factions.links.wiki} (lost ${c.factions.links.lost}, gained ${c.factions.links.gained}).`,
    `Added:\n${list(c.factions.added)}`,
    `Removed:\n${list(c.factions.removed)}`,
    '### Quest lines',
    `Quests with "Faction…" lines: Mo Betta ${c.quests.moBetta}, wiki pages ${c.quests.wiki}. Quests bucket: ${c.quests.bucket.rows ?? 'not read'} rows, fields ${c.quests.bucket.fields.join(', ') || 'none'}${c.quests.bucket.error ? ` (${c.quests.bucket.error})` : ''}.`,
    `Lost:\n${list(c.quests.lost)}`,
    '### Named and raid, per zone',
    ['| Zone | Named | Raid |', '|---|---|---|', ...c.tags.map((t) => `| ${t.zone} | ${t.named} | ${t.raid} |`)].join('\n'),
    '### Recent changes (24 h)',
    `${c.recentChanges.total} main-namespace pages edited, ${c.recentChanges.zoneData} of them NPC, zone or quest pages.`,
    '### The gate',
    // Lines 2-4 also hold when each missing one is listed (and, line 2, explained): BELOW means "read the list".
    ...c.gate.map(
      (g) => `**Line ${g.line}: ${g.line === 6 ? "WAITS FOR BRIAN'S OK" : g.pass ? 'PASS' : g.line === 1 ? 'FAIL' : 'BELOW, each listed'}** — ${g.text}\n${list(g.detail, 60)}`,
    ),
    '**Line 5** — the first import\'s writes: measured on a local D1 (the "Measure" step).',
  ].join('\n\n');
}

if (import.meta.main) {
  const { values: args } = parseArgs({ options: { snapshot: { type: 'string' }, 'zones-dir': { type: 'string' }, json: { type: 'string' } } });
  if (!args.snapshot || !args['zones-dir']) throw new Error('--snapshot and --zones-dir are required');
  const snap = JSON.parse(readFileSync(join(args.snapshot, 'snapshot.json'), 'utf8')) as WikiSnapshot;
  const zones = readZoneDir(args['zones-dir']);
  const wiki = checkStructure(JSON.parse(readFileSync(join(args['zones-dir'], 'mnm-tools__wiki.json'), 'utf8')));
  const c = compare(snap, zones, wiki, new Date().toISOString());
  if (args.json) writeFileSync(args.json, JSON.stringify(c, null, 2));
  console.log(markdown(c));
}

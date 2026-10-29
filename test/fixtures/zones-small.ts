// Order 17: small zone sources shaped like the real ones (mnm-tools maps.json, MnM Atlas data/maps.json), and the zone,
// NPC and quest records each case the zone import handles: a curly apostrophe, a case variant, a space-only list, " or ",
// an unmatched adjacent zone, records equal but for case, a merchant, and a mob whose fields conflict with an NPC's or
// are filled by it. Order 28b, PR D: those records reach the import as a wiki snapshot (the only zone source), written
// here as the wiki's own templates ({{ZoneDetails}}, {{Namedmobpage}}, {{Merchantpage}}, a quest's "== Rewards ==").
import type { WikiData } from '../../scripts/import/core.ts';
import { withWiki, type ZoneInput } from '../../scripts/import/zones.ts';
import { CATEGORIES, type SnapshotCategory, type WikiSnapshot } from '../../scripts/wiki/types.ts';

interface ZoneRec { name: string; level: string; adjacent: string[] }
interface NpcRec { name: string; merchant?: boolean; level: string; zone: string; race: string; class: string; location: string; loot: string[]; factions?: string[]; opposing_factions?: string[]; named?: boolean; raid?: boolean }
interface QuestRec { title: string; rewards: string[] }

const ZONES: ZoneRec[] = [
  { name: 'Evershade Weald', level: '1 - ??', adjacent: ["Keeper's Bight", 'Fields of the Lost'] },
  { name: "Keeper's Bight", level: '5 - ??', adjacent: ['Evershade Weald'] },
  { name: 'Rothold', level: '30-45', adjacent: [] },
  { name: "Ail'Vorith", level: '1 - 50', adjacent: [] },
];
const NPCS: NpcRec[] = [
  // Order 24: factions ("Reputation Lost") and opposing_factions ("Reputation Gained"), as the wiki infobox records them.
  { name: 'A gnoll scout', level: '~8-11', zone: 'Evershade Weald', race: 'Gnoll', class: '', location: 'North', loot: ['Gnoll Tooth'], factions: ['Gnoll Pack'], opposing_factions: ['Weald Rangers'] },
  { name: 'A Gnoll scout', level: '', zone: 'Evershade Weald', race: 'Gnoll', class: 'Warrior', location: 'South', loot: [], factions: [' Gnoll Pack '], opposing_factions: [] },
  { name: 'Marshal Harding', level: '20', zone: "Evershade Weald, Keeper's Bight", race: 'Human', class: 'Paladin', location: '', loot: [], factions: ['Weald Rangers'], opposing_factions: ['Gnoll Pack', 'Gnoll Pack Elders'], named: true },
  { name: 'Supplier Jul', merchant: true, level: '', zone: "Ail'vorith", race: 'Deep Elf', class: '', location: '', loot: [] },
  { name: 'A wanderer', level: '', zone: "Rothold or Keeper's Bight", race: '', class: '', location: '', loot: [] },
  { name: 'A lost soul', level: '??', zone: 'Evershade Weald Rothold', race: '', class: '', location: '', loot: [], factions: ['Weald Rangers'] },
  { name: 'A nobody', level: '', zone: '', race: '', class: '', location: '', loot: [], factions: ['Lost Cause'] },
];
// Order 25: reward lines starting "Faction" (any case), one naming two factions where a shorter name overlaps a longer
// one, one naming no stored faction, and rewards that are not faction lines.
const QUESTS: QuestRec[] = [
  { title: 'Ranger Trial', rewards: ['Faction standing with Weald Rangers', 'Experience'] },
  { title: 'Elder Words', rewards: ['faction with Gnoll Pack Elders and Weald Rangers'] },
  { title: 'Fight Night', rewards: ['Faction with The Fight Club'] },
  { title: 'Tooth Collector', rewards: ['Gnoll Pack Tooth', 'Weald Rangers faction'] },
];

const linked = (xs: string[] = []) => xs.map((x) => `[[${x}]]`).join(', ');
const npcPage = (n: NpcRec) =>
  `{{${n.merchant ? 'Merchantpage' : 'Namedmobpage'}\n|name = ${n.name}\n|zone = ${n.zone}\n|level = ${n.level}\n|race = ${n.race}\n|class = ${n.class}\n|location = ${n.location}\n` +
  `|known_loot =\n${n.loot.map((l) => `* [[${l}]]`).join('\n')}\n|factions = ${linked(n.factions)}\n|opposing_factions = ${linked(n.opposing_factions)}\n}}`;
const zonePage = (z: ZoneRec) => `{{ZoneDetails\n|Level = ${z.level}\n|AdjacentZones = ${linked(z.adjacent)}\n}}`;
const questPage = (q: QuestRec) => `{{Quest\n|Start Zone = Rothold\n}}\n== Rewards ==\n${q.rewards.map((r) => `* ${r}`).join('\n')}\n`;

/** The records a test may edit before they become pages (a fresh copy each call). */
export interface ZoneRecords { zones: ZoneRec[]; npcs: NpcRec[]; quests: QuestRec[] }
export type EditRecords = (r: ZoneRecords) => void;

/** The records above (after `edit`) as a wiki snapshot: one page each, in the categories the parser reads. */
export function snapshotOf(edit: EditRecords = () => {}, revTime = '2026-10-20T00:00:00Z'): WikiSnapshot {
  const r: ZoneRecords = structuredClone({ zones: ZONES, npcs: NPCS, quests: QUESTS });
  edit(r);
  const { zones: ZONES_, npcs: NPCS_, quests: QUESTS_ } = r;
  const contents: [string, string][] = [...ZONES_.map((z): [string, string] => [z.name, zonePage(z)]), ...NPCS_.map((n): [string, string] => [n.name, npcPage(n)]), ...QUESTS_.map((q): [string, string] => [q.title, questPage(q)])];
  const pages = Object.fromEntries(contents.map(([title, content], i) => [title, { pageid: i + 1, title, ns: 0, revid: 100 + i, timestamp: revTime, content }]));
  const cat = (root: string, titles: string[]): SnapshotCategory => ({ pages: titles, subcats: [], depth: 0, roots: [root] });
  return {
    site: 'Monsters and Memories Wiki · MediaWiki (fixture)',
    fetchedAt: revTime,
    version: { revid: 100 + contents.length - 1, timestamp: revTime },
    categories: {
      [CATEGORIES.zones]: cat(CATEGORIES.zones, ZONES_.map((z) => z.name)),
      [CATEGORIES.npcs]: cat(CATEGORIES.npcs, NPCS_.map((n) => n.name)),
      [CATEGORIES.quests]: cat(CATEGORIES.quests, QUESTS_.map((q) => q.title)),
      [CATEGORIES.merchant]: cat(CATEGORIES.merchant, NPCS_.filter((n) => n.merchant).map((n) => n.name)),
      [CATEGORIES.named]: cat(CATEGORIES.named, NPCS_.filter((n) => n.named).map((n) => n.name)),
      [CATEGORIES.raid]: cat(CATEGORIES.raid, NPCS_.filter((n) => n.raid).map((n) => n.name)),
    },
    pages,
    buckets: {},
    recentChanges: { since: revTime, changes: [] },
    requests: { count: 0, bytes: 0, maxlagWaits: 0, log: [] },
  };
}

export function zoneInput(changedAt = '2026-10-20T00:00:00Z', edit?: EditRecords): ZoneInput {
  return withWiki(
    {
      files: {
        'mnm-tools/maps.json': {
          generatedAt: '2026-07-02T00:00:00Z',
          categories: [],
          zones: [
            {
              name: 'Evershade Weald',
              image: 'evershade_weald.avif',
              markers: [
                { x: 1, y: 2, label: 'Copper Vein', category: 'ore', notes: '' },
                { x: 3, y: 4, label: 'Old Hermit', category: 'quest', notes: 'https://mnm-db.com/#/mob/x\n\nAsk twice' },
              ],
              width: 10,
              height: 10,
            },
            { name: "Keeper's Bight", image: 'keeper_s_bight.avif', markers: [] },
            { name: 'Rothold', image: 'rothold.avif', markers: [], source: 'wiki: Rothold map by skoop.png' },
          ],
        },
        'mnmatlas/maps.json': {
          version: 1,
          defaultMap: 'world',
          maps: [
            { id: 'world', title: 'World map' },
            { id: 'evershade-weald', title: 'Evershade Weald' },
            { id: 'keepers-bight', title: 'Keeper’s Bight' },
            { id: 'rothold', title: 'Rothold' },
          ],
        },
      },
      versions: [
        { name: 'mnm-tools/wiki.json', sha: 'b'.repeat(40), changedAt: '2026-10-20T00:00:00Z' },
        { name: 'mnm-tools/maps.json', sha: 'c'.repeat(40), changedAt },
        { name: 'mnmatlas/maps.json', sha: 'd'.repeat(40), changedAt: '2025-01-01T00:00:00Z' },
      ],
    },
    snapshotOf(edit),
  );
}

/** The wiki fixture with the mobs and wikiZones the zone sources meet. */
export function withZoneWiki(base: unknown): WikiData {
  const f = structuredClone(base) as WikiData;
  f.items['Gnoll Tooth'] = { wikiZones: ['Evershade Weald'] };
  f.items['Bight Shell'] = { wikiZones: ["Keeper's Bight", 'Sunken Resort'] };
  f.mobs = {
    'a gnoll scout': { title: 'A gnoll scout', level: '8 - 10', race: 'Gnoll', class: null, zone: '[[Evershade Weald]]', loot: ['Gnoll Tooth', 'Gnoll Pelt'] },
    'a curious jackal': { title: 'A curious jackal', level: '3', zone: 'Evershade Weald' },
  };
  return f;
}

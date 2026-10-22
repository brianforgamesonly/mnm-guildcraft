// /zone (work order 17, ITEMs 2–3; order 17b): a zone's card, private with Post to channel, from the zone data the nightly
// import keeps (scripts/import/zones.ts). Link buttons: Wiki (Miraheze), MnM Wiki, Stories of MnM, Zone connections and
// Open in MnM Atlas, each only when the zone has that page. Action buttons: Post to channel, Gear here (asks for the class,
// then shows /gear find's results for this zone) and More creatures (paged, private). No writes beyond the read audit row
// 'zone.view' (src/interactions.ts).
import type { Ctx } from '../context.ts';
import { button, ephemeral, linkButton, md, optString, row, updateMessage, type MessageReply, type Option } from '../discord.ts';
import { unknownZone } from '../zone/suggest.ts';
import { ANY, SORTS, ZONE_STATE_MAX, type GearQuery } from '../gear/options.ts';
import { gameList } from '../gamedata.ts';
import { atlasMapUrl, listEmbed, loadZone, safeUrl, ZONE_CONNECTIONS, ZONE_COPY, zoneEmbeds, zoneSites, type ZoneData } from '../zone/card.ts';
import { zoneKey } from '../zone/names.ts';
import { gearResults } from './gear.ts';
import { postedReply, searchReply } from './share.ts';

/** Post to channel: "pub:zone:<zone key>" (src/commands/share.ts POST_PREFIX). */
export const POST_WHAT = 'zone:';
/** Gear here, from the card (private or posted): a new private class select. */
export const GEAR_PREFIX = 'zg:';
/** The class select ("zgc:<key>"): the results replace it (their sort select is /gear find's, src/commands/gear.ts). */
export const GEAR_CLASS_PREFIX = 'zgc:';
/** More creatures from the card: a new private page. */
export const CREATURES_PREFIX = 'zc:';
/** Previous / Next on a page: "zcn:<page>:<key>", editing the page in place. */
export const CREATURES_PAGE_PREFIX = 'zcn:';
/** Order 17 cards already posted carry More drops ("zd:", "zdn:"); order 17b removed the list, so a press says so. */
export const DROPS_PREFIX = 'zd:';
export const DROPS_PAGE_PREFIX = 'zdn:';

// ---------------------------------------------------------------- copy (orders 17 and 17b; listed for approval in docs/COPY.md)

export const ZONE_REPLY_COPY = {
  gone: 'That zone is no longer in the data. Run `/zone` again.',
  dropsRemoved: 'Zone cards no longer list drops. Press **Gear here** on the card to find the zone\'s gear for your class.',
  gearPick: (zone: string) => `Gear from **${md(zone)}**: pick your class (or Any). You can change the sort on the results.`,
  classPlaceholder: 'Your class, or Any',
  noClasses: 'No classes are loaded yet. Try `/gear find` once the nightly import has run.',
} as const;

// ---------------------------------------------------------------- the card

/** Discord's limit: five buttons in a row. */
const ROW_MAX = 5;

/**
 * The card's link buttons (one row, kept on a posted copy), in a fixed order, each only when the zone has that page:
 * a link to a page the site does not have is never offered (order 17b: no fallback to an index or the atlas's world map).
 */
export function zoneLinks(d: ZoneData): unknown[] {
  const z = d.zone;
  const sites = zoneSites(z.key);
  const wiki = safeUrl(z.wiki_url);
  return [
    ...(wiki ? [linkButton(ZONE_COPY.wikiPage, wiki)] : []),
    ...(sites.mnmWiki ? [linkButton(ZONE_COPY.mnmWiki, sites.mnmWiki)] : []),
    ...(sites.stories ? [linkButton(ZONE_COPY.stories, sites.stories)] : []),
    linkButton(ZONE_COPY.connections, ZONE_CONNECTIONS),
    ...(z.atlas_id ? [linkButton(ZONE_COPY.openAtlas, atlasMapUrl(z.atlas_id))] : []),
  ].slice(0, ROW_MAX);
}

/** The card's action buttons (each press answers the presser privately); Post to channel goes first on a private card. */
function actionButtons(d: ZoneData): unknown[] {
  const z = d.zone;
  return [
    button(`${GEAR_PREFIX}${z.key}`, ZONE_COPY.gearHere, undefined, z.key.length > ZONE_STATE_MAX),
    // The card may show fewer than 10 lines when long ones fill a field, so the list is pageable whenever it has rows.
    button(`${CREATURES_PREFIX}${z.key}`, ZONE_COPY.moreCreatures, undefined, !d.creatures.length),
  ];
}

export async function zoneCommand(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = optString(opts, 'name') ?? '';
  const d = await loadZone(c.db, zoneKey(typed));
  if (!d) return unknownZone(c.db, typed);
  return searchReply({ embeds: zoneEmbeds(d, c.atlasZoneImages === true) }, `${POST_WHAT}${d.zone.key}`, zoneLinks(d), [], actionButtons(d));
}

/** pub:zone:<key>: the card, posted; its buttons answer each presser privately. */
export async function postZone(c: Ctx, key: string): Promise<MessageReply> {
  const d = await loadZone(c.db, key);
  if (!d) return ephemeral(ZONE_REPLY_COPY.gone);
  return postedReply({ embeds: zoneEmbeds(d, c.atlasZoneImages === true) }, c.userId, zoneLinks(d), [row(actionButtons(d))]);
}

// ---------------------------------------------------------------- More creatures

function listReply(d: ZoneData, page: number, inPlace: boolean): MessageReply {
  const l = listEmbed(d, page);
  const nav = row([
    button(`${CREATURES_PAGE_PREFIX}${l.page - 1}:${d.zone.key}`, ZONE_COPY.previous, undefined, l.page === 0),
    button(`${CREATURES_PAGE_PREFIX}${l.page + 1}:${d.zone.key}`, ZONE_COPY.next, undefined, l.page >= l.pages - 1),
  ]);
  const data = { embeds: [l.embed], components: l.pages > 1 ? [nav] : [] };
  return inPlace ? updateMessage(data) : ephemeral('', data);
}

/** zc:<key> from the card: page 1, a new private message. zd:… (an order 17 card's More drops): the list is gone. */
export async function zoneList(c: Ctx, customId: string): Promise<MessageReply> {
  if (customId.startsWith(DROPS_PREFIX)) return ephemeral(ZONE_REPLY_COPY.dropsRemoved);
  const d = await loadZone(c.db, customId.slice(CREATURES_PREFIX.length));
  if (!d) return ephemeral(ZONE_REPLY_COPY.gone);
  return listReply(d, 0, false);
}

/** zcn:<page>:<key>: Previous / Next, editing the private page in place. zdn:…: as zd:. */
export async function zoneListPage(c: Ctx, customId: string): Promise<MessageReply> {
  if (customId.startsWith(DROPS_PAGE_PREFIX)) return ephemeral(ZONE_REPLY_COPY.dropsRemoved);
  const [, page, key] = /^zcn:(-?\d+):(.*)$/.exec(customId) ?? [];
  const d = key === undefined ? null : await loadZone(c.db, key);
  if (!d) return ephemeral(ZONE_REPLY_COPY.gone);
  return listReply(d, Number(page), true);
}

// ---------------------------------------------------------------- Gear here

const DEFAULT_SORT = SORTS.find((s) => s.key === 'AC')!;

/** zg:<key>: Gear here, from the card. A new private message holding only the class select (required, as on /gear find). */
export async function zoneGear(c: Ctx, customId: string): Promise<MessageReply> {
  const key = customId.slice(GEAR_PREFIX.length);
  const name = (await c.db.prepare('SELECT name FROM zone WHERE key = ? AND active = 1').bind(key).first<{ name: string }>())?.name;
  if (!name) return ephemeral(ZONE_REPLY_COPY.gone);
  const classes = await gameList(c.db, 'classes');
  if (!classes.length) return ephemeral(ZONE_REPLY_COPY.noClasses);
  const cls = row([
    {
      type: 3,
      custom_id: `${GEAR_CLASS_PREFIX}${key}`,
      placeholder: ZONE_REPLY_COPY.classPlaceholder,
      // A select holds 25 options: Any and the first 24 classes (the data holds 18 today).
      options: [ANY, ...classes].slice(0, 25).map((x) => ({ label: x, value: x })),
    },
  ]);
  return ephemeral(ZONE_REPLY_COPY.gearPick(name), { components: [cls] });
}

/** zgc:<key>: the class picked; /gear find's first page for this zone, sorted by AC, replaces the select. */
export async function zoneGearClass(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const key = customId.slice(GEAR_CLASS_PREFIX.length);
  if (!values[0] || key.length > ZONE_STATE_MAX) return ephemeral(ZONE_REPLY_COPY.gone);
  if (!(await c.db.prepare('SELECT 1 FROM zone WHERE key = ? AND active = 1').bind(key).first())) return ephemeral(ZONE_REPLY_COPY.gone);
  const q: GearQuery = { cls: values[0], stats: [], sort: DEFAULT_SORT, zone: key };
  return gearResults(c, q, true);
}

// /zone (work order 17, ITEMs 2–3): a zone's card, private with Post to channel, from the zone data the nightly import
// keeps (scripts/import/zones.ts). Buttons: Open in MnM Atlas and Wiki page (links), Gear here (asks for the class, then
// runs /gear find on this zone), More creatures and More drops (paged, private). No writes beyond the read audit row
// 'zone.view' (src/interactions.ts).
import type { Ctx } from '../context.ts';
import { button, ephemeral, linkButton, md, optString, row, updateMessage, type MessageReply, type Option } from '../discord.ts';
import { unknownZone } from '../zone/suggest.ts';
import { ANY, SORTS, ZONE_STATE_MAX, type GearQuery } from '../gear/options.ts';
import { gameList } from '../gamedata.ts';
import { atlasMapUrl, listEmbed, loadZone, safeUrl, ZONE_COPY, zoneEmbeds, type ZoneData } from '../zone/card.ts';
import { zoneKey } from '../zone/names.ts';
import { gearResults } from './gear.ts';
import { postedReply, searchReply } from './share.ts';

/** Post to channel: "pub:zone:<zone key>" (src/commands/share.ts POST_PREFIX). */
export const POST_WHAT = 'zone:';
/** Gear here, from the card (private or posted): a new private menu. */
export const GEAR_PREFIX = 'zg:';
/** The menu's sort select ("zgs:<key>") and class select ("zgc:<sort index>:<key>"), editing the menu in place. */
export const GEAR_SORT_PREFIX = 'zgs:';
export const GEAR_CLASS_PREFIX = 'zgc:';
/** More creatures / More drops from the card: a new private page. */
export const CREATURES_PREFIX = 'zc:';
export const DROPS_PREFIX = 'zd:';
/** Previous / Next on a page: "zcn:<page>:<key>", "zdn:<page>:<key>", editing the page in place. */
export const CREATURES_PAGE_PREFIX = 'zcn:';
export const DROPS_PAGE_PREFIX = 'zdn:';

// ---------------------------------------------------------------- copy (order 17; listed for approval in docs/COPY.md)

export const ZONE_REPLY_COPY = {
  gone: 'That zone is no longer in the data. Run `/zone` again.',
  gearFrom: (zone: string) => `**Gear from ${md(zone)}**`,
  gearPick: (zone: string) => `Gear from **${md(zone)}**: pick a sort if you like (AC by default), then your class.`,
  sortPlaceholder: 'Sort (AC by default)',
  sortChosen: (label: string) => `Sort: ${label}`,
  classPlaceholder: 'Your class, or Any',
  noClasses: 'No classes are loaded yet. Try `/gear find` once the nightly import has run.',
} as const;

// ---------------------------------------------------------------- the card

/** The card's link buttons (kept on a posted copy) and its action row (each press answers the presser privately). */
function cardButtons(d: ZoneData): { links: unknown[]; actions: unknown } {
  const z = d.zone;
  const wiki = safeUrl(z.wiki_url);
  const links = [linkButton(ZONE_COPY.openAtlas, atlasMapUrl(z.atlas_id)), ...(wiki ? [linkButton(ZONE_COPY.wikiPage, wiki)] : [])];
  const actions = row([
    // Gear here searches gear only: it is offered when some of the zone's drops are gear.
    button(`${GEAR_PREFIX}${z.key}`, ZONE_COPY.gearHere, undefined, !d.drops.some((x) => x.gear) || z.key.length > ZONE_STATE_MAX),
    // The card may show fewer than 10 lines when long ones fill a field, so a list is pageable whenever it has rows.
    button(`${CREATURES_PREFIX}${z.key}`, ZONE_COPY.moreCreatures, undefined, !d.creatures.length),
    button(`${DROPS_PREFIX}${z.key}`, ZONE_COPY.moreDrops, undefined, !d.drops.length),
  ]);
  return { links, actions };
}

export async function zoneCommand(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = optString(opts, 'name') ?? '';
  const d = await loadZone(c.db, zoneKey(typed));
  if (!d) return unknownZone(c.db, typed);
  const { links, actions } = cardButtons(d);
  return searchReply({ embeds: zoneEmbeds(d, c.atlasZoneImages === true) }, `${POST_WHAT}${d.zone.key}`, links, [actions]);
}

/** pub:zone:<key>: the card, posted; its buttons answer each presser privately. */
export async function postZone(c: Ctx, key: string): Promise<MessageReply> {
  const d = await loadZone(c.db, key);
  if (!d) return ephemeral(ZONE_REPLY_COPY.gone);
  const { links, actions } = cardButtons(d);
  return postedReply({ embeds: zoneEmbeds(d, c.atlasZoneImages === true) }, c.userId, links, [actions]);
}

// ---------------------------------------------------------------- More creatures, More drops

function listReply(d: ZoneData, kind: 'creatures' | 'drops', page: number, inPlace: boolean): MessageReply {
  const l = listEmbed(d, kind, page);
  const prefix = kind === 'creatures' ? CREATURES_PAGE_PREFIX : DROPS_PAGE_PREFIX;
  const nav = row([
    button(`${prefix}${l.page - 1}:${d.zone.key}`, ZONE_COPY.previous, undefined, l.page === 0),
    button(`${prefix}${l.page + 1}:${d.zone.key}`, ZONE_COPY.next, undefined, l.page >= l.pages - 1),
  ]);
  const data = { embeds: [l.embed], components: l.pages > 1 ? [nav] : [] };
  return inPlace ? updateMessage(data) : ephemeral('', data);
}

/** zc:<key> / zd:<key> from the card: page 1, a new private message. */
export async function zoneList(c: Ctx, customId: string): Promise<MessageReply> {
  const kind = customId.startsWith(CREATURES_PREFIX) ? 'creatures' : 'drops';
  const d = await loadZone(c.db, customId.slice(CREATURES_PREFIX.length));
  if (!d) return ephemeral(ZONE_REPLY_COPY.gone);
  return listReply(d, kind, 0, false);
}

/** zcn:<page>:<key> / zdn:<page>:<key>: Previous / Next, editing the private page in place. */
export async function zoneListPage(c: Ctx, customId: string): Promise<MessageReply> {
  const [, kind, page, key] = /^z([cd])n:(-?\d+):(.*)$/.exec(customId) ?? [];
  const d = key === undefined ? null : await loadZone(c.db, key);
  if (!d) return ephemeral(ZONE_REPLY_COPY.gone);
  return listReply(d, kind === 'c' ? 'creatures' : 'drops', Number(page), true);
}

// ---------------------------------------------------------------- Gear here

const DEFAULT_SORT = SORTS.findIndex((s) => s.key === 'AC');

/** The menu: the gear finder's full sort list (the chosen one marked), then the class (required, as on /gear find). */
async function gearMenu(c: Ctx, key: string, sortIdx: number): Promise<{ content: string; components: unknown[] } | string> {
  const name = (await c.db.prepare('SELECT name FROM zone WHERE key = ? AND active = 1').bind(key).first<{ name: string }>())?.name;
  if (!name) return ZONE_REPLY_COPY.gone;
  const classes = await gameList(c.db, 'classes');
  if (!classes.length) return ZONE_REPLY_COPY.noClasses;
  const sorts = row([
    {
      type: 3,
      custom_id: `${GEAR_SORT_PREFIX}${key}`,
      placeholder: ZONE_REPLY_COPY.sortPlaceholder,
      options: SORTS.map((s, i) => ({ label: ZONE_REPLY_COPY.sortChosen(s.label), value: String(i), ...(i === sortIdx ? { default: true } : {}) })),
    },
  ]);
  const cls = row([
    {
      type: 3,
      custom_id: `${GEAR_CLASS_PREFIX}${sortIdx}:${key}`,
      placeholder: ZONE_REPLY_COPY.classPlaceholder,
      // A select holds 25 options: Any and the first 24 classes (the data holds 18 today).
      options: [ANY, ...classes].slice(0, 25).map((x) => ({ label: x, value: x })),
    },
  ]);
  return { content: ZONE_REPLY_COPY.gearPick(name), components: [sorts, cls] };
}

/** zg:<key>: Gear here, from the card. A new private menu. */
export async function zoneGear(c: Ctx, customId: string): Promise<MessageReply> {
  const m = await gearMenu(c, customId.slice(GEAR_PREFIX.length), DEFAULT_SORT);
  return typeof m === 'string' ? ephemeral(m) : ephemeral(m.content, { components: m.components });
}

/** zgs:<key>: a sort picked; the menu is redrawn with it. */
export async function zoneGearSort(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const idx = Number(values[0]);
  const m = await gearMenu(c, customId.slice(GEAR_SORT_PREFIX.length), SORTS[idx] ? idx : DEFAULT_SORT);
  return typeof m === 'string' ? ephemeral(m) : updateMessage({ content: m.content, components: m.components });
}

/** zgc:<sort index>:<key>: the class picked; /gear find's first page for this zone replaces the menu. */
export async function zoneGearClass(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const [, idx, key] = /^zgc:(\d+):(.*)$/.exec(customId) ?? [];
  const sort = SORTS[Number(idx)];
  if (!sort || key === undefined || !values[0]) return ephemeral(ZONE_REPLY_COPY.gone);
  const name = (await c.db.prepare('SELECT name FROM zone WHERE key = ? AND active = 1').bind(key).first<{ name: string }>())?.name;
  if (!name) return ephemeral(ZONE_REPLY_COPY.gone);
  const q: GearQuery = { cls: values[0], stats: [], sort, zone: key };
  return gearResults(c, q, true, ZONE_REPLY_COPY.gearFrom(name));
}

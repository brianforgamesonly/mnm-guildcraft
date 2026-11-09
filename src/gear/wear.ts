// Order 35, PR B (docs/PRD.md "Gear upgrades", saved gear): what each character wears, in 20 slots.
//
// - Stored in character_gear (migrations/0030): one row per filled slot, naming the item by item.name_key (never its id,
//   never its stats), written only when a slot changes, with who made the change.
// - Reached from the Gear button on /me (and /officer edit-member's view of a member), from /gear wear, and from I'm
//   wearing this on an /item card. Every reply is private.
// - Who: a panel's controls act on the character their custom_id names, re-checked on every press: the owner, or an
//   officer (order 35's override 3 of order 2: saved gear is private like /me). I'm wearing this and /gear wear act only
//   on the presser's own characters, never a card owner's.
// - Which slots an item fits comes only from item.slot_mask. No dual-wield rule in part 1: a shield and a one-handed
//   weapon are alike in Secondary. Paired slots fill the empty side, and ask only when both are full.
// - Refused: an item the character's class or race can't use (a character with no class or no race is treated as any;
//   an item whose data names no class, mask 0, or no race, is not refused for it), and anything in Secondary while a
//   two-hander (src/gear/vocab.ts isTwoHanded) is in Primary. A two-hander in Primary empties Secondary.
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import type { Ctx } from '../context.ts';
import { button, EMBED_LIMITS, ephemeral, md, optString, row, STYLE_PRIMARY, truncate, updateMessage, type InteractionReply, type MessageReply, type ModalComponent, type Option } from '../discord.ts';
import { characterHead, findById, findByName, liveCharacters, noCharacters, type Character } from '../commands/character.ts';
import { modalValues } from '../commands/reports.ts';
import { slotByKey, WEAR_MASK, WEAR_SLOTS, type SlotToken, type WearSlot } from './slots.ts';
import { ALL_CLASSES, bitOf, isTwoHanded, SLOTS } from './vocab.ts';
import { wikiHref, wikiLinked } from './wiki-link.ts';

export { slotByKey, WEAR_MASK, WEAR_SLOTS };
const fits = (slotMask: number, w: WearSlot) => (slotMask & bitOf(SLOTS, w.token)) !== 0;
/** A slot group's key in a menu: "g:EAR" for a pair, the slot's own key otherwise. */
const groupKey = (token: SlotToken) => `g:${token}`;

// ---------------------------------------------------------------- custom_ids (order 23: each has its own routing test)

/** wrp:<character id>: open the character's Gear panel (the /me buttons; a reply's Gear button). */
export const PANEL_PREFIX = 'wrp:';
/** wrg:<owner>: /me's character select, when there are more than 5. */
export const PANEL_PICK_PREFIX = 'wrg:';
/**
 * wrs:<character id>: Change a slot (select). Order 39: it updates the panel in place to that slot (UPDATE_MESSAGE, which
 * redraws the select at its prompt), instead of opening the box: a box can't be answered when it is dismissed.
 */
export const SLOT_PREFIX = 'wrs:';
/** wrm:<character id>:<slot>: the item box's submit. Order 39: it updates the panel in place (src/interactions.ts planFor). */
export const BOX_PREFIX = 'wrm:';
/** wrt:<character id>:<slot>: Type the item (order 39; was Type again): the box, a modal. */
export const AGAIN_PREFIX = 'wrt:';
/** Order 39: wre:<character id>:<slot>: Empty slot on the slot view (in place). */
export const EMPTY_PREFIX = 'wre:';
/** Order 39: wrv:<character id>: Back, from the slot view to the panel (in place). */
export const BACK_PREFIX = 'wrv:';
/** wrk:<character id>:<slot>: the matches menu (values: item ids, or "more"). */
export const MATCH_PREFIX = 'wrk:';
/** wri:<item id>: I'm wearing this on an /item card. */
export const WEARING_PREFIX = 'wri:';
/** wrc:<item id>: which of the presser's characters (select). */
export const WEARING_CHAR_PREFIX = 'wrc:';
/** wrz:<character id>:<item id>: which slot (select; values: a slot key or a pair group). */
export const SLOT_PICK_PREFIX = 'wrz:';
/** Order 36: guf:<character id>: Find upgrades on the panel (src/gear/upgrades.ts answers it). */
export const FIND_UPGRADES_PREFIX = 'guf:';
/**
 * Order 44: wrx:<character id>: View an item on the panel (select; values: a slot key, never an item id: both sides of a
 * pair can hold one item, and Discord refuses a select with two equal values). Deferred as a component (type 6) and
 * answered with a new private message, the item's /item card (src/gear/upgrades.ts viewItem, as Pick a result's gur:).
 */
export const VIEW_PREFIX = 'wrx:';
/** The controls that answer with a modal, at once (src/interactions.ts OPENS_MODAL). Order 39: the slot select no longer. */
export const WEAR_OPENS_MODAL = [AGAIN_PREFIX];
/** Order 39: the modal submits answered by editing the panel they were opened from (src/interactions.ts planFor). */
export const WEAR_SUBMITS_IN_PLACE = [BOX_PREFIX];

const MORE = 'more';
/** Matches shown in the menu; the 25th option says how many more there are. */
export const MATCH_MAX = 24;

// ---------------------------------------------------------------- copy (order 35; listed for approval in docs/COPY.md)

export const WEAR_COPY = {
  gone: 'That character no longer exists.',
  itemGone: 'That item is no longer in the data.',
  notYours: "That's another member's character. Only they, or an officer, can change its gear.",
  ownOnly: 'I\'m wearing this saves gear for your own characters only.',
  filled: (n: number) => `${n} of ${WEAR_SLOTS.length} slots filled`,
  empty: '—',
  noLongerListed: '*(no longer listed)*',
  cantUse: (who: string) => `*(${md(who)} can't use)*`,
  changeSlot: 'Change a slot',
  boxTitle: (label: string) => truncate(`${label}: type the item`, 45),
  boxLabel: 'Item name',
  boxHint: 'Leave blank to empty the slot',
  // Order 39: the slot view (a slot pick updates the panel in place).
  typeItem: 'Type the item',
  emptySlot: 'Empty slot',
  back: 'Back',
  slotLine: (label: string, what: string) => `**${label}:** ${what}`,
  slotEmpty: 'empty',
  gearButton: 'Gear',
  noMatch: (label: string, typed: string) => `No ${label} item matches **${md(typed)}**.`,
  pick: (label: string, n: number) => `${n} ${label} items match. Pick one:`,
  more: (n: number) => truncate(`${n} more: type more of the name`, 100),
  typeMore: 'Type more of the name.',
  saved: (label: string, item: string, was: string | null) => `**${label}:** ${md(item)} (${was === null ? 'was empty' : `replaced ${md(was)}`}).`,
  same: (label: string, item: string) => `**${label}** already holds ${md(item)}.`,
  emptied: (label: string, was: string) => `**${label}** emptied (was ${md(was)}).`,
  alreadyEmpty: (label: string) => `**${label}** was already empty.`,
  twoHandEmptied: (was: string) => `**Secondary** emptied (was ${md(was)}): a two-handed weapon takes both hands.`,
  twoHandEmpty: '**Secondary** is empty (it was already): a two-handed weapon takes both hands.',
  underTwoHand: (primary: string) => `Nothing can go in **Secondary** while ${md(primary)}, a two-handed weapon, is in **Primary**.`,
  classRefused: (cls: string, item: string) => `**${md(cls)}** can't use ${md(item)}: its classes don't include ${md(cls)}.`,
  raceRefused: (race: string, item: string) => `Race **${md(race)}** can't use ${md(item)}: its races don't include ${md(race)}.`,
  noFit: (item: string, label: string) => `${md(item)} doesn't go in **${label}**.`,
  notWearable: (item: string) => `${md(item)} isn't worn in any of the ${WEAR_SLOTS.length} gear slots.`,
  noItem: (typed: string) => `No item called **${md(typed)}**. Pick one from the list as you type.`,
  pickCharacter: 'Which character is wearing it?',
  pickSlot: (item: string) => `Which slot is ${md(item)} for?`,
  bothFull: (item: string) => `Both sides are filled. Which one does ${md(item)} replace?`,
  severalCharacters: (names: string[]) => `You have several characters: ${names.map((n) => `**${md(n)}**`).join(', ')}. Pick one with \`character:\`.`,
  changedBy: (who: string) => `-# Changed by ${md(who)}.`,
  wearingButton: "I'm wearing this",
  /** Order 36. */
  findUpgrades: 'Find upgrades',
  /** Order 44: the panel's menu of worn items; each option "<Slot>: <item>". */
  viewItem: 'View an item',
  /** Order 44: the panel's last line, only if its lines could ever pass 4,096 characters unlinked (fitLines' words). */
  moreLines: (n: number) => `+${n} more`,
} as const;

// ---------------------------------------------------------------- reading

interface WearItem {
  id: number;
  name: string;
  name_key: string;
  slot: string | null;
  slot_mask: number;
  class_mask: number;
  race_mask: number;
  handed: string | null;
  gone_at: string | null;
  /** Order 44: the panel links the name (https only, src/gear/wiki-link.ts wikiHref). */
  wiki_url: string | null;
}
const ITEM_COLS = 'i.id, i.name, i.name_key, i.slot, i.slot_mask, i.class_mask, i.race_mask, i.handed, i.gone_at, i.wiki_url';
interface Worn {
  slot: string;
  item_key: string;
  item: WearItem | null;
}
interface Bits {
  cb: number | null;
  rb: number | null;
  /** Order 39: 1 when the stored class is a game class (src/commands/character.ts GAME_CLASSES_SQL's rule), for the head. */
  ck?: number | null;
}

/** The character's saved rows (each with its item, or null when the key names no item row), and its class and race bits. */
async function readGear(c: Ctx, ch: Character): Promise<{ worn: Map<string, Worn>; bits: Bits }> {
  const [rows, bits] = await c.db.batch([
    // The saved slot is gear_slot: item.slot (in ITEM_COLS) is the item's own slot text.
    c.db.prepare(`SELECT g.slot AS gear_slot, g.item_key, ${ITEM_COLS} FROM character_gear g LEFT JOIN item i ON i.name_key = g.item_key WHERE g.character_id = ?`).bind(ch.id),
    c.db
      .prepare('SELECT (SELECT bit FROM game_class WHERE code = ?1 AND item_count > 0) AS cb, (SELECT bit FROM game_race WHERE code = ?2 AND item_count > 0) AS rb, (SELECT 1 FROM game_class WHERE code = ?1 AND item_count > 0) AS ck')
      .bind(ch.class ? ch.class.toUpperCase() : null, ch.race),
  ]);
  const worn = new Map<string, Worn>();
  for (const r of rows.results as (WearItem & { gear_slot: string; item_key: string })[])
    worn.set(r.gear_slot, { slot: r.gear_slot, item_key: r.item_key, item: r.id === null ? null : r });
  return { worn, bits: ((bits.results as Bits[])[0] ?? { cb: null, rb: null }) };
}

/** Why the character can't use the item (null: it can). Class first, then race. */
export function refusal(ch: Pick<Character, 'class' | 'race'>, item: Pick<WearItem, 'name' | 'class_mask' | 'race_mask'>, bits: Bits): { who: string; message: string } | null {
  const blocked = (mask: number, bit: number | null) => bit !== null && mask !== ALL_CLASSES && mask !== 0 && ((mask >>> bit) & 1) === 0;
  if (ch.class && blocked(Number(item.class_mask), bits.cb)) return { who: ch.class.toUpperCase(), message: WEAR_COPY.classRefused(ch.class.toUpperCase(), item.name) };
  // -1 (ALL_RACES) is every race, as ALL_CLASSES (also -1) is every class: the same test serves both.
  if (ch.race && blocked(Number(item.race_mask), bits.rb)) return { who: ch.race, message: WEAR_COPY.raceRefused(ch.race, item.name) };
  return null;
}

/** Review fix: an item the source no longer lists (gone_at) is never saved anew, by any path. */
const loadItem = (c: Ctx, id: number) => c.db.prepare(`SELECT ${ITEM_COLS} FROM item i WHERE i.id = ? AND i.source = 'wiki' AND i.gone_at IS NULL`).bind(id).first<WearItem>();

/** The character a custom_id names, if it still exists and the presser may act on it (order 36's controls use it too). */
export async function characterFor(c: Ctx, id: string, ownOnly = false): Promise<{ ch: Character } | { reply: MessageReply }> {
  const n = Number(id);
  const ch = Number.isInteger(n) ? await findById(c.db, c.guild.id, n) : null;
  if (!ch) return { reply: ephemeral(WEAR_COPY.gone) };
  if (ch.owner_user_id !== c.userId && (ownOnly || !c.officer)) return { reply: ephemeral(ownOnly ? WEAR_COPY.ownOnly : WEAR_COPY.notYours) };
  return { ch };
}

const displayName = (c: Ctx) => c.member.nick ?? c.member.user.global_name ?? c.member.user.username;

// ---------------------------------------------------------------- the panel

/**
 * What a slot holds, as the panel shows it: the item, marked when no longer listed or the character can't use it. Order 44:
 * with `link`, a listed item's name links to its wiki page when it has an https one (unbolded, as the panel's names are);
 * a gone or missing item is never linked. The slot view passes no link: its text is message content, where a link would
 * unfold a preview (the panel's lines are in an embed, where links don't).
 */
function slotText(ch: Character, g: Worn | undefined, bits: Bits, link = false): string {
  if (!g) return WEAR_COPY.empty;
  if (!g.item || g.item.gone_at !== null) return `${md(g.item?.name ?? g.item_key)} ${WEAR_COPY.noLongerListed}`;
  // A class or race change keeps saved gear; the slot is marked when the character can no longer use it.
  const r = refusal(ch, g.item, bits);
  const name = md(g.item.name);
  return `${link ? wikiLinked(name, wikiHref(g.item.wiki_url)) : name}${r ? ` ${WEAR_COPY.cantUse(r.who)}` : ''}`;
}

/**
 * Order 44: the panel's embed text: the "filled" line, a blank line, then one line per slot, never cut mid-line. Each line
 * comes linked and plain; when the linked text passes `max`, lines lose their link from the bottom up until it fits. On the
 * data the linked worst case fits (docs/ORDER-RULES.md, "Order 44"); if even the plain lines ever passed `max`, whole lines
 * would go from the bottom with "+N more" (fitLines' words), never part of one.
 */
export function panelText(filled: string, lines: { linked: string; plain: string }[], max: number = EMBED_LIMITS.description): string {
  const shown = lines.map((l) => l.linked);
  const text = (kept: number) => [filled, '', ...shown.slice(0, kept), ...(kept < shown.length ? [WEAR_COPY.moreLines(shown.length - kept)] : [])].join('\n');
  for (let i = shown.length - 1; i >= 0 && text(shown.length).length > max; i--) shown[i] = lines[i].plain;
  let kept = shown.length;
  while (kept > 0 && text(kept).length > max) kept--;
  return text(kept);
}

/**
 * Order 44: View an item: one option per filled slot whose item row is still listed, in panel order (WEAR_SLOTS), its
 * value the slot key; null (no menu) when none qualifies. At most 20 options, within Discord's 25. No default option.
 */
export function viewSelect(ch: Pick<Character, 'id'>, worn: Map<string, Worn>) {
  const options = WEAR_SLOTS.flatMap((w) => {
    const item = worn.get(w.key)?.item;
    return item && item.gone_at === null ? [{ label: truncate(`${w.label}: ${item.name}`, 100), value: w.key }] : [];
  });
  return options.length ? row([{ type: MessageComponentTypes.STRING_SELECT, custom_id: `${VIEW_PREFIX}${ch.id}`, placeholder: WEAR_COPY.viewItem, options }]) : null;
}

/**
 * Order 44: the item a slot holds now, read again on a View an item pick: its id while it is still listed, otherwise null (an
 * empty slot, a key that names no item row, or an item gone since). One indexed row each (character_gear's primary key,
 * item.name_key's unique index).
 */
export async function wornItemId(c: Ctx, ch: Character, slotKey: string): Promise<number | null> {
  const slot = slotByKey(slotKey);
  if (!slot) return null;
  const r = await c.db
    .prepare('SELECT i.id FROM character_gear g JOIN item i ON i.name_key = g.item_key WHERE g.character_id = ? AND g.slot = ? AND i.gone_at IS NULL')
    .bind(ch.id, slot.key)
    .first<{ id: number }>();
  return r ? r.id : null;
}

/**
 * Change a slot: never a default option, so every redraw shows the prompt (order 39: the client otherwise keeps showing the
 * last pick, as Brian's screenshot of "Shirt: —" showed).
 */
const slotSelect = (ch: Character, worn: Map<string, Worn>) =>
  row([
    {
      type: MessageComponentTypes.STRING_SELECT,
      custom_id: `${SLOT_PREFIX}${ch.id}`,
      placeholder: WEAR_COPY.changeSlot,
      options: WEAR_SLOTS.map((w) => {
        const g = worn.get(w.key);
        return { label: truncate(`${w.label}: ${g ? (g.item?.name ?? g.item_key) : WEAR_COPY.empty}`, 100), value: w.key };
      }),
    },
  ]);

/**
 * The private Gear panel: the character, the 20 slots, how many are filled, and Change a slot. 1 round trip (2 statements).
 * Order 44: any note and the character head are the message content (never empty: the head always has the name); the
 * "filled" line and the 20 lines, each worn name linked to its wiki page, are one embed, where links don't unfold previews
 * and the description holds 4,096 characters. Every form of the panel sends both, so an edit replaces each one (a Discord
 * edit keeps any field it doesn't send). Rows: Change a slot, Find upgrades, then View an item when a slot qualifies.
 */
export async function gearPanel(c: Ctx, ch: Character, note?: string): Promise<MessageReply> {
  const { worn, bits } = await readGear(c, ch);
  const lines = WEAR_SLOTS.map((w) => {
    const g = worn.get(w.key);
    return { linked: `${w.label}: ${slotText(ch, g, bits, true)}`, plain: `${w.label}: ${slotText(ch, g, bits)}` };
  });
  const content = [note, characterHead(ch, !!bits.ck)].filter((l) => l !== undefined).join('\n');
  const view = viewSelect(ch, worn);
  return ephemeral(truncate(content, 2000), {
    embeds: [{ description: panelText(WEAR_COPY.filled(worn.size), lines) }],
    // Order 36: Find upgrades opens /gear upgrades' summary for this character (the same owner-or-officer check).
    components: [slotSelect(ch, worn), row([button(`${FIND_UPGRADES_PREFIX}${ch.id}`, WEAR_COPY.findUpgrades, STYLE_PRIMARY)]), ...(view ? [view] : [])],
  });
}

/**
 * Order 39: the slot view, the panel updated in place for one slot: what it holds, Type the item (the box), Empty slot (only
 * when filled) and Back; Change a slot stays on top at its prompt. `matches` is the box's pick list, when it has one.
 */
async function slotView(c: Ctx, ch: Character, slot: WearSlot, note?: string, matches?: unknown): Promise<MessageReply> {
  const { worn, bits } = await readGear(c, ch);
  const g = worn.get(slot.key);
  const content = [note, characterHead(ch, !!bits.ck), WEAR_COPY.slotLine(slot.label, g ? slotText(ch, g, bits) : WEAR_COPY.slotEmpty)].filter((l) => l !== undefined).join('\n');
  const buttons = [
    button(`${AGAIN_PREFIX}${ch.id}:${slot.key}`, WEAR_COPY.typeItem, STYLE_PRIMARY),
    ...(g ? [button(`${EMPTY_PREFIX}${ch.id}:${slot.key}`, WEAR_COPY.emptySlot)] : []),
    button(`${BACK_PREFIX}${ch.id}`, WEAR_COPY.back),
  ];
  return updateMessage({ content: truncate(content, 2000), embeds: [], components: [slotSelect(ch, worn), ...(matches ? [matches] : []), row(buttons)] });
}

/** The panel itself, in place (after a save, an emptying, or Back). */
const panelInPlace = async (c: Ctx, ch: Character, note?: string) => asEdit(await gearPanel(c, ch, note));

/** wrp:<character id>: the panel, as a new private message. */
export async function panelButton(c: Ctx, id: string): Promise<MessageReply> {
  const t = await characterFor(c, id.slice(PANEL_PREFIX.length));
  return 'reply' in t ? t.reply : gearPanel(c, t.ch);
}

/** wrg:<owner>: the picked character's panel. */
export async function panelPicked(c: Ctx, values: string[]): Promise<MessageReply> {
  const t = await characterFor(c, values[0] ?? '');
  return 'reply' in t ? t.reply : gearPanel(c, t.ch);
}

// ---------------------------------------------------------------- changing a slot from the panel

const box = (charId: string, slot: WearSlot): InteractionReply => ({
  type: InteractionResponseType.MODAL,
  data: {
    custom_id: `${BOX_PREFIX}${charId}:${slot.key}`,
    title: WEAR_COPY.boxTitle(slot.label),
    components: [
      {
        type: MessageComponentTypes.LABEL,
        label: WEAR_COPY.boxLabel,
        description: WEAR_COPY.boxHint,
        component: { type: MessageComponentTypes.INPUT_TEXT, custom_id: 'item', style: 1, required: false, max_length: 100 },
      },
    ],
  },
});

/**
 * wrs:<character id>: the picked slot's view, the panel edited in place (deferred like any component: no modal here). The
 * character is checked first, so a removed one's panel answers "no longer exists" (a new private message).
 */
export async function slotPicked(c: Ctx, id: string, values: string[]): Promise<MessageReply> {
  const slot = slotByKey(values[0] ?? '');
  const t = await characterFor(c, id.slice(SLOT_PREFIX.length));
  if ('reply' in t) return t.reply;
  return slot ? slotView(c, t.ch, slot) : ephemeral(WEAR_COPY.gone);
}

/** Order 39: wre:<character id>:<slot>: Empty slot, then the panel in place with the reply line as its note. */
export async function emptyPressed(c: Ctx, id: string): Promise<MessageReply> {
  const [charId, key] = id.slice(EMPTY_PREFIX.length).split(':');
  const slot = slotByKey(key ?? '');
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  if (!slot) return ephemeral(WEAR_COPY.gone);
  return panelInPlace(c, t.ch, note(c, t.ch, await emptyLines(c, t.ch, slot)));
}

/** Order 39: wrv:<character id>: Back to the panel, in place. */
export async function backPressed(c: Ctx, id: string): Promise<MessageReply> {
  const t = await characterFor(c, id.slice(BACK_PREFIX.length));
  return 'reply' in t ? t.reply : panelInPlace(c, t.ch);
}

/** wrt:<character id>:<slot>: Type the item (was Type again): the box, after the same check. */
export async function againButton(c: Ctx, id: string): Promise<InteractionReply> {
  const [charId, key] = id.slice(AGAIN_PREFIX.length).split(':');
  const slot = slotByKey(key ?? '');
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  return slot ? box(String(t.ch.id), slot) : ephemeral(WEAR_COPY.gone);
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

/**
 * Order 39: what a save or an emptying from the panel answers. Saved, emptied or unchanged: the panel, in place, with the
 * reply line as its note. Refused: the slot's view with the reason, so Type the item is at hand.
 */
const afterChange = (c: Ctx, ch: Character, slot: WearSlot, r: { lines: string[]; refused: boolean }) =>
  r.refused ? slotView(c, ch, slot, note(c, ch, r.lines)) : panelInPlace(c, ch, note(c, ch, r.lines));

/**
 * wrm:<character id>:<slot>: blank empties the slot; one exact name (case-insensitive) that fits the slot saves it;
 * otherwise the items that fit the slot and contain the text, by name (never by stats), up to 24 and a "more" line; none
 * says so on the slot's view. One statement for the matches (count(*) OVER () gives how many in the same scan). Order 39:
 * every answer edits the message the box came from (the panel), never a new message, except a refusal of the presser.
 */
export async function boxSubmitted(c: Ctx, id: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const [charId, key] = id.slice(BOX_PREFIX.length).split(':');
  const slot = slotByKey(key ?? '');
  const t = await characterFor(c, charId);
  if ('reply' in t) return t.reply;
  if (!slot) return ephemeral(WEAR_COPY.gone);
  const typed = (modalValues(components).get('item') ?? '').trim();
  if (!typed) return afterChange(c, t.ch, slot, { lines: await emptyLines(c, t.ch, slot), refused: false });
  const lower = typed.toLowerCase();
  const { results } = await c.db
    .prepare(
      `SELECT ${ITEM_COLS}, count(*) OVER () AS total FROM item i
       WHERE i.source = 'wiki' AND i.gone_at IS NULL AND i.slot_mask <> 0 AND (i.slot_mask & ?1) <> 0 AND i.name_key LIKE ?2 ESCAPE '\\'
       ORDER BY i.name_key = ?3 DESC, i.name COLLATE NOCASE, i.id LIMIT ${MATCH_MAX}`,
    )
    .bind(bitOf(SLOTS, slot.token), like(lower), lower)
    .all<WearItem & { total: number }>();
  if (!results.length) return slotView(c, t.ch, slot, WEAR_COPY.noMatch(slot.label, typed));
  if (results[0].name_key === lower) return afterChange(c, t.ch, slot, await wearLines(c, t.ch, results[0], slot));
  const total = Number(results[0].total);
  const classes = await classCodes(c);
  const options = results.map((r) => ({
    label: truncate(r.name, 100),
    description: truncate(`${r.slot ?? ''} · ${classList(Number(r.class_mask), classes)}`, 100),
    value: String(r.id),
  }));
  if (total > MATCH_MAX) options.push({ label: WEAR_COPY.more(total - MATCH_MAX), description: WEAR_COPY.typeMore, value: MORE });
  const matches = row([{ type: MessageComponentTypes.STRING_SELECT, custom_id: `${MATCH_PREFIX}${t.ch.id}:${slot.key}`, placeholder: truncate(typed, 100), options }]);
  return slotView(c, t.ch, slot, WEAR_COPY.pick(slot.label, total), matches);
}

async function classCodes(c: Ctx): Promise<{ code: string; bit: number }[]> {
  return (await c.db.prepare('SELECT code, bit FROM game_class WHERE item_count > 0 AND bit IS NOT NULL ORDER BY code').all<{ code: string; bit: number }>()).results;
}
const classList = (mask: number, classes: { code: string; bit: number }[]) =>
  mask === ALL_CLASSES ? 'ALL' : mask === 0 ? 'no class listed' : classes.filter((k) => ((mask >>> k.bit) & 1) === 1).map((k) => k.code).join(' ') || 'no class listed';

/**
 * wrk:<character id>:<slot>: the picked match (or "more": type more). Edits the message in place: order 39, the panel with
 * the saved line, or the slot's view (refused, "more", or an item gone since the list was drawn).
 */
export async function matchPicked(c: Ctx, id: string, values: string[]): Promise<MessageReply> {
  const [charId, key] = id.slice(MATCH_PREFIX.length).split(':');
  const slot = slotByKey(key ?? '');
  const t = await characterFor(c, charId);
  if ('reply' in t) return asEdit(t.reply);
  if (!slot) return asEdit(ephemeral(WEAR_COPY.gone));
  if (values[0] === MORE) return slotView(c, t.ch, slot, WEAR_COPY.typeMore);
  const item = await loadItem(c, Number(values[0]));
  if (!item) return slotView(c, t.ch, slot, WEAR_COPY.itemGone);
  return afterChange(c, t.ch, slot, await wearLines(c, t.ch, item, slot));
}

const asEdit = (r: MessageReply) => updateMessage({ content: r.data.content, embeds: r.data.embeds ?? [], components: r.data.components ?? [] });

// ---------------------------------------------------------------- saving

const gearButton = (ch: Character) => row([button(`${PANEL_PREFIX}${ch.id}`, WEAR_COPY.gearButton)]);
/** The reply lines, with "Changed by <officer>" when someone else changed the character's gear. */
const note = (c: Ctx, ch: Character, lines: string[]) => [...lines, ...(ch.owner_user_id !== c.userId ? [WEAR_COPY.changedBy(displayName(c))] : [])].join('\n');
const reply = (c: Ctx, ch: Character, lines: string[]) => ephemeral(note(c, ch, lines), { components: [gearButton(ch)] });
const upsert = (c: Ctx, ch: Character, slot: string, itemKey: string) =>
  c.db
    .prepare(
      `INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (character_id, slot) DO UPDATE SET item_key = excluded.item_key, set_at = excluded.set_at, set_by = excluded.set_by
       WHERE character_gear.item_key IS NOT excluded.item_key`,
    )
    .bind(ch.id, c.guild.id, slot, itemKey, new Date().toISOString(), c.userId);
const remove = (c: Ctx, ch: Character, slot: string) => c.db.prepare('DELETE FROM character_gear WHERE character_id = ? AND slot = ?').bind(ch.id, slot);
const nameOf = (g: Worn) => g.item?.name ?? g.item_key;

/** Empties the slot; the reply line. */
async function emptyLines(c: Ctx, ch: Character, slot: WearSlot): Promise<string[]> {
  const { worn } = await readGear(c, ch);
  const g = worn.get(slot.key);
  if (!g) return [WEAR_COPY.alreadyEmpty(slot.label)];
  await remove(c, ch, slot.key).run();
  return [WEAR_COPY.emptied(slot.label, nameOf(g))];
}

/**
 * Order 36: I'm wearing it now, from /gear upgrades. The item (still listed) into that one slot, through wear()'s rules;
 * null when the item is no longer in the data or the slot key is not one of the 20.
 */
export async function wearById(c: Ctx, ch: Character, itemId: number, slotKey: string): Promise<MessageReply | null> {
  const slot = slotByKey(slotKey);
  const item = slot ? await loadItem(c, itemId) : null;
  return slot && item ? wear(c, ch, item, slot) : null;
}

/** Saves the item in that one slot, with every rule; the reply names the slot, the item and what it replaced. */
export async function wear(c: Ctx, ch: Character, item: WearItem, slot: WearSlot): Promise<MessageReply> {
  return reply(c, ch, (await wearLines(c, ch, item, slot)).lines);
}

/** wear()'s work: the reply lines, and whether a rule refused it (order 39: the panel answers a refusal on the slot's view). */
async function wearLines(c: Ctx, ch: Character, item: WearItem, slot: WearSlot): Promise<{ lines: string[]; refused: boolean }> {
  const no = (line: string) => ({ lines: [line], refused: true });
  if (!fits(Number(item.slot_mask), slot)) return no(WEAR_COPY.noFit(item.name, slot.label));
  const { worn, bits } = await readGear(c, ch);
  const refused = refusal(ch, item, bits);
  if (refused) return no(refused.message);
  const primary = worn.get('primary');
  if (slot.key === 'secondary' && primary?.item && isTwoHanded(primary.item.handed)) return no(WEAR_COPY.underTwoHand(primary.item.name));
  const had = worn.get(slot.key);
  const stmts: D1PreparedStatement[] = [];
  const lines: string[] = [];
  if (had?.item_key === item.name_key) lines.push(WEAR_COPY.same(slot.label, item.name));
  else {
    stmts.push(upsert(c, ch, slot.key, item.name_key));
    lines.push(WEAR_COPY.saved(slot.label, item.name, had ? nameOf(had) : null));
  }
  if (slot.key === 'primary' && isTwoHanded(item.handed)) {
    const second = worn.get('secondary');
    if (second) {
      stmts.push(remove(c, ch, 'secondary'));
      lines.push(WEAR_COPY.twoHandEmptied(nameOf(second)));
    } else lines.push(WEAR_COPY.twoHandEmpty);
  }
  if (stmts.length) await c.db.batch(stmts);
  return { lines, refused: false };
}

/**
 * Where an item goes when no slot was named: one slot that fits, saved; a pair, the empty side (asking only when both
 * are full); several slots, a menu of those that fit (pairs as one choice).
 */
async function place(c: Ctx, ch: Character, item: WearItem, choice?: string): Promise<MessageReply> {
  const fitting = WEAR_SLOTS.filter((w) => fits(Number(item.slot_mask), w));
  if (!fitting.length) return reply(c, ch, [WEAR_COPY.notWearable(item.name)]);
  const concrete = choice ? slotByKey(choice) : undefined;
  if (concrete) return wear(c, ch, item, concrete);
  const tokens = [...new Set(fitting.map((w) => w.token))];
  const token = choice?.startsWith('g:') ? (choice.slice(2) as SlotToken) : tokens.length === 1 ? tokens[0] : undefined;
  if (token === undefined || !tokens.includes(token)) {
    const options = tokens.map((t) => {
      const sides = fitting.filter((w) => w.token === t);
      return sides.length > 1 ? { label: sides[0].label.replace(/ 1$/, ''), value: groupKey(t) } : { label: sides[0].label, value: sides[0].key };
    });
    return slotMenu(ch, item, WEAR_COPY.pickSlot(item.name), options);
  }
  const sides = fitting.filter((w) => w.token === token);
  if (sides.length === 1) return wear(c, ch, item, sides[0]);
  const { worn } = await readGear(c, ch);
  const open = sides.find((w) => !worn.has(w.key));
  if (open) return wear(c, ch, item, open);
  return slotMenu(ch, item, WEAR_COPY.bothFull(item.name), sides.map((w) => ({ label: truncate(`${w.label}: ${nameOf(worn.get(w.key)!)}`, 100), value: w.key })));
}

const slotMenu = (ch: Character, item: WearItem, content: string, options: { label: string; value: string }[]) =>
  ephemeral(content, { components: [row([{ type: MessageComponentTypes.STRING_SELECT, custom_id: `${SLOT_PICK_PREFIX}${ch.id}:${item.id}`, options }])] });

/** wrz:<character id>:<item id>: the picked slot (or pair). Only /gear wear and I'm wearing this send it: own characters only. */
export async function slotPickedForItem(c: Ctx, id: string, values: string[]): Promise<MessageReply> {
  const [charId, itemId] = id.slice(SLOT_PICK_PREFIX.length).split(':');
  const t = await characterFor(c, charId, true);
  if ('reply' in t) return asEdit(t.reply);
  const item = await loadItem(c, Number(itemId));
  if (!item) return asEdit(ephemeral(WEAR_COPY.itemGone));
  return asEdit(await place(c, t.ch, item, values[0]));
}

// ---------------------------------------------------------------- /gear wear and I'm wearing this

/** /gear wear item: [character:] [slot:]: the caller's own characters only (no member: option). */
export async function gearWear(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = (optString(opts, 'item') ?? '').trim();
  const name = optString(opts, 'character');
  let ch: Character | null;
  if (name !== undefined) {
    ch = await findByName(c.db, c.guild.id, c.userId, name);
    if (!ch) return ephemeral(`You have no character named **${md(name)}**.`);
  } else {
    const live = await liveCharacters(c.db, c.guild.id, c.userId);
    if (!live.length) return ephemeral(noCharacters(c, c.userId));
    if (live.length > 1) return ephemeral(WEAR_COPY.severalCharacters(live.map((x) => x.name)));
    ch = live[0];
  }
  const item = await c.db.prepare(`SELECT ${ITEM_COLS} FROM item i WHERE i.name_key = ? AND i.source = 'wiki' AND i.gone_at IS NULL`).bind(typed.toLowerCase()).first<WearItem>();
  if (!item) return ephemeral(WEAR_COPY.noItem(typed || '(nothing)'));
  if ((Number(item.slot_mask) & WEAR_MASK) === 0) return ephemeral(WEAR_COPY.notWearable(item.name));
  const slot = optString(opts, 'slot');
  return place(c, ch, item, slot);
}

/** The card's button, only for gear worn in the 20 slots. */
export const wearingButton = (itemId: number, slotMask: number) => ((Number(slotMask) & WEAR_MASK) !== 0 ? [button(`${WEARING_PREFIX}${itemId}`, WEAR_COPY.wearingButton)] : []);

/** wri:<item id>: for the presser's own characters, never the card owner's: one, placed; several, which one first. */
export async function wearingPressed(c: Ctx, id: string): Promise<MessageReply> {
  const item = await loadItem(c, Number(id.slice(WEARING_PREFIX.length)));
  if (!item) return ephemeral(WEAR_COPY.itemGone);
  const live = await liveCharacters(c.db, c.guild.id, c.userId);
  if (!live.length) return ephemeral(noCharacters(c, c.userId));
  if (live.length === 1) return place(c, live[0], item);
  return ephemeral(WEAR_COPY.pickCharacter, {
    components: [
      row([
        {
          type: MessageComponentTypes.STRING_SELECT,
          custom_id: `${WEARING_CHAR_PREFIX}${item.id}`,
          options: live.slice(0, 25).map((x) => ({ label: truncate(`${x.name}${x.is_main ? ' (main)' : ''}`, 100), value: String(x.id) })),
        },
      ]),
    ],
  });
}

/** wrc:<item id>: the picked character, which must be the presser's own. */
export async function wearingCharacterPicked(c: Ctx, id: string, values: string[]): Promise<MessageReply> {
  const t = await characterFor(c, values[0] ?? '', true);
  if ('reply' in t) return asEdit(t.reply);
  const item = await loadItem(c, Number(id.slice(WEARING_CHAR_PREFIX.length)));
  if (!item) return asEdit(ephemeral(WEAR_COPY.gone));
  return asEdit(await place(c, t.ch, item));
}

// ---------------------------------------------------------------- routing (src/interactions.ts)

/** The saved-gear controls answered at once (modals). */
export function wearImmediate(c: Ctx, id: string, _values: string[]): Promise<InteractionReply> | null {
  if (id.startsWith(AGAIN_PREFIX)) return againButton(c, id);
  return null;
}

/** The deferred saved-gear controls (null: not one). Each re-checks the character and who may act on it. */
export function wearComponent(c: Ctx, id: string, values: string[], components: ModalComponent[] | undefined, modal: boolean): Promise<MessageReply> | null {
  if (modal) return id.startsWith(BOX_PREFIX) ? boxSubmitted(c, id, components) : null;
  if (id.startsWith(PANEL_PREFIX)) return panelButton(c, id);
  if (id.startsWith(PANEL_PICK_PREFIX)) return panelPicked(c, values);
  // Order 39: the slot view (in place).
  if (id.startsWith(SLOT_PREFIX)) return slotPicked(c, id, values);
  if (id.startsWith(EMPTY_PREFIX)) return emptyPressed(c, id);
  if (id.startsWith(BACK_PREFIX)) return backPressed(c, id);
  if (id.startsWith(MATCH_PREFIX)) return matchPicked(c, id, values);
  if (id.startsWith(SLOT_PICK_PREFIX)) return slotPickedForItem(c, id, values);
  if (id.startsWith(WEARING_CHAR_PREFIX)) return wearingCharacterPicked(c, id, values);
  if (id.startsWith(WEARING_PREFIX)) return wearingPressed(c, id);
  return null;
}

// ---------------------------------------------------------------- autocomplete for /gear wear item:

/**
 * The gear the character can use, matching the start of the name: one statement. The character is the `character:`
 * value when given (the caller's own only), else the caller's main; none found means no class or race filter. A
 * character with no class (or race), an item with ALL or no class listed, passes.
 */
export const WEAR_ITEMS_SQL = `WITH ch AS (
    SELECT (SELECT bit FROM game_class WHERE code = upper(c.class) AND item_count > 0) AS cb,
           (SELECT bit FROM game_race WHERE code = c.race AND item_count > 0) AS rb
    FROM character c WHERE c.guild_id = ?1 AND c.owner_user_id = ?2 AND c.deleted_at IS NULL
      AND (CASE WHEN ?3 IS NULL THEN c.is_main = 1 ELSE c.name_key = lower(?3) END) LIMIT 1)
  SELECT i.name FROM item i LEFT JOIN ch ON 1
  WHERE i.source = 'wiki' AND i.gone_at IS NULL AND i.slot_mask <> 0 AND (i.slot_mask & ?4) <> 0 AND i.name_key >= ?5 AND i.name_key < ?6
    AND (ch.cb IS NULL OR i.class_mask IN (-1, 0) OR ((i.class_mask >> ch.cb) & 1) = 1)
    AND (ch.rb IS NULL OR i.race_mask IN (-1, 0) OR ((i.race_mask >> ch.rb) & 1) = 1)
  ORDER BY i.name_key LIMIT 25`;

export async function wearItemChoices(db: D1Database, guildId: string, userId: string, character: string | undefined, typed: string): Promise<{ name: string; value: string }[]> {
  const t = typed.trim().toLowerCase();
  const { results } = await db.prepare(WEAR_ITEMS_SQL).bind(guildId, userId, character ?? null, WEAR_MASK, t, `${t}￿`).all<{ name: string }>();
  return results.map((r) => ({ name: truncate(r.name, 100), value: r.name }));
}

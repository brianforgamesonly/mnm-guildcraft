// /me [character] and /officer edit-member member: (work order 18, CHECKLIST A20): one private panel for a member's
// characters (the main marked), skills with their stale markers, known recipes, request notices and open requests, with
// buttons that replace /character add|edit|remove, /craft update, /craft notify, /craft forget and /craft requests.
// The edits reuse those commands' handlers, so their checks and audit rows are unchanged.
//
// Whose panel. Every custom_id carries the member it acts on (the "target"). A press whose target is not the presser is
// re-checked for the officer role on that press (the role is read from the press itself, never from the message), so a
// copied button gets a member nowhere. Unmapped behaviour stays: Add character, Notices and Forget a recipe act only on
// the presser's own (the old /character add, /craft notify and /craft forget had no member: option), so an officer's
// view of another member's panel leaves them out. Edit, Remove, Update skills and Cancel a request work for officers,
// as /character edit member:, /character remove member:, the Update skills buttons and /craft requests did.
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import { audit, now, touchMember } from '../access.ts';
import type { Ctx } from '../context.ts';
import { button, EMBED_LIMITS, embedChars, ephemeral, memberTag, optString, row, STYLE_DANGER, STYLE_PRIMARY, STYLE_SECONDARY, truncate, updateMessage, type InteractionReply, type MessageReply, type ModalComponent, type Option } from '../discord.ts';
import { NO_REQUEST_CHANNEL } from '../requests.ts';
import { REQUEST_COLS, type RequestRow } from '../requests.ts';
import { visibleTo } from '../recipes.ts';
import { className } from '../gear/score.ts';
import { CHARACTER_RACES_SQL, gameClasses, characterAdd, characterEdit, characterRemove, charactersWithRemoved, findById, LEVEL_MAX, liveCharacters, NAME_MAX, resolveCharacter, type Character } from './character.ts';
import { PANEL_PREFIX as GEAR_PANEL_PREFIX, PANEL_PICK_PREFIX as GEAR_PANEL_PICK_PREFIX } from '../gear/wear.ts';
import { raceLabel } from '../gear/vocab.ts';
import { OFFICER_ONLY } from './members.ts';
import { craftForget } from './recipes.ts';
import { modalValues } from './reports.ts';
import { logAction, notifyLine, requestList, written } from './requests.ts';
import { allTradeskills, characterEmbeds, EMBED_MAX, skillGroups, updatePicker } from './skills.ts';
import { WELCOME } from './welcome.ts';
import { dkpMeLine } from '../dkp/me.ts';

export const ADD_PREFIX = 'mea:';
export const ADD_MODAL_PREFIX = 'meam:';
export const EDIT_PREFIX = 'mee:';
export const EDIT_PICK_PREFIX = 'mees:';
export const EDIT_MODAL_PREFIX = 'meem:';
export const REMOVE_PREFIX = 'mer:';
export const REMOVE_PICK_PREFIX = 'mers:';
export const UPDATE_PREFIX = 'meu:';
export const UPDATE_PICK_PREFIX = 'meus:';
export const NOTICES_PREFIX = 'men:';
export const NOTICES_PICK_PREFIX = 'mens:';
export const REMINDERS_PREFIX = 'merm:';
export const FORGET_PREFIX = 'mef:';
export const FORGET_PAGE_PREFIX = 'mefn:';
export const FORGET_PICK_PREFIX = 'mefs:';
export const CANCEL_PREFIX = 'mec:';
/** The panel's buttons that answer with a modal, at once (src/interactions.ts OPENS_MODAL). */
export const ME_OPENS_MODAL = [ADD_PREFIX, EDIT_PREFIX, EDIT_PICK_PREFIX];

const SELECT_MAX = 25;
const LABEL_MAX = 45;
const YES = 'yes';
const NO = 'no';

// ---------------------------------------------------------------- copy (order 18; listed for approval in docs/COPY.md)

export const ME_COPY = {
  noCharacters: 'You have no characters yet. Press **Add character** to register your first one: it becomes your main.',
  othersNone: (who: string) => `${who} has no characters yet. They add them with \`/me\`.`,
  actingFor: (who: string) => `**Acting for ${who}.** Changes you make here are recorded as yours.`,
  showing: (shown: number, total: number) => `Showing ${shown} of ${total} characters.`,
  stale: (days: number) => `-# *stale* = not updated in ${days} days.`,
  requestsHead: '**Your open craft requests:**',
  othersRequestsHead: '**Their open craft requests:**',
  noRequests: '**Open craft requests:** none (`/request` starts one)',
  add: 'Add character',
  edit: 'Edit character',
  remove: 'Remove character',
  update: 'Update skills',
  notices: 'Notices',
  remindersOn: 'Reminders: on',
  remindersOff: 'Reminders: off',
  notYours: 'That button is for the member whose `/me` it is.',
  forget: 'Forget a recipe',
  cancel: 'Cancel a request',
  ownOnly: 'Only the member can do that, from their own `/me`.',
  gone: 'That character is no longer available. Run `/me` again.',
  pickEdit: 'Which character do you want to edit?',
  pickRemove: 'Which character do you want to remove? Its skills are kept, and adding it again restores it.',
  pickUpdate: 'Which character are you updating?',
  pickCharacter: 'Pick a character',
  removedMark: ' (removed)',
  nothingChanged: 'Nothing changed.',
  addTitle: 'Add a character',
  editTitle: (name: string) => truncate(`Edit ${name}`, LABEL_MAX),
  name: 'Name',
  className: 'Class',
  // Order 39: a menu of the game's classes (retires "A class code from the game (e.g. CLR), or type your own").
  classHint: 'Optional. The classes in the wiki data',
  noClass: 'No class',
  level: 'Level',
  levelHint: `Optional: 1 to ${LEVEL_MAX}`,
  levelEditHint: `1 to ${LEVEL_MAX}. Blank keeps the current level`,
  mainEditHint: 'To change your main, pick Yes on the character that should be it',
  main: 'Make this your main?',
  mainYes: 'Yes, my main character',
  mainNo: 'No',
  noticesHead: 'Pick the tradeskills you want craft request notices for. Unpick one to stop its notices.',
  noticesPlaceholder: (label: string) => `${label}: request notices`,
  noKnown: 'No recipes are marked known yet. Press **I know this recipe** on an `/item` card to mark one.',
  forgetHead: (from: number, to: number, total: number) => `Pick a recipe to unmark (${from}–${to} of ${total} marked known):`,
  forgetPlaceholder: 'A recipe marked known',
  noOpen: 'No open craft requests.',
  cancelHead: 'Pick a request to cancel. Everyone in its thread is told.',
  // Order 35.
  race: 'Race',
  raceHint: 'Optional. Codes from the wiki data; no race means any race',
  noRace: 'No race (any)',
  gear: (name: string) => truncate(`Gear: ${name}`, 80),
  gearPick: 'Gear: pick a character',
} as const;

// ---------------------------------------------------------------- whose panel

/** The target in "<prefix><target>[:...]", and whether the presser may act on it (officer re-check for someone else's). */
function target(c: Ctx, customId: string, prefix: string, ownOnly = false): { ownerId: string; rest: string[] } | { reply: MessageReply } {
  const [ownerId, ...rest] = customId.slice(prefix.length).split(':');
  if (!/^\d+$/.test(ownerId ?? '')) return { reply: ephemeral(ME_COPY.gone) };
  if (ownerId !== c.userId) {
    if (ownOnly) return { reply: ephemeral(ME_COPY.ownOnly) };
    if (!c.officer) return { reply: ephemeral(OFFICER_ONLY) };
  }
  return { ownerId, rest };
}

/** A picked character (a select's value), re-checked: live, the target's, and the presser may act on it. */
async function pickedCharacter(c: Ctx, ownerId: string, value: string | undefined, includeRemoved = false): Promise<Character | null> {
  const id = Number(value);
  const ch = Number.isInteger(id) ? await findById(c.db, c.guild.id, id, includeRemoved) : null;
  return ch && ch.owner_user_id === ownerId ? ch : null;
}

const characterSelect = (customId: string, chars: Character[]) =>
  row([
    {
      type: MessageComponentTypes.STRING_SELECT,
      custom_id: customId,
      placeholder: ME_COPY.pickCharacter,
      options: chars.slice(0, SELECT_MAX).map((ch) => ({ label: truncate(`${ch.name}${ch.deleted_at ? ME_COPY.removedMark : ch.is_main ? ' (main)' : ''}`, 100), value: String(ch.id) })),
    },
  ]);

/** The reply a handler gave, as an edit of the presser's own private select message. */
const asEdit = (r: MessageReply) => updateMessage({ content: r.data.content, embeds: r.data.embeds ?? [], components: r.data.components ?? [] });

// ---------------------------------------------------------------- the panel

async function openRequests(c: Ctx, ownerId: string): Promise<RequestRow[]> {
  const { results } = await c.db
    .prepare(`SELECT ${REQUEST_COLS} FROM craft_request r WHERE r.guild_id = ? AND r.requester = ? AND r.status = 'open' AND r.thread_id IS NOT NULL ORDER BY r.id LIMIT ${SELECT_MAX}`)
    .bind(c.guild.id, ownerId)
    .all<RequestRow>();
  return results;
}

/** The panel's buttons: at most 2 rows of 4 and 3 (Discord: 5 rows, 5 buttons a row). Own-only buttons on one's own panel only. */
export function panelRows(ownerId: string, own: boolean, hasCharacters: boolean, hasRequests: boolean, reminders: boolean | null = null): unknown[] {
  const first = [
    ...(own ? [button(`${ADD_PREFIX}${ownerId}`, ME_COPY.add, STYLE_PRIMARY)] : []),
    ...(hasCharacters
      ? [button(`${EDIT_PREFIX}${ownerId}`, ME_COPY.edit), button(`${REMOVE_PREFIX}${ownerId}`, ME_COPY.remove, STYLE_DANGER), button(`${UPDATE_PREFIX}${ownerId}`, ME_COPY.update, STYLE_PRIMARY)]
      : []),
  ];
  const second = [
    ...(own ? [button(`${NOTICES_PREFIX}${ownerId}`, ME_COPY.notices)] : []),
    ...(own && reminders !== null ? [button(`${REMINDERS_PREFIX}${ownerId}`, reminders ? ME_COPY.remindersOn : ME_COPY.remindersOff)] : []),
    ...(own && hasCharacters ? [button(`${FORGET_PREFIX}${ownerId}:0`, ME_COPY.forget)] : []),
    ...(hasRequests ? [button(`${CANCEL_PREFIX}${ownerId}`, ME_COPY.cancel, STYLE_SECONDARY)] : []),
  ];
  return [first, second].filter((r) => r.length).map((r) => row(r));
}

/**
 * Order 35: Gear for each character shown (src/gear/wear.ts): a button each, up to 5 (one row); more, one select. The
 * custom_id names the character; the panel re-checks on every press who may see it (the owner, or an officer).
 */
export function gearRow(ownerId: string, chars: Character[]): unknown[] {
  if (!chars.length) return [];
  if (chars.length <= 5) return [row(chars.map((ch) => button(`${GEAR_PANEL_PREFIX}${ch.id}`, ME_COPY.gear(ch.name))))];
  return [
    row([
      {
        type: MessageComponentTypes.STRING_SELECT,
        custom_id: `${GEAR_PANEL_PICK_PREFIX}${ownerId}`,
        placeholder: ME_COPY.gearPick,
        options: chars.slice(0, SELECT_MAX).map((ch) => ({ label: truncate(ch.name, 100), value: String(ch.id) })),
      },
    ]),
  ];
}

/** Order 33: the Reminders toggle's state: null where the Events module is off, so the panel doesn't offer it. One statement. */
async function remindersOn(c: Ctx): Promise<boolean | null> {
  const r = await c.db
    .prepare('SELECT (SELECT enabled FROM event_guild WHERE guild_id = ?1) AS module, (SELECT reminders_off FROM event_member WHERE guild_id = ?1 AND member_id = ?2) AS off')
    .bind(c.guild.id, c.userId)
    .first<{ module: number | null; off: number | null }>();
  return r?.module === 1 ? r.off !== 1 : null;
}

/** merm:<member>: Reminders on or off, for this server. It stops reminders only, as No reminders does. */
export async function remindersButton(c: Ctx, id: string): Promise<MessageReply> {
  if (id.slice(REMINDERS_PREFIX.length) !== c.userId) return ephemeral(ME_COPY.notYours);
  await c.db
    .prepare('INSERT INTO event_member (guild_id, member_id, reminders_off) VALUES (?1, ?2, 1) ON CONFLICT (guild_id, member_id) DO UPDATE SET reminders_off = 1 - reminders_off')
    .bind(c.guild.id, c.userId)
    .run();
  return asEdit(await mePanel(c, c.userId));
}

/** The panel for `ownerId` (the caller, or a member an officer opened), optionally one named character only. */
export async function mePanel(c: Ctx, ownerId: string, name?: string): Promise<MessageReply> {
  const own = ownerId === c.userId;
  let chars: Character[];
  if (name !== undefined) {
    const t = await resolveCharacter(c, ownerId, name);
    if ('reply' in t) return t.reply;
    chars = [t.character];
  } else chars = await liveCharacters(c.db, c.guild.id, ownerId);
  const reqs = await openRequests(c, ownerId);
  const who = own ? '' : await whoIs(c, ownerId);
  // Order 27: DKP balances and attendance, only where DKP is on.
  const dkp = await dkpMeLine(c.db, c.guild.id, ownerId);
  const reminders = own ? await remindersOn(c) : null;
  if (!chars.length) {
    const rows = panelRows(ownerId, own, false, reqs.length > 0, reminders);
    const head = own ? ME_COPY.noCharacters : ME_COPY.othersNone(who);
    const content = dkp ? `${head}\n${dkp}` : head;
    return own ? ephemeral(content, { embeds: [WELCOME], components: rows }) : ephemeral(content, { components: rows });
  }
  const { embeds, anyStale } = await characterEmbeds(c, chars.slice(0, EMBED_MAX));
  // Inside the message's 6,000 characters, less the one-time welcome's reserve: whole characters off the end, noted.
  while (embeds.length > 1 && embedChars(embeds) > EMBED_LIMITS.total - 1000) embeds.pop();
  const listed = reqs.length ? await requestList(c, reqs, false) : null;
  const notes = [
    own ? null : ME_COPY.actingFor(who),
    chars.length > embeds.length ? ME_COPY.showing(embeds.length, chars.length) : null,
    await notifyLine(c.db, c.guild.id, ownerId),
    listed ? [own ? ME_COPY.requestsHead : ME_COPY.othersRequestsHead, ...listed.lines].join('\n') : ME_COPY.noRequests,
    anyStale ? ME_COPY.stale(c.guild.stale_days) : null,
    dkp,
  ].filter(Boolean);
  return ephemeral(truncate(notes.join('\n'), 2000), { embeds, components: [...panelRows(ownerId, own, true, reqs.length > 0, reminders), ...gearRow(ownerId, chars)] });
}

async function whoIs(c: Ctx, userId: string): Promise<string> {
  const m = await c.db.prepare('SELECT display_name FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, userId).first<{ display_name: string }>();
  return memberTag(userId, m?.display_name);
}

/** /me [character]. */
export const meCommand = (c: Ctx, opts: Option[]) => mePanel(c, c.userId, optString(opts, 'character'));
/** /officer edit-member member: (the route checks the officer role): that member's panel. */
export async function officerEditMember(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const userId = optString(opts, 'member');
  if (!userId) return ephemeral('Pick the member.');
  return mePanel(c, userId);
}

// ---------------------------------------------------------------- Add character (a modal at once)

const textInput = (custom_id: string, label: string, o: { description?: string; required?: boolean; max?: number; value?: string | null } = {}) => ({
  type: MessageComponentTypes.LABEL,
  label,
  ...(o.description ? { description: o.description } : {}),
  component: {
    type: MessageComponentTypes.INPUT_TEXT,
    custom_id,
    style: 1,
    required: o.required ?? false,
    ...(o.max ? { max_length: o.max } : {}),
    ...(o.value ? { value: o.value } : {}),
  },
});
const mainSelect = (isMain: boolean, edit: boolean) => ({
  type: MessageComponentTypes.LABEL,
  label: ME_COPY.main,
  ...(edit ? { description: ME_COPY.mainEditHint } : {}),
  component: {
    type: MessageComponentTypes.STRING_SELECT,
    custom_id: 'main',
    required: false,
    min_values: 0,
    max_values: 1,
    options: [
      { label: ME_COPY.mainYes, value: YES, ...(isMain ? { default: true } : {}) },
      { label: ME_COPY.mainNo, value: NO, ...(isMain ? {} : { default: true }) },
    ],
  },
});
/**
 * Order 35: the race choice, a select in the form (Discord: a String Select sits in a modal inside a Label; a modal holds
 * at most 5 components, and this is the fifth). The races are game_race's, never a mount race; "No race" clears it. Left
 * out while the race list is empty.
 */
const NO_RACE = 'none';
const raceSelect = (races: string[], current: string | null) => ({
  type: MessageComponentTypes.LABEL,
  label: ME_COPY.race,
  description: ME_COPY.raceHint,
  component: {
    type: MessageComponentTypes.STRING_SELECT,
    custom_id: 'race',
    required: false,
    min_values: 0,
    max_values: 1,
    // Review fix: the character's own race is always offered (and picked), even when the list no longer holds it, so
    // saving the form for another change never clears it silently.
    options: [
      { label: ME_COPY.noRace, value: NO_RACE, ...(current === null ? { default: true } : {}) },
      ...[...(current !== null && !races.includes(current) ? [current] : []), ...races].slice(0, SELECT_MAX - 1).map((r) => ({ label: raceLabel(r), value: r, ...(r === current ? { default: true } : {}) })),
    ],
  },
});
/**
 * Order 39: the class choice, a select in the form in place of the text box (Discord: "String Selects are available in
 * messages and modals. They must be placed inside an Action Row in messages and a Label in modals"; a modal holds "Between
 * 1 and 5 (inclusive) components", and this keeps it at 5). The classes are game_class's (src/commands/character.ts
 * GAME_CLASSES_SQL), labelled by name, valued by code, by name; "No class" clears it. Edit pre-picks a known class (and No
 * class when none is saved). A stored class outside the list is not offered and nothing is picked: left alone, the menu
 * sends nothing and the stored value is kept (order 39's override 1: never rewritten). Left out while the list is empty.
 */
const NO_CLASS = 'none';
const classSelect = (classes: string[], ch: Character | undefined) => ({
  type: MessageComponentTypes.LABEL,
  label: ME_COPY.className,
  description: ME_COPY.classHint,
  component: {
    type: MessageComponentTypes.STRING_SELECT,
    custom_id: 'class',
    required: false,
    min_values: 0,
    max_values: 1,
    options: [
      { label: ME_COPY.noClass, value: NO_CLASS, ...(ch && ch.class === null ? { default: true } : {}) },
      ...classes.slice(0, SELECT_MAX - 1).map((code) => ({ label: className(code), value: code, ...(ch?.class?.toUpperCase() === code ? { default: true } : {}) })),
    ],
  },
});
// Order 36 review fix: in the order members read them, by name (a code with no name sorts by itself).
const characterRaces = async (c: Ctx) =>
  (await c.db.prepare(CHARACTER_RACES_SQL).all<{ code: string }>()).results.map((r) => r.code).sort((a, b) => raceLabel(a).localeCompare(raceLabel(b), 'en'));
/** Order 39: the class menu's list, by name (one statement, read alongside the races' one). */
async function formLists(c: Ctx): Promise<{ races: string[]; classes: string[] }> {
  const [races, classes] = await Promise.all([characterRaces(c), gameClasses(c.db)]);
  return { races, classes: classes.sort((a, b) => className(a).localeCompare(className(b), 'en')) };
}
const characterFields = ({ races, classes }: { races: string[]; classes: string[] }, ch?: Character) => [
  textInput('name', ME_COPY.name, { required: true, max: NAME_MAX, value: ch?.name }),
  ...(classes.length ? [classSelect(classes, ch)] : []),
  textInput('level', ME_COPY.level, { description: ch ? ME_COPY.levelEditHint : ME_COPY.levelHint, max: 3, value: ch?.level === null || ch?.level === undefined ? null : String(ch.level) }),
  mainSelect(!!ch?.is_main, !!ch),
  ...(races.length ? [raceSelect(races, ch?.race ?? null)] : []),
];
/** The form's race: undefined when the form had no race select; '' for No race (or nothing picked). */
const raceOf = (v: Map<string, string>) => (v.has('race') ? (v.get('race') === NO_RACE ? '' : (v.get('race') ?? '')) : undefined);
/**
 * Order 39: the form's class: undefined (keep) when nothing was picked or the form had no menu; '' for No class; else the
 * picked value, which /character's check refuses unless it is a code from the list. A form sent before order 39 (a text box)
 * arrives the same way: blank keeps, text is checked.
 */
const classOf = (v: Map<string, string>) => {
  const raw = (v.get('class') ?? '').trim();
  return raw === '' ? undefined : raw === NO_CLASS ? '' : raw;
};

/** mea:<target>: the Add character form (own panel only: /character add had no member: option). */
export async function addButton(c: Ctx, customId: string): Promise<InteractionReply> {
  const t = target(c, customId, ADD_PREFIX, true);
  if ('reply' in t) return t.reply;
  return { type: InteractionResponseType.MODAL, data: { custom_id: `${ADD_MODAL_PREFIX}${t.ownerId}`, title: ME_COPY.addTitle, components: characterFields(await formLists(c)) } };
}

/** A typed level: blank is none, digits are the number, anything else fails /character's level check. */
const levelOf = (raw: string | undefined) => {
  const s = (raw ?? '').trim();
  return s === '' ? undefined : /^\d{1,3}$/.test(s) ? Number(s) : Number.NaN;
};
const opt = (name: string, value: string | number | boolean): Option => ({ type: 3, name, value });

/** meam:<target>: /character add with the form's values. */
export async function addSubmitted(c: Ctx, customId: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const t = target(c, customId, ADD_MODAL_PREFIX, true);
  if ('reply' in t) return t.reply;
  const v = modalValues(components);
  const level = levelOf(v.get('level'));
  const cls = classOf(v);
  const race = raceOf(v);
  // Order 32: an event card's Add a character reaches this form from a member who may never have run a command.
  const { isNew } = await touchMember(c.db, c.guild.id, c.member);
  const reply = await characterAdd(c, [
    opt('name', v.get('name') ?? ''),
    ...(cls ? [opt('class', cls)] : []),
    ...(race ? [opt('race', race)] : []),
    ...(level !== undefined ? [opt('level', level)] : []),
    ...(v.get('main') === YES ? [opt('main', true)] : []),
  ]);
  return isNew ? { ...reply, data: { ...reply.data, embeds: [...(reply.data.embeds ?? []).slice(0, 9), WELCOME] } } : reply;
}

// ---------------------------------------------------------------- Edit character (a select when several, then a modal)

const editModal = async (c: Ctx, ch: Character): Promise<InteractionReply> => ({
  type: InteractionResponseType.MODAL,
  data: { custom_id: `${EDIT_MODAL_PREFIX}${ch.id}`, title: ME_COPY.editTitle(ch.name), components: characterFields(await formLists(c), ch) },
});

/** mee:<target>: one character, its form at once; several, a private select first (answered at once too). */
export async function editButton(c: Ctx, customId: string): Promise<InteractionReply> {
  const t = target(c, customId, EDIT_PREFIX);
  if ('reply' in t) return t.reply;
  // An officer on another member's panel also reaches their removed characters, to free a name (as /character edit
  // member: did); the member's own panel lists live ones only.
  const chars = t.ownerId === c.userId ? await liveCharacters(c.db, c.guild.id, t.ownerId) : await charactersWithRemoved(c.db, c.guild.id, t.ownerId);
  if (!chars.length) return ephemeral(ME_COPY.gone);
  if (chars.length === 1) return editModal(c, chars[0]);
  return ephemeral(ME_COPY.pickEdit, { components: [characterSelect(`${EDIT_PICK_PREFIX}${t.ownerId}`, chars)] });
}

/** mees:<target>: the picked character's form. */
export async function editPicked(c: Ctx, customId: string, values: string[]): Promise<InteractionReply> {
  const t = target(c, customId, EDIT_PICK_PREFIX);
  if ('reply' in t) return t.reply;
  const ch = await pickedCharacter(c, t.ownerId, values[0], t.ownerId !== c.userId);
  return ch ? editModal(c, ch) : ephemeral(ME_COPY.gone);
}

/** meem:<character id>: /character edit with what changed (member: is the owner, so an officer's edit is checked as before). */
export async function editSubmitted(c: Ctx, customId: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const ch = await findById(c.db, c.guild.id, Number(customId.slice(EDIT_MODAL_PREFIX.length)), true);
  if (!ch) return ephemeral(ME_COPY.gone);
  if (ch.owner_user_id !== c.userId && !c.officer) return ephemeral(OFFICER_ONLY);
  // Removed characters are an officer's, on another member's panel (characterEdit applies the same rule).
  if (ch.deleted_at && ch.owner_user_id === c.userId) return ephemeral(ME_COPY.gone);
  const v = modalValues(components);
  const name = (v.get('name') ?? '').trim();
  const cls = classOf(v);
  const level = levelOf(v.get('level'));
  const main = v.get('main');
  const race = raceOf(v);
  const changes: Option[] = [
    ...(name !== ch.name ? [opt('new_name', name)] : []),
    // Order 39: nothing picked keeps the stored class (even one outside the list); No class clears it.
    // Review fix: case-insensitive, as the pre-pick is, so an untouched menu never rewrites "spb" as "SPB".
    ...(cls !== undefined && cls.toUpperCase() !== (ch.class ?? '').toUpperCase() ? [opt('class', cls)] : []),
    // Order 35: the race picked, or No race to clear it.
    ...(race !== undefined && race !== (ch.race ?? '') ? [opt('race', race)] : []),
    ...(level !== undefined && level !== ch.level ? [opt('level', level)] : []),
    // A main stops being the main only when another becomes it, so "No" on the main changes nothing (the other fields still save).
    ...(main === YES && !ch.is_main ? [opt('main', true)] : []),
  ];
  if (!changes.length) return ephemeral(ME_COPY.nothingChanged);
  return characterEdit(c, [opt('name', ch.name), opt('member', ch.owner_user_id), ...changes]);
}

// ---------------------------------------------------------------- Remove character, Update skills (a select when several)

/** mer:<target>: a select of the characters (always: picking one is the confirmation). */
export async function removeButton(c: Ctx, customId: string): Promise<MessageReply> {
  const t = target(c, customId, REMOVE_PREFIX);
  if ('reply' in t) return t.reply;
  const chars = await liveCharacters(c.db, c.guild.id, t.ownerId);
  if (!chars.length) return ephemeral(ME_COPY.gone);
  return ephemeral(ME_COPY.pickRemove, { components: [characterSelect(`${REMOVE_PICK_PREFIX}${t.ownerId}`, chars)] });
}

/** mers:<target>: /character remove for the picked character. */
export async function removePicked(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const t = target(c, customId, REMOVE_PICK_PREFIX);
  if ('reply' in t) return t.reply;
  const ch = await pickedCharacter(c, t.ownerId, values[0]);
  if (!ch) return updateMessage({ content: ME_COPY.gone, components: [] });
  return asEdit(await characterRemove(c, [opt('name', ch.name), opt('member', ch.owner_user_id)]));
}

/** meu:<target>: /craft update's skill select, for the one character or the one picked. */
export async function updateButton(c: Ctx, customId: string): Promise<MessageReply> {
  const t = target(c, customId, UPDATE_PREFIX);
  if ('reply' in t) return t.reply;
  const chars = await liveCharacters(c.db, c.guild.id, t.ownerId);
  if (!chars.length) return ephemeral(ME_COPY.gone);
  if (chars.length === 1) return updatePicker(c, chars[0]);
  return ephemeral(ME_COPY.pickUpdate, { components: [characterSelect(`${UPDATE_PICK_PREFIX}${t.ownerId}`, chars)] });
}

/** meus:<target>: the picked character's skill select, in place of the character select. */
export async function updatePicked(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const t = target(c, customId, UPDATE_PICK_PREFIX);
  if ('reply' in t) return t.reply;
  const ch = await pickedCharacter(c, t.ownerId, values[0]);
  if (!ch) return updateMessage({ content: ME_COPY.gone, components: [] });
  return asEdit(await updatePicker(c, ch));
}

// ---------------------------------------------------------------- Notices (own only; one select per group of up to 25)

async function noticesView(c: Ctx): Promise<{ content: string; components: unknown[] } | null> {
  const [skills, on] = await Promise.all([
    allTradeskills(c.db),
    c.db.prepare('SELECT tradeskill_id FROM craft_notify WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, c.userId).all<{ tradeskill_id: number }>(),
  ]);
  if (!skills.length) return null;
  const active = new Set(on.results.map((r) => r.tradeskill_id));
  // The tradeskill list is derived (the import's); skillGroups splits it into selects of at most 25.
  const components = skillGroups(skills)
    .slice(0, 5)
    .map((g, i) =>
      row([
        {
          type: MessageComponentTypes.STRING_SELECT,
          custom_id: `${NOTICES_PICK_PREFIX}${i}`,
          placeholder: ME_COPY.noticesPlaceholder(g.label),
          min_values: 0,
          max_values: g.skills.length,
          options: g.skills.map((s) => ({ label: truncate(s.name, 100), value: String(s.id), ...(active.has(s.id) ? { default: true } : {}) })),
        },
      ]),
    );
  return { content: [ME_COPY.noticesHead, await notifyLine(c.db, c.guild.id, c.userId)].join('\n'), components };
}

/** men:<target>: the member's own notices. */
export async function noticesButton(c: Ctx, customId: string): Promise<MessageReply> {
  const t = target(c, customId, NOTICES_PREFIX, true);
  if ('reply' in t) return t.reply;
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const v = await noticesView(c);
  return v ? ephemeral(v.content, { components: v.components }) : ephemeral("The tradeskill list hasn't loaded yet. Try again later.");
}

/** mens:<group>: that group's picks become the presser's notices for its tradeskills (the other groups are untouched). */
export async function noticesPicked(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return updateMessage({ content: NO_REQUEST_CHANNEL, components: [] });
  const group = skillGroups(await allTradeskills(c.db))[Number(customId.slice(NOTICES_PICK_PREFIX.length))];
  if (!group) return updateMessage({ content: "That list has changed. Press **Notices** on `/me` again.", components: [] });
  const ids = group.skills.map((s) => s.id);
  const picked = values.map(Number).filter((n) => ids.includes(n));
  const was = new Set((await c.db.prepare('SELECT tradeskill_id FROM craft_notify WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, c.userId).all<{ tradeskill_id: number }>()).results.map((r) => r.tradeskill_id));
  const turnOn = picked.filter((n) => !was.has(n));
  const turnOff = ids.filter((n) => !picked.includes(n) && was.has(n));
  const names = (list: number[]) => group.skills.filter((s) => list.includes(s.id)).map((s) => s.name).join(', ');
  // The audit rows keep /craft notify's shape ({ on, tradeskills }), one per direction, and only for a change.
  const stmts: D1PreparedStatement[] = [];
  if (turnOn.length)
    stmts.push(
      c.db.prepare('INSERT OR IGNORE INTO craft_notify (guild_id, discord_user_id, tradeskill_id, created_at) SELECT ?, ?, value, ? FROM json_each(?)').bind(c.guild.id, c.userId, now(), JSON.stringify(turnOn)),
      audit(c.db, c.guild.id, c.userId, 'craft.notify', `member:${c.userId}`, null, { on: true, tradeskills: names(turnOn) }),
    );
  if (turnOff.length)
    stmts.push(
      c.db.prepare('DELETE FROM craft_notify WHERE guild_id = ? AND discord_user_id = ? AND tradeskill_id IN (SELECT value FROM json_each(?))').bind(c.guild.id, c.userId, JSON.stringify(turnOff)),
      audit(c.db, c.guild.id, c.userId, 'craft.notify', `member:${c.userId}`, null, { on: false, tradeskills: names(turnOff) }),
    );
  // The request log line (order 16's "writes per action"), as /craft notify wrote it.
  logAction('notify', stmts.length ? written(await c.db.batch(stmts)) : 0, null);
  const v = await noticesView(c);
  return updateMessage(v ?? { content: ME_COPY.nothingChanged, components: [] });
}

// ---------------------------------------------------------------- Forget a recipe (own only; paged 25 a page)

interface Known {
  character_id: number;
  character: string;
  recipe_id: number;
  item: string;
  tradeskill: string;
}

async function forgetView(c: Ctx, page: number): Promise<{ content: string; components: unknown[] }> {
  const { results } = await c.db
    .prepare(
      `SELECT ch.id AS character_id, ch.name AS character, r.id AS recipe_id, i.name AS item, t.name AS tradeskill
       FROM character_recipe k JOIN character ch ON ch.id = k.character_id JOIN recipe r ON r.id = k.recipe_id
       JOIN item i ON i.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id
       WHERE ch.guild_id = ?1 AND ch.owner_user_id = ?2 AND ch.deleted_at IS NULL AND ${visibleTo('?1')}
       ORDER BY i.name COLLATE NOCASE, t.name COLLATE NOCASE, ch.name COLLATE NOCASE`,
    )
    .bind(c.guild.id, c.userId)
    .all<Known>();
  if (!results.length) return { content: ME_COPY.noKnown, components: [] };
  const pages = Math.ceil(results.length / SELECT_MAX);
  const p = Math.min(Math.max(0, page), pages - 1);
  const shown = results.slice(p * SELECT_MAX, (p + 1) * SELECT_MAX);
  const select = row([
    {
      type: MessageComponentTypes.STRING_SELECT,
      custom_id: FORGET_PICK_PREFIX,
      placeholder: ME_COPY.forgetPlaceholder,
      options: shown.map((k) => ({ label: truncate(`${k.item} · ${k.tradeskill}`, 100), description: truncate(k.character, 100), value: `${k.character_id}:${k.recipe_id}` })),
    },
  ]);
  const nav = row([
    button(`${FORGET_PAGE_PREFIX}${c.userId}:${p - 1}`, '◀ Previous', STYLE_SECONDARY, p === 0),
    button(`${FORGET_PAGE_PREFIX}${c.userId}:${p + 1}`, 'Next ▶', STYLE_SECONDARY, p >= pages - 1),
  ]);
  return { content: ME_COPY.forgetHead(p * SELECT_MAX + 1, p * SELECT_MAX + shown.length, results.length), components: [select, ...(pages > 1 ? [nav] : [])] };
}

/** mef:<target>:0 on the panel: a new private message. */
export async function forgetButton(c: Ctx, customId: string): Promise<MessageReply> {
  const t = target(c, customId, FORGET_PREFIX, true);
  if ('reply' in t) return t.reply;
  const v = await forgetView(c, 0);
  return ephemeral(v.content, { components: v.components });
}

/** mefn:<target>:<page>: Previous / Next, edited in place. */
export async function forgetPage(c: Ctx, customId: string): Promise<MessageReply> {
  const t = target(c, customId, FORGET_PAGE_PREFIX, true);
  if ('reply' in t) return t.reply;
  return updateMessage(await forgetView(c, Number(t.rest[0]) || 0));
}

/** mefs: "<character id>:<recipe id>": /craft forget for the presser's own character. */
export async function forgetPicked(c: Ctx, values: string[]): Promise<MessageReply> {
  const [chId, recipeId] = (values[0] ?? '').split(':').map(Number);
  const ch = await pickedCharacter(c, c.userId, String(chId));
  if (!ch) return updateMessage({ content: ME_COPY.gone, components: [] });
  return asEdit(await craftForget(c, [opt('recipe', `#${recipeId}`), opt('character', ch.name)]));
}

// ---------------------------------------------------------------- Cancel a request

/** mec:<target>: the target's open requests, with /craft requests' Cancel select (rql:, which re-checks who may cancel). */
export async function cancelButton(c: Ctx, customId: string): Promise<MessageReply> {
  const t = target(c, customId, CANCEL_PREFIX);
  if ('reply' in t) return t.reply;
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const reqs = await openRequests(c, t.ownerId);
  if (!reqs.length) return ephemeral(ME_COPY.noOpen);
  const { lines, select } = await requestList(c, reqs, t.ownerId !== c.userId);
  return ephemeral([ME_COPY.cancelHead, ...lines].join('\n').slice(0, 2000), { components: [row([select])] });
}

/** The panel's immediate answers (modals), routed from src/interactions.ts skillSelect. */
export function meImmediate(c: Ctx, id: string, values: string[]): Promise<InteractionReply> | InteractionReply | null {
  if (id.startsWith(ADD_PREFIX)) return addButton(c, id);
  if (id.startsWith(EDIT_PICK_PREFIX)) return editPicked(c, id, values);
  if (id.startsWith(EDIT_PREFIX)) return editButton(c, id);
  return null;
}

/** The panel's deferred answers, routed from src/interactions.ts component (null: not a panel custom_id). */
export function meComponent(c: Ctx, id: string, values: string[], components: ModalComponent[] | undefined, modal: boolean): Promise<MessageReply> | null {
  if (modal) {
    if (id.startsWith(ADD_MODAL_PREFIX)) return addSubmitted(c, id, components);
    if (id.startsWith(EDIT_MODAL_PREFIX)) return editSubmitted(c, id, components);
    return null;
  }
  if (id.startsWith(REMOVE_PICK_PREFIX)) return removePicked(c, id, values);
  if (id.startsWith(REMOVE_PREFIX)) return removeButton(c, id);
  if (id.startsWith(UPDATE_PICK_PREFIX)) return updatePicked(c, id, values);
  if (id.startsWith(UPDATE_PREFIX)) return updateButton(c, id);
  if (id.startsWith(NOTICES_PICK_PREFIX)) return noticesPicked(c, id, values);
  if (id.startsWith(NOTICES_PREFIX)) return noticesButton(c, id);
  if (id.startsWith(REMINDERS_PREFIX)) return remindersButton(c, id);
  if (id.startsWith(FORGET_PICK_PREFIX)) return forgetPicked(c, values);
  if (id.startsWith(FORGET_PAGE_PREFIX)) return forgetPage(c, id);
  if (id.startsWith(FORGET_PREFIX)) return forgetButton(c, id);
  if (id.startsWith(CANCEL_PREFIX)) return cancelButton(c, id);
  return null;
}

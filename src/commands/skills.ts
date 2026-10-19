// /craft set | update | me (PRD FR-2, except know/forget).
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import { audit, now } from '../access.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, optInt, optString, row, STYLE_PRIMARY, truncate, type Embed, type InteractionReply, type MessageReply, type ModalComponent, type Option } from '../discord.ts';
import { findById, liveCharacters, noCharacters, resolveCharacter, resolveOwner, type Character } from './character.ts';

export interface Tradeskill {
  id: number;
  name: string;
}

export const MAX_PICK = 5; // a Discord modal holds 5 inputs
export const SELECT_MAX_OPTIONS = 25;
const LABEL_MAX = 45;
const LEVEL_INPUT_MAX = 3;

/** Every tradeskill, by name: the list is derived by the import, never typed here. */
const allTradeskillsStmt = (db: D1Database) => db.prepare('SELECT id, name FROM tradeskill ORDER BY name COLLATE NOCASE');
export async function allTradeskills(db: D1Database): Promise<Tradeskill[]> {
  const { results } = await allTradeskillsStmt(db).all<Tradeskill>();
  return results;
}

const levelRange = (c: Ctx) => `Level must be a whole number from 0 to ${c.guild.skill_cap}.`;

// ---------------------------------------------------------------- /craft set

export async function craftSet(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const owner = resolveOwner(c, opts);
  if ('reply' in owner) return owner.reply;
  const typed = (optString(opts, 'skill') ?? '').trim();
  const skill = await c.db.prepare('SELECT id, name FROM tradeskill WHERE name = ? COLLATE NOCASE').bind(typed).first<Tradeskill>();
  if (!skill) return ephemeral(`I don't know a tradeskill called **${md(typed)}**. Pick one from the list as you type.`);
  const level = optInt(opts, 'level');
  if (level === undefined || !Number.isInteger(level) || level < 0 || level > c.guild.skill_cap) return ephemeral(levelRange(c));
  const target = await resolveCharacter(c, owner.ownerId, optString(opts, 'character'));
  if ('reply' in target) return target.reply;
  const ch = target.character;

  const before = await c.db
    .prepare('SELECT level FROM character_skill WHERE character_id = ? AND tradeskill_id = ?')
    .bind(ch.id, skill.id)
    .first<{ level: number }>();
  await c.db.batch([
    upsertSkill(c, ch.id, skill.id, level),
    audit(c.db, c.guild.id, c.userId, 'skill.set', `character:${ch.id}`, { [skill.name]: before?.level ?? null }, { [skill.name]: level }),
  ]);
  const was = before ? ` (was ${before.level})` : '';
  return ephemeral(`**${md(ch.name)}**: ${skill.name} set to **${level}**${was}.`, { components: updateButtons([ch]) });
}

function upsertSkill(c: Ctx, characterId: number, skillId: number, level: number): D1PreparedStatement {
  return c.db
    .prepare(
      'INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ' +
        'ON CONFLICT(character_id, tradeskill_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    )
    .bind(characterId, skillId, level, now(), c.userId);
}

const levelsStmt = (db: D1Database, characterId: number) => db.prepare('SELECT tradeskill_id, level FROM character_skill WHERE character_id = ?').bind(characterId);
const levelMap = (rows: { tradeskill_id: number; level: number }[]) => new Map(rows.map((r) => [r.tradeskill_id, r.level]));
async function levelsOf(db: D1Database, characterId: number): Promise<Map<number, number>> {
  return levelMap((await levelsStmt(db, characterId).all<{ tradeskill_id: number; level: number }>()).results);
}

// ---------------------------------------------------------------- /craft update: the select

/**
 * One select holds at most 25 options. Up to 25 skills: one select. Beyond that the PRD's split,
 * A–M and N–Z (a name not starting with A–M goes to N–Z), each further cut at 25 if it still overflows.
 */
export function skillGroups<T extends { name: string }>(skills: T[]): { label: string; skills: T[] }[] {
  if (skills.length <= SELECT_MAX_OPTIONS) return [{ label: 'Tradeskills', skills }];
  const halves: [string, T[]][] = [
    ['A–M', skills.filter((s) => /^[a-m]/i.test(s.name))],
    ['N–Z', skills.filter((s) => !/^[a-m]/i.test(s.name))],
  ];
  const out: { label: string; skills: T[] }[] = [];
  for (const [range, list] of halves) {
    const parts = Math.ceil(list.length / SELECT_MAX_OPTIONS);
    for (let p = 0; p < parts; p++)
      out.push({ label: `Tradeskills ${range}${parts > 1 ? ` (${p + 1}/${parts})` : ''}`, skills: list.slice(p * SELECT_MAX_OPTIONS, (p + 1) * SELECT_MAX_OPTIONS) });
  }
  return out;
}

export const SELECT_PREFIX = 'upd:';
export const MODAL_PREFIX = 'updm:';
const INPUT_PREFIX = 'lvl:';

export function updateSelects(characterId: number, skills: Tradeskill[], levels: Map<number, number>): unknown[] {
  return skillGroups(skills).map((g, i) => ({
    type: MessageComponentTypes.ACTION_ROW,
    components: [
      {
        type: MessageComponentTypes.STRING_SELECT,
        custom_id: `${SELECT_PREFIX}${characterId}:${i}`,
        placeholder: `${g.label}: pick up to ${MAX_PICK}`,
        min_values: 1,
        max_values: Math.min(MAX_PICK, g.skills.length),
        options: g.skills.map((s) => ({
          label: s.name,
          value: String(s.id),
          ...(levels.has(s.id) ? { description: `Now ${levels.get(s.id)}` } : {}),
        })),
      },
    ],
  }));
}

/** The skill-select step of /craft update, for one character. Also what an Update skills button opens. */
async function updatePicker(c: Ctx, ch: Character): Promise<MessageReply> {
  const skills = await allTradeskills(c.db);
  if (!skills.length) return ephemeral('The tradeskill list is empty: the recipe data has not been imported yet.');
  return ephemeral(`Pick up to ${MAX_PICK} tradeskills for **${md(ch.name)}**. A form then opens with a level box for each.`, {
    components: updateSelects(ch.id, skills, await levelsOf(c.db, ch.id)),
  });
}

export async function craftUpdate(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const target = await resolveCharacter(c, c.userId, optString(opts, 'character'));
  if ('reply' in target) return target.reply;
  return updatePicker(c, target.character);
}

// ---------------------------------------------------------------- Update skills buttons (order 3, ITEM 2)

export const BUTTON_PREFIX = 'upb:';
const BUTTONS_PER_ROW = 5;

/** One Update skills button per character (labelled with the name when there are several), up to 5 rows. */
export function updateButtons(chars: Pick<Character, 'id' | 'name'>[]): unknown[] {
  const buttons = chars.map((ch) => button(`${BUTTON_PREFIX}${ch.id}`, chars.length === 1 ? 'Update skills' : truncate(`Update ${ch.name}`, 80), STYLE_PRIMARY));
  const rows: unknown[] = [];
  for (let i = 0; i < buttons.length && rows.length < 5; i += BUTTONS_PER_ROW) rows.push(row(buttons.slice(i, i + BUTTONS_PER_ROW)));
  return rows;
}

/** An Update skills button: the same skill select /craft update opens, for that character. */
export async function updateButton(c: Ctx, customId: string): Promise<MessageReply> {
  const target = await componentCharacter(c, customId, BUTTON_PREFIX);
  if ('reply' in target) return target.reply;
  return updatePicker(c, target.character);
}

/** The character a select or modal acts on, re-checked: still live, and the caller's (or the caller is an officer). */
async function componentCharacter(c: Ctx, customId: string, prefix: string): Promise<{ character: Character } | { reply: MessageReply }> {
  const id = Number(customId.slice(prefix.length).split(':')[0]);
  const ch = Number.isInteger(id) ? await findById(c.db, c.guild.id, id) : null;
  if (!ch || (ch.owner_user_id !== c.userId && !c.officer)) return { reply: ephemeral('That character is no longer available. Run `/craft update` again.') };  return { character: ch };
}

/**
 * The select's answer: a modal with one level box per chosen skill, pre-filled with the current level.
 * A modal cannot follow a deferral, so this answers inside Discord's 3 seconds: 3 D1 round trips (the
 * guild row, the character, then tradeskills and levels in one batch).
 */
export async function updateSelected(c: Ctx, customId: string, values: string[]): Promise<InteractionReply> {
  const target = await componentCharacter(c, customId, SELECT_PREFIX);
  if ('reply' in target) return target.reply;
  const ch = target.character;
  const ids = [...new Set(values.map(Number))].filter(Number.isInteger).slice(0, MAX_PICK);
  const [allRes, levelRes] = await c.db.batch([allTradeskillsStmt(c.db), levelsStmt(c.db, ch.id)]);
  const chosen = (allRes.results as Tradeskill[]).filter((s) => ids.includes(s.id));
  if (!chosen.length) return ephemeral('Those tradeskills are no longer in the list. Run `/craft update` again.');
  const levels = levelMap(levelRes.results as { tradeskill_id: number; level: number }[]);
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${MODAL_PREFIX}${ch.id}`,
      title: truncate(`Levels for ${ch.name}`, LABEL_MAX),
      components: chosen.map((s) => ({
        type: MessageComponentTypes.LABEL,
        label: truncate(s.name, LABEL_MAX),
        description: `0 to ${c.guild.skill_cap}`,
        component: {
          type: MessageComponentTypes.INPUT_TEXT,
          custom_id: `${INPUT_PREFIX}${s.id}`,
          style: 1,
          min_length: 1,
          max_length: LEVEL_INPUT_MAX,
          required: true,
          ...(levels.has(s.id) ? { value: String(levels.get(s.id)) } : {}),
        },
      })),
    },
  };
}

/** Text inputs from a modal submit: Label components, or legacy action rows. */
export function modalInputs(components: ModalComponent[] | undefined): { custom_id: string; value: string }[] {
  const out: { custom_id: string; value: string }[] = [];
  const visit = (c: ModalComponent) => {
    if (c.type === MessageComponentTypes.INPUT_TEXT && c.custom_id) out.push({ custom_id: c.custom_id, value: c.value ?? '' });
    if (c.component) visit(c.component);
    for (const x of c.components ?? []) visit(x);
  };
  for (const c of components ?? []) visit(c);
  return out;
}

/** The modal's answer: every box is validated first; one invalid box writes nothing. */
export async function updateSubmitted(c: Ctx, customId: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const target = await componentCharacter(c, customId, MODAL_PREFIX);
  if ('reply' in target) return target.reply;
  const ch = target.character;
  const byId = new Map((await allTradeskills(c.db)).map((s) => [s.id, s]));
  const entries = modalInputs(components)
    .filter((x) => x.custom_id.startsWith(INPUT_PREFIX))
    .map((x) => ({ skill: byId.get(Number(x.custom_id.slice(INPUT_PREFIX.length))), raw: x.value.trim() }));
  if (!entries.length || entries.some((e) => !e.skill)) return ephemeral('That form is out of date. Run `/craft update` again.');

  const bad = entries.filter((e) => !/^\d{1,3}$/.test(e.raw) || Number(e.raw) > c.guild.skill_cap);
  if (bad.length)
    return ephemeral(
      `Nothing was saved. ${bad.map((e) => `**${e.skill!.name}**: "${md(e.raw)}" is not a whole number from 0 to ${c.guild.skill_cap}.`).join(' ')}\nRun \`/craft update\` again to retry.`,
    );

  const levels = await levelsOf(c.db, ch.id);
  const before: Record<string, number | null> = {};
  const after: Record<string, number> = {};
  for (const e of entries) {
    before[e.skill!.name] = levels.get(e.skill!.id) ?? null;
    after[e.skill!.name] = Number(e.raw);
  }
  await c.db.batch([
    ...entries.map((e) => upsertSkill(c, ch.id, e.skill!.id, Number(e.raw))),
    audit(c.db, c.guild.id, c.userId, 'skill.update', `character:${ch.id}`, before, after),
  ]);
  const list = entries.map((e) => `${e.skill!.name} **${e.raw.replace(/^0+(?=\d)/, '')}**${before[e.skill!.name] !== null ? ` (was ${before[e.skill!.name]})` : ''}`);
  return ephemeral(`Saved for **${md(ch.name)}**: ${list.join(', ')}.`);
}

// ---------------------------------------------------------------- /craft me

const EMBED_MAX = 10;
const DAY_MS = 86_400_000;

export async function craftMe(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const name = optString(opts, 'character');
  let chars: Character[];
  if (name !== undefined) {
    const target = await resolveCharacter(c, c.userId, name);
    if ('reply' in target) return target.reply;
    chars = [target.character];
  } else {
    chars = await liveCharacters(c.db, c.guild.id, c.userId);
    if (!chars.length) return ephemeral(noCharacters(c, c.userId));
  }
  const shown = chars.slice(0, EMBED_MAX);
  const { results } = await c.db
    .prepare(
      `SELECT s.character_id, t.name, s.level, s.updated_at FROM character_skill s JOIN tradeskill t ON t.id = s.tradeskill_id
       WHERE s.character_id IN (${shown.map(() => '?').join(', ')}) ORDER BY t.name COLLATE NOCASE`,
    )
    .bind(...shown.map((ch) => ch.id))
    .all<{ character_id: number; name: string; level: number; updated_at: string }>();
  const staleBefore = Date.now() - c.guild.stale_days * DAY_MS;
  let anyStale = false;
  const embeds: Embed[] = shown.map((ch) => {
    const head = [ch.class ? md(ch.class) : null, ch.level !== null ? `level ${ch.level}` : null].filter(Boolean).join(' · ');
    const lines = results
      .filter((r) => r.character_id === ch.id)
      .map((r) => {
        const t = Date.parse(r.updated_at);
        const stale = t < staleBefore;
        anyStale ||= stale;
        return `**${r.name}** ${r.level} · <t:${Math.floor(t / 1000)}:d>${stale ? ' · *stale*' : ''}`;
      });
    return {
      title: truncate(`${ch.name}${ch.is_main ? ' (main)' : ''}`, 256),
      description: [head, lines.length ? lines.join('\n') : 'No skills yet: `/craft set` or `/craft update`.'].filter(Boolean).join('\n'),
    };
  });
  const notes = [
    chars.length > EMBED_MAX ? `Showing ${EMBED_MAX} of ${chars.length} characters.` : null,
    anyStale ? `-# *stale* = not updated in ${c.guild.stale_days} days.` : null,
  ].filter(Boolean);
  return ephemeral(notes.join('\n'), { embeds, components: updateButtons(shown) });
}

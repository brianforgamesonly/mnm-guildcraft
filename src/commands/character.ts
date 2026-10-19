// /character add | edit | remove (PRD FR-1), plus how a character name resolves for every command.
// Privacy (ORDER-RULES, order 2): a name resolves only among the caller's own characters unless an
// officer passes member:@user, so another member's character answers exactly like a missing one.
import { audit, auditNewCharacter, now } from '../access.ts';
import type { Ctx } from '../context.ts';
import { ephemeral, md, optBool, optInt, optString, type InteractionReply, type Option } from '../discord.ts';

export const NAME_MAX = 32;
/** Guards against typos only: the game's level cap is unverified. */
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 100;

export interface Character {
  id: number;
  guild_id: string;
  owner_user_id: string;
  name: string;
  name_key: string;
  class: string | null;
  level: number | null;
  is_main: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = 'id, guild_id, owner_user_id, name, name_key, class, level, is_main, deleted_at, created_at, updated_at';

export const nameKey = (name: string): string => name.toLowerCase();

const snapshot = (ch: Pick<Character, 'name' | 'class' | 'level' | 'is_main' | 'deleted_at'>) => ({
  name: ch.name, class: ch.class, level: ch.level, is_main: ch.is_main, deleted_at: ch.deleted_at,
});

export const OFFICERS_ONLY = "Only officers can change another member's characters.";
export const TAKEN = (name: string) => `**${md(name)}** is already taken in this guild. Character names are unique, whatever their capitals.`;

export function notFound(c: Ctx, ownerId: string, name: string): string {
  return ownerId === c.userId ? `You have no character named **${md(name)}**.` : `<@${ownerId}> has no character named **${md(name)}**.`;
}

export function noCharacters(c: Ctx, ownerId: string): string {
  return ownerId === c.userId ? 'You have no characters yet. Add one with `/character add`.' : `<@${ownerId}> has no characters yet.`;
}

function removedByOther(c: Ctx, name: string, owner: string): string {
  const base = `**${md(name)}** belongs to a removed character, so it can't be reused yet. An officer can rename the removed character to free the name.`;
  return c.officer ? `${base} It belongs to <@${owner}>: use \`/character edit\` with \`member:\` set to them and a \`new_name\`.` : base;
}

/** Whose characters a command acts on: the caller's, or (officers only) member:@user's. */
export function resolveOwner(c: Ctx, opts: Option[]): { ownerId: string } | { reply: InteractionReply } {
  const target = optString(opts, 'member');
  if (!target || target === c.userId) return { ownerId: c.userId };
  if (!c.officer) return { reply: ephemeral(OFFICERS_ONLY) };
  return { ownerId: target };
}

export function findByName(db: D1Database, guildId: string, ownerId: string, name: string, includeRemoved = false): Promise<Character | null> {
  return db
    .prepare(`SELECT ${COLS} FROM character WHERE guild_id = ? AND owner_user_id = ? AND name_key = ?${includeRemoved ? '' : ' AND deleted_at IS NULL'}`)
    .bind(guildId, ownerId, nameKey(name.trim()))
    .first<Character>();
}

export function findById(db: D1Database, guildId: string, id: number): Promise<Character | null> {
  return db.prepare(`SELECT ${COLS} FROM character WHERE guild_id = ? AND id = ? AND deleted_at IS NULL`).bind(guildId, id).first<Character>();
}

export async function liveCharacters(db: D1Database, guildId: string, ownerId: string): Promise<Character[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM character WHERE guild_id = ? AND owner_user_id = ? AND deleted_at IS NULL ORDER BY is_main DESC, created_at, id`)
    .bind(guildId, ownerId)
    .all<Character>();
  return results;
}

/** The named character, or the owner's main when no name is given (PRD FR-1). */
export async function resolveCharacter(c: Ctx, ownerId: string, name: string | undefined): Promise<{ character: Character } | { reply: InteractionReply }> {
  if (name !== undefined) {
    const ch = await findByName(c.db, c.guild.id, ownerId, name);
    return ch ? { character: ch } : { reply: ephemeral(notFound(c, ownerId, name)) };
  }
  const [main] = await liveCharacters(c.db, c.guild.id, ownerId);
  return main ? { character: main } : { reply: ephemeral(noCharacters(c, ownerId)) };
}

function cleanName(raw: string | undefined): { name: string } | { error: string } {
  const name = (raw ?? '').trim();
  if (!name) return { error: "A character name can't be empty." };
  if (name.length > NAME_MAX) return { error: `A character name can be at most ${NAME_MAX} characters.` };
  if (/[\u0000-\u001f]/.test(name)) return { error: "A character name can't contain line breaks or control characters." };
  return { name };
}

/** A class from the derived list (stored as its code), or as typed with a note: in Early Access the list is not authoritative. */
async function cleanClass(db: D1Database, raw: string | undefined): Promise<{ value?: string; note?: string }> {
  const typed = raw?.trim();
  if (!typed) return {};
  const row = await db.prepare('SELECT code FROM game_class WHERE code = ? AND item_count > 0').bind(typed.toUpperCase()).first<{ code: string }>();
  if (row) return { value: row.code };
  return { value: typed, note: `Class **${md(typed)}** isn't in the class list taken from the wiki data, so it's saved as typed. (The game is in Early Access; the list may be incomplete.)` };
}

function checkLevel(level: number | undefined): string | null {
  if (level === undefined) return null;
  return Number.isInteger(level) && level >= LEVEL_MIN && level <= LEVEL_MAX ? null : `Level must be a whole number from ${LEVEL_MIN} to ${LEVEL_MAX}.`;
}

/** Text placed inside a `code span`, where markdown escapes would show literally. */
const inCode = (s: string) => s.replaceAll('`', "'");

const isUniqueViolation =(e: unknown) => e instanceof Error && /UNIQUE constraint failed/i.test(e.message);

function describe(ch: { name: string; class: string | null; level: number | null }): string {
  const bits = [ch.class, ch.level !== null ? `level ${ch.level}` : null].filter(Boolean);
  return `**${md(ch.name)}**${bits.length ? ` (${bits.map((b) => md(String(b))).join(', ')})` : ''}`;
}

const byKey = (db: D1Database, guildId: string, key: string) =>
  db.prepare(`SELECT ${COLS} FROM character WHERE guild_id = ? AND name_key = ?`).bind(guildId, key).first<Character>();

const clearMain = (db: D1Database, guildId: string, ownerId: string, at: string, exceptId = -1) =>
  db
    .prepare('UPDATE character SET is_main = 0, updated_at = ? WHERE guild_id = ? AND owner_user_id = ? AND is_main = 1 AND id <> ?')
    .bind(at, guildId, ownerId, exceptId);

// ---------------------------------------------------------------- /character add

export async function characterAdd(c: Ctx, opts: Option[]): Promise<InteractionReply> {
  const n = cleanName(optString(opts, 'name'));
  if ('error' in n) return ephemeral(n.error);
  const level = optInt(opts, 'level');
  const levelError = checkLevel(level);
  if (levelError) return ephemeral(levelError);
  const cls = await cleanClass(c.db, optString(opts, 'class'));
  const wantMain = optBool(opts, 'main') === true;
  const key = nameKey(n.name);

  const existing = await byKey(c.db, c.guild.id, key);
  if (existing && !existing.deleted_at) return ephemeral(TAKEN(n.name));
  if (existing && existing.owner_user_id !== c.userId) return ephemeral(removedByOther(c, existing.name, existing.owner_user_id));

  const live = await liveCharacters(c.db, c.guild.id, c.userId);
  const isMain = live.length === 0 || wantMain;
  const at = now();
  const notes = cls.note ? `\n${cls.note}` : '';
  const mainLine = isMain ? (live.length === 0 ? ' It is your main (your first character).' : ' It is now your main.') : '';

  if (existing) {
    // The caller's own removed character: add restores it, with its skills.
    const after = { ...existing, class: cls.value ?? existing.class, level: level ?? existing.level, is_main: isMain ? 1 : 0, deleted_at: null };
    const stmts = [
      ...(isMain ? [clearMain(c.db, c.guild.id, c.userId, at, existing.id)] : []),
      c.db
        .prepare('UPDATE character SET deleted_at = NULL, class = ?, level = ?, is_main = ?, updated_at = ? WHERE id = ?')
        .bind(after.class, after.level, after.is_main, at, existing.id),
      audit(c.db, c.guild.id, c.userId, 'character.restore', `character:${existing.id}`, snapshot(existing), snapshot(after)),
    ];
    await c.db.batch(stmts);
    const skills = await c.db.prepare('SELECT count(*) AS n FROM character_skill WHERE character_id = ?').bind(existing.id).first<{ n: number }>();
    const n2 = skills?.n ?? 0;
    return ephemeral(`Restored ${describe(after)}, which you removed earlier, with its ${n2} saved skill${n2 === 1 ? '' : 's'}.${isMain ? ' It is your main.' : ''}${notes}`);
  }

  const row = { name: n.name, class: cls.value ?? null, level: level ?? null, is_main: isMain ? 1 : 0, deleted_at: null };
  try {
    await c.db.batch([
      ...(isMain ? [clearMain(c.db, c.guild.id, c.userId, at)] : []),
      c.db
        .prepare(
          'INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(c.guild.id, c.userId, row.name, key, row.class, row.level, row.is_main, at, at),
      auditNewCharacter(c.db, c.guild.id, c.userId, 'character.add', key, row),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return ephemeral(TAKEN(n.name));
    throw e;
  }
  return ephemeral(`Added ${describe(row)}.${mainLine}${notes}`);
}

// ---------------------------------------------------------------- /character edit

export async function characterEdit(c: Ctx, opts: Option[]): Promise<InteractionReply> {
  const owner = resolveOwner(c, opts);
  if ('reply' in owner) return owner.reply;
  const name = optString(opts, 'name') ?? '';
  // An officer naming a member may also reach that member's removed characters (to free a name).
  const officerPath = owner.ownerId !== c.userId;
  const ch = await findByName(c.db, c.guild.id, owner.ownerId, name, officerPath);
  if (!ch) return ephemeral(notFound(c, owner.ownerId, name));

  const rawNew = optString(opts, 'new_name');
  const rawClass = optString(opts, 'class');
  const level = optInt(opts, 'level');
  const main = optBool(opts, 'main');
  if (rawNew === undefined && rawClass === undefined && level === undefined && main === undefined)
    return ephemeral('Nothing to change: give a `new_name`, `class`, `level` or `main`.');

  const after = { ...ch };
  const notes: string[] = [];
  if (rawNew !== undefined) {
    const n = cleanName(rawNew);
    if ('error' in n) return ephemeral(n.error);
    const key = nameKey(n.name);
    if (key !== ch.name_key) {
      const clash = await byKey(c.db, c.guild.id, key);
      if (clash && !clash.deleted_at) return ephemeral(TAKEN(n.name));
      if (clash && clash.owner_user_id === ch.owner_user_id)
        return ephemeral(`There is a removed character named **${md(clash.name)}** on this account. \`/character add name:${inCode(clash.name)}\` restores it; or pick another name.`);
      if (clash) return ephemeral(removedByOther(c, clash.name, clash.owner_user_id));
    }
    after.name = n.name;
    after.name_key = key;
  }
  if (rawClass !== undefined) {
    const cls = await cleanClass(c.db, rawClass);
    after.class = cls.value ?? null;
    if (cls.note) notes.push(cls.note);
  }
  if (level !== undefined) {
    const levelError = checkLevel(level);
    if (levelError) return ephemeral(levelError);
    after.level = level;
  }
  if (main !== undefined) {
    if (ch.deleted_at) return ephemeral(`**${md(ch.name)}** is removed; it can't be made a main until it is restored.`);
    if (!main && ch.is_main) return ephemeral(`**${md(ch.name)}** is the main. To change that, set \`main\` on another character.`);
    after.is_main = main ? 1 : 0;
  }

  const at = now();
  try {
    await c.db.batch([
      ...(after.is_main && !ch.is_main ? [clearMain(c.db, c.guild.id, ch.owner_user_id, at, ch.id)] : []),
      c.db
        .prepare('UPDATE character SET name = ?, name_key = ?, class = ?, level = ?, is_main = ?, updated_at = ? WHERE id = ?')
        .bind(after.name, after.name_key, after.class, after.level, after.is_main, at, ch.id),
      audit(c.db, c.guild.id, c.userId, 'character.edit', `character:${ch.id}`, snapshot(ch), snapshot(after)),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) return ephemeral(TAKEN(after.name));
    throw e;
  }
  const renamed = after.name !== ch.name ? ` (was **${md(ch.name)}**)` : '';
  const mainLine = after.is_main && !ch.is_main ? ' It is now the main.' : '';
  return ephemeral([`Updated ${describe(after)}${renamed}.${mainLine}`, ...notes].join('\n'));
}

// ---------------------------------------------------------------- /character remove

export async function characterRemove(c: Ctx, opts: Option[]): Promise<InteractionReply> {
  const owner = resolveOwner(c, opts);
  if ('reply' in owner) return owner.reply;
  const name = optString(opts, 'name') ?? '';
  const ch = await findByName(c.db, c.guild.id, owner.ownerId, name);
  if (!ch) return ephemeral(notFound(c, owner.ownerId, name));

  const at = now();
  // If the main goes, the oldest remaining character becomes main.
  const next = ch.is_main ? (await liveCharacters(c.db, c.guild.id, owner.ownerId)).filter((x) => x.id !== ch.id).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id)[0] : undefined;
  await c.db.batch([
    c.db.prepare('UPDATE character SET deleted_at = ?, is_main = 0, updated_at = ? WHERE id = ?').bind(at, at, ch.id),
    ...(next ? [c.db.prepare('UPDATE character SET is_main = 1, updated_at = ? WHERE id = ?').bind(at, next.id)] : []),
    audit(c.db, c.guild.id, c.userId, 'character.remove', `character:${ch.id}`, snapshot(ch), snapshot({ ...ch, is_main: 0, deleted_at: at })),
  ]);
  const lines = [`Removed **${md(ch.name)}**. Its skills are kept: \`/character add name:${inCode(ch.name)}\` restores it.`];
  if (next) lines.push(`**${md(next.name)}** is now the main.`);
  return ephemeral(lines.join('\n'));
}

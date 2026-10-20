// Guild row, member row and access (PRD FR-8 roles, FR-9 first use).
// One place decides who may do what (ORDER-RULES Data: "one decision has one decider").
import { ADMINISTRATOR, hasPermission, MANAGE_GUILD, type GuildMember } from './discord.ts';

export interface Guild {
  id: string;
  name: string;
  member_role_id: string | null;
  officer_role_id: string | null;
  skill_cap: number;
  stale_days: number;
  /** /craft find "Still learning": this many points below the trivial (migration 0004). */
  learning_window: number;
  /** The roster board's forum channel (PRD FR-5), set by /guildcraft setup board:. */
  board_channel_id: string | null;
  /** Where departure notices go (order 7, PRD FR-8), set by /guildcraft setup review:. */
  review_channel_id: string | null;
  /** Where screenshots wait for approval (order 9, PRD FR-6), set by /guildcraft setup vault:. */
  vault_channel_id: string | null;
}

const GUILD_COLUMNS = 'id, name, member_role_id, officer_role_id, skill_cap, stale_days, learning_window, board_channel_id, review_channel_id, vault_channel_id';

/** Budget for the guild-name lookup, well inside Discord's 3-second first-reply window. */
export const GUILD_NAME_TIMEOUT_MS = 1500;

export const now = () => new Date().toISOString();

export function loadGuild(db: D1Database, guildId: string): Promise<Guild | null> {
  return db.prepare(`SELECT ${GUILD_COLUMNS} FROM guild WHERE id = ?`).bind(guildId).first<Guild>();
}

/** The server's name from one bot-token GET /guilds/{id}; null on any failure or timeout. */
export async function fetchGuildName(botToken: string | undefined, guildId: string): Promise<string | null> {
  if (!botToken) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { Authorization: `Bot ${botToken}`, 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
      signal: AbortSignal.timeout(GUILD_NAME_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: unknown };
    return typeof body.name === 'string' && body.name.trim() ? body.name : null;
  } catch {
    return null;
  }
}

/**
 * Loads the guild row, creating it with the defaults (no role gate, skill_cap 300, stale_days 60) on
 * the first command from a server. guild.name comes from the guild lookup; if that fails, the id is
 * stored as the name and the name is refreshed after a later command's reply (ctx.waitUntil).
 */
export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

export async function ensureGuild(db: D1Database, botToken: string | undefined, guildId: string, ctx: WaitUntil): Promise<Guild> {
  const found = await loadGuild(db, guildId);
  if (found) {
    if (found.name === found.id) ctx.waitUntil(refreshGuildName(db, botToken, guildId));
    return found;
  }
  const name = (await fetchGuildName(botToken, guildId)) ?? guildId;
  await db.prepare('INSERT INTO guild (id, name, created_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(guildId, name, now()).run();
  return (await loadGuild(db, guildId))!;
}

async function refreshGuildName(db: D1Database, botToken: string | undefined, guildId: string): Promise<void> {
  const name = await fetchGuildName(botToken, guildId);
  if (name) await db.prepare('UPDATE guild SET name = ? WHERE id = ? AND name = id').bind(name, guildId).run();
}

export const isAdmin = (m: GuildMember): boolean =>
  hasPermission(m.permissions, ADMINISTRATOR) || hasPermission(m.permissions, MANAGE_GUILD);

/** Officer rights: the guild's officer role, or Administrator, or Manage Server. */
export const isOfficer = (guild: Guild | null, m: GuildMember): boolean =>
  isAdmin(m) || (!!guild?.officer_role_id && m.roles.includes(guild.officer_role_id));

/** Member commands: the guild's member role when one is set, otherwise anyone in the server. */
export const passesMemberGate = (guild: Guild | null, m: GuildMember): boolean =>
  !guild?.member_role_id || m.roles.includes(guild.member_role_id);

/**
 * The same two decisions as passesMemberGate and isOfficer, as SQL, for an autocomplete that must answer
 * in one statement (order 3, ITEM 3.2). Parameters (bind with sqlAccessParams): ?1 guild id, ?2 JSON
 * array of the caller's role ids, ?3 1 when isAdmin. A missing guild row passes the gate, as
 * passesMemberGate(null) does. test/worker/access-sql.test.ts checks both forms agree over every combination.
 */
export const SQL_PASSES_MEMBER_GATE =
  'NOT EXISTS (SELECT 1 FROM guild g WHERE g.id = ?1 AND g.member_role_id IS NOT NULL AND g.member_role_id NOT IN (SELECT value FROM json_each(?2)))';
export const SQL_IS_OFFICER =
  '(?3 = 1 OR EXISTS (SELECT 1 FROM guild g WHERE g.id = ?1 AND g.officer_role_id IS NOT NULL AND g.officer_role_id IN (SELECT value FROM json_each(?2))))';
export const sqlAccessParams = (guildId: string, m: GuildMember): [string, string, number] => [guildId, JSON.stringify(m.roles ?? []), isAdmin(m) ? 1 : 0];

export const displayName = (m: GuildMember): string => m.nick || m.user.global_name || m.user.username;

/**
 * Creates the member row, or refreshes its display name (PRD FR-8 "created or refreshed").
 * Called for application commands only. Returns isNew = the row did not exist before this call,
 * which is what decides the one-time welcome.
 */
export async function touchMember(db: D1Database, guildId: string, m: GuildMember): Promise<{ isNew: boolean }> {
  const name = displayName(m);
  const [insert] = await db.batch([
    db.prepare(
      "INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?) ON CONFLICT DO NOTHING",
    ).bind(guildId, m.user.id, name, now()),
    // The board shows display names (order 5): a changed name marks the member's posts dirty for the
    // 15-minute sweep. Runs before the UPDATE below, while the stored name is still the old one.
    db.prepare(
      `UPDATE board_post SET dirty = 1 WHERE guild_id = ?1 AND tradeskill_id IN (SELECT cs.tradeskill_id FROM character_skill cs JOIN character c ON c.id = cs.character_id
         WHERE c.guild_id = ?1 AND c.owner_user_id = ?2 AND c.deleted_at IS NULL)
       AND EXISTS (SELECT 1 FROM member WHERE guild_id = ?1 AND discord_user_id = ?2 AND (display_name IS NOT ?3 OR status <> 'active'))`,
    ).bind(guildId, m.user.id, name),
    db.prepare(
      "UPDATE member SET display_name = ?, status = 'active' WHERE guild_id = ? AND discord_user_id = ? AND (display_name IS NOT ? OR status <> 'active')",
    ).bind(name, guildId, m.user.id, name),
  ]);
  return { isNew: insert.meta.changes === 1 };
}

export function audit(db: D1Database, guildId: string, actor: string, action: string, target: string, before: unknown, after: unknown): D1PreparedStatement {
  return db
    .prepare('INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(guildId, actor, action, target, JSON.stringify({ before, after }), now());
}

/** As audit(), for a character inserted earlier in the same batch: the target id is read by name_key. */
export function auditNewCharacter(db: D1Database, guildId: string, actor: string, action: string, nameKey: string, after: unknown): D1PreparedStatement {
  return db
    .prepare(
      "INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) VALUES (?, ?, ?, 'character:' || (SELECT id FROM character WHERE guild_id = ? AND name_key = ?), ?, ?)",
    )
    .bind(guildId, actor, action, guildId, nameKey, JSON.stringify({ before: null, after }), now());
}

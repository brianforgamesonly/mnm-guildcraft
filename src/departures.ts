// Members who left the server (order 7, ITEM 3; PRD FR-8): the nightly departure run, its review-channel notices,
// and the removal that /guildcraft remove-member and the notice's Remove button share.
//
// The run (src/board/refresh.ts scheduled, in the 15-minute trigger falling at 08:15–08:29 UTC):
//   1. reads the guild's active members from D1;
//   2. lists the server's members, GET /guilds/{id}/members?limit=1000, paged with `after` (needs the Server Members
//      privileged intent);
//   3. marks member.status = 'left' only on a complete list (every page answered, the last one shorter than the limit)
//      and only under the ceiling (MAX_MARK, MAX_MARK_SHARE); nothing is ever deleted;
//   4. posts one notice per newly departed member in the review channel (at most MAX_NOTICES a night; the rest wait).
// State lives in audit_log rows, never in new columns (ORDER-RULES: no column for a value a table already holds):
//   member.left      (system) the run marked the member; the notice is pending until one of the three below follows it
//   member.notified  (system) the notice was posted
//   member.keep      an officer pressed Keep: no further notice until the member returns and leaves again
//   member.removed   an officer removed the member's characters (remove-member, or the notice's Remove)
//   departures.run   (system) one per guild per run: what it listed, marked and posted, or why it stopped
// A member marked 'left' becomes 'active' again on their own next command (touchMember, src/access.ts). The run
// itself never reactivates anyone, so a member an officer removed stays 'left' while they are still in the server.
import { now } from './access.ts';
import { budgetLeft, type BotApi } from './board/api.ts';
import type { Ctx } from './context.ts';
import { button, md, row, STYLE_DANGER, STYLE_SECONDARY, truncate, type Embed } from './discord.ts';

/** Discord's largest page for List Guild Members (the default is 1). */
export const MEMBER_PAGE = 1000;
/** The ceiling: a run that would mark more than this many members, … */
export const MAX_MARK = 25;
/** … or more than this share of the active members (once 3 or more would be marked), marks nobody. */
export const MAX_MARK_SHARE = 0.3;
const SHARE_FLOOR = 3;
/** Notices posted per guild per run; the rest carry to the next night. */
export const MAX_NOTICES = 10;
/** The run's UTC slot: the 15-minute trigger at 08:15 (after the 07:30 import and the 08:00 board run). */
export const DEPARTURE_HOUR_UTC = 8;
export const DEPARTURE_MINUTE_UTC = 15;
export const isDepartureRun = (scheduledTime: number) => {
  const d = new Date(scheduledTime);
  return d.getUTCHours() === DEPARTURE_HOUR_UTC && d.getUTCMinutes() >= DEPARTURE_MINUTE_UTC && d.getUTCMinutes() < DEPARTURE_MINUTE_UTC + 15;
};

/** Notice buttons: dep:keep:<user id> and dep:remove:<user id>. */
export const NOTICE_PREFIX = 'dep:';
/** remove-member preview buttons: rm:yes:<user id> and rm:no:<user id>. */
export const REMOVE_PREFIX = 'rm:';
/** The Developer Portal step when the member list is refused. */
export const INTENT_STEP =
  'Discord Developer Portal → Applications → MNM-Guildcraft → Bot → Privileged Gateway Intents → turn on Server Members Intent → Save Changes';

export interface CharacterBrief {
  id: number;
  name: string;
  class: string | null;
  level: number | null;
}

export interface DepartureResult {
  guild: string;
  dry_run: boolean;
  active: number;
  listed: number | null;
  pages: number;
  would_mark: string[];
  marked: number;
  notices_pending: number;
  notices_posted: number;
  /** Why the run marked nobody, or stopped posting. */
  stopped: string | null;
  errors: string[];
}

// ---------------------------------------------------------------- the server's member list

type ListOutcome = { ok: true; ids: Set<string>; pages: number } | { ok: false; pages: number; why: string };

/** Every member id, or why the list is not complete. Never partial: a failed or skipped page fails the list. */
export async function listMemberIds(api: BotApi, guildId: string): Promise<ListOutcome> {
  const ids = new Set<string>();
  let after = '0';
  for (let pages = 1; ; pages++) {
    const r = await api.call<{ user?: { id?: string } }[]>('GET', `/guilds/${guildId}/members?limit=${MEMBER_PAGE}&after=${after}`);
    if (!r.ok) {
      const why = r.skipped
        ? `member list page ${pages} not read (${r.skipped})`
        : `member list refused: HTTP ${r.status}${r.code ? ` code ${r.code}` : ''}${r.status === 403 || r.code === 50001 ? ` — check the Server Members Intent (${INTENT_STEP})` : ''}`;
      return { ok: false, pages, why };
    }
    if (!Array.isArray(r.body)) return { ok: false, pages, why: `member list page ${pages}: not a list` };
    for (const m of r.body) if (m.user?.id) ids.add(m.user.id);
    if (r.body.length < MEMBER_PAGE) return { ok: true, ids, pages };
    const last = r.body.at(-1)?.user?.id;
    if (!last || last === after) return { ok: false, pages, why: `member list page ${pages}: cursor did not advance` };
    after = last;
  }
}

/** Whether marking `n` of `active` members is past the ceiling. */
export const pastCeiling = (n: number, active: number) => n > MAX_MARK || (n >= SHARE_FLOOR && n > active * MAX_MARK_SHARE);

// ---------------------------------------------------------------- D1 statements

const charactersJson = `(SELECT json_group_array(json_object('id', c.id, 'name', c.name, 'class', c.class, 'level', c.level))
  FROM character c WHERE c.guild_id = m.guild_id AND c.owner_user_id = m.discord_user_id AND c.deleted_at IS NULL)`;

/** Left members whose latest member.left row has no notice, Keep or removal after it: the notices still owed. */
// A plain SELECT (no WITH), so the workflow's read-only guard (scripts/board/run.mjs) accepts it in a dry run.
const PENDING_SQL = `SELECT m.discord_user_id AS id, m.display_name AS name, ${charactersJson} AS characters
  FROM member m JOIN (SELECT target, max(id) AS id FROM audit_log WHERE guild_id = ?1 AND action = 'member.left' GROUP BY target) l
    ON l.target = 'member:' || m.discord_user_id
  WHERE m.guild_id = ?1 AND m.status = 'left'
    AND NOT EXISTS (SELECT 1 FROM audit_log b WHERE b.guild_id = ?1 AND b.target = l.target AND b.id > l.id AND b.action IN ('member.notified', 'member.keep', 'member.removed'))
  ORDER BY l.id`;

const parseCharacters = (json: string | null): CharacterBrief[] => {
  try {
    const v = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.name === 'string') : [];
  } catch {
    return [];
  }
};

const auditRow = (db: D1Database, guildId: string, actor: string, action: string, target: string, detail: unknown, at: string) =>
  db.prepare('INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(guildId, actor, action, target, JSON.stringify(detail), at);

/** The posts that list these members' live characters need rewriting (run before the change that hides them). */
const dirtyFor = (db: D1Database, guildId: string, ownerIds: string[]) =>
  db
    .prepare(
      `UPDATE board_post SET dirty = 1 WHERE guild_id = ?1 AND tradeskill_id IN (SELECT cs.tradeskill_id FROM character_skill cs JOIN character c ON c.id = cs.character_id
         WHERE c.guild_id = ?1 AND c.deleted_at IS NULL AND c.owner_user_id IN (SELECT value FROM json_each(?2)))`,
    )
    .bind(guildId, JSON.stringify(ownerIds));

// ---------------------------------------------------------------- the notice

export const describeCharacter = (ch: CharacterBrief) => {
  const bits = [ch.class, ch.level !== null && ch.level !== undefined ? `level ${ch.level}` : null].filter(Boolean);
  return `**${md(ch.name)}**${bits.length ? ` (${bits.map((b) => md(String(b))).join(', ')})` : ''}`;
};

/** The review-channel notice for one departed member (DRAFT copy, docs/COPY.md: approved before launch). */
export function noticeMessage(userId: string, name: string | null, characters: CharacterBrief[]) {
  name = name?.trim() || 'A member';
  const list = characters.length ? characters.map(describeCharacter).join('\n') : 'No characters registered.';
  const embed: Embed = {
    title: truncate(`${name} left the server`, 256),
    description: truncate(
      [
        `**Characters**\n${list}`,
        '',
        'While they are away their characters are hidden from `/craft find`, `/roster` and the roster board. If they come back and use GuildCraft, they show again.',
        '**Remove** removes the characters (their skills are kept; `/character add` with the same name restores one). **Keep** leaves them as they are. Officers only.',
      ].join('\n'),
      4096,
    ),
    color: 0x95a5a6,
  };
  return {
    embeds: [embed],
    components: [row([button(`${NOTICE_PREFIX}remove:${userId}`, 'Remove characters', STYLE_DANGER), button(`${NOTICE_PREFIX}keep:${userId}`, 'Keep', STYLE_SECONDARY)])],
    allowed_mentions: { parse: [] as string[] },
  };
}

// ---------------------------------------------------------------- the nightly run, one guild

export async function departuresForGuild(
  db: D1Database,
  api: BotApi,
  guild: { id: string; review_channel_id: string | null },
  opts: { dryRun?: boolean; nowMs?: number } = {},
): Promise<DepartureResult> {
  const r: DepartureResult = { guild: guild.id, dry_run: !!opts.dryRun, active: 0, listed: null, pages: 0, would_mark: [], marked: 0, notices_pending: 0, notices_posted: 0, stopped: null, errors: [] };
  const at = new Date(opts.nowMs ?? Date.now()).toISOString();
  const record = (extra: D1PreparedStatement[] = []) =>
    opts.dryRun
      ? Promise.resolve()
      : db.batch([...extra, auditRow(db, guild.id, 'system', 'departures.run', `guild:${guild.id}`, { active: r.active, listed: r.listed, pages: r.pages, marked: r.marked, notices_posted: r.notices_posted, stopped: r.stopped }, at)]);

  const everyone = (await db.prepare('SELECT discord_user_id AS id, status FROM member WHERE guild_id = ?').bind(guild.id).all<{ id: string; status: string }>()).results;
  const active = everyone.filter((m) => m.status === 'active');
  r.active = active.length;
  // The list is read whenever someone could be marked or is owed a notice (a member back in the server is owed none).
  let listedNow: Set<string> | null = null;

  if (everyone.length) {
    const list = await listMemberIds(api, guild.id);
    r.pages = list.pages;
    if (!list.ok) {
      r.stopped = list.why;
      r.errors.push(list.why);
    } else {
      listedNow = list.ids;
      r.listed = list.ids.size;
      const gone = active.map((m) => m.id).filter((id) => !list.ids.has(id));
      r.would_mark = gone;
      if (pastCeiling(gone.length, active.length)) r.stopped = `ceiling: ${gone.length} of ${active.length} active members would be marked (limit ${MAX_MARK}, or ${MAX_MARK_SHARE * 100}% once ${SHARE_FLOOR}+); nobody marked`;
      else if (gone.length && !opts.dryRun) {
        const ids = JSON.stringify(gone);
        // The member.left rows go first: if a non-atomic caller (the workflow's HTTP adapter) stops halfway, an
        // orphan row is harmless (pending notices also need status 'left'), a hidden member without one never is.
        const results = await db.batch([
          db
            .prepare("INSERT INTO audit_log (guild_id, actor, action, target, detail_json, created_at) SELECT ?1, 'system', 'member.left', 'member:' || value, '{}', ?3 FROM json_each(?2)")
            .bind(guild.id, ids, at),
          dirtyFor(db, guild.id, gone),
          db.prepare("UPDATE member SET status = 'left' WHERE guild_id = ? AND status = 'active' AND discord_user_id IN (SELECT value FROM json_each(?))").bind(guild.id, ids),
        ]);
        r.marked = results[2].meta.changes ?? gone.length;
      }
    }
  }

  // Notices still owed (this run's and any carried from earlier nights), posted only when a review channel is set.
  // A member back in the server (seen in this run's complete list) is owed no "left the server" notice.
  const pending = (await db.prepare(PENDING_SQL).bind(guild.id).all<{ id: string; name: string | null; characters: string | null }>()).results.filter(
    (p) => !listedNow?.has(p.id),
  );
  // In a dry run the members this run would mark are owed a notice too.
  const marking = r.stopped ? [] : r.would_mark;
  const owed = opts.dryRun ? [...pending.map((p) => p.id), ...marking.filter((id) => !pending.some((p) => p.id === id))] : pending.map((p) => p.id);
  r.notices_pending = owed.length;
  const notified: D1PreparedStatement[] = [];
  if (!guild.review_channel_id) {
    if (owed.length && !r.stopped) r.stopped = 'no review channel set: notices wait until /guildcraft setup review: is set';
  } else if (!opts.dryRun) {
    try {
      await postNotices();
    } finally {
      // Whatever was posted is recorded, even if a later step threw: a posted notice is never posted twice.
      await record(notified);
    }
    return r;
  }
  await record(notified);
  return r;

  async function postNotices() {
    for (const p of pending.slice(0, MAX_NOTICES)) {
      // One call for the post, one for the final D1 write.
      if (budgetLeft(api.budget) < 2 || Date.now() >= api.budget.deadline) {
        r.stopped ??= 'call budget: remaining notices carry to the next run';
        break;
      }
      const sent = await api.call<{ id: string }>('POST', `/channels/${guild.review_channel_id}/messages`, noticeMessage(p.id, p.name, parseCharacters(p.characters)));
      if (!sent.ok) {
        r.errors.push(`notice: HTTP ${sent.status}${sent.code ? ` code ${sent.code}` : ''}`);
        r.stopped ??= 'the review channel refused a notice; the rest wait for the next run';
        break;
      }
      r.notices_posted++;
      notified.push(auditRow(db, guild.id, 'system', 'member.notified', `member:${p.id}`, { message_id: sent.body?.id ?? null }, at));
    }
    if (pending.length > MAX_NOTICES && !r.stopped) r.stopped = `${pending.length - MAX_NOTICES} notice(s) over the nightly ${MAX_NOTICES} carry to the next run`;
  }
}

/** The run over every guild, sharing one call budget; a guild not reached waits for the next night. */
export async function runDepartures(db: D1Database, api: BotApi, opts: { dryRun?: boolean; nowMs?: number } = {}): Promise<DepartureResult[]> {
  const guilds = (await db.prepare('SELECT id, review_channel_id FROM guild ORDER BY id').all<{ id: string; review_channel_id: string | null }>()).results;
  const out: DepartureResult[] = [];
  for (const g of guilds) {
    // The smallest useful run: active members, one list page, the mark batch, the pending read, the record.
    if (budgetLeft(api.budget) < 6) break;
    out.push(await departuresForGuild(db, api, g, opts));
  }
  return out;
}

// ---------------------------------------------------------------- removal (remove-member and the notice's Remove)

export async function membersCharacters(db: D1Database, guildId: string, userId: string): Promise<{ member: { name: string; status: string } | null; characters: CharacterBrief[] }> {
  const [m, chars] = await db.batch([
    db.prepare('SELECT display_name AS name, status FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(guildId, userId),
    db.prepare('SELECT id, name, class, level FROM character WHERE guild_id = ? AND owner_user_id = ? AND deleted_at IS NULL ORDER BY is_main DESC, created_at, id').bind(guildId, userId),
  ]);
  return { member: (m.results[0] as { name: string; status: string } | undefined) ?? null, characters: chars.results as CharacterBrief[] };
}

/**
 * Removes a member: every live character is soft-deleted (deleted_at; skills kept), the member is marked 'left',
 * the posts that listed them are marked dirty, and one member.removed row records it. Nothing is deleted.
 */
export async function removeMember(c: Ctx, userId: string, via: 'command' | 'notice'): Promise<{ name: string; characters: CharacterBrief[] } | null> {
  const { member, characters } = await membersCharacters(c.db, c.guild.id, userId);
  if (!member) return null;
  const at = now();
  await c.db.batch([
    dirtyFor(c.db, c.guild.id, [userId]),
    c.db.prepare('UPDATE character SET deleted_at = ?1, is_main = 0, updated_at = ?1 WHERE guild_id = ?2 AND owner_user_id = ?3 AND deleted_at IS NULL').bind(at, c.guild.id, userId),
    c.db.prepare("UPDATE member SET status = 'left' WHERE guild_id = ? AND discord_user_id = ?").bind(c.guild.id, userId),
    auditRow(c.db, c.guild.id, c.userId, 'member.removed', `member:${userId}`, { via, characters: characters.map((x) => ({ id: x.id, name: x.name })), status_before: member.status }, at),
  ]);
  if (c.guild.board_channel_id) c.effects.board = true;
  return { name: member.name, characters };
}

/** Keep: recorded, so the member is not notified again until they come back and leave again. */
export async function keepMember(c: Ctx, userId: string): Promise<void> {
  await auditRow(c.db, c.guild.id, c.userId, 'member.keep', `member:${userId}`, {}, now()).run();
}

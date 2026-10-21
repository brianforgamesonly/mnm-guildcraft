// /roster skill | member | top (PRD FR-4; /roster recipes is order 5).
// Rosters show guild roster data only: character names, classes, levels and skill levels. Removed
// characters (deleted_at) and departed members (status 'left') never appear.
import type { Ctx } from '../context.ts';
import { button, EMBED_LIMITS, ephemeral, md, memberTag, mention, optInt, optString, plural, publicReply, row, STYLE_SECONDARY, truncate, updateMessage, type Embed, type MessageReply, type Option } from '../discord.ts';
import { postButton, postedReply, searchReply, SEARCH_REPLIES_PRIVATE } from './share.ts';
import { skillGroups, type Tradeskill } from './skills.ts';

export const PAGE_SIZE = 15;
export const PAGE_PREFIX = 'rs:';
export const SWITCH_PREFIX = 'rss:';
/** Action rows left for tradeskill switchers after the buttons row. */
const MAX_SWITCH_ROWS = 4;
const DAY_MS = 86_400_000;

const LIVE = "c.deleted_at IS NULL AND m.status = 'active'";
const JOIN_LIVE = 'JOIN character c ON c.id = cs.character_id JOIN member m ON m.guild_id = c.guild_id AND m.discord_user_id = c.owner_user_id';

const charBits = (cls: string | null, level: number | null) => [cls ? md(cls) : null, level !== null ? `level ${level}` : null].filter(Boolean).join(' ');

// ---------------------------------------------------------------- /roster skill

interface RosterLine {
  name: string;
  owner_user_id: string;
  member: string;
  class: string | null;
  char_level: number | null;
  level: number;
  updated_at: string;
}

interface SkillPage {
  skill: Tradeskill;
  min: number;
  page: number;
  pages: number;
  total: number;
  lines: RosterLine[];
  inUse: Tradeskill[];
}

async function loadSkillPage(c: Ctx, skillId: number, min: number, page: number): Promise<SkillPage | null> {
  const [skill, total, inUse] = await c.db.batch([
    c.db.prepare('SELECT id, name FROM tradeskill WHERE id = ?').bind(skillId),
    c.db.prepare(`SELECT count(*) AS n FROM character_skill cs ${JOIN_LIVE} WHERE cs.tradeskill_id = ? AND c.guild_id = ? AND cs.level >= ? AND ${LIVE}`).bind(skillId, c.guild.id, min),
    c.db
      .prepare(`SELECT DISTINCT t.id, t.name FROM character_skill cs ${JOIN_LIVE} JOIN tradeskill t ON t.id = cs.tradeskill_id WHERE c.guild_id = ? AND ${LIVE} ORDER BY t.name COLLATE NOCASE`)
      .bind(c.guild.id),
  ]);
  const s = (skill.results as Tradeskill[])[0];
  if (!s) return null;
  const n = (total.results as { n: number }[])[0]?.n ?? 0;
  const pages = Math.max(1, Math.ceil(n / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const { results } = await c.db
    .prepare(
      `SELECT c.name, c.owner_user_id, m.display_name AS member, c.class, c.level AS char_level, cs.level, cs.updated_at FROM character_skill cs ${JOIN_LIVE}
       WHERE cs.tradeskill_id = ? AND c.guild_id = ? AND cs.level >= ? AND ${LIVE}
       ORDER BY cs.level DESC, c.name COLLATE NOCASE LIMIT ? OFFSET ?`,
    )
    .bind(skillId, c.guild.id, min, PAGE_SIZE, p * PAGE_SIZE)
    .all<RosterLine>();
  return { skill: s, min, page: p, pages, total: n, lines: results, inUse: inUse.results as Tradeskill[] };
}

function skillEmbed(c: Ctx, d: SkillPage): Embed {
  const staleBefore = Date.now() - c.guild.stale_days * DAY_MS;
  const lines = d.lines.map((l, i) => {
    const bits = charBits(l.class, l.char_level);
    const stale = Date.parse(l.updated_at) < staleBefore ? ' · *stale*' : '';
    return `**${d.page * PAGE_SIZE + i + 1}.** **${md(l.name)}** ${l.level}${bits ? ` · ${bits}` : ''} · ${memberTag(l.owner_user_id, l.member)}${stale}`;
  });
  const minText = d.min > 0 ? ` at ${d.min}+` : '';
  return {
    title: truncate(`${d.skill.name}: ${plural(d.total, 'character')}${minText}`, EMBED_LIMITS.title),
    description: lines.length ? lines.join('\n') : `No one in the guild has recorded ${d.skill.name}${minText} yet.`,
    footer: { text: `Page ${d.page + 1} of ${d.pages}${lines.some((l) => l.includes('*stale*')) ? ` · stale = not updated in ${c.guild.stale_days} days` : ''}` },
  };
}

const pageId = (skillId: number, min: number, page: number) => `${PAGE_PREFIX}${skillId}:${min}:${page}`;

function skillRows(d: SkillPage): unknown[] {
  const nav = row([
    button(pageId(d.skill.id, d.min, d.page - 1), '◀ Previous', STYLE_SECONDARY, d.page === 0),
    button(pageId(d.skill.id, d.min, d.page + 1), 'Next ▶', STYLE_SECONDARY, d.page >= d.pages - 1),
    ...(SEARCH_REPLIES_PRIVATE ? [postButton(`rs:${d.skill.id}:${d.min}:${d.page}`)] : []),
  ]);
  const switchers = skillGroups(d.inUse)
    .slice(0, MAX_SWITCH_ROWS)
    .map((g, i) =>
      row([
        {
          type: 3,
          custom_id: `${SWITCH_PREFIX}${d.min}:${i}`,
          placeholder: `Switch tradeskill${g.label === 'Tradeskills' ? '' : ` (${g.label.replace('Tradeskills ', '')})`}`,
          min_values: 1,
          max_values: 1,
          options: g.skills.map((s) => ({ label: truncate(s.name, 100), value: String(s.id), ...(s.id === d.skill.id ? { default: true } : {}) })),
        },
      ]),
    );
  return [nav, ...switchers];
}

export async function rosterSkill(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = (optString(opts, 'skill') ?? '').trim();
  const skill = await c.db.prepare('SELECT id, name FROM tradeskill WHERE name = ? COLLATE NOCASE').bind(typed).first<Tradeskill>();
  if (!skill) return ephemeral(`I don't know a tradeskill called **${md(typed)}**. Pick one from the list as you type.`);
  const min = optInt(opts, 'min_level') ?? 0;
  if (!Number.isInteger(min) || min < 0 || min > c.guild.skill_cap) return ephemeral(`min_level must be a whole number from 0 to ${c.guild.skill_cap}.`);
  const d = (await loadSkillPage(c, skill.id, min, 0))!;
  // skillRows carries the paging buttons, Post to channel (when private) and the switchers.
  const data = { embeds: [skillEmbed(c, d)], components: skillRows(d) };
  return SEARCH_REPLIES_PRIVATE ? ephemeral('', data) : publicReply(data);
}

/** Previous / Next: a new interaction each time, so Discord's 15-minute follow-up window never applies. */
export async function rosterPage(c: Ctx, customId: string): Promise<MessageReply> {
  const [skillId, min, page] = customId.slice(PAGE_PREFIX.length).split(':').map(Number);
  const d = await loadSkillPage(c, skillId, min, page);
  if (!d) return ephemeral('That tradeskill is no longer in the list. Run `/roster skill` again.');
  return updateMessage({ embeds: [skillEmbed(c, d)], components: skillRows(d) });
}

/** The tradeskill switcher: the chosen skill, page 1, same min_level. */
export async function rosterSwitch(c: Ctx, customId: string, values: string[]): Promise<MessageReply> {
  const min = Number(customId.slice(SWITCH_PREFIX.length).split(':')[0]);
  const d = await loadSkillPage(c, Number(values[0]), Number.isInteger(min) ? min : 0, 0);
  if (!d) return ephemeral('That tradeskill is no longer in the list. Run `/roster skill` again.');
  return updateMessage({ embeds: [skillEmbed(c, d)], components: skillRows(d) });
}

// ---------------------------------------------------------------- /roster member

async function memberEmbeds(c: Ctx, userId: string): Promise<{ embeds: Embed[]; content: string }> {
  const [rows, saved] = await c.db.batch([
    c.db
      .prepare(
        `SELECT c.id, c.name, c.class, c.level AS char_level, c.is_main, t.name AS skill, cs.level
         FROM character c JOIN member m ON m.guild_id = c.guild_id AND m.discord_user_id = c.owner_user_id
         LEFT JOIN character_skill cs ON cs.character_id = c.id LEFT JOIN tradeskill t ON t.id = cs.tradeskill_id
         WHERE c.guild_id = ? AND c.owner_user_id = ? AND ${LIVE}
         ORDER BY c.is_main DESC, c.created_at, c.id, cs.level DESC, t.name COLLATE NOCASE`,
      )
      .bind(c.guild.id, userId),
    // Order 16: the saved name beside the header's mention (none for someone who never used GuildCraft).
    c.db.prepare('SELECT display_name FROM member WHERE guild_id = ? AND discord_user_id = ?').bind(c.guild.id, userId),
  ]);
  const results = rows.results as { id: number; name: string; class: string | null; char_level: number | null; is_main: number; skill: string | null; level: number | null }[];
  const savedName = (saved.results as { display_name: string }[])[0]?.display_name;
  const chars = new Map<number, Embed & { lines: string[] }>();
  for (const r of results) {
    let e = chars.get(r.id);
    if (!e) {
      const bits = charBits(r.class, r.char_level);
      e = { title: truncate(`${r.name}${r.is_main ? ' (main)' : ''}`, EMBED_LIMITS.title), lines: bits ? [bits] : [] };
      chars.set(r.id, e);
    }
    if (r.skill !== null) e.lines.push(`**${r.skill}** ${r.level}`);
  }
  const all = [...chars.values()];
  const embeds = all.slice(0, EMBED_LIMITS.embeds).map(({ lines, ...e }) => ({ ...e, description: lines.length ? lines.join('\n') : 'No skills recorded.' }));
  const who = savedName ? memberTag(userId, savedName) : mention(userId);
  const content = !all.length
    ? `${who} has no characters on the roster.`
    : `${who}: ${plural(all.length, 'character')}${all.length > embeds.length ? ` (showing ${embeds.length})` : ''}`;
  return { embeds, content };
}

export async function rosterMember(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const userId = optString(opts, 'member');
  if (!userId) return ephemeral('Pick a member.');
  const { embeds, content } = await memberEmbeds(c, userId);
  return searchReply({ content, embeds }, `rm:${userId}`);
}

// ---------------------------------------------------------------- /roster top

export const TOP_N = 3;

async function topEmbed(c: Ctx): Promise<Embed> {
  const { results } = await c.db
    .prepare(
      `SELECT skill, name, owner_user_id, member, level FROM (
         SELECT t.name AS skill, c.name, c.owner_user_id, m.display_name AS member, cs.level,
           ROW_NUMBER() OVER (PARTITION BY cs.tradeskill_id ORDER BY cs.level DESC, c.name COLLATE NOCASE) AS rn
         FROM character_skill cs ${JOIN_LIVE} JOIN tradeskill t ON t.id = cs.tradeskill_id
         WHERE c.guild_id = ? AND ${LIVE})
       WHERE rn <= ? ORDER BY skill COLLATE NOCASE, rn`,
    )
    .bind(c.guild.id, TOP_N)
    .all<{ skill: string; name: string; owner_user_id: string; member: string; level: number }>();
  const bySkill = new Map<string, string[]>();
  for (const r of results) bySkill.set(r.skill, [...(bySkill.get(r.skill) ?? []), `${md(r.name)} ${r.level} ${memberTag(r.owner_user_id, r.member)}`]);
  const lines = [...bySkill].map(([skill, top]) => `**${skill}**: ${top.join(' · ')}`);
  return {
    title: `Top ${TOP_N} in each tradeskill`,
    description: truncate(lines.length ? lines.join('\n') : 'No one in the guild has recorded a tradeskill yet.', EMBED_LIMITS.description),
  };
}

export async function rosterTop(c: Ctx): Promise<MessageReply> {
  return searchReply({ embeds: [await topEmbed(c)] }, 'rt');
}

// ---------------------------------------------------------------- Post to channel

export async function postRoster(c: Ctx, what: string): Promise<MessageReply | null> {
  const [kind, ...args] = what.split(':');
  if (kind === 'rs') {
    const [skillId, min, page] = args.map(Number);
    const d = await loadSkillPage(c, skillId, min, page);
    if (!d) return ephemeral('That tradeskill is no longer in the list. Run `/roster skill` again.');
    return postedReply({ embeds: [skillEmbed(c, d)] }, c.userId);
  }
  if (kind === 'rm') {
    const { embeds, content } = await memberEmbeds(c, args[0]);
    return postedReply({ content, embeds }, c.userId);
  }
  if (kind === 'rt') return postedReply({ embeds: [await topEmbed(c)] }, c.userId);
  return null;
}

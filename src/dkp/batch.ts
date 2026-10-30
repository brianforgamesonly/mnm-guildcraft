// Order 34 (ITEM 3): /dkp adjust event:, one change to everyone on an event's roster, as one batch: one ledger row per member
// and one public post. Every rule of a single adjustment holds for each member: nobody changes their own points (the officer
// running it is skipped; dkpSelfConflict decides), the cap applies, and over the "Second officer needed over" setting the
// whole batch waits for a second officer, whose press pays it. Events never pays by itself: this runs only on an officer's
// command.
import { audit, dkpSelfConflict, now } from '../access.ts';
import type { BotApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { ephemeral, memberTag, optInt, optString, truncate, type Embed, type MessageReply, type Option } from '../discord.ts';
import { layoutRoster } from '../events/card.ts';
import { EVENT_COPY } from '../events/copy.ts';
import { loadEvents } from '../events/state.ts';
import { ON_ROSTER } from '../events/types.ts';
import { askApproval, dkpApi, resolvePool, spentDkp, whoRan } from './commands.ts';
import { BATCH_COPY, DKP_COPY } from './copy.ts';
import { payStatement, POOL_GUILD, registerPool } from './ledger.ts';
import { poolNames, postIn, refreshStandings } from './messages.ts';
import type { DkpState } from './state.ts';

/** A member of a batch: `frozen` is DKP's word for member.status 'left'. */
export interface BatchMember {
  member_id: string;
  name: string;
  frozen: boolean;
}
const shape = (rows: { member_id: string; name: string; status: string }[]): BatchMember[] => rows.map((r) => ({ member_id: r.member_id, name: r.name, frozen: r.status === 'left' }));

const ROSTER_SQL = `SELECT s.member_id, coalesce(m.display_name, s.member_id) AS name, coalesce(m.status, 'active') AS status FROM event_signup s
  LEFT JOIN member m ON m.guild_id = s.guild_id AND m.discord_user_id = s.member_id
  WHERE s.event_id = ? AND s.status IN (${ON_ROSTER.map((x) => `'${x}'`).join(', ')}) ORDER BY lower(name)`;

/** The members a batch fixed when it was requested, as they stand now. */
export async function batchMembers(db: D1Database, guildId: string, pendingId: number): Promise<BatchMember[]> {
  const { results } = await db
    .prepare(`SELECT p.member_id, coalesce(m.display_name, p.member_id) AS name, coalesce(m.status, 'active') AS status FROM dkp_pending_member p
      LEFT JOIN member m ON m.guild_id = ? AND m.discord_user_id = p.member_id WHERE p.pending_id = ? ORDER BY lower(name)`)
    .bind(guildId, pendingId)
    .all<{ member_id: string; name: string; status: string }>();
  return shape(results);
}

const tagsOf = (list: BatchMember[]) => list.map((m) => memberTag(m.member_id, m.name)).join(', ');

/**
 * The one public post: everyone paid, with what the cap cut, and the frozen skipped. Reads the rows this batch wrote, so what
 * it says is what happened. Then the pool's standings.
 */
export async function postBatch(c: Ctx, d: DkpState, api: BotApi | null, b: { title: string; pool: { key: string; name: string }; points: number; reason: string; actor: string; at: string; by: string; frozen: BatchMember[] }): Promise<boolean> {
  if (!api || !d.channel_id) return false;
  const { results } = await c.db
    .prepare(`SELECT l.member_id, coalesce(m.display_name, l.member_id) AS name, l.cut, l.balance_after FROM dkp_ledger l LEFT JOIN member m ON m.guild_id = l.guild_id AND m.discord_user_id = l.member_id
      WHERE l.guild_id = ? AND l.pool = ? AND l.actor = ? AND l.at = ? AND l.kind = 'adjust' ORDER BY lower(name)`)
    .bind(c.guild.id, b.pool.key, b.actor, b.at)
    .all<{ member_id: string; name: string; cut: number; balance_after: number }>();
  const header = BATCH_COPY.head(b.points, b.title, b.pool.name, results.length, b.by, b.reason);
  const sections = [
    { head: BATCH_COPY.paidHead, lines: results.map((r) => BATCH_COPY.line(memberTag(r.member_id, r.name), r.balance_after, r.cut)) },
    ...(b.frozen.length ? [{ head: BATCH_COPY.frozenHead, lines: b.frozen.map((m) => memberTag(m.member_id, m.name)) }] : []),
  ];
  const embed: Embed = layoutRoster(header, sections, 0);
  const posted = await postIn(api, d.channel_id, { embeds: [embed] });
  await refreshStandings(c.db, api, c.guild.id, d.channel_id, [b.pool.key]);
  return !!posted;
}

export async function adjustEvent(c: Ctx, opts: Option[], d: DkpState): Promise<MessageReply> {
  const points = optInt(opts, 'points') ?? 0;
  const reason = (optString(opts, 'reason') ?? '').trim();
  if (optString(opts, 'member') !== undefined) return ephemeral(BATCH_COPY.either);
  if (!reason) return ephemeral(DKP_COPY.adjustReason);
  if (!points) return ephemeral(DKP_COPY.noPoints);
  if (!(await loadEvents(c.db, c.guild.id)).enabled) return ephemeral(EVENT_COPY.off);
  const id = Number(optString(opts, 'event'));
  if (!Number.isInteger(id) || id <= 0) return ephemeral(EVENT_COPY.pickEvent);
  const [found, linked, roster] = await c.db.batch<Record<string, unknown>>([
    c.db.prepare('SELECT title, status FROM event WHERE id = ? AND guild_id = ?').bind(id, c.guild.id),
    c.db.prepare('SELECT pool FROM dkp_raid WHERE event_id = ?').bind(id),
    c.db.prepare(ROSTER_SQL).bind(id),
  ]);
  const e = found.results[0] as { title: string; status: string } | undefined;
  if (!e || (e.status !== 'open' && e.status !== 'closed')) return ephemeral(e?.status === 'cancelled' ? BATCH_COPY.cancelled : EVENT_COPY.pickEvent);
  const typed = optString(opts, 'pool');
  const raidPool = (linked.results[0] as { pool: string } | undefined)?.pool ?? POOL_GUILD;
  const pool = typed !== undefined ? await resolvePool(c.db, typed) : { key: raidPool, name: (await poolNames(c.db, [raidPool])).get(raidPool)! };
  if (!pool) return ephemeral(DKP_COPY.unknownPool(truncate(typed ?? '', 100)));
  const everyone = shape(roster.results as { member_id: string; name: string; status: string }[]);
  // Nobody changes their own points: one function decides (order 27), and the reply says so.
  const skippedSelf = everyone.some((m) => dkpSelfConflict(c.userId, { member: m.member_id }));
  const others = everyone.filter((m) => !dkpSelfConflict(c.userId, { member: m.member_id }));
  const frozen = others.filter((m) => m.frozen);
  const eligible = others.filter((m) => !m.frozen);
  if (!eligible.length) return ephemeral(skippedSelf ? BATCH_COPY.onlyYou(e.title) : BATCH_COPY.noOne(e.title));
  const at = now();
  const api = dkpApi(c);
  try {
    if (Math.abs(points) > d.settings.second_officer_over) {
      const r = await askApproval(c, d, api, { member: `event:${id}`, name: e.title, pool, points, reason, at, batch: { eventId: id, title: e.title, members: eligible } });
      return ephemeral([r.data.content, ...notes(skippedSelf, frozen)].join('\n'));
    }
    const ids = eligible.map((m) => m.member_id);
    await c.db.batch([
      registerPool(c.db, c.guild.id, pool.key, at),
      payStatement(c.db, { guildId: c.guild.id, pool: pool.key, members: ids, asked: points, cap: d.settings.cap, kind: 'adjust', reason, actor: c.userId, at }),
      audit(c.db, c.guild.id, c.userId, 'dkp.adjust.event', `event:${id}`, null, { pool: pool.key, points, members: ids.length }),
    ]);
    const posted = await postBatch(c, d, api, { title: e.title, pool, points, reason, actor: c.userId, at, by: whoRan(c), frozen });
    return ephemeral([DKP_COPY.adjustDone(posted), ...notes(skippedSelf, frozen)].join('\n'));
  } finally {
    spentDkp(c, api);
  }
}

const notes = (self: boolean, frozen: BatchMember[]) => [...(self ? [BATCH_COPY.youSkipped] : []), ...(frozen.length ? [BATCH_COPY.frozenSkipped(tagsOf(frozen))] : [])];

/** The approval card's list of who a batch covers. */
export const batchNames = (members: BatchMember[]) => truncate(tagsOf(members), 3000);

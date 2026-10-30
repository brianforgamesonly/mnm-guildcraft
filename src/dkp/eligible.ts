// Order 29 (docs/PRD.md "Order 29: spending points"; ORDER-RULES Order 29: "One function decides who may bid in a raid
// auction, and every route calls it"): who may bid. bidRefusal decides from one member's facts; eligibility reads the facts
// for any number of members in one statement (the Bid press, the bid form, the close's re-check, the wishlist count and
// nudges all call it). Who was at a kill is the kill's roster (dkp_kill_member), never the ledger.
//
// A raid auction: frozen members can't bid; the member was Present or Standby at one or more kills of that raid; under the
// win limits (wins per raid, wins in any 7 days: general-auction wins count only toward the 7 days; shop purchases toward
// neither); past the new-member wait (kills, Present or Standby, in that raid zone's pool, ever). A general auction: not
// frozen, and the 7-day limit.
import type { Settings } from './settings.ts';

export type Refusal = 'frozen' | 'not_at_raid' | 'raid_limit' | 'week_limit' | 'new_member';

export interface BidFacts {
  member_id: string;
  /** member.status; null: no member row (never seen by the bot), refused as frozen is. */
  status: string | null;
  at_kills: number;
  raid_wins: number;
  week_wins: number;
  pool_kills: number;
}

export interface AuctionKind {
  kind: 'raid' | 'general';
  raid_id: number | null;
  pool: string;
}

export const WEEK_MS = 7 * 86_400_000;

/** The one decider: the refusal, or null when the member may bid. */
export function bidRefusal(a: Pick<AuctionKind, 'kind'>, f: BidFacts, s: Pick<Settings, 'wins_per_raid' | 'wins_per_week' | 'new_member_kills'>): Refusal | null {
  if (f.status !== 'active') return 'frozen';
  if (a.kind === 'raid') {
    if (f.at_kills < 1) return 'not_at_raid';
    if (f.raid_wins >= s.wins_per_raid) return 'raid_limit';
  }
  if (f.week_wins >= s.wins_per_week) return 'week_limit';
  if (a.kind === 'raid' && f.pool_kills < s.new_member_kills) return 'new_member';
  return null;
}

/**
 * The facts for each member, in one statement: their member row, their kills of this raid (its rosters), their wins in
 * this raid and in the 7 days before `nowMs` (sold auctions; dkp_auction_wins), and their kills ever in the pool's raids
 * (dkp_kill_member_by_member). `excludeAuction`: an auction being decided does not count toward its own limits.
 */
export async function eligibility(db: D1Database, guildId: string, a: AuctionKind & { id: number }, members: string[], nowMs: number, s: Settings): Promise<Map<string, Refusal | null>> {
  if (!members.length) return new Map();
  const { results } = await db
    .prepare(
      `SELECT j.value AS member_id, m.status,
         (SELECT count(*) FROM dkp_kill_member km JOIN dkp_kill k ON k.id = km.kill_id WHERE km.member_id = j.value AND k.raid_id = ?2) AS at_kills,
         (SELECT count(*) FROM dkp_auction w WHERE w.guild_id = ?1 AND w.winner = j.value AND w.status = 'sold' AND w.kind = 'raid' AND w.raid_id = ?2 AND w.id <> ?6) AS raid_wins,
         (SELECT count(*) FROM dkp_auction w WHERE w.guild_id = ?1 AND w.winner = j.value AND w.status = 'sold' AND w.closed_at >= ?4 AND w.id <> ?6) AS week_wins,
         (SELECT count(*) FROM dkp_kill_member km JOIN dkp_kill k ON k.id = km.kill_id JOIN dkp_raid r ON r.id = k.raid_id
            WHERE km.member_id = j.value AND r.guild_id = ?1 AND r.pool = ?3) AS pool_kills
       FROM json_each(?5) j LEFT JOIN member m ON m.guild_id = ?1 AND m.discord_user_id = j.value`,
    )
    .bind(guildId, a.raid_id, a.pool, new Date(nowMs - WEEK_MS).toISOString(), JSON.stringify([...new Set(members)]), a.id)
    .all<BidFacts>();
  return new Map(results.map((f) => [f.member_id, bidRefusal(a, f, s)]));
}

/** One member's answer from eligibility(): null when they may bid (a member the read did not return is refused). */
export const refusalOf = (m: Map<string, Refusal | null>, member: string): Refusal | null => (m.has(member) ? m.get(member)! : 'frozen');

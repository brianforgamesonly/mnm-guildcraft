// Order 27 (ITEM 5): /me's DKP line, only where DKP is on: the member's balance in each pool used, and 30-day attendance,
// from the one reader (dkpRead). Guild-public by design (override 3), so an officer's view of a member's panel shows it too.
// Order 34: with the Events module on too, their linked raids, from the same reader.
import { EVENT_COPY } from '../events/copy.ts';
import { RAID_COPY } from './copy.ts';
import { dkpRead, POOL_GUILD } from './ledger.ts';
import { poolNames } from './messages.ts';
import { loadDkp } from './state.ts';

export async function dkpMeLine(db: D1Database, guildId: string, memberId: string): Promise<string | null> {
  if (!(await loadDkp(db, guildId)).enabled) return null;
  const { results } = await db.prepare('SELECT pool FROM dkp_pool WHERE guild_id = ? ORDER BY pool = ? DESC, created_at').bind(guildId, POOL_GUILD).all<{ pool: string }>();
  const pools = [...new Set([POOL_GUILD, ...results.map((r) => r.pool)])];
  const [{ standings, attendance, raidEvents }, names] = await Promise.all([dkpRead(db, guildId, { pools, member: memberId, attendance: true, raidEvents: true }), poolNames(db, pools)]);
  const lines = pools.map((p) => {
    const a = attendance.find((x) => x.pool === p);
    return RAID_COPY.meLine(names.get(p)!, standings.get(p)?.[0]?.balance ?? 0, a?.earned ?? 0, a?.held ?? 0);
  });
  const events = raidEvents?.module === 1 ? [EVENT_COPY.meRaidEvents(raidEvents.signed_up, raidEvents.attended, raidEvents.no_shows)] : [];
  return [RAID_COPY.meHead, ...lines, ...events].join('\n');
}

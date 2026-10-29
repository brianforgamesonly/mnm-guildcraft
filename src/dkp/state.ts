// Order 27: a server's DKP state in one statement: the switch, GC-DKP, /dkp's command id and the settings.
import { settingsOf, type Settings } from './settings.ts';

export interface DkpState {
  enabled: boolean;
  channel_id: string | null;
  command_id: string | null;
  settings: Settings;
}

const STATE_SQL = `SELECT g.enabled, g.channel_id, g.command_id,
  (SELECT json_group_object(s.key, s.value) FROM dkp_setting s WHERE s.guild_id = ?1) AS settings
  FROM (SELECT ?1 AS guild_id) q LEFT JOIN dkp_guild g ON g.guild_id = q.guild_id`;

export async function loadDkp(db: D1Database, guildId: string): Promise<DkpState> {
  const r = await db.prepare(STATE_SQL).bind(guildId).first<{ enabled: number | null; channel_id: string | null; command_id: string | null; settings: string | null }>();
  return {
    enabled: r?.enabled === 1,
    channel_id: r?.channel_id ?? null,
    command_id: r?.command_id ?? null,
    settings: settingsOf(r?.settings ? (JSON.parse(r.settings) as Record<string, string>) : null),
  };
}

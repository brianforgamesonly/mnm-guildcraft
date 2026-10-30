// Order 32: a server's Events state in one statement: the switch, #gc-events, /event's command id and the settings.
import { eventSettingsOf, type EventSettings } from './settings.ts';

export interface EventState {
  enabled: boolean;
  channel_id: string | null;
  command_id: string | null;
  settings: EventSettings;
}

const STATE_SQL = `SELECT g.enabled, g.channel_id, g.command_id,
  (SELECT json_group_object(s.key, s.value) FROM event_setting s WHERE s.guild_id = ?1) AS settings
  FROM (SELECT ?1 AS guild_id) q LEFT JOIN event_guild g ON g.guild_id = q.guild_id`;

export async function loadEvents(db: D1Database, guildId: string): Promise<EventState> {
  const r = await db.prepare(STATE_SQL).bind(guildId).first<{ enabled: number | null; channel_id: string | null; command_id: string | null; settings: string | null }>();
  return {
    enabled: r?.enabled === 1,
    channel_id: r?.channel_id ?? null,
    command_id: r?.command_id ?? null,
    settings: eventSettingsOf(r?.settings ? (JSON.parse(r.settings) as Record<string, string>) : null),
  };
}

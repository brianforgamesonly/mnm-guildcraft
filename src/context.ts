import type { Guild } from './access.ts';
import type { GuildMember } from './discord.ts';

/** What every command handler gets: the caller, their guild and their rights, checked for this request. */
export interface Ctx {
  db: D1Database;
  guild: Guild;
  member: GuildMember;
  userId: string;
  officer: boolean;
}

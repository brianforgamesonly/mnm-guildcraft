import type { Guild } from './access.ts';
import type { GuildMember, Resolved } from './discord.ts';

/** Work a handler asks for after its reply is delivered (order 5: the board refresh). */
export interface Effects {
  board?: boolean;
  /** Order 6: the refresh is /guildcraft rebuild-board's own run (it may create while the rebuild is in progress). */
  rebuild?: boolean;
  /** Order 7: a read's audit row (craft.find, roster.view, guildcraft.status), written after delivery. */
  audit?: { guildId: string; actor: string; action: string; target: string; detail: unknown };
  /**
   * Order 19: Discord calls the handler already made in this invocation (Create GuildCraft channels), so the board run
   * after it stays inside the same 40-call budget (src/board/api.ts BOARD_CALL_CAP).
   */
  discordCalls?: number;
}

/** What every command handler gets: the caller, their guild and their rights, checked for this request. */
export interface Ctx {
  db: D1Database;
  guild: Guild;
  member: GuildMember;
  userId: string;
  officer: boolean;
  /** Set by handlers; read by the deferred path after delivery (src/index.ts). */
  effects: Effects;
  /** The interaction's resolved objects (channel options carry the app's permissions there). */
  resolved?: Resolved;
  /** This application's id (the bot user's id), from the interaction. */
  applicationId?: string;
  botToken?: string;
  /** Which copy answered: 'dev' or 'production' (Env.GUILDCRAFT_COPY). */
  copy?: string;
  /** Order 17: Env.ATLAS_ZONE_IMAGES is 'on'. */
  atlasZoneImages?: boolean;
}

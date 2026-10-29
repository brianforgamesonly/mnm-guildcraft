export interface Env {
  DB: D1Database;
  /** Hex Ed25519 public key from the Discord developer portal (Worker variable, not secret). */
  DISCORD_PUBLIC_KEY: string;
  /** Bot token (Worker secret). The guild-name lookup (src/access.ts) and the roster board (src/board/). */
  DISCORD_BOT_TOKEN?: string;
  /** Order 10: which copy this Worker is, 'dev' or 'production' (wrangler.jsonc vars; /guildcraft status shows it). */
  GUILDCRAFT_COPY?: string;
  /**
   * Order 17, override 3: 'on' shows MnM Atlas's whole-zone pictures on /zone cards. The repository variable of the same
   * name, passed by the deploy workflow; anything else, unset included, is off. It ships off.
   */
  ATLAS_ZONE_IMAGES?: string;
  /** Order 27: one DKP timer object per guild (src/dkp/timers.ts DkpTimers; SQLite-backed, wrangler.jsonc). */
  DKP_TIMERS: DurableObjectNamespace<import('./dkp/timers.ts').DkpTimers>;
}

/** Order 11's one decider of dev and production, held in src/copy.ts (order 12). */
export { isDevCopy } from './copy.ts';

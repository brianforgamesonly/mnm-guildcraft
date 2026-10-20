export interface Env {
  DB: D1Database;
  /** Hex Ed25519 public key from the Discord developer portal (Worker variable, not secret). */
  DISCORD_PUBLIC_KEY: string;
  /** Bot token (Worker secret). The guild-name lookup (src/access.ts) and the roster board (src/board/). */
  DISCORD_BOT_TOKEN?: string;
  /** Order 10: which copy this Worker is, 'dev' or 'production' (wrangler.jsonc vars; /guildcraft status shows it). */
  GUILDCRAFT_COPY?: string;
}

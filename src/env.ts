export interface Env {
  DB: D1Database;
  /** Hex Ed25519 public key from the Discord developer portal (Worker variable, not secret). */
  DISCORD_PUBLIC_KEY: string;
  /** Bot token (Worker secret). Unused until order 2. */
  DISCORD_BOT_TOKEN?: string;
}

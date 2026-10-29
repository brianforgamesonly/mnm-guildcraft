import type { D1Migration } from 'cloudflare:test';

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      DISCORD_PUBLIC_KEY: string;
      TEST_MIGRATIONS: D1Migration[];
      DKP_TIMERS: DurableObjectNamespace<import('../src/dkp/timers.ts').DkpTimers>;
    }
  }
}

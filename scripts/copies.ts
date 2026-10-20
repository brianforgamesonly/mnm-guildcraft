// The two copies of GuildCraft (order 10, ITEM 2): dev and production. Same code, different config: each is one
// wrangler environment in wrangler.jsonc (its Worker, its D1 database, its GUILDCRAFT_COPY marker), and the jobs pick
// one with GUILDCRAFT_COPY (default dev). The list of copies is the config's own environments, never typed here.
// Their Discord apps' secrets: dev uses DISCORD_*, production PROD_DISCORD_* (the workflows map them).
import { readFileSync } from 'node:fs';

interface EnvConfig {
  name: string;
  vars?: { GUILDCRAFT_COPY?: string };
  d1_databases: { binding: string; database_name: string; database_id: string }[];
}

export interface Copy {
  /** The wrangler environment, and the GUILDCRAFT_COPY value: 'dev' or 'production'. */
  name: string;
  worker: string;
  database: string;
  /** The D1 database_id (not a secret); throws when the database is not provisioned yet. */
  databaseId: () => string;
}

function config(configPath: string): Record<string, EnvConfig> {
  const text = readFileSync(configPath, 'utf8').replace(/^\s*\/\/.*$/gm, '');
  return (JSON.parse(text) as { env: Record<string, EnvConfig> }).env;
}

/** Every copy wrangler.jsonc defines, in its order. */
export function copies(configPath = 'wrangler.jsonc'): Copy[] {
  return Object.entries(config(configPath)).map(([name, e]) => {
    if (e.vars?.GUILDCRAFT_COPY !== name) throw new Error(`wrangler.jsonc env.${name}: vars.GUILDCRAFT_COPY must be "${name}"`);
    const db = e.d1_databases.find((d) => d.binding === 'DB');
    if (!db) throw new Error(`wrangler.jsonc env.${name}: no DB binding`);
    return {
      name,
      worker: e.name,
      database: db.database_name,
      databaseId: () => {
        if (!/^[0-9a-f-]{36}$/.test(db.database_id) || /^0{8}-/.test(db.database_id)) throw new Error(`wrangler.jsonc has no provisioned database_id for ${name}`);
        return db.database_id;
      },
    };
  });
}

/**
 * The Actions secrets' prefix per copy, as the operator named them (work order 10): the Dev app's are DISCORD_*,
 * the production app's PROD_DISCORD_*. Any other copy a fork adds uses its upper-cased name and an underscore.
 */
export const secretPrefix = (copy: string) => (copy === 'dev' ? '' : copy === 'production' ? 'PROD_' : `${copy.toUpperCase()}_`);

/**
 * The workflows' matrix: one entry per copy wrangler.jsonc defines, filtered by `want` ('both' or a copy's name),
 * production first when `primaryFirst` (the backup's order: production is primary).
 */
export function matrix(want = 'both', primaryFirst = false, configPath = 'wrangler.jsonc'): { copy: string; prefix: string }[] {
  const all = copies(configPath).map((c) => ({ copy: c.name, prefix: secretPrefix(c.name) }));
  if (primaryFirst) all.sort((a, b) => Number(b.copy === 'production') - Number(a.copy === 'production'));
  const out = want === 'both' ? all : all.filter((c) => c.copy === want);
  if (!out.length) throw new Error(`no copy named ${want} in wrangler.jsonc`);
  return out;
}

/** The copy a job runs against: GUILDCRAFT_COPY, default dev. */
export function currentCopy(name = process.env.GUILDCRAFT_COPY || 'dev', configPath = 'wrangler.jsonc'): Copy {
  const c = copies(configPath).find((x) => x.name === name);
  if (!c) throw new Error(`GUILDCRAFT_COPY=${name}: wrangler.jsonc has no such environment`);
  return c;
}

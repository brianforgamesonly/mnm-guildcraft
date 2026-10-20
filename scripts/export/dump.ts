// One guild's copy of a database dump (order 10, ITEM 1.2), with Node's built-in SQLite (node:sqlite): the full
// export (wrangler d1 export) is loaded in memory, every row outside the guild is deleted by the plan derived from
// the schema (scripts/export/lib.ts), and the rest is written back out as SQL that loads into an empty D1
// (wrangler d1 execute <db> --file). Nothing here prints a row: callers print table names and counts only.
import { DatabaseSync } from 'node:sqlite';
import { deleteStatements, exportPlan, type TablePlan, type TableSql } from './lib.ts';

const TABLES = "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' ORDER BY rowid";

export interface GuildDump {
  sql: string;
  plan: TablePlan[];
  /** Rows per table in the guild's copy. */
  counts: Record<string, number>;
}

const q = (s: string) => `"${s.replace(/"/g, '""')}"`;

function literal(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** Loads SQL into a fresh in-memory database (foreign keys checked afterwards, not per statement). */
export function load(sql: string): DatabaseSync {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  db.exec(sql);
  return db;
}

export function counts(db: DatabaseSync): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { name } of db.prepare(TABLES).all() as { name: string }[]) out[name] = Number((db.prepare(`SELECT count(*) AS n FROM ${q(name)}`).get() as { n: number }).n);
  return out;
}

/** "CREATE TABLE x" → "CREATE TABLE IF NOT EXISTS x" (and indexes, views, triggers). */
const ifNotExists = (sql: string) => sql.replace(/^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX|VIEW|TRIGGER)\s+(?!IF\s+NOT\s+EXISTS)/i, (_m, u, k) => `CREATE ${u ?? ''}${k} IF NOT EXISTS `);

/**
 * The database as SQL: schema, then rows parents first, then indexes. It loads into an empty database, or into one
 * whose migrations already ran (the schema statements are IF NOT EXISTS, and a row already there, such as a
 * d1_migrations entry, is kept: INSERT OR IGNORE).
 */
export function dump(db: DatabaseSync, parentsFirst: string[]): string {
  const tables = db.prepare(TABLES).all() as unknown as TableSql[];
  const lines = ['PRAGMA defer_foreign_keys = TRUE;'];
  for (const t of tables) lines.push(`${ifNotExists(t.sql)};`);
  const order = [...parentsFirst.filter((n) => tables.some((t) => t.name === n)), ...tables.map((t) => t.name).filter((n) => !parentsFirst.includes(n))];
  for (const name of order) {
    for (const row of db.prepare(`SELECT * FROM ${q(name)}`).all() as Record<string, unknown>[]) {
      const cols = Object.keys(row);
      lines.push(`INSERT OR IGNORE INTO ${q(name)} (${cols.map(q).join(', ')}) VALUES (${cols.map((c) => literal(row[c])).join(', ')});`);
    }
  }
  for (const { sql } of db.prepare("SELECT sql FROM sqlite_master WHERE type IN ('index', 'trigger', 'view') AND sql IS NOT NULL ORDER BY rowid").all() as { sql: string }[]) lines.push(`${ifNotExists(sql)};`);
  return `${lines.join('\n')}\n`;
}

/**
 * The guild's copy of `fullSql`. Throws when the guild is not in the dump, when a foreign key would dangle, or when
 * the copy does not load back with the same counts.
 */
export function guildDump(fullSql: string, guildId: string, referenceTables: readonly string[]): GuildDump {
  const db = load(fullSql);
  const plan = exportPlan(db.prepare(TABLES).all() as unknown as TableSql[], guildId, referenceTables);
  const found = db.prepare('SELECT count(*) AS n FROM guild WHERE id = ?').get(guildId) as { n: number };
  if (Number(found.n) !== 1) throw new Error('that guild is not in this database');
  for (const s of deleteStatements(plan)) db.exec(s);
  const dangling = db.prepare('PRAGMA foreign_key_check').all();
  if (dangling.length) throw new Error(`${dangling.length} row(s) would point at rows outside the export`);
  const kept = counts(db);
  const sql = dump(db, [...plan.map((p) => p.table)].reverse());
  const back = counts(load(sql));
  if (JSON.stringify(back) !== JSON.stringify(kept)) throw new Error('the guild copy does not load back with the same counts');
  return { sql, plan, counts: kept };
}

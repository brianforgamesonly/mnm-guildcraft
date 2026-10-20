// The per-guild export's rules (order 10, ITEM 1.2: the continuity kit). Pure: no I/O, so the local test and the
// dispatched run apply the same plan.
//
// Which rows belong to one guild is derived from the database's own schema (sqlite_master), never from a list:
//   - guild: the row whose id is the guild's;
//   - a table with a guild_id column: its rows for the guild (a nullable guild_id also keeps the shared rows, NULL,
//     as the recipe table's guild-private recipes work: src/recipes.ts visibleTo);
//   - a table without guild_id whose foreign keys point at guild tables (character_skill, character_recipe,
//     recipe_component, ...): its rows whose every such key points at a kept row, and at least one does;
//   - the game data the import writes (scripts/import/core.ts IMPORT_WRITES) and d1_migrations: whole, because the
//     guild's rows point into it by id, and a fresh copy needs it to load;
//   - every other table (the operator's backup_status, usage_daily, and anything added later): emptied.
// A table that cannot be scoped (no guild_id, only a composite key to a guild table) stops the export.

export interface TableSql {
  name: string;
  sql: string;
}

export interface Column {
  name: string;
  nullable: boolean;
}

export interface ForeignKey {
  columns: string[];
  parent: string;
  parentColumns: string[];
}

export interface Parsed {
  name: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
}

export type Scope = 'guild' | 'guild_id' | 'child' | 'reference' | 'emptied';

export interface TablePlan {
  table: string;
  scope: Scope;
  /** Rows to keep: a SQL predicate over the table's own columns, with the guild id inlined as a literal. */
  keep: string;
}

const ident = (s: string) => s.trim().replace(/^["`[]|["`\]]$/g, '');
const list = (s: string) => s.split(',').map(ident);

/** Splits at commas outside parentheses and quotes. */
function topLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let cur = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"') quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** A CREATE TABLE statement as SQLite stores it (ALTER TABLE ADD COLUMN appends to it). */
export function parseTable(t: TableSql): Parsed {
  const sql = t.sql.replace(/--[^\n]*/g, '');
  const open = sql.indexOf('(');
  const body = sql.slice(open + 1, sql.lastIndexOf(')'));
  const columns: Column[] = [];
  const foreignKeys: ForeignKey[] = [];
  for (const raw of topLevel(body)) {
    const part = raw.trim();
    const fk = /^FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+([\w"`[\]]+)\s*\(([^)]*)\)/i.exec(part);
    if (fk) {
      foreignKeys.push({ columns: list(fk[1]), parent: ident(fk[2]), parentColumns: list(fk[3]) });
      continue;
    }
    if (/^(PRIMARY\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(part)) continue;
    const name = ident(part.split(/\s+/)[0]);
    columns.push({ name, nullable: !/\bNOT\s+NULL\b/i.test(part) && !/\bPRIMARY\s+KEY\b/i.test(part) });
    const inline = /\bREFERENCES\s+([\w"`[\]]+)\s*\(([^)]*)\)/i.exec(part);
    if (inline) foreignKeys.push({ columns: [name], parent: ident(inline[1]), parentColumns: list(inline[2]) });
  }
  return { name: t.name, columns, foreignKeys };
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The plan for one guild: one entry per table, in an order where every child comes before its parents (the
 * deletes run children first, so the foreign keys hold throughout).
 */
export function exportPlan(tables: TableSql[], guildId: string, referenceTables: readonly string[]): TablePlan[] {
  if (!/^\d{1,25}$/.test(guildId)) throw new Error('the guild id must be a Discord snowflake (digits only)');
  const parsed = new Map(tables.map((t) => [t.name, parseTable(t)]));
  const g = lit(guildId);
  const keep = new Map<string, { scope: Scope; keep: string }>();
  const visiting = new Set<string>();

  function plan(name: string): { scope: Scope; keep: string } {
    const done = keep.get(name);
    if (done) return done;
    if (visiting.has(name)) throw new Error(`table ${name}: a foreign-key cycle through guild tables`);
    visiting.add(name);
    const t = parsed.get(name)!;
    const gid = t.columns.find((c) => c.name === 'guild_id');
    let out: { scope: Scope; keep: string };
    if (name === 'guild') out = { scope: 'guild', keep: `id = ${g}` };
    else if (gid) out = { scope: 'guild_id', keep: gid.nullable ? `(guild_id IS NULL OR guild_id = ${g})` : `guild_id = ${g}` };
    else {
      const scopedKeys = t.foreignKeys.filter((k) => parsed.has(k.parent) && isGuildData(k.parent));
      if (scopedKeys.length) {
        const single = scopedKeys.filter((k) => k.columns.length === 1);
        if (single.length !== scopedKeys.length) throw new Error(`table ${name}: a composite foreign key to a guild table, without guild_id; it cannot be scoped`);
        const ins = single.map((k) => `${k.columns[0]} IN (SELECT ${k.parentColumns[0]} FROM ${k.parent} WHERE ${plan(k.parent).keep})`);
        const nulls = single.map((k) => `${k.columns[0]} IS NULL`);
        // Every key that is set points at a kept row, and at least one is set.
        out = { scope: 'child', keep: `(${single.map((k, i) => `(${nulls[i]} OR ${ins[i]})`).join(' AND ')}) AND NOT (${nulls.join(' AND ')})` };
      } else if (referenceTables.includes(name) || name === 'd1_migrations') out = { scope: 'reference', keep: '1' };
      else out = { scope: 'emptied', keep: '0' };
    }
    visiting.delete(name);
    keep.set(name, out);
    return out;
  }

  /** A table holds guild data when it is the guild table, has guild_id, or points (by key) at one that does. */
  function isGuildData(name: string, seen = new Set<string>()): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    const t = parsed.get(name);
    if (!t) return false;
    if (name === 'guild' || t.columns.some((c) => c.name === 'guild_id')) return true;
    return t.foreignKeys.some((k) => isGuildData(k.parent, seen));
  }

  for (const name of parsed.keys()) plan(name);
  // Children first: a table comes before every table its foreign keys point at.
  const order: string[] = [];
  const placed = new Set<string>();
  const place = (name: string) => {
    if (placed.has(name)) return;
    placed.add(name);
    for (const [other, t] of parsed) if (other !== name && t.foreignKeys.some((k) => k.parent === name)) place(other);
    order.push(name);
  };
  for (const name of [...parsed.keys()].sort()) place(name);
  return order.map((table) => ({ table, ...keep.get(table)! }));
}

/** The deletes that leave only the guild's rows, children first. */
export const deleteStatements = (plan: TablePlan[]) =>
  // coalesce: a predicate that is NULL for a row (an unknown) deletes it rather than keeping it.
  plan.filter((p) => p.keep !== '1').map((p) => `DELETE FROM "${p.table}" WHERE NOT coalesce((${p.keep}), 0)`);

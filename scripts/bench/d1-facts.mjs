// Read-only facts from the remote dev D1 (order 4): fixed SELECT statements only, no input reaches the SQL.
//   items:      "Corroded Weapon" and "Rusty Weapon" as stored (ITEM 3), and every active recipe naming them;
//   tables:     the schema's tables (no alias or synonym table exists unless listed here);
//   activity:   the latest audit_log actions with their times (no actor or target ids);
//   shape:      row counts behind /roster (guilds, active members, live characters, skill rows).
// Usage: node scripts/bench/d1-facts.mjs   (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID from the environment)
import { execFileSync } from 'node:child_process';

const NAMES = "('corroded weapon', 'rusty weapon')";
const QUERIES = {
  items: `SELECT id, name, name_key, source, imported_at FROM item WHERE name_key IN ${NAMES} ORDER BY id`,
  recipes_using_them: `SELECT i.id AS component_id, i.name AS component, rc.qty, t.name AS tradeskill, ri.name AS result
    FROM recipe_component rc JOIN item i ON i.id = rc.item_id JOIN recipe r ON r.id = rc.recipe_id
    JOIN item ri ON ri.id = r.result_item_id JOIN tradeskill t ON t.id = r.tradeskill_id
    WHERE i.name_key IN ${NAMES} AND r.active = 1 ORDER BY ri.name, i.name`,
  tables: "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  activity: 'SELECT action, created_at FROM audit_log ORDER BY id DESC LIMIT 20',
  shape: `SELECT (SELECT count(*) FROM guild) AS guilds, (SELECT count(*) FROM member WHERE status = 'active') AS active_members,
    (SELECT count(*) FROM character WHERE deleted_at IS NULL) AS live_characters, (SELECT count(*) FROM character_skill) AS skill_rows`,
};

for (const [name, sql] of Object.entries(QUERIES)) {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`${name}: not a SELECT`);
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'mnm-guildcraft-dev', '--remote', '--env', 'dev', '--json', '--command', sql.replace(/\s+/g, ' ')], { encoding: 'utf8' });
  const parsed = JSON.parse(out);
  const first = Array.isArray(parsed) ? parsed[0] : parsed;
  console.log(`${name}: ${JSON.stringify(first.results)}  (rows_read ${first.meta?.rows_read ?? '?'})`);
}

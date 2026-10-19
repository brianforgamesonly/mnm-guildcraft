// Autocomplete. At most one D1 statement per keystroke, and never a write (order 3, ITEM 3.2):
// - skill, class, item: public game data, not role-gated; one statement that checks the import key and
//   reads the list only when it changed (src/gamedata.ts).
// - character: the caller's own characters (an officer who filled member: sees that member's), with the
//   member-role gate and the officer check inside the same statement (src/access.ts SQL_*).
import { SQL_IS_OFFICER, SQL_PASSES_MEMBER_GATE, sqlAccessParams } from '../access.ts';
import { focused, matchChoices, optString, subcommand, truncate, type Choice, type Interaction } from '../discord.ts';
import { gameList, type GameList } from '../gamedata.ts';

const CHOICE_MAX = 100;

const asChoices = (names: string[]): Choice[] => names.map((n) => ({ name: truncate(n, CHOICE_MAX), value: n }));

const GAME_OPTIONS: Record<string, GameList> = { skill: 'skills', class: 'classes', item: 'items' };

const CHARACTERS_SQL = `SELECT c.name FROM character c
  WHERE c.guild_id = ?1 AND c.deleted_at IS NULL AND ${SQL_PASSES_MEMBER_GATE}
    AND c.owner_user_id = CASE WHEN ?4 IS NOT NULL AND ${SQL_IS_OFFICER} THEN ?4 ELSE ?5 END
  ORDER BY c.is_main DESC, c.name COLLATE NOCASE`;

export async function autocomplete(db: D1Database, i: Interaction): Promise<Choice[]> {
  const { options } = subcommand(i);
  const f = focused(options);
  if (!f || !i.member || !i.guild_id) return [];
  const typed = typeof f.value === 'string' ? f.value : '';

  const list = GAME_OPTIONS[f.name];
  if (list) return asChoices(matchChoices(await gameList(db, list), typed));
  if (f.name === 'name' || f.name === 'character') {
    const { results } = await db
      .prepare(CHARACTERS_SQL)
      .bind(...sqlAccessParams(i.guild_id, i.member), optString(options, 'member') ?? null, i.member.user.id)
      .all<{ name: string }>();
    return asChoices(matchChoices(results.map((r) => r.name), typed));
  }
  return [];
}

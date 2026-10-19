// Autocomplete. Reads only: never creates a guild or member row (a Discord autocomplete reply can carry only choices).
import { isOfficer, type Guild } from '../access.ts';
import { focused, matchChoices, optString, subcommand, truncate, type Choice, type Interaction } from '../discord.ts';
import { allTradeskills } from './skills.ts';

const CHOICE_MAX = 100;

const asChoices = (names: string[]): Choice[] => names.map((n) => ({ name: truncate(n, CHOICE_MAX), value: n }));

export async function autocomplete(db: D1Database, guild: Guild | null, i: Interaction): Promise<Choice[]> {
  const { options } = subcommand(i);
  const f = focused(options);
  if (!f || !i.member || !i.guild_id) return [];
  const typed = typeof f.value === 'string' ? f.value : '';

  switch (f.name) {
    case 'class': {
      const { results } = await db.prepare('SELECT code FROM game_class WHERE item_count > 0 ORDER BY code').all<{ code: string }>();
      return asChoices(matchChoices(results.map((r) => r.code), typed));
    }
    case 'skill':
      return asChoices(matchChoices((await allTradeskills(db)).map((s) => s.name), typed));
    case 'name':
    case 'character': {
      // The caller's own characters; an officer who has filled member: sees that member's.
      const target = optString(options, 'member');
      const owner = target && isOfficer(guild, i.member) ? target : i.member.user.id;
      const { results } = await db
        .prepare('SELECT name FROM character WHERE guild_id = ? AND owner_user_id = ? AND deleted_at IS NULL ORDER BY is_main DESC, name COLLATE NOCASE')
        .bind(i.guild_id, owner)
        .all<{ name: string }>();
      return asChoices(matchChoices(results.map((r) => r.name), typed));
    }
    default:
      return [];
  }
}

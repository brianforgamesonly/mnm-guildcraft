// Order 17: no dead ends. A zone name that matches no zone (from /zone or /gear find's zone option) gets the zones whose
// names contain what was typed, or, failing that, the list itself.
import { ephemeral, matchChoices, md, truncate, type MessageReply } from '../discord.ts';
import { gameList } from '../gamedata.ts';

// ---------------------------------------------------------------- copy (order 17; listed for approval in docs/COPY.md)

export const ZONE_SUGGEST_COPY = {
  noZones: 'No zones are loaded yet. They arrive with the nightly import.',
  unknown: (typed: string) => `No zone is called **${md(typed)}**.`,
  suggest: (names: string[]) => `Did you mean: ${names.map((n) => `**${md(n)}**`).join(', ')}?`,
  allZones: (names: string[]) => `The zones: ${names.map(md).join(', ')}.`,
} as const;

export async function unknownZone(db: D1Database, typed: string): Promise<MessageReply> {
  const names = await gameList(db, 'zones');
  if (!names.length) return ephemeral(ZONE_SUGGEST_COPY.noZones);
  const words = typed.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  const near = [...new Set([...matchChoices(names, typed, 5), ...names.filter((n) => words.some((w) => n.toLowerCase().includes(w)))])].slice(0, 5);
  const head = ZONE_SUGGEST_COPY.unknown(truncate(typed, 100));
  return ephemeral(truncate([head, near.length ? ZONE_SUGGEST_COPY.suggest(near) : ZONE_SUGGEST_COPY.allZones(names)].join('\n'), 1900));
}

// Order 17: one creature from two sources. mnm-tools' mob keeps every field it holds; Mo Betta fills only the fields the
// mob lacks. The import reports its fills and conflicts with this same function (scripts/import/zones.ts), so the report
// describes exactly what the card shows.

export interface CreatureFields {
  level: string | null;
  race: string | null;
  class: string | null;
  loot: string[];
}

export function mergeCreature(
  mob: CreatureFields,
  moBetta: CreatureFields,
): { merged: CreatureFields; filled: (keyof CreatureFields)[]; conflicts: { field: keyof CreatureFields; mob: string; moBetta: string }[] } {
  const merged: CreatureFields = { ...mob, loot: [...mob.loot] };
  const filled: (keyof CreatureFields)[] = [];
  const conflicts: { field: keyof CreatureFields; mob: string; moBetta: string }[] = [];
  for (const f of ['level', 'race', 'class'] as const) {
    if (mob[f] === null && moBetta[f] !== null) {
      merged[f] = moBetta[f];
      filled.push(f);
    } else if (mob[f] !== null && moBetta[f] !== null && mob[f] !== moBetta[f]) conflicts.push({ field: f, mob: mob[f]!, moBetta: moBetta[f]! });
  }
  if (!mob.loot.length && moBetta.loot.length) {
    merged.loot = [...moBetta.loot];
    filled.push('loot');
  } else if (mob.loot.length && moBetta.loot.length && [...mob.loot].sort().join('\n') !== [...moBetta.loot].sort().join('\n'))
    conflicts.push({ field: 'loot', mob: mob.loot.join(', '), moBetta: moBetta.loot.join(', ') });
  return { merged, filled, conflicts };
}

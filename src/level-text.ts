// Order 41: a level bound recorded only as question marks is unknown. One place decides how such a text reads and how it
// parses, and every surface that shows a recorded level text (zone.level, mob.level, npc.level) reads it here: the zone
// card (src/zone/card.ts), the factions board (src/board/factions.ts) and /gear find's mob lines (src/commands/gear.ts).
// The import's parser (scripts/import/levels.ts parseLevel) reads UNKNOWN_TOP from here too. The column text itself is never
// rewritten (order 35: "The text stays as recorded in its column.").
//
// Forms in the data on 2026-11-08 (production import 42462309448's sources, read locally):
//   a top bound made only of question marks: "1 - ??", "5 - ??", "1 - ?", "15-?", "18-???"  → low N, top not recorded
//   only question marks: "?", "??"                                                          → no level (as before)
//   a number or range followed by "?": "15?", "42-44?", "38+?" …                            → as recorded (order 41 gives
//     that "?" no meaning; the owner rules on it)

/** A top bound written only as question marks after a known low ("1 - ??", "15-?", "18-???"). Group 1: the known part. */
export const UNKNOWN_TOP = /^(.*\d)\s*-\s*\?+\s*$/s;
/** A text made only of question marks ("?", "??"): no level is recorded. */
export const ONLY_QUESTION_MARKS = /^\s*\?+\s*$/;

/** The copy (listed in docs/COPY.md for the owner's approval). */
export const LEVEL_COPY = {
  topNotRecorded: (known: string) => `${known} and up (top level not recorded)`,
} as const;

/** How a level text a question mark makes uncertain is read; the import's coverage report counts each text by this. */
export type QuestionReading = 'top not recorded' | 'no level' | 'as recorded';

export function questionReading(text: string): QuestionReading | null {
  if (!text.includes('?')) return null;
  if (ONLY_QUESTION_MARKS.test(text)) return 'no level';
  return UNKNOWN_TOP.test(text.trim()) ? 'top not recorded' : 'as recorded';
}

/**
 * A recorded level text as members see it (without markdown escaping: each surface escapes its own line). null: nothing to
 * show (no text, empty, or only question marks), so the surface says "not recorded" or leaves the level out, as it does for
 * a creature or zone with no level. A text with no question mark is returned exactly as recorded.
 */
export function shownLevel(text: string | null | undefined): string | null {
  if (text === null || text === undefined || text === '') return null;
  switch (questionReading(text)) {
    case 'no level':
      return null;
    case 'top not recorded':
      return LEVEL_COPY.topNotRecorded((UNKNOWN_TOP.exec(text.trim()) as RegExpExecArray)[1].trim());
    default:
      return text;
  }
}

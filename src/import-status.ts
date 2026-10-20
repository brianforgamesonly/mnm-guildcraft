// The data_import statuses, held once (order 9, ITEM 0). Every reader picks rows by a positive rule from this table,
// never by excluding a named status, so a status added later is not silently counted as a real import.
//   real:    the run tried to write the game data. /guildcraft status's "Last import" shows only these.
//   alarm:   the row is the nightly import's alarm state (scripts/import/run.ts). A refused run is in the alarm state but
//            is not an import: it wrote no game data.
//   failing: the state counts as failing.
export const IMPORT_STATUS = {
  ok: { real: true, alarm: true, failing: false },
  failed: { real: true, alarm: true, failing: true },
  // A 'running' row seen by a later run is a run that crashed mid-write: failing (order 9 review).
  running: { real: true, alarm: true, failing: true },
  refused: { real: false, alarm: true, failing: true },
  'dry-run': { real: false, alarm: false, failing: false },
} as const;
export type ImportStatus = keyof typeof IMPORT_STATUS;

const where = (key: 'real' | 'alarm') =>
  `status IN (${(Object.keys(IMPORT_STATUS) as ImportStatus[]).filter((s) => IMPORT_STATUS[s][key]).map((s) => `'${s}'`).join(', ')})`;
/** SQL predicate: the row is a real import. */
export const REAL_IMPORT = where('real');
/** SQL predicate: the row is part of the import alarm's state. */
export const ALARM_IMPORT = where('alarm');
export const isFailing = (status: string) => status in IMPORT_STATUS && IMPORT_STATUS[status as ImportStatus].failing;

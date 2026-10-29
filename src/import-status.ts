// The data_import statuses, held once (order 9, ITEM 0). Every reader picks rows by a positive rule from this table,
// never by excluding a named status, so a status added later is not silently counted as a real import.
//   real:     the run tried to write the game data. /guildcraft status's "Last import" shows only these.
//   alarm:    the row is the nightly import's alarm state (scripts/import/run.ts). A refused run is in the alarm state but
//             is not an import: it wrote no game data.
//   failing:  the state counts as failing.
//   finished: the run completed what it wrote (order 13): the game-data cache and "data as of" read these.
export const IMPORT_STATUS = {
  ok: { real: true, alarm: true, failing: false, finished: true },
  // Order 13: stopped at the write ceiling (scripts/import/core.ts WRITE_CEILING) between whole groups; the next run
  // writes the rest. What it wrote is complete, so readers of the game data treat it as finished.
  partial: { real: true, alarm: true, failing: false, finished: true },
  // Order 28's override 9 (order 28b, PR D): the game data imported, but the zone part kept yesterday's zone data because
  // the wiki snapshot job failed (its reason in `error`). Finished for the game data's readers; failing for the alarm, so
  // the owner hears of it once per state change.
  'zones-kept': { real: true, alarm: true, failing: true, finished: true },
  failed: { real: true, alarm: true, failing: true, finished: false },
  // A 'running' row seen by a later run is a run that crashed mid-write: failing (order 9 review).
  running: { real: true, alarm: true, failing: true, finished: false },
  refused: { real: false, alarm: true, failing: true, finished: false },
  'dry-run': { real: false, alarm: false, failing: false, finished: false },
} as const;
export type ImportStatus = keyof typeof IMPORT_STATUS;

const where = (key: 'real' | 'alarm' | 'finished') =>
  `status IN (${(Object.keys(IMPORT_STATUS) as ImportStatus[]).filter((s) => IMPORT_STATUS[s][key]).map((s) => `'${s}'`).join(', ')})`;
/** SQL predicate: the row is a real import. */
export const REAL_IMPORT = where('real');
/** SQL predicate: the row is part of the import alarm's state. */
export const ALARM_IMPORT = where('alarm');
/** SQL predicate: the run finished writing what it wrote (ok, or stopped cleanly at the write ceiling). */
export const FINISHED_IMPORT = where('finished');
export const isFailing = (status: string) => status in IMPORT_STATUS && IMPORT_STATUS[status as ImportStatus].failing;

// Order 32 (ITEM 2): event times. A typed time is read in the server's time zone, and each one is converted with that
// date's own offset, from the runtime's Intl data (IANA zones: test/worker/events-card.test.ts proves America/New_York
// across a daylight-saving change in workerd). Nothing here hard-codes an offset.

export const MAX_DAYS_AHEAD = 90;
const DAY = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

interface Local {
  y: number;
  m: number;
  d: number;
  h: number;
  min: number;
  /** Day of the week, Sunday 0. */
  dow: number;
}

function localParts(ms: number, tz: string): Local {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'long' }).formatToParts(ms);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), h: Number(get('hour')), min: Number(get('minute')), dow: WEEKDAYS.indexOf(get('weekday').toLowerCase()) };
}

/** The zone's offset from UTC at this moment, in ms (east positive). */
const offsetAt = (ms: number, tz: string) => {
  const l = localParts(ms, tz);
  return Date.UTC(l.y, l.m - 1, l.d, l.h, l.min) - Math.floor(ms / 60_000) * 60_000;
};

/**
 * The moment a local date and time names, or null when the clocks skip it. A time the clocks repeat means the first. The
 * two offsets either side of the date are the only candidates, so a date's own offset is always the one used.
 */
export function localToUtc(y: number, m: number, d: number, h: number, min: number, tz: string): number | null {
  const wall = Date.UTC(y, m - 1, d, h, min);
  const candidates = [...new Set([offsetAt(wall - DAY, tz), offsetAt(wall + DAY, tz)])].map((o) => wall - o).sort((a, b) => a - b);
  for (const t of candidates) {
    const l = localParts(t, tz);
    if (l.y === y && l.m === m && l.d === d && l.h === h && l.min === min) return t;
  }
  return null;
}

/** HH:MM, or 8pm / 8:30 pm. */
function parseClock(s: string): { h: number; min: number } | null {
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    return h <= 23 && min <= 59 ? { h, min } : null;
  }
  m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(s);
  if (!m) return null;
  const hour = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (hour < 1 || hour > 12 || min > 59) return null;
  return { h: (hour % 12) + (m[3] === 'pm' ? 12 : 0), min };
}

export type StartError = 'format' | 'skipped' | 'past' | 'far';

/**
 * YYYY-MM-DD HH:MM, or a weekday, today or tomorrow plus a time, in `tz`. A weekday means the next such day: today while
 * that time is still ahead, otherwise a week on (docs/PRD.md "Events module", departures).
 */
export function parseStart(typed: string, tz: string, nowMs: number): { at: number } | { error: StartError } {
  const s = typed.trim().toLowerCase().replace(/\s+/g, ' ');
  const check = (at: number | null) => {
    if (at === null) return { error: 'skipped' as const };
    if (at <= nowMs) return { error: 'past' as const };
    if (at > nowMs + MAX_DAYS_AHEAD * DAY) return { error: 'far' as const };
    return { at };
  };
  const dated = /^(\d{4})-(\d{2})-(\d{2}) (.+)$/.exec(s);
  if (dated) {
    const clock = parseClock(dated[4]);
    const [y, m, d] = [Number(dated[1]), Number(dated[2]), Number(dated[3])];
    const real = new Date(Date.UTC(y, m - 1, d));
    if (!clock || real.getUTCMonth() !== m - 1 || real.getUTCDate() !== d) return { error: 'format' };
    return check(localToUtc(y, m, d, clock.h, clock.min, tz));
  }
  const space = s.indexOf(' ');
  if (space < 0) return { error: 'format' };
  const word = s.slice(0, space);
  const clock = parseClock(s.slice(space + 1));
  if (!clock) return { error: 'format' };
  const today = localParts(nowMs, tz);
  const on = (days: number) => {
    // Calendar arithmetic on the local date, so a change of offset can't move the day.
    const t = new Date(Date.UTC(today.y, today.m - 1, today.d + days));
    return localToUtc(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate(), clock.h, clock.min, tz);
  };
  if (word === 'today') return check(on(0));
  if (word === 'tomorrow') return check(on(1));
  const dow = WEEKDAYS.findIndex((w) => w === word || w.slice(0, 3) === word);
  if (dow < 0) return { error: 'format' };
  const ahead = (dow - today.dow + 7) % 7;
  const first = on(ahead);
  return check(first !== null && first <= nowMs ? on(ahead + 7) : first);
}

/** The full date in the server's zone: "Saturday, October 31, 2026 at 8:00 PM EDT". */
export const fullDate = (ms: number, tz: string) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(ms);
/** Discord's local-time displays. */
export const stamp = (ms: number, style: 'F' | 'R' | 'f' | 't') => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** When an event locks (null: never) and closes, from its start and the settings at this moment. */
export const lockAndClose = (startMs: number, s: { lock_minutes: number; close_hours: number }) => ({
  lock_at: s.lock_minutes ? new Date(startMs - s.lock_minutes * 60_000).toISOString() : null,
  closes_at: new Date(startMs + s.close_hours * 3_600_000).toISOString(),
});

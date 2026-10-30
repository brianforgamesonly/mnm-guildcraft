// Order 33 (ITEM 3): Add to calendar, in two forms, built from the event's rows. Nothing is served from a public web route.
//
// Google Calendar's event-template link (no official reference; the parameters as add-event-to-calendar-docs records them):
//   https://calendar.google.com/calendar/render?action=TEMPLATE&text=&dates=<start>/<end>&details=&location=
// Discord's link button: "URL for link-style buttons; max 512 characters" (docs.discord.com/developers/components/reference),
// measured here after encoding. When it would be longer the description gives way first, then the title.
//
// The .ics file, RFC 5545: content lines end CRLF and "SHOULD NOT be longer than 75 octets" (3.1); TEXT escapes \ ; , and
// newline (3.3.11); "An iCalendar object MUST include the "PRODID" and "VERSION" calendar properties" (3.6); a VEVENT requires
// DTSTAMP and UID (3.6.1); a UTC time ends Z (3.3.5). UTC is required here: these two are the exception to "UTC is never shown".

export const LINK_MAX = 512;
const GOOGLE = 'https://calendar.google.com/calendar/render?action=TEMPLATE';

export interface CalendarEvent {
  id: number;
  guildId: string;
  title: string;
  startMs: number;
  durationMinutes: number;
  /** The raid zone's name, not a time zone. */
  location: string | null;
  description: string | null;
  cardUrl: string | null;
}

const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const endOf = (e: CalendarEvent) => e.startMs + e.durationMinutes * 60_000;

/** The longest start of `text` that `fits`, ended with … when cut. By code point, so a cut never splits a character. */
function longestFitting(text: string, fits: (s: string) => boolean): string {
  if (fits(text)) return text;
  const points = Array.from(text);
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(`${points.slice(0, mid).join('')}…`)) low = mid;
    else high = mid - 1;
  }
  return low ? `${points.slice(0, low).join('')}…` : '';
}

/** The Google Calendar link, at most LINK_MAX characters once encoded. */
export function googleLink(e: CalendarEvent): string {
  const details = (description: string) => [description, e.cardUrl].filter(Boolean).join('\n\n');
  const build = (title: string, description: string, location: string | null) =>
    `${GOOGLE}&text=${encodeURIComponent(title)}&dates=${utc(e.startMs)}/${utc(endOf(e))}${details(description) ? `&details=${encodeURIComponent(details(description))}` : ''}${location ? `&location=${encodeURIComponent(location)}` : ''}`;
  const fits = (url: string) => url.length <= LINK_MAX;
  const description = longestFitting(e.description ?? '', (d) => fits(build(e.title, d, e.location)));
  const title = longestFitting(e.title, (t) => fits(build(t, description, e.location)));
  const location = e.location ? longestFitting(e.location, (l) => fits(build(title, description, l))) : null;
  return build(title, description, location);
}

/** RFC 5545 3.3.11. */
const text = (s: string) => s.replace(/\r\n?/g, '\n').replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');

/** RFC 5545 3.1: at most 75 octets a line, a continuation starting with one space, never inside a UTF-8 character. */
function fold(line: string): string {
  const out: string[] = [];
  let part = '';
  let octets = 0;
  const size = new TextEncoder();
  for (const ch of line) {
    const n = size.encode(ch).length;
    if (octets + n > 75) {
      out.push(part);
      part = ' ';
      octets = 1;
    }
    part += ch;
    octets += n;
  }
  out.push(part);
  return out.join('\r\n');
}

/** The .ics file's text: one VEVENT, every line CRLF. */
export function icsText(e: CalendarEvent, nowMs: number): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GuildCraft//Events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:ev-${e.id}-${e.guildId}@guildcraft`,
    `DTSTAMP:${utc(nowMs)}`,
    `DTSTART:${utc(e.startMs)}`,
    `DTEND:${utc(endOf(e))}`,
    `SUMMARY:${text(e.title)}`,
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.cardUrl ? [`URL:${e.cardUrl}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .map(fold)
    .join('\r\n')
    .concat('\r\n');
}

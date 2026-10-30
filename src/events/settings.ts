// Order 32: the Events settings, in src/dkp/settings.ts's pattern. A row in event_setting exists only for a value a server
// changed; every reader goes through eventSettingsOf, so a default is never typed twice. Who creates events is a role,
// decided in src/access.ts (isEventRunner). Class default roles have their own table (event_class_role).
import { ROLE_DEFAULTS, ROLES, TYPE_DEFAULTS, TYPES, type EventType, type Role } from './types.ts';

export const EVENT_SETTINGS = [
  { key: 'lock_minutes', label: 'Sign-ups lock before start', default: 30, min: 0, max: 1440, unit: 'minutes' },
  { key: 'close_hours', label: 'Event closes after start', default: 8, min: 1, max: 168, unit: 'hours' },
] as const;

export type NumberKey = (typeof EVENT_SETTINGS)[number]['key'];
export const TIME_ZONE = 'time_zone';
export const DEFAULT_TIME_ZONE = 'America/New_York';
export const EVENTS_ROLE = 'events_role';
export const SIGNUP_ROLE = 'signup_role';
export const SUPPORT_ON = 'support_on';
export const roleLabelKey = (r: Role) => `role_label_${r}`;
export const typeLabelKey = (t: EventType) => `type_label_${t}`;
export const LABEL_MAX = 32;

export type EventSettings = Record<NumberKey, number> & {
  time_zone: string;
  /** Null: the officer role. */
  events_role: string | null;
  /** The sign-up role a new event starts with; null: none. */
  signup_role: string | null;
  support_on: boolean;
  role_labels: Record<Role, string>;
  type_labels: Record<EventType, string>;
};

/** Whether the runtime knows this IANA zone. */
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return /\//.test(tz) || tz === 'UTC';
  } catch {
    return false;
  }
}

/** The settings from event_setting's rows (key → text), each missing or unusable one at its default. */
export function eventSettingsOf(rows: Record<string, string> | null | undefined): EventSettings {
  const numbers = Object.fromEntries(
    EVENT_SETTINGS.map((s) => {
      const v = Number(rows?.[s.key] ?? Number.NaN);
      return [s.key, Number.isInteger(v) && v >= s.min && v <= s.max ? v : s.default];
    }),
  ) as Record<NumberKey, number>;
  const tz = rows?.[TIME_ZONE];
  return {
    ...numbers,
    time_zone: tz && validTimeZone(tz) ? tz : DEFAULT_TIME_ZONE,
    events_role: rows?.[EVENTS_ROLE] || null,
    signup_role: rows?.[SIGNUP_ROLE] || null,
    support_on: rows?.[SUPPORT_ON] !== '0',
    role_labels: Object.fromEntries(ROLES.map((r) => [r, rows?.[roleLabelKey(r)] || ROLE_DEFAULTS[r]])) as Record<Role, string>,
    type_labels: Object.fromEntries(TYPES.map((t) => [t, rows?.[typeLabelKey(t)] || TYPE_DEFAULTS[t]])) as Record<EventType, string>,
  };
}

export const eventSettingOf = (key: string) => EVENT_SETTINGS.find((s) => s.key === key);

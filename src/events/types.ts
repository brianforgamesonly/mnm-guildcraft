// Order 32: the Events module's fixed keys, held once here (docs/PRD.md "Events module"). Types, roles and statuses are
// stored as these keys; an admin renames only a label (src/events/settings.ts). Every list a command or card shows is
// derived from these tables.

export const ROLES = ['tank', 'healer', 'dps', 'support'] as const;
export type Role = (typeof ROLES)[number];
export const ROLE_DEFAULTS: Record<Role, string> = { tank: 'Tank', healer: 'Healer', dps: 'DPS', support: 'Support' };

/** The statuses a member can choose; each type offers some of them. */
export type Choice = 'signed_up' | 'tentative' | 'bench' | 'declined';
/** Every status a sign-up row can hold (migrations/0024 CHECK). */
export type Status = Choice | 'waitlist' | 'left' | 'removed';
/** Who counts as on the roster: the card lists them, and the lock's Left check looks them up. */
export const ON_ROSTER = ['signed_up', 'tentative', 'bench', 'waitlist'] as const satisfies readonly Status[];

export const TYPES = ['raid', 'group', 'social', 'other'] as const;
export type EventType = (typeof TYPES)[number];
export const TYPE_DEFAULTS: Record<EventType, string> = { raid: 'Raid', group: 'Group', social: 'Social', other: 'Other' };

type Need = 'required' | 'optional' | 'none';
export interface TypeRule {
  statuses: readonly Choice[];
  /** Whether a sign-up names a character and a role. */
  character: Need;
  /** Role limits on the event. */
  limits: boolean;
  zone: Need;
  /** The status labels Going and Maybe, stored as signed_up and tentative. */
  casual: boolean;
  /** Hours, the default duration. */
  hours: number;
}

export const TYPE_RULES: Record<EventType, TypeRule> = {
  raid: { statuses: ['signed_up', 'tentative', 'bench', 'declined'], character: 'required', limits: true, zone: 'required', casual: false, hours: 3 },
  group: { statuses: ['signed_up', 'tentative', 'declined'], character: 'required', limits: true, zone: 'optional', casual: false, hours: 2 },
  social: { statuses: ['signed_up', 'tentative', 'declined'], character: 'none', limits: false, zone: 'none', casual: true, hours: 2 },
  other: { statuses: ['signed_up', 'tentative', 'declined'], character: 'optional', limits: false, zone: 'optional', casual: true, hours: 2 },
};

export const LIMIT_COLUMN: Record<Role, 'limit_tank' | 'limit_healer' | 'limit_dps' | 'limit_support'> = { tank: 'limit_tank', healer: 'limit_healer', dps: 'limit_dps', support: 'limit_support' };

// Order 32 (override 1 of order 18's command list, in the same way as order 27's override 4 for /dkp): /event is a
// per-server definition, kept outside COMMANDS. The Worker creates it on one server when an admin presses Add Events
// module (Create Guild Application Command, an upsert) and deletes it on Remove Events module; register-commands upserts
// it after each deploy on every server whose Events module is on. It is never registered globally and never sent in a bulk
// PUT (scripts/discord/dkp.ts). Discord allows 25 options per subcommand, so /event create takes its fields as options and
// needs no modal.
import { EVENT_SETTINGS, LABEL_MAX } from './settings.ts';
import { ROLES, ROLE_DEFAULTS, TYPES, TYPE_DEFAULTS } from './types.ts';

const SUBCOMMAND = 1;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const ROLE = 8;

export const EVENT_NAME = 'event';

export const EVENT_COMMAND = {
  name: EVENT_NAME,
  description: 'Events: raids and get-togethers with sign-ups',
  type: 1,
  contexts: [0],
  options: [
    {
      type: SUBCOMMAND,
      name: 'settings',
      description: 'Admins: Events settings, posted publicly; leave the options out to see them',
      options: [
        { type: STRING, name: 'time_zone', description: 'The server time zone, such as America/New_York', max_length: 64 },
        ...EVENT_SETTINGS.map((s) => ({ type: INTEGER, name: s.key, description: `${s.label}, in ${s.unit}${s.key === 'lock_minutes' ? ' (0: never)' : ''}`, min_value: s.min, max_value: s.max })),
        { type: ROLE, name: 'events_role', description: 'The role that creates events (default: the officer role)' },
        { type: ROLE, name: 'signup_role', description: 'The sign-up role a new event starts with (default: none)' },
        { type: STRING, name: 'clear', description: 'Set a role setting back to its default', choices: [{ name: 'Who creates events', value: 'events_role' }, { name: 'Default sign-up role', value: 'signup_role' }] },
        { type: BOOLEAN, name: 'support', description: 'Whether new sign-ups can choose Support (existing ones stay)' },
        ...ROLES.map((r) => ({ type: STRING, name: `role_${r}`, description: `The label for ${ROLE_DEFAULTS[r]}`, max_length: LABEL_MAX })),
        ...TYPES.map((t) => ({ type: STRING, name: `type_${t}`, description: `The label for ${TYPE_DEFAULTS[t]}`, max_length: LABEL_MAX })),
        { type: STRING, name: 'class', description: 'A class, to set its default role', autocomplete: true, max_length: 32 },
        { type: STRING, name: 'role', description: "That class's default role", choices: [...ROLES.map((r) => ({ name: ROLE_DEFAULTS[r], value: r })), { name: 'None', value: 'none' }] },
      ],
    },
  ],
} as const;

/** "/event sub" with its description, as /help lists it (only where the Events module is on). */
export const EVENT_DEFINED_LIST = EVENT_COMMAND.options.map((o) => ({ cmd: `/${EVENT_NAME} ${o.name}`, command: EVENT_NAME, description: o.description as string }));
export const EVENT_DEFINED = new Set(EVENT_DEFINED_LIST.map((d) => d.cmd));
/** The PRD's /event commands not built yet (test/worker/interactions.test.ts derives them from docs/PRD.md). */
export const EVENT_COMING: string[] = ['/event cancel', '/event create', '/event edit', '/event list', '/event roster'];

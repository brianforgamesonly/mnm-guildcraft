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
const NUMBER = 10;

export const EVENT_NAME = 'event';

const TYPE_OPTION = (required: boolean) => ({ type: STRING, name: 'type', description: 'The kind of event', required, choices: TYPES.map((t) => ({ name: TYPE_DEFAULTS[t], value: t })) });
const EVENT_OPTION = { type: STRING, name: 'event', description: 'The event: pick from the list', required: true, autocomplete: true, max_length: 100 };
const FIELDS = [
  { type: NUMBER, name: 'hours', description: 'How long it runs (default: 3 for a Raid, 2 otherwise)', min_value: 0.5, max_value: 24 },
  { type: STRING, name: 'zone', description: 'The zone: pick from the list (a Raid needs one; a Social takes none)', autocomplete: true, max_length: 100 },
  { type: STRING, name: 'description', description: 'A few words for the card', max_length: 1000 },
  { type: INTEGER, name: 'capacity', description: 'How many can sign up in all', min_value: 0, max_value: 1000 },
  ...ROLES.map((r) => ({ type: INTEGER, name: r, description: `${ROLE_DEFAULTS[r]} limit (Raid and Group)`, min_value: 0, max_value: 1000 })),
  { type: STRING, name: 'when_full', description: 'Where a full event sends a member (default: the waitlist)', choices: [{ name: 'Waitlist', value: 'waitlist' }, { name: 'Bench', value: 'bench' }] },
  { type: ROLE, name: 'signup_role', description: 'Only this role can sign up (default: the server setting)' },
];

export const EVENT_COMMAND = {
  name: EVENT_NAME,
  description: 'Events: raids and get-togethers with sign-ups',
  type: 1,
  contexts: [0],
  options: [
    {
      type: SUBCOMMAND,
      name: 'create',
      description: 'Officers: set up an event; a private preview comes first, with Post and Cancel',
      options: [
        TYPE_OPTION(true),
        { type: STRING, name: 'title', description: 'What the event is called', required: true, max_length: 100 },
        { type: STRING, name: 'start', description: 'Like 2026-11-07 20:00, friday 20:00 or tomorrow 8pm, in the server time zone', required: true, max_length: 40 },
        ...FIELDS,
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'edit',
      description: 'Officers: change an open event; lowering a limit removes nobody',
      options: [
        EVENT_OPTION,
        TYPE_OPTION(false),
        { type: STRING, name: 'title', description: 'What the event is called', max_length: 100 },
        { type: STRING, name: 'start', description: 'A new start; it moves the lock', max_length: 40 },
        ...FIELDS,
        { type: STRING, name: 'clear', description: 'Remove one value', choices: [{ name: 'Capacity', value: 'capacity' }, ...ROLES.map((r) => ({ name: `${ROLE_DEFAULTS[r]} limit`, value: r })), { name: 'Zone', value: 'zone' }, { name: 'Description', value: 'description' }, { name: 'Sign-up role', value: 'signup_role' }] },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'cancel',
      description: 'Officers: cancel an event, with a public reason',
      options: [EVENT_OPTION, { type: STRING, name: 'reason', description: 'Why (shown publicly on the card)', required: true, max_length: 200 }],
    },
    {
      type: SUBCOMMAND,
      name: 'list',
      description: 'Upcoming events, or one event\'s full roster (answers privately)',
      options: [
        { ...TYPE_OPTION(false), description: 'Only this type' },
        { ...EVENT_OPTION, required: false, description: "One event: its full roster" },
        { type: BOOLEAN, name: 'history', description: "Officers: that event's sign-up history" },
      ],
    },
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
export const EVENT_COMING: string[] = ['/event roster'];

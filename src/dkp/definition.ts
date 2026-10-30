// Order 27 (override 4 of order 18's ten commands and order 10's registration scopes): /dkp is a per-server definition,
// kept outside COMMANDS. The Worker creates it on one server when an admin presses Add DKP (Create Guild Application
// Command, an upsert: "Returns 201 if a command with the same name does not already exist, or a 200 if it does") and
// deletes it on Remove DKP; register-commands upserts it after each deploy on every server whose DKP is on. It is never
// registered globally and never sent in a bulk PUT (scripts/discord/dkp.ts). Literals only, so the registration script
// reads this file alone.
import { SETTINGS } from './settings.ts';

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;
const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;
const USER = 6;
const ROLE = 8;

export const DKP_NAME = 'dkp';

export const DKP_COMMAND = {
  name: DKP_NAME,
  description: 'DKP: points for raid attendance, kept per raid zone',
  type: 1,
  contexts: [0],
  options: [
    {
      type: SUBCOMMAND,
      name: 'raid',
      description: 'Officers: open a raid night in GC-DKP (one open raid at a time)',
      options: [
        { type: STRING, name: 'zone', description: 'The raid zone: pick from the list', required: true, autocomplete: true, max_length: 100 },
        { type: STRING, name: 'mode', description: 'Pay per named kill (default), or a flat value once', choices: [{ name: 'Per named kill', value: 'named' }, { name: 'Flat', value: 'flat' }] },
        { type: STRING, name: 'event', description: 'The event to link (default: the one in this zone within an hour of now)', autocomplete: true, max_length: 100 },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'kill',
      description: 'Officers: record a named kill in the open raid (pick, or type a name the data lacks)',
      options: [{ type: STRING, name: 'named', description: 'The named creature', required: true, autocomplete: true, max_length: 100 }],
    },
    {
      type: SUBCOMMAND,
      name: 'correct',
      description: 'Officers: add or remove a member on a kill, or on the whole raid, with a reason',
      options: [
        { type: USER, name: 'member', description: 'The member', required: true },
        { type: STRING, name: 'action', description: 'Add or remove', required: true, choices: [{ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }] },
        { type: STRING, name: 'reason', description: 'Why (shown publicly)', required: true, max_length: 200 },
        { type: INTEGER, name: 'kill', description: 'One kill of the latest raid (leave out: the whole raid)', autocomplete: true },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'history',
      description: "A member's DKP history in one pool, newest first (answers privately)",
      options: [
        { type: USER, name: 'member', description: 'The member (default: you)' },
        { type: STRING, name: 'pool', description: 'The pool (default: the guild pool)', autocomplete: true, max_length: 100 },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'auction',
      description: 'Officers: auction an item (sealed bids; the bot closes it on time and sets the price)',
      options: [
        { type: STRING, name: 'item', description: 'The item: pick from the list', required: true, autocomplete: true, max_length: 100 },
        { type: INTEGER, name: 'minimum', description: 'The minimum bid (default 1)', min_value: 1, max_value: 100000 },
        { type: INTEGER, name: 'minutes', description: 'How long it runs (default: the auction length setting)', min_value: 1, max_value: 10080 },
        { type: BOOLEAN, name: 'general', description: 'The general auction: guild points, open to every member (default: the open raid)' },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'cancel',
      description: 'Officers: cancel an open auction, with a public reason; it reveals the bids',
      options: [
        { type: STRING, name: 'auction', description: 'The open auction: pick from the list', required: true, autocomplete: true, max_length: 100 },
        { type: STRING, name: 'reason', description: 'Why (shown publicly; it reveals the bids)', required: true, max_length: 200 },
      ],
    },
    {
      type: SUBCOMMAND_GROUP,
      name: 'wishlist',
      description: 'Wishlists, public in this server (adding an item opts you in to a direct message)',
      options: [
        {
          type: SUBCOMMAND,
          name: 'add',
          description: 'Add an item to your wishlist (you get a direct message when an auction opens for it)',
          options: [
            { type: STRING, name: 'item', description: 'The item: pick from the list', required: true, autocomplete: true, max_length: 100 },
            { type: STRING, name: 'character', description: 'Which of your characters it is for', autocomplete: true, max_length: 40 },
          ],
        },
        {
          type: SUBCOMMAND,
          name: 'remove',
          description: 'Remove an item from your wishlist',
          options: [{ type: STRING, name: 'item', description: 'The item on your wishlist', required: true, autocomplete: true, max_length: 100 }],
        },
        { type: SUBCOMMAND, name: 'show', description: "A member's wishlist (default: yours)", options: [{ type: USER, name: 'member', description: 'The member (default: you)' }] },
      ],
    },
    {
      type: SUBCOMMAND_GROUP,
      name: 'shop',
      description: 'The shop: items at fixed prices in guild points',
      options: [
        {
          type: SUBCOMMAND,
          name: 'add',
          description: 'Officers: list an item for guild points in GC-DKP (first come, first served)',
          options: [
            { type: STRING, name: 'item', description: 'The item: pick from the list', required: true, autocomplete: true, max_length: 100 },
            { type: INTEGER, name: 'price', description: 'Guild points each', required: true, min_value: 1, max_value: 100000 },
            { type: INTEGER, name: 'quantity', description: 'How many to sell (default 1)', min_value: 1, max_value: 1000 },
            { type: INTEGER, name: 'per_member', description: 'At most this many per member (default 1)', min_value: 1, max_value: 1000 },
          ],
        },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'adjust',
      description: "Officers: change a member's points, with a reason (posted publicly)",
      options: [
        { type: USER, name: 'member', description: 'The member', required: true },
        { type: STRING, name: 'pool', description: 'The pool: a raid zone, or the guild pool', required: true, autocomplete: true, max_length: 100 },
        { type: INTEGER, name: 'points', description: 'Points to add (negative to take away)', required: true, min_value: -100000, max_value: 100000 },
        { type: STRING, name: 'reason', description: 'Why (shown publicly)', required: true, max_length: 200 },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'settings',
      description: 'Admins: DKP settings; leave the options out to see them',
      options: [
        { type: STRING, name: 'setting', description: 'The setting to change', choices: SETTINGS.map((s) => ({ name: s.label, value: s.key })) },
        { type: INTEGER, name: 'value', description: 'Its new value', min_value: 0, max_value: 100000 },
        { type: ROLE, name: 'runner_role', description: 'The role that runs DKP (default: the officer role)' },
      ],
    },
    {
      type: SUBCOMMAND,
      name: 'named-value',
      description: 'Officers: the raid points one named pays, from now on (posted publicly)',
      options: [
        { type: STRING, name: 'zone', description: 'The raid zone', required: true, autocomplete: true, max_length: 100 },
        { type: STRING, name: 'named', description: 'The named creature', required: true, autocomplete: true, max_length: 100 },
        { type: INTEGER, name: 'points', description: 'Raid points it pays', required: true, min_value: 0, max_value: 1000 },
      ],
    },
  ],
} as const;

/** "/dkp sub" with its description, as /help lists it (order 27: only where DKP is on). */
export const DKP_DEFINED_LIST = DKP_COMMAND.options.map((o) => ({ cmd: `/${DKP_NAME} ${o.name}`, command: DKP_NAME, description: o.description as string }));
export const DKP_DEFINED = new Set(DKP_DEFINED_LIST.map((d) => d.cmd));
/** The PRD's /dkp commands not built yet (test/worker/interactions.test.ts derives them from docs/PRD.md): none (order 29, PR D). */
export const DKP_COMING: string[] = [];

// Order 10, ITEM 0.5: every string option across every command, against Discord's client-side rules. An option with
// `choices` accepts only those values ("If you specify choices for an option, they are the only valid values for a
// user to pick"); an autocomplete option is "not confined to only use choices given by the application"
// (docs.discord.com/developers/interactions/application-commands). So choices are kept for closed lists held in
// src/recipes.ts, and every other string option is free text, bounded by max_length where the handler bounds it.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { autocomplete } from '../../src/commands/autocomplete.ts';
import { COMMANDS } from '../../src/commands/definitions.ts';
import { gearFindOptions } from '../../src/gear/options.ts';
import { ACQUISITIONS, REPORT_ISSUES } from '../../src/recipes.ts';
import { ADMIN, as, auto } from '../discord.ts';

const STRING = 3;
type Opt = { type: number; name: string; choices?: readonly { value: string }[]; autocomplete?: boolean; min_length?: number; max_length?: number; options?: readonly Opt[] };
const strings = COMMANDS.flatMap((c) =>
  (c.options as readonly Opt[]).flatMap((s) => (s.options ?? []).filter((o) => o.type === STRING).map((o) => ({ command: c.name, sub: s.name, o }))),
);
/** The closed lists a choice set may come from. Order 13: /gear find's, each derived (src/gear/options.ts). */
const CLOSED = [
  ACQUISITIONS.map(String),
  REPORT_ISSUES.map((i) => i.value),
  ...(gearFindOptions([]).filter((o) => o.choices) as { choices: { value: string }[] }[]).map((o) => o.choices.map((c) => c.value)),
].map((l) => JSON.stringify([...l].sort()));

describe('string options against the client-side rules', () => {
  it('found the options', () => expect(strings.length).toBeGreaterThan(10));

  it('choices only for the closed lists held in src/recipes.ts, never with autocomplete or a length bound', () => {
    for (const { command, sub, o } of strings.filter((x) => x.o.choices)) {
      expect(CLOSED, `/${command} ${sub} ${o.name}`).toContain(JSON.stringify(o.choices!.map((c) => c.value).sort()));
      expect(o.autocomplete ?? false).toBe(false);
      expect(o.min_length ?? o.max_length).toBeUndefined();
    }
  });

  it('no string option demands a minimum length; every max_length fits Discord range 1..6000', () => {
    for (const { o } of strings) {
      expect(o.min_length).toBeUndefined();
      if (o.max_length !== undefined) expect(o.max_length).toBeGreaterThanOrEqual(1), expect(o.max_length).toBeLessThanOrEqual(6000);
    }
  });

  it('every autocomplete option answers a freely typed value (100 characters max per choice), and never throws', async () => {
    const officer = as('100000000000000009', { permissions: ADMIN });
    for (const { command, sub, o } of strings.filter((x) => x.o.autocomplete)) {
      const choices = await autocomplete(env.DB, auto(officer, command, sub, { [o.name]: 'anything typed' }, o.name) as never);
      expect(Array.isArray(choices), `/${command} ${sub} ${o.name}`).toBe(true);
      for (const c of choices) expect(String(c.value).length).toBeLessThanOrEqual(o.max_length ?? 100);
    }
  });
});

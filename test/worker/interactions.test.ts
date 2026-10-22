import { describe, expect, it } from 'vitest';
import prd from '../../docs/PRD.md?raw';
import { DEFINED } from '../../src/commands/definitions.ts';
import { COMING_SOON, HELP_FOOTER, HELP_LIMIT, HELP_LINES, HELP_TEXT } from '../../src/commands/help.ts';
import { APP_ID, as, cmd, exchange, post } from '../discord.ts';

const helpCommand = cmd(as('100000000000000001'), 'craft', 'help');

describe('Discord interactions endpoint', () => {
  it('a valid signature returns 200', async () => {
    expect((await post({ type: 1 })).status).toBe(200);
  });

  it('an invalid signature returns 401', async () => {
    expect((await post({ type: 1 }, { tamper: true })).status).toBe(401);
    expect((await post({ type: 1 }, { noHeaders: true })).status).toBe(401);
  });

  it('PING returns PONG', async () => {
    expect(await (await post({ type: 1 })).json()).toEqual({ type: 1 });
  });

  it('/craft help defers privately (type 5, flag 64), then edits @original with the help text', async () => {
    const { ack, calls } = await exchange(helpCommand);
    expect(ack).toEqual({ type: 5, data: { flags: 64 } });
    expect(calls.map((c) => [c.method, c.url])).toEqual([['PATCH', `https://discord.com/api/v10/webhooks/${APP_ID}/${calls[0].token}/messages/@original`]]);
    // Order 17: the guide is an embed's description (it outgrew a message's 2,000 characters of content).
    expect(calls[0].body.embeds[0].description).toBe(HELP_TEXT);
    expect(calls[0].body.flags).toBeUndefined(); // an edit cannot change visibility; the defer set it
  });

  it('an unknown command returns a polite ephemeral error, never a 500', async () => {
    for (const payload of [
      { type: 2, data: { name: 'roster', options: [{ type: 1, name: 'top' }] } },
      { type: 2, data: { name: 'nonsense' } },
      { type: 3, data: {} },
      { type: 2 },
    ]) {
      const res = await post(payload);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { type: number; data: { content: string; flags: number } };
      expect(body).toMatchObject({ type: 4, data: { flags: 64 } });
      expect(body.data.content).toMatch(/^Sorry/);
    }
  });
});

describe('/craft help copy', () => {
  // Commands are derived from docs/PRD.md, not typed by hand. Two prose matches are not commands:
  // "/auction channel" (an example channel name) and "/character and" (the delivery plan's wording).
  const NOT_COMMANDS = new Set(['/auction channel', '/character and']);
  const prdCommands = [...new Set([...prd.matchAll(/(?:^|[ |(])(\/[a-z]+ [a-z][a-z-]*)/gm)].map((m) => m[1]))].filter((c) => !NOT_COMMANDS.has(c));

  it('lists every command in the PRD', () => {
    expect(prdCommands.length).toBe(23);
    for (const c of prdCommands) expect(HELP_TEXT, c).toContain(c);
  });

  it('marks exactly the commands that are not registered as coming soon', () => {
    const entries = HELP_LINES.filter((l) => typeof l !== 'string');
    for (const e of entries) {
      const built = e.cmds.map((c) => DEFINED.has(c));
      expect(new Set(built).size, `${e.cmds.join(', ')}: one status per entry`).toBe(1);
      const line = HELP_TEXT.split('\n').find((l) => l.startsWith(`\`${e.cmds[0]}\``))!;
      expect(line.endsWith(COMING_SOON), e.cmds[0]).toBe(!built[0]);
    }
    // Every registered subcommand is listed, and the help lists nothing that is not in the PRD.
    for (const c of DEFINED) expect(entries.some((e) => e.cmds.includes(c)), c).toBe(true);
    // Order 13: /gear find is a named departure from the PRD (CHECKLIST A15), the one command beyond it.
    // Order 16: the craft request commands (CHECKLIST A18), named departures from the PRD too.
    // Order 17: /zone (CHECKLIST A16, A19).
    const BEYOND_PRD = ['/gear find', '/craft request', '/craft requests', '/craft notify', '/zone'];
    for (const c of entries.flatMap((e) => e.cmds)) expect([...prdCommands, ...BEYOND_PRD], c).toContain(c);
    expect([...DEFINED].sort()).toEqual([
      '/character add', '/character edit', '/character remove', '/craft find', '/craft forget', '/craft help', '/craft know', '/craft me', '/craft notify', '/craft report',
      '/craft request', '/craft requests', '/craft set', '/craft update', '/gear find', '/guildcraft rebuild-board', '/guildcraft remove-member', '/guildcraft setup', '/guildcraft status', '/item image', '/recipe override',
      '/recipe source', '/roster member', '/roster recipes', '/roster skill', '/roster top', '/zone',
    ]);
    // Order 9: /recipe add is out of scope (override 3), so it alone stays "(coming soon)", derived.
    expect(HELP_TEXT.split('\n').filter((l) => l.endsWith(COMING_SOON))).toEqual([expect.stringMatching(/^`\/recipe add`/)]);
    // Order 7: /guildcraft remove-member is registered, so its "(coming soon)" mark is gone, derived.
    expect(HELP_TEXT.split('\n').find((l) => l.startsWith('`/guildcraft remove-member`'))).not.toContain(COMING_SOON);
    // Order 3: the four search entries lose "(coming soon)" because they are now registered.
    for (const c of ['/craft find', '/roster skill', '/roster member', '/roster top'])
      expect(HELP_TEXT.split('\n').find((l) => l.startsWith(`\`${c}\``))!.endsWith(COMING_SOON), c).toBe(false);
  });

  it('fits one embed description and carries the attribution footer, with no "draft" left (order 11)', () => {
    expect(HELP_TEXT.length).toBeLessThanOrEqual(HELP_LIMIT);
    expect(HELP_TEXT.endsWith('-# Item data: Monsters and Memories Wiki (CC BY-SA 4.0)')).toBe(true);
    expect(HELP_TEXT).toContain(HELP_FOOTER);
    expect(HELP_TEXT).not.toMatch(/draft/i);
  });
});

// Order 11: the copy rules, checked over every source file the Worker ships (the population is the code itself, so a
// file added later is checked too).
const SOURCES = import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('copy rules over src/ (order 11)', () => {
  it('reads every source file', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(30);
  });
  const rules: [string, RegExp][] = [
    ['plurals come from plural() in src/discord.ts', /=== 1 \? '' : 's'|[a-z]\(s\)[ ,.][a-z ]/],
    ['"level", never "lvl" in text', /`[^`]*\blvl \$\{/],
    ['straight apostrophes', /’/],
    ['no DRAFT markers', /\bDRAFT\b/],
    ['no "draft" label in member-facing text', /['"`][^'"`\n]*\bdraft\b/i],
  ];
  it('each rule catches its own example (a control)', () => {
    const bad: [number, string][] = [[0, "`${n} warning${n === 1 ? '' : 's'}`"], [0, "'2 notice(s) over'"], [1, '`lvl ${level}`'], [2, 'the bot’s'], [3, '// DRAFT copy'], [4, "'-# draft — more'"]];
    expect(bad.map(([i, s]) => rules[i][1].test(s))).toEqual(bad.map(() => true));
    // and a lambda's (s) is not a plural
    expect(rules[0][1].test('stmts.map((s) => originals.get(s) ?? s)')).toBe(false);
  });
  for (const [rule, re] of rules)
    it(rule, () => {
      const hits = Object.entries(SOURCES).flatMap(([file, text]) => text.split('\n').flatMap((l, i) => (re.test(l) ? [`${file}:${i + 1}: ${l.trim()}`] : [])));
      expect(hits).toEqual([]);
    });
});

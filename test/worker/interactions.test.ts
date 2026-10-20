import { describe, expect, it } from 'vitest';
import prd from '../../docs/PRD.md?raw';
import { DEFINED } from '../../src/commands/definitions.ts';
import { COMING_SOON, HELP_FOOTER, HELP_LINES, HELP_TEXT } from '../../src/commands/help.ts';
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
    expect(calls[0].body.content).toBe(HELP_TEXT);
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
    for (const c of entries.flatMap((e) => e.cmds)) expect(prdCommands, c).toContain(c);
    expect([...DEFINED].sort()).toEqual([
      '/character add', '/character edit', '/character remove', '/craft find', '/craft help', '/craft me', '/craft set', '/craft update', '/guildcraft rebuild-board',
      '/guildcraft remove-member', '/guildcraft setup', '/guildcraft status', '/roster member', '/roster skill', '/roster top',
    ]);
    // Order 7: /guildcraft remove-member is registered, so its "(coming soon)" mark is gone, derived.
    expect(HELP_TEXT.split('\n').find((l) => l.startsWith('`/guildcraft remove-member`'))).not.toContain(COMING_SOON);
    // Order 3: the four search entries lose "(coming soon)" because they are now registered.
    for (const c of ['/craft find', '/roster skill', '/roster member', '/roster top'])
      expect(HELP_TEXT.split('\n').find((l) => l.startsWith(`\`${c}\``))!.endsWith(COMING_SOON), c).toBe(false);
  });

  it('fits one Discord message and carries the draft footer', () => {
    expect(HELP_TEXT.length).toBeLessThanOrEqual(2000);
    expect(HELP_TEXT).toContain(HELP_FOOTER);
  });
});

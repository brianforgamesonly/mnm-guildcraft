import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import prd from '../../docs/PRD.md?raw';
import { COMMANDS, DEFINED, DEFINED_LIST } from '../../src/commands/definitions.ts';
import { COMING, COMING_SOON, HELP_FOOTER, HELP_PREFIX, helpButton, helpPage, PAGE_OF, pagesFor, pageText, PAGES } from '../../src/commands/help.ts';
import { WELCOME } from '../../src/commands/welcome.ts';
import { HOW_TO_GET_LISTED } from '../../src/board/render.ts';
import { EMBED_LIMITS } from '../../src/discord.ts';
import { NOT_YET } from '../../src/interactions.ts';
import { DKP_COMING, DKP_COMMAND, DKP_DEFINED, DKP_DEFINED_LIST } from '../../src/dkp/definition.ts';
import { EVENT_COMING, EVENT_DEFINED } from '../../src/events/definition.ts';
import { APP_ID, as, exchange, post, press, rawCmd, send, top } from '../discord.ts';

const helpCommand = top(as('100000000000000001'), 'help');

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

  it('/help defers privately (type 5, flag 64), then edits @original with its first page', async () => {
    const { ack, calls } = await exchange(helpCommand);
    expect(ack).toEqual({ type: 5, data: { flags: 64 } });
    expect(calls.map((c) => [c.method, c.url])).toEqual([['PATCH', `https://discord.com/api/v10/webhooks/${APP_ID}/${calls[0].token}/messages/@original`]]);
    expect(calls[0].body.embeds[0].description).toBe(pageText('start'));
    expect(calls[0].body.flags).toBeUndefined(); // an edit cannot change visibility; the defer set it
  });

  it('order 18: the old command names, sent as Discord would, answer "not available" and point to /help', async () => {
    const old: [string, string][] = [
      ['character', 'add'], ['craft', 'set'], ['craft', 'find'], ['craft', 'help'], ['craft', 'request'], ['item', 'image'], ['gear', 'find'], ['recipe', 'source'], ['guildcraft', 'remove-member'],
    ];
    for (const [name, sub] of old) {
      const r = await send(rawCmd(as('100000000000000001'), name, sub));
      expect(r.data.content, `/${name} ${sub}`).toBe(NOT_YET);
    }
    expect(NOT_YET).toContain('`/help`');
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

describe('/help pages (order 18: derived from the definitions)', () => {
  const all = PAGES.map((p) => pageText(p.key)).join('\n');

  it('every registered command and subcommand is on exactly one page, with its own description', () => {
    expect(Object.keys(PAGE_OF).sort()).toEqual(COMMANDS.map((c) => c.name).sort());
    expect(DEFINED_LIST.length).toBe(DEFINED.size);
    for (const d of DEFINED_LIST) {
      const on = PAGES.filter((p) => pageText(p.key).split('\n').includes(`\`${d.cmd}\` ${d.description}`));
      expect(on.map((p) => p.key), d.cmd).toEqual([PAGE_OF[d.command as keyof typeof PAGE_OF]]);
    }
  });

  // The PRD's commands, derived from docs/PRD.md's backticked names, not typed by hand. The order 18 rename table's
  // rows ("old → new") name the old commands on purpose and are left out.
  const current = prd.split('\n').filter((l) => !l.includes('→')).join('\n');
  const prdCommands = [...new Set([...current.matchAll(/`(\/[a-z]+(?: [a-z][a-z-]*)?)[` ]/g)].map((m) => m[1]))];

  it('"coming soon" is exactly the PRD\'s commands that are not built (/recipe add), derived', () => {
    // Order 27: /dkp is a per-server definition; its PRD commands are built (DKP_DEFINED) or due in PR B (DKP_COMING).
    const isDkp = (c: string) => c.startsWith('/dkp ');
    // Order 32: /event likewise (EVENT_DEFINED, or EVENT_COMING until PR C).
    const isEvent = (c: string) => c.startsWith('/event ');
    expect(prdCommands.filter((c) => isEvent(c) && !EVENT_DEFINED.has(c)).sort()).toEqual([...EVENT_COMING].sort());
    expect([...EVENT_DEFINED].filter((c) => !prdCommands.includes(c))).toEqual([]);
    const unbuilt = prdCommands.filter((c) => !isDkp(c) && !isEvent(c) && c !== '/event' && !DEFINED.has(c) && !COMMANDS.some((k) => `/${k.name}` === c));
    expect(COMING.map((c) => c.cmd).sort()).toEqual(unbuilt.sort());
    expect(prdCommands.filter((c) => isDkp(c) && !DKP_DEFINED.has(c)).sort()).toEqual([...DKP_COMING].sort());
    expect([...DKP_DEFINED].filter((c) => !prdCommands.includes(c))).toEqual([]);
    expect(all.split('\n').filter((l) => l.endsWith(COMING_SOON))).toEqual([expect.stringMatching(/^`\/recipe add`/)]);
  });

  it('every command the pages, the welcome and the board index name is registered', () => {
    const named = [...`${all}\n${WELCOME.description}\n${HOW_TO_GET_LISTED}`.matchAll(/`\/([a-z-]+)(?: ([a-z-]+))?/g)];
    expect(named.length).toBeGreaterThan(10);
    for (const [, name, sub] of named) {
      if (COMING.some((c) => c.cmd === `/${name}${sub ? ` ${sub}` : ''}`)) continue;
      // Order 27: /dkp is registered per server, where DKP is on (its page shows only there).
      if (name === 'event') continue; // Order 32: checked against EVENT_DEFINED above, and registered per server.
      const c = [...COMMANDS, DKP_COMMAND].find((k) => k.name === name);
      expect(c, `/${name}`).toBeDefined();
      // Order 29: a subcommand group (type 2) is named as a subcommand is (`/dkp wishlist`).
      const subs = ((c as { options?: readonly { type: number; name: string }[] }).options ?? []).filter((o) => o.type === 1 || o.type === 2).map((o) => o.name);
      if (subs.length && sub) expect(subs, `/${name} ${sub}`).toContain(sub);
    }
  });

  it('each page fits an embed with the attribution footer; six page buttons (seven where DKP is on) in rows of at most 5; no "draft" left', () => {
    for (const dkp of [false, true])
      for (const p of pagesFor(dkp)) {
        const page = helpPage(p.key, dkp);
        expect(page.embeds[0].description!.length, p.key).toBeLessThanOrEqual(EMBED_LIMITS.description / 2);
        expect(page.embeds[0].footer!.text).toBe(HELP_FOOTER);
        expect(page.embeds[0].description).not.toMatch(/draft/i);
        const rows = page.components as { components: { custom_id: string; disabled?: boolean }[] }[];
        expect(rows.flatMap((r) => r.components).length).toBe(dkp ? 7 : 6);
        for (const r of rows) expect(r.components.length).toBeLessThanOrEqual(5);
        expect(rows.flatMap((r) => r.components).filter((b) => b.disabled).map((b) => b.custom_id)).toEqual([`${HELP_PREFIX}${p.key}`]);
      }
    expect(pagesFor(false).map((p) => p.label)).toEqual(['Getting started', 'Finding things', 'Your profile', 'Requests', 'Officers', 'Admins']);
    expect(pagesFor(true).map((p) => p.label).at(-1)).toBe('DKP');
    // Order 27 (override 4): the DKP page lists every /dkp subcommand, each with its own description, and only there.
    for (const d of DKP_DEFINED_LIST) expect(pageText('dkp').split('\n'), d.cmd).toContain(`\`${d.cmd}\` ${d.description}`);
    // A DKP page button where DKP is off goes to the first page.
    expect(helpButton(`${HELP_PREFIX}dkp`, false).data.embeds![0].title).toBe('GuildCraft help · Getting started (1 of 6)');
  });

  it('a page button edits the help in place, for anyone, the member gate included', async () => {
    // A member role is set and this presser lacks it: /help and its pages are open, as before.
    await send(rawCmd(as('100000000000000009', { permissions: String(1 << 3) }), 'guildcraft', 'setup', { member_role: '500000000000000001' }));
    expect((await env.DB.prepare('SELECT member_role_id AS r FROM guild').first<{ r: string }>())!.r).toBe('500000000000000001');
    expect((await send(top(as('100000000000000005'), 'me'))).data.content).toMatch(/is for members with the/); // the gate refuses them
    const r = await send(press(as('100000000000000005'), `${HELP_PREFIX}officers`));
    expect(r.type).toBe(7);
    expect(r.data.embeds![0].title).toBe('GuildCraft help · Officers (5 of 6)');
    expect(r.data.embeds![0].description).toContain('`/officer edit-member`');
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
      // Order 32: one exemption, the stored status value of an event's preview (never shown, migrations/0024's CHECK).
      const stored = (l: string) => l === "export const PREVIEW = 'draft';";
      const hits = Object.entries(SOURCES).flatMap(([file, text]) => text.split('\n').flatMap((l, i) => (re.test(l) && !stored(l) ? [`${file}:${i + 1}: ${l.trim()}`] : [])));
      expect(hits).toEqual([]);
    });
});

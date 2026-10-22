// Order 4, ITEM 1: /roster skill failed live ("didn't respond in time"); every handler that touches D1
// now defers, and its reply arrives through the interaction webhook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, DEFINED } from '../../src/commands/definitions.ts';
import { PAGE_PREFIX, SWITCH_PREFIX } from '../../src/commands/roster.ts';
import { POST_PREFIX } from '../../src/commands/share.ts';
import { BUTTON_PREFIX, MODAL_PREFIX, SELECT_PREFIX } from '../../src/commands/skills.ts';
import { planFor } from '../../src/interactions.ts';
import { deliver, ERROR_REPLY, type Delivery } from '../../src/respond.ts';
import { ephemeral } from '../../src/discord.ts';
import { reset } from '../db.ts';
import { APP_ID, as, auto, cmd, exchange, press, rawCmd, seen, select, submit, webhook } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);

beforeEach(async () => {
  await reset();
  webhook.reset();
});
afterEach(() => vi.restoreAllMocks());

/** The live shape on 2026-10-19: one member, one character (Testchar), Blacksmithing 25. */
async function liveShape() {
  await exchange(cmd(ann, 'character', 'add', { name: 'Testchar', class: 'clr', level: 12 }));
  await exchange(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
}

describe('which interactions defer: every D1 handler, except the answers Discord cannot defer', () => {
  beforeEach(liveShape);

  // Derived from the registered command definitions, not a hand list.
  const commands = [...DEFINED].map((c) => c.slice(1).split(' ') as [string, string | undefined]);

  it('every registered command defers with type 5 and carries the private flag in the defer itself', async () => {
    // Each command's subcommands, or the command itself when it has none (order 17: /zone; order 18: /me, /item ...).
    expect(commands.length).toBe(COMMANDS.reduce((n, c) => n + Math.max(1, ((c as { options?: readonly { type: number }[] }).options ?? []).filter((o) => o.type === 1).length), 0));
    for (const [name, sub] of commands) {
      const { ack, calls } = await exchange(rawCmd(ann, name, sub));
      expect(ack, `/${name} ${sub}`).toEqual({ type: 5, data: { flags: 64 } });
      expect(calls.length, `/${name} ${sub} delivered`).toBeGreaterThan(0);
      for (const c of calls) expect(c.body?.flags, `/${name} ${sub}: an edit never carries flags`).toBeUndefined();
    }
  });

  it('buttons and the tradeskill switcher defer with type 6; a modal submit with type 5, private', async () => {
    for (const id of [`${PAGE_PREFIX}1:0:0`, `${SWITCH_PREFIX}0:0`, `${POST_PREFIX}rt`, `${BUTTON_PREFIX}1`])
      expect(planFor(press(ann, id) as any), id).toEqual({ defer: true, ack: 6, private: true });
    expect((await exchange(press(ann, `${POST_PREFIX}rt`))).ack).toEqual({ type: 6 });
    expect((await exchange(submit(ann, `${MODAL_PREFIX}1`, { 'lvl:1': '5' }))).ack).toEqual({ type: 5, data: { flags: 64 } });
  });

  it('cannot defer: autocomplete (type 8) and the skill select that opens a modal (type 9) answer at once', async () => {
    expect(planFor(auto(ann, 'craft', 'find', { item: 'Tarn' }, 'item') as any)).toEqual({ defer: false });
    expect(planFor(select(ann, `${SELECT_PREFIX}1:0`, ['1']) as any)).toEqual({ defer: false });
    const { ack, calls } = await exchange(select(ann, `${SELECT_PREFIX}1:0`, ['2']));
    expect(ack.type).toBe(9);
    expect(calls).toEqual([]);
  });

  it('Post to channel arrives as a public follow-up; paging edits the component message', async () => {
    const first = await exchange(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing' }));
    const r = seen(first.ack, first.calls);
    const postId = r.data.components![0].components[2].custom_id;
    const pub = await exchange(press(ann, postId));
    expect(pub.calls.map((c) => c.method)).toEqual(['POST']);
    expect(pub.calls[0].body.flags).toBeUndefined();
    const page = await exchange(press(ann, r.data.components![0].components[1].custom_id));
    expect(page.calls.map((c) => c.method)).toEqual(['PATCH']);
    expect(seen(page.ack, page.calls).type).toBe(7);
  });
});

describe('never silent: an exception, or a refused delivery, sends the polite private error', () => {
  /** A D1 binding whose every call throws, standing in for any failure after the defer. */
  const failingDb = new Proxy({}, { get: () => () => { throw new Error('D1 unavailable (test)'); } });
  const broken = { env: { DB: failingDb } };

  it('one forced exception per command group: /character, /craft, /roster, /guildcraft', async () => {
    for (const [name, sub, opts] of [
      ['character', 'add', { name: 'X' }],
      ['craft', 'me', {}],
      ['roster', 'skill', { skill: 'Blacksmithing' }],
      ['guildcraft', 'setup', {}],
    ] as const) {
      const { ack, calls } = await exchange(cmd(ann, name, sub, opts), broken);
      expect(ack, `/${name} ${sub}`).toEqual({ type: 5, data: { flags: 64 } });
      expect(calls.map((c) => [c.method, c.body.content]), `/${name} ${sub}`).toEqual([['PATCH', ERROR_REPLY]]);
    }
  });

  it('a component and a modal submit: a private follow-up, and an edit of the private defer', async () => {
    const button = await exchange(press(ann, `${PAGE_PREFIX}1:0:1`), broken);
    expect(button.calls.map((c) => [c.method, c.body.content, c.body.flags])).toEqual([['POST', ERROR_REPLY, 64]]);
    const modal = await exchange(submit(ann, `${MODAL_PREFIX}1`, { 'lvl:1': '5' }), broken);
    expect(modal.calls.map((c) => [c.method, c.body.content])).toEqual([['PATCH', ERROR_REPLY]]);
  });

  it('the immediate paths: autocomplete gets no suggestions, the modal-opening select the polite error', async () => {
    expect((await exchange(auto(ann, 'craft', 'find', { item: 'T' }, 'item'), broken)).ack).toEqual({ type: 8, data: { choices: [] } });
    expect((await exchange(select(ann, `${SELECT_PREFIX}1:0`, ['1']), broken)).ack).toMatchObject({ type: 4, data: { content: ERROR_REPLY, flags: 64 } });
  });

  it('Discord refuses the edit: the refusal is recorded and the polite error follows', async () => {
    await liveShape();
    let n = 0;
    webhook.status = () => (n++ === 0 ? 400 : 200);
    const errors = vi.spyOn(console, 'error');
    const { calls } = await exchange(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing' }));
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'PATCH']);
    expect(calls[1].body.content).toBe(ERROR_REPLY);
    expect(String(errors.mock.calls.at(-1))).toMatch(/delivery refused.*"status":400.*Invalid Form Body/);
  });

  it('a private reply after a public defer is never shown publicly: delete, then a private follow-up', async () => {
    const log: Delivery[] = [];
    const methods: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => {
      methods.push(`${init?.method} ${JSON.parse(String(init?.body ?? '{}')).flags ?? ''}`.trim());
      return new Response(null, { status: 204 });
    });
    const ok = await deliver({ type: 2, application_id: APP_ID, token: 't' }, { defer: true, ack: 5, private: false }, ephemeral('just for you'), log);
    expect(ok).toBe(true);
    expect(methods).toEqual(['DELETE', 'POST 64']);
  });
});

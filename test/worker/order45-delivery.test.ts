// Order 45: on 2026-11-09 a Change a slot pick (wrs:) showed the slot view after ~10 s and the member also got
// ERROR_REPLY: the edit's answer missed our 10 s abort while Discord applied it. An unanswered edit is now read
// back once (GET @original) before the member is told it failed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DELIVERY_TIMEOUT_MS, editLanded, ERROR_REPLY, READ_TIMEOUT_MS, WAIT_UNTIL_MS } from '../../src/respond.ts';
import { one, reset } from '../db.ts';
import { as, cmd, exchange, seen, select, send, webhook, type WebhookCall } from '../discord.ts';

const ann = as('100000000000000001');
const snowflake = (ms: number) => ((BigInt(ms) - 1420070400000n) << 22n).toString();

beforeEach(async () => {
  await reset();
  webhook.reset();
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
});
afterEach(() => vi.restoreAllMocks());

/** Change a slot → Head on Testchar's panel, as Discord sends it (with the interaction's id). */
async function pickHead() {
  const { id } = await one<{ id: number }>('SELECT id FROM character WHERE name = ?', 'Testchar');
  return exchange({ ...select(ann, `wrs:${id}`, ['head']), id: snowflake(Date.now() - 50) });
}

/** The fake Discord: the edit gets `editStatus`; GET @original returns what the last edit sent, edited now, when `applied`. */
function discord(editStatus: number, applied: boolean) {
  let lastEdit: WebhookCall | undefined;
  webhook.status = (c) => {
    if (c.method === 'PATCH' && !lastEdit) {
      lastEdit = c;
      return editStatus;
    }
    return 200;
  };
  webhook.original = () =>
    applied && lastEdit ? { id: '1', content: lastEdit.body.content, edited_timestamp: new Date().toISOString(), flags: 0 } : { id: '1', content: '**Testchar** · no class · no level · any race', edited_timestamp: null, flags: 0 };
}

describe('order 45: an edit Discord applied is never reported to the member as a failure', () => {
  it('a normal 2xx: one edit, no read-back, no error (unchanged)', async () => {
    const { ack, calls } = await pickHead();
    expect(ack).toEqual({ type: 6 });
    expect(calls.map((c) => c.method)).toEqual(['PATCH']);
    expect(seen(ack, calls).data.content).toMatch(/^\*\*Head:\*\* empty$/m);
  });

  it('the abort fired but Discord applied the edit: read back once, no error; the member sees the slot view', async () => {
    discord(0, true);
    const errors = vi.spyOn(console, 'error');
    const { ack, calls } = await pickHead();
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'GET']);
    expect(calls[1].url).toMatch(/\/messages\/@original$/);
    const member = seen(ack, calls.filter((c) => c.method !== 'GET'));
    expect(member.type).toBe(7);
    expect(member.data.content).toMatch(/^\*\*Head:\*\* empty$/m);
    expect(calls.some((c) => c.body?.content === ERROR_REPLY)).toBe(false);
    expect(errors.mock.calls.some((a) => String(a[0]) === 'interaction failed')).toBe(false);
  });

  it('the abort fired and the edit did not land: the member still gets the error (never silent)', async () => {
    discord(0, false);
    const errors = vi.spyOn(console, 'error');
    const { calls } = await pickHead();
    expect(calls.map((c) => c.method)).toEqual(['PATCH', 'GET', 'POST']);
    expect(calls[2].body).toMatchObject({ content: ERROR_REPLY, flags: 64 });
    expect(String(errors.mock.calls.find((a) => a[0] === 'interaction failed'))).toMatch(/delivery refused.*"op":"edit","status":0.*timeout/);
  });

  it('a 5xx that Discord applied is read back too; a 4xx is a refusal, never read back', async () => {
    discord(502, true);
    expect((await pickHead()).calls.map((c) => c.method)).toEqual(['PATCH', 'GET']);
    webhook.reset();
    discord(400, true);
    const refused = await pickHead();
    expect(refused.calls.map((c) => c.method)).toEqual(['PATCH', 'POST']);
    expect(refused.calls[1].body.content).toBe(ERROR_REPLY);
  });

  it('a read-back that itself fails sends the error', async () => {
    let n = 0;
    webhook.status = (c) => (c.method === 'PATCH' && n++ === 0 ? 0 : c.method === 'GET' ? 0 : 200);
    expect((await pickHead()).calls.map((c) => [c.method, c.body?.content === ERROR_REPLY])).toEqual([['PATCH', false], ['GET', false], ['POST', true]]);
  });
});

describe('editLanded: the read-back judges the edit by its own content and time', () => {
  const t = Date.parse('2026-11-09T19:18:10Z');
  const sent = { content: '**Head:** Copper Chain Coif' };
  it('content and an edit after the interaction: landed', () => {
    expect(editLanded({ content: sent.content, edited_timestamp: '2026-11-09T19:18:20.000Z' }, sent, t, 6)).toBe(true);
  });
  it('an edit from before the interaction, other content, or no time: not landed', () => {
    expect(editLanded({ content: sent.content, edited_timestamp: '2026-11-09T19:17:00.000Z' }, sent, t, 6)).toBe(false);
    expect(editLanded({ content: 'the panel', edited_timestamp: '2026-11-09T19:18:20.000Z' }, sent, t, 6)).toBe(false);
    expect(editLanded({ content: sent.content, edited_timestamp: '2026-11-09T19:18:20.000Z' }, sent, null, 6)).toBe(false);
  });
  it('a type 5 message (created by this interaction) counts once it is no longer "thinking"', () => {
    expect(editLanded({ content: sent.content, edited_timestamp: null, flags: 0 }, sent, t, 5)).toBe(true);
    expect(editLanded({ content: '', edited_timestamp: null, flags: 1 << 7 }, sent, t, 5)).toBe(false);
  });
});

it('the edit, its read-back and the error follow-up fit inside waitUntil (30 s)', () => {
  expect(2 * DELIVERY_TIMEOUT_MS + READ_TIMEOUT_MS).toBeLessThan(WAIT_UNTIL_MS);
});

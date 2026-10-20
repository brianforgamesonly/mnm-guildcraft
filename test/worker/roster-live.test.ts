// Order 4, ITEM 1.2: the failing live request, reproduced. /roster skill at 21:05:56Z on 2026-10-19 got
// "didn't respond in time" although the Worker logged ok, HTTP 200, 268 ms. Live shape: one member, one
// character (Testchar), Blacksmithing 25. This file imports only the test harness, so the same file runs
// against the old code (red at fec541a) and the new (green).
import { beforeEach, describe, expect, it } from 'vitest';
import { reset } from '../db.ts';
import { APP_ID, as, cmd, exchange, seen } from '../discord.ts';

const ann = as('100000000000000001');

beforeEach(async () => {
  await reset();
  await exchange(cmd(ann, 'character', 'add', { name: 'Testchar', class: 'clr', level: 12 }));
  await exchange(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
});

describe('/roster skill on the live data shape', () => {
  it('acknowledges at once with a private defer, then edits @original with the roster, never with content ""', async () => {
    const { ack, calls } = await exchange(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing' }));
    // fec541a answered with an immediate type 4 carrying content "": the only reply in the Worker that sent "".
    expect(ack).toEqual({ type: 5, data: { flags: 64 } });
    expect(calls.map((c) => [c.method, c.url])).toEqual([['PATCH', `https://discord.com/api/v10/webhooks/${APP_ID}/${calls[0]?.token}/messages/@original`]]);
    expect('content' in calls[0].body).toBe(false);
    const r = seen(ack, calls);
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds![0]).toEqual({ title: 'Blacksmithing: 1 character', description: '**1.** **Testchar** 25 · CLR level 12', footer: { text: 'Page 1 of 1' } });
  });

  it('min_level above everyone: the polite empty roster, delivered the same way', async () => {
    const { ack, calls } = await exchange(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing', min_level: 30 }));
    expect(ack).toEqual({ type: 5, data: { flags: 64 } });
    const r = seen(ack, calls);
    expect(r.data.embeds![0].title).toBe('Blacksmithing: 0 characters at 30+');
    expect(r.data.embeds![0].description).toBe('No one in the guild has recorded Blacksmithing at 30+ yet.');
  });
});

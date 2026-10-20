// Order 9, ITEM 2 (FR-7 as amended by override 4): /craft report, the Report a problem modal, the report card in the
// review channel (a mocked Discord: never a live post), Mark fixed / Dismiss, the no-review-channel case, the limit.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_OPEN_REPORTS } from '../../src/commands/reports.ts';
import { all, count, markImported, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, exchange, GUILD, press, send } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
const officer = as('100000000000000009', { permissions: ADMIN });
const REVIEW = '600000000000000010';
const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const at = '2026-10-19T00:00:00Z';
let posted: { path: string; body: any }[];
let swordId: number;

beforeEach(async () => {
  await env.DB.batch(['recipe_correction_component', 'recipe_correction', 'recipe_report', 'recipe_component', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await reset(['Blacksmithing']);
  swordId = (await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Copper Sword', 'copper sword', 'wiki', ?)").bind(at).run()).meta.last_row_id;
  await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, source, imported_at) VALUES ('k1', (SELECT id FROM tradeskill), ?, 20, 'wiki', ?)").bind(swordId, at).run();
  await markImported();
  await send(cmd(ann, 'character', 'add', { name: 'Annsmith' }), TOKEN);
  posted = [];
  botApi.handle = (method, path, body) => {
    if (method === 'POST' && /^\/channels\/\d+\/messages$/.test(path)) {
      posted.push({ path, body });
      return new Response(JSON.stringify({ id: '555000000000000001' }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'not faked', code: 0 }), { status: 404 });
  };
});
afterEach(() => botApi.reset());

const report = (o: Record<string, unknown> = {}) => send(cmd(ann, 'craft', 'report', { item: 'Copper Sword', issue: 'trivial', ...o }), TOKEN);

describe('/craft report', () => {
  it('saves the report and posts a card in the review channel with Mark fixed and Dismiss', async () => {
    await env.DB.prepare('UPDATE guild SET review_channel_id = ?').bind(REVIEW).run();
    const r = await report({ details: 'It is 25 now' });
    expect(r.data.content).toBe('Thanks: your report on **Copper Sword** (Wrong trivial) is saved. Your officers have it to review.');
    expect(await all('SELECT item_id, reporter, issue, details, status FROM recipe_report')).toEqual([{ item_id: swordId, reporter: ANN, issue: 'trivial', details: 'It is 25 now', status: 'open' }]);
    expect(posted).toHaveLength(1);
    const card = posted[0];
    expect(card.path).toBe(`/channels/${REVIEW}/messages`);
    expect(card.body.embeds[0].title).toBe('Report: Copper Sword');
    expect(card.body.embeds[0].description).toMatch(/^\*\*Issue:\*\* Wrong trivial\n\*\*From:\*\* <@100000000000000001> · <t:\d+:f>\n\*\*Details:\*\* It is 25 now$/);
    expect(card.body.components[0].components.map((b: any) => [b.label, b.custom_id])).toEqual([['Mark fixed', expect.stringMatching(/^rpf:\d+$/)], ['Dismiss', expect.stringMatching(/^rpd:\d+$/)]]);
    expect(card.body.allowed_mentions).toEqual({ parse: [] });
  });

  it('with no review channel the report is still saved, and status shows it', async () => {
    const r = await report({ issue: 'source' });
    expect(r.data.content).toBe('Thanks: your report on **Copper Sword** (Wrong source (how it is obtained)) is saved for your officers.');
    expect(posted).toHaveLength(0);
    expect(await count('recipe_report')).toBe(1);
    const s = await send(cmd(officer, 'guildcraft', 'status'), TOKEN);
    expect(s.data.content).toContain('**Waiting for officers:** 1 open report · 0 pending screenshots (no vault channel: `/guildcraft setup vault:`)');
  });

  it(`at most ${MAX_OPEN_REPORTS} open reports per member`, async () => {
    for (let i = 0; i < MAX_OPEN_REPORTS; i++) await report();
    expect((await report()).data.content).toBe('You already have 5 reports waiting for an officer. Once one is marked fixed or dismissed you can file another.');
    expect(await count('recipe_report')).toBe(MAX_OPEN_REPORTS);
  });
});

describe('the Report a problem button', () => {
  it('opens a modal at once (type 9, never deferred) with the issue select inside a Label', async () => {
    const { ack, calls } = await exchange(press(ann, `rpt:${swordId}`), TOKEN);
    expect(calls).toEqual([]);
    expect(ack.type).toBe(9);
    const data = ack.data as any;
    expect(data.custom_id).toBe(`rptm:${swordId}`);
    expect(data.components.map((c: any) => [c.type, c.component.type, c.component.custom_id])).toEqual([[18, 3, 'issue'], [18, 4, 'details']]);
    expect(data.components[0].component.options.map((o: any) => o.label)).toEqual(['Wrong trivial', 'Wrong ingredients','Wrong source (how it is obtained)', 'Missing recipe', 'Other']);
  });

  it('the submit files the same report, item pre-filled', async () => {
    const submit = { type: 5, guild_id: GUILD, member: ann, data: { custom_id: `rptm:${swordId}`, components: [{ type: 18, component: { type: 3, custom_id: 'issue', values: ['components'] } }, { type: 18, component: { type: 4, custom_id: 'details', value: '' } }] } };
    const r = await send(submit, TOKEN);
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('your report on **Copper Sword** (Wrong ingredients) is saved');
    expect(await all('SELECT issue, details FROM recipe_report')).toEqual([{ issue: 'components', details: null }]);
  });
});

describe('Mark fixed and Dismiss', () => {
  it('officers only; the card shows who acted and when, and loses its buttons; the reporter is not messaged', async () => {
    await env.DB.prepare('UPDATE guild SET review_channel_id = ?').bind(REVIEW).run();
    await report();
    const id = posted[0].body.components[0].components[0].custom_id as string;
    expect((await send(press(ann, id), TOKEN)).data.content).toBe('Only officers can do that.');
    const before = posted.length;
    const done = await send(press(officer, id), TOKEN);
    expect(done.type).toBe(7);
    expect(done.data.content).toMatch(/^✅ Marked fixed by <@100000000000000009> · <t:\d+:f>$/);
    expect(done.data.components).toEqual([]);
    expect(done.data.embeds![0].title).toBe('Report: Copper Sword');
    expect(posted.length).toBe(before); // no message to the reporter
    expect(await all('SELECT status, resolved_by FROM recipe_report')).toEqual([{ status: 'fixed', resolved_by: '100000000000000009' }]);
    await report({ issue: 'other' });
    const dismiss = posted.at(-1)!.body.components[0].components[1].custom_id as string;
    expect((await send(press(officer, dismiss), TOKEN)).data.content).toMatch(/^✖️ Dismissed by <@100000000000000009>/);
  });
});

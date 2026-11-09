// Work order 18, PR A2: the /me panel and /officer edit-member. Every press on a panel for someone else re-checks the
// officer role; Add character, Notices and Forget a recipe are the member's own.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CLASS_NOT_LISTED } from '../../src/commands/character.ts';
import { ME_COPY } from '../../src/commands/me.ts';
import { OFFICER_ONLY } from '../../src/commands/members.ts';
import { WELCOME } from '../../src/commands/welcome.ts';
import { planFor } from '../../src/interactions.ts';
import { NO_REQUEST_CHANNEL } from '../../src/requests.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, as, cmd, GUILD, press, select, send, submit, type Member, type Reply } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const ann = as(ANN);
const bo = as(BO);
const officer = as('100000000000000009', { permissions: ADMIN });
const at = '2026-10-19T00:00:00Z';

const me = (m: Member = ann, options: Record<string, unknown> = {}) =>
  send({ type: 2, guild_id: GUILD, member: m, data: { name: 'me', options: Object.entries(options).map(([name, value]) => ({ type: 3, name, value })) } });
const buttons = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components);
const byLabel = (r: Reply, label: string) => buttons(r).find((b: any) => b.label === label);
const add = (name: string, m: Member = ann) => send(cmd(m, 'character', 'add', { name }));

beforeEach(() => reset());

describe('/me', () => {
  it('no characters: the welcome once, Add character, and Notices (notices are per member, not per character)', async () => {
    const r = await me();
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toBe(ME_COPY.noCharacters);
    expect(r.data.embeds!.filter((e) => e.title === WELCOME.title).length).toBe(1);
    expect(buttons(r).map((b: any) => b.label)).toEqual([ME_COPY.add, ME_COPY.notices]);
  });

  it("the panel: characters, skills, notices and requests, inside Discord's limits (5 rows, 5 buttons a row)", async () => {
    await add('Testchar');
    await add('Alt');
    await send(cmd(ann, 'craft', 'set', { skill: 'Brewing', level: 7 }));
    const r = await me();
    expect(r.data.embeds!.map((e) => e.title)).toEqual(['Testchar (main)', 'Alt']);
    expect(r.data.embeds![0].description).toContain('**Brewing** 7');
    expect(r.data.content).toContain('**Craft request notices:** off');
    expect(r.data.content).toContain(ME_COPY.noRequests);
    const rows = r.data.components!;
    // Order 35: a third row, Gear for each character shown.
    expect(rows.map((row: any) => row.components.map((b: any) => b.label))).toEqual([
      [ME_COPY.add, ME_COPY.edit, ME_COPY.remove, ME_COPY.update],
      [ME_COPY.notices, ME_COPY.forget],
      [ME_COPY.gear('Testchar'), ME_COPY.gear('Alt')],
    ]);
    expect(rows.length).toBeLessThanOrEqual(5);
    for (const row of rows) expect(row.components.length).toBeLessThanOrEqual(5);
    expect(buttons(r).length).toBe(8);
    // A custom_id is at most 100 characters.
    for (const b of buttons(r)) expect(b.custom_id.length).toBeLessThanOrEqual(100);
    // character: shows one.
    expect((await me(ann, { character: 'Alt' })).data.embeds!.map((e) => e.title)).toEqual(['Alt']);
  });

  it('Add character: a modal at once (never deferred); its form adds the character, class picked from the menu', async () => {
    await env.DB.prepare("INSERT INTO game_race (code, item_count, bit, mount) VALUES ('HUM', 5, 0, 0)").run();
    const id = byLabel(await me(), ME_COPY.add).custom_id;
    expect(planFor(press(ann, id) as any)).toEqual({ defer: false });
    const modal = await send(press(ann, id));
    expect(modal.type).toBe(9);
    expect(modal.data.title).toBe(ME_COPY.addTitle);
    // Order 39: the class is a select in a Label, the form still 5 components; nothing picked on Add.
    const comps = (modal.data as any).components;
    expect(comps.length).toBe(5);
    const cls = comps.find((c: any) => c.component?.custom_id === 'class');
    expect(cls.type).toBe(18);
    expect(cls.component.type).toBe(3);
    // The derived list (game_class codes on items: OLD has none), by name, valued by code, after No class.
    expect(cls.component.options.map((o: any) => [o.label, o.value])).toEqual([[ME_COPY.noClass, 'none'], ['Cleric', 'CLR'], ['Shadow Knight', 'SHD'], ['Wizard', 'WIZ']]);
    expect(cls.component.options.some((o: any) => o.default)).toBe(false);
    const done = await send(submit(ann, modal.data.custom_id!, { name: 'Testchar', class: 'SHD', level: '12' }));
    expect(done.data.content).toMatch(/^Added \*\*Testchar\*\* · Shadow Knight · level 12 · any race\. It is your main/);
    expect(await one('SELECT class, level, is_main FROM character')).toEqual({ class: 'SHD', level: 12, is_main: 1 });
    const bad = await send(submit(ann, modal.data.custom_id!, { name: 'Other', level: 'abc' }));
    expect(bad.data.content).toBe('Level must be a whole number from 1 to 100.');
    // A value that isn't a code from the list (a stale or forged form) is refused, and nothing is saved.
    expect((await send(submit(ann, modal.data.custom_id!, { name: 'Other', class: 'Ranger' }))).data.content).toBe(CLASS_NOT_LISTED('Ranger'));
    expect(await count('character')).toBe(1);
  });

  it('order 39: Edit pre-picks a known class; an unknown stored class is not offered, nothing is picked, and an untouched menu keeps it', async () => {
    await add('Testchar');
    const id = (await one<{ id: number }>('SELECT id FROM character')).id;
    await env.DB.prepare("UPDATE character SET class = 'WIZ' WHERE id = ?").bind(id).run();
    const classOpts = async () => ((await send(press(ann, byLabel(await me(), ME_COPY.edit).custom_id))).data as any).components.find((c: any) => c.component?.custom_id === 'class').component.options;
    expect((await classOpts()).filter((o: any) => o.default).map((o: any) => o.value)).toEqual(['WIZ']);
    // No class saved: No class is picked.
    await env.DB.prepare('UPDATE character SET class = NULL WHERE id = ?').bind(id).run();
    expect((await classOpts()).filter((o: any) => o.default).map((o: any) => o.value)).toEqual(['none']);
    // Banakil's case: a class saved as typed before order 39.
    await env.DB.prepare("UPDATE character SET class = 'Halfling' WHERE id = ?").bind(id).run();
    const opts = await classOpts();
    expect(opts.some((o: any) => o.default)).toBe(false);
    expect(opts.map((o: any) => o.value)).not.toContain('Halfling');
    // Saved with the menu left alone (it sends nothing): the class is kept, the level changes.
    await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: '', level: '18', main: '' }));
    expect(await one('SELECT class, level FROM character WHERE id = ?', id)).toEqual({ class: 'Halfling', level: 18 });
    // Review fix: a known code stored in lower case is pre-picked, and the untouched menu (it sends the code) changes nothing.
    await env.DB.prepare("UPDATE character SET class = 'wiz' WHERE id = ?").bind(id).run();
    expect((await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: 'WIZ', level: '18', main: '' }))).data.content).toBe(ME_COPY.nothingChanged);
    expect(await one('SELECT class FROM character WHERE id = ?', id)).toEqual({ class: 'wiz' });
    // Picking a class fixes it; No class clears it.
    await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: 'CLR', level: '', main: '' }));
    expect(await one('SELECT class FROM character WHERE id = ?', id)).toEqual({ class: 'CLR' });
    await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: 'none', level: '', main: '' }));
    expect(await one('SELECT class FROM character WHERE id = ?', id)).toEqual({ class: null });
  });

  it('Edit character: one character opens its form at once; several ask which first; the form changes what changed', async () => {
    await add('Testchar');
    const one1 = await send(press(ann, byLabel(await me(), ME_COPY.edit).custom_id));
    expect(one1.type).toBe(9);
    await add('Alt');
    const pick = await send(press(ann, byLabel(await me(), ME_COPY.edit).custom_id));
    expect(pick.type).toBe(4);
    expect(pick.data.content).toBe(ME_COPY.pickEdit);
    const sel = pick.data.components![0].components[0];
    expect(sel.options.map((o: any) => o.label)).toEqual(['Testchar (main)', 'Alt']);
    expect(planFor(select(ann, sel.custom_id, [sel.options[1].value]) as any)).toEqual({ defer: false });
    const modal = await send(select(ann, sel.custom_id, [sel.options[1].value]));
    expect(modal.type).toBe(9);
    const done = await send(submit(ann, modal.data.custom_id!, { name: 'Altana', class: '', level: '20', main: 'yes' }));
    expect(done.data.content).toBe('Updated **Altana** · no class · level 20 · any race (was **Alt**). It is now your main.');
    expect((await send(submit(ann, modal.data.custom_id!, { name: 'Altana', class: '', level: '20', main: 'yes' }))).data.content).toBe(ME_COPY.nothingChanged);
  });

  it('Remove character and Update skills: a select of the characters, then the old handlers', async () => {
    await add('Testchar');
    await add('Alt');
    const rm = await send(press(ann, byLabel(await me(), ME_COPY.remove).custom_id));
    const rmSel = rm.data.components![0].components[0];
    const removed = await send(select(ann, rmSel.custom_id, [rmSel.options[1].value]));
    expect(removed.type).toBe(7);
    expect(removed.data.content).toMatch(/^Removed \*\*Alt\*\*/);
    // One character left: Update skills opens /craft update's select directly.
    const up = await send(press(ann, byLabel(await me(), ME_COPY.update).custom_id));
    expect(up.data.content).toBe('Pick up to 5 tradeskills for **Testchar**. A form then opens with a level box for each.');
  });

  it('Notices: says so without a request channel; with one, the tradeskill selects set the notices', async () => {
    await add('Testchar');
    const id = byLabel(await me(), ME_COPY.notices).custom_id;
    expect((await send(press(ann, id))).data.content).toBe(NO_REQUEST_CHANNEL);
    await env.DB.prepare('UPDATE guild SET request_channel_id = ? WHERE id = ?').bind('700000000000000001', GUILD).run();
    const view = await send(press(ann, id));
    const sel = view.data.components![0].components[0];
    expect(sel.options.map((o: any) => o.label)).toEqual(['Alchemy', 'Blacksmithing', 'Brewing', 'Fletching', 'Tailoring']);
    expect(sel.min_values).toBe(0);
    const picked = await send(select(ann, sel.custom_id, [sel.options[1].value, sel.options[4].value]));
    expect(picked.type).toBe(7);
    expect(picked.data.content).toContain('**Craft request notices:** Blacksmithing, Tailoring');
    await send(select(ann, sel.custom_id, [sel.options[4].value]));
    expect((await all<{ name: string }>('SELECT t.name FROM craft_notify n JOIN tradeskill t ON t.id = n.tradeskill_id')).map((r) => r.name)).toEqual(['Tailoring']);
  });

  it('Forget a recipe: the recipes marked known, then unmarked', async () => {
    await add('Testchar');
    const item = await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Brew Cask', 'brew cask', 'wiki', ?)").bind(at).run();
    const r = await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, source, imported_at) VALUES ('m1', (SELECT id FROM tradeskill WHERE name = 'Brewing'), ?, 10, 'wiki', ?)").bind(item.meta.last_row_id, at).run();
    await send(cmd(ann, 'craft', 'know', { recipe: `#${r.meta.last_row_id}` }));
    const view = await send(press(ann, byLabel(await me(), ME_COPY.forget).custom_id));
    const sel = view.data.components![0].components[0];
    expect(sel.options.map((o: any) => [o.label, o.description])).toEqual([['Brew Cask · Brewing', 'Testchar']]);
    const done = await send(select(ann, sel.custom_id, [sel.options[0].value]));
    expect(done.data.content).toBe('**Testchar** no longer has **Brew Cask · Brewing · trivial 10** marked known.');
    expect(await count('character_recipe')).toBe(0);
    await env.DB.batch(['character_recipe', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  });

  it('Cancel a request: the open requests, with the Cancel select', async () => {
    await add('Testchar');
    await env.DB.prepare('UPDATE guild SET request_channel_id = ? WHERE id = ?').bind('700000000000000001', GUILD).run();
    const item = await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Brew Cask', 'brew cask', 'wiki', ?)").bind(at).run();
    const req = await env.DB.prepare("INSERT INTO craft_request (guild_id, requester, status, created_at, opened_at, thread_id) VALUES (?, ?, 'open', ?, ?, '710000000000000001')").bind(GUILD, ANN, at, at).run();
    await env.DB.prepare('INSERT INTO craft_request_item (request_id, position, item_id, quantity) VALUES (?, 1, ?, 2)').bind(req.meta.last_row_id, item.meta.last_row_id).run();
    const panel = await me();
    expect(panel.data.content).toContain(ME_COPY.requestsHead);
    expect(panel.data.content).toContain('Brew Cask ×2');
    const view = await send(press(ann, byLabel(panel, ME_COPY.cancel).custom_id));
    expect(view.data.components![0].components[0].custom_id).toBe('rql:');
    await env.DB.batch(['craft_request_item', 'craft_request', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  });
});

describe('/officer edit-member: the member\'s panel for an officer, re-checked on every press', () => {
  it('opens the panel without the member-only buttons; an edit is recorded as the officer\'s', async () => {
    await add('Testchar');
    const r = await send(cmd(officer, 'officer', 'edit-member', { member: ANN }));
    // Order 42: the member named once, by saved name, never as a mention as well.
    expect(r.data.content).toMatch(/^\*\*Acting for Global 100000000000000001\.\*\*/);
    expect(r.data.content).not.toContain('<@100000000000000001>');
    // Order 35: the same Gear button on the member's character.
    expect(buttons(r).map((b: any) => b.label)).toEqual([ME_COPY.edit, ME_COPY.remove, ME_COPY.update, ME_COPY.gear('Testchar')]);
    const modal = await send(press(officer, byLabel(r, ME_COPY.edit).custom_id));
    expect(modal.type).toBe(9);
    await send(submit(officer, modal.data.custom_id!, { name: 'Testchar', class: '', level: '30', main: 'yes' }));
    expect(await one("SELECT actor FROM audit_log WHERE action = 'character.edit'")).toEqual({ actor: '100000000000000009' });
    expect(await one('SELECT level FROM character')).toEqual({ level: 30 });
  });

  it('an officer without the member role can still use a member\'s panel; "No" on the main keeps the other changes', async () => {
    await add('Testchar');
    await env.DB.prepare('UPDATE guild SET member_role_id = ? WHERE id = ?').bind('600000000000000001', GUILD).run();
    const panel = await send(cmd(officer, 'officer', 'edit-member', { member: ANN }));
    const modal = await send(press(officer, byLabel(panel, ME_COPY.edit).custom_id));
    expect(modal.type).toBe(9);
    // Order 39: the officer's form has the same class menu.
    expect((modal.data as any).components.find((c: any) => c.component?.custom_id === 'class').component.type).toBe(3);
    const done = await send(submit(officer, modal.data.custom_id!, { name: 'Testchar', class: 'SHD', level: '', main: 'no' }));
    expect(done.data.content).toMatch(/^Updated \*\*Testchar\*\* · Shadow Knight · /);
    expect(await one('SELECT class, is_main FROM character')).toEqual({ class: 'SHD', is_main: 1 });
  });

  it('a member who is not an officer gets nowhere with copied buttons or forms of another member\'s panel', async () => {
    await add('Testchar');
    const panel = await me();
    for (const label of [ME_COPY.edit, ME_COPY.remove, ME_COPY.update])
      expect((await send(press(bo, byLabel(panel, label).custom_id))).data.content, label).toBe(OFFICER_ONLY);
    for (const label of [ME_COPY.add, ME_COPY.notices, ME_COPY.forget])
      expect((await send(press(bo, byLabel(panel, label).custom_id))).data.content, label).toBe(ME_COPY.ownOnly);
    const ch = await one<{ id: number }>('SELECT id FROM character');
    expect((await send(submit(bo, `meem:${ch.id}`, { name: 'Stolen' }))).data.content).toBe(OFFICER_ONLY);
    expect((await send(select(bo, `mers:${ANN}`, [String(ch.id)]))).data.content).toBe(OFFICER_ONLY);
    expect((await send(cmd(bo, 'officer', 'edit-member', { member: ANN }))).data.content).toBe(OFFICER_ONLY);
    expect(await one('SELECT name, deleted_at FROM character')).toEqual({ name: 'Testchar', deleted_at: null });
  });
});

// Work order 35, PR B (ITEM 1's character part, ITEM 4): race on characters, and saved gear (src/gear/wear.ts).
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { ME_COPY } from '../../src/commands/me.ts';
import { WEAR_COPY, WEAR_SLOTS, MATCH_MAX, PANEL_PICK_PREFIX, PANEL_PREFIX } from '../../src/gear/wear.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';
import { planFor } from '../../src/interactions.ts';
import { count, one, reset } from '../db.ts';
import { ADMIN, as, auto, cmd, press, rawCmd, select, send, submit, type Member, type Reply } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const ann = as(ANN);
const bo = as(BO);
const officer = as('100000000000000009', { permissions: ADMIN, nick: 'Joegandomi' });

// Class bits: CLR 0, INQ 1, WIZ 2. Race bits: HUM 0, ELF 1; HRS 2 is a mount race.
const CLS = { CLR: 1, INQ: 2, WIZ: 4 } as const;
const RACE = { HUM: 1, ELF: 2 } as const;
const slot = (...t: (typeof SLOTS)[number][]) => t.reduce((m, s) => m | bitOf(SLOTS, s), 0);

const items: [string, number, number, number, string | null][] = [
  // name, slot_mask, class_mask, race_mask, handed
  ['Copper Breastplate', slot('CHEST'), CLS.CLR | CLS.INQ, -1, null],
  ['Enchanted Copper Plate Breastplate', slot('CHEST'), CLS.CLR | CLS.INQ, -1, null],
  ["Academy Student's Robe", slot('CHEST'), CLS.WIZ, -1, null],
  ['Elf Tunic', slot('CHEST'), -1, RACE.ELF, null],
  ['Copper Greatsword', slot('PRIMARY'), -1, -1, 'Two Handed'],
  ['Short Sword', slot('PRIMARY', 'SECONDARY'), -1, -1, 'One Handed'],
  ['Buckler', slot('SECONDARY'), -1, -1, null],
  ['Gold Ring', slot('FINGER'), -1, -1, null],
  ['Silver Ring', slot('FINGER'), -1, -1, null],
  ['Bronze Ring', slot('FINGER'), -1, -1, null],
  ['Neck Or Back Charm', slot('NECK', 'BACK'), -1, -1, null],
  ['Wizard Hat', slot('HEAD'), CLS.WIZ, -1, null],
  ...Array.from({ length: 30 }, (_, i): [string, number, number, number, null] => [`Leather Cap ${String(i).padStart(2, '0')}`, slot('HEAD'), -1, -1, null]),
  // One item per slot token, for "each slot".
  ...[...new Set(WEAR_SLOTS.map((w) => w.token))].map((t): [string, number, number, number, null] => [`Plain ${t.toLowerCase()} thing`, slot(t), -1, -1, null]),
];

beforeEach(async () => {
  await reset(undefined, [['CLR', 10], ['INQ', 10], ['WIZ', 10]]);
  await env.DB.batch([
    env.DB.prepare("UPDATE game_class SET bit = CASE code WHEN 'CLR' THEN 0 WHEN 'INQ' THEN 1 WHEN 'WIZ' THEN 2 END"),
    env.DB.prepare("INSERT INTO game_race (code, item_count, bit, mount) VALUES ('HUM', 5, 0, 0), ('ELF', 5, 1, 0), ('HRS', 9, 2, 1)"),
    env.DB.prepare('DELETE FROM item'),
    ...items.map(([name, sm, cm, rm, handed]) =>
      env.DB.prepare("INSERT INTO item (name, name_key, slot, stats_json, source, imported_at, slot_mask, class_mask, race_mask) VALUES (?, ?, 'X', ?, 'wiki', 't', ?, ?, ?)").bind(
        name, name.toLowerCase(), handed ? JSON.stringify({ handed }) : null, sm, cm, rm,
      ),
    ),
  ]);
});

const add = (name: string, m: Member = ann) => send(cmd(m, 'character', 'add', { name }));
const charId = async (name: string) => (await one<{ id: number }>('SELECT id FROM character WHERE name = ?', name)).id;
const itemId = async (name: string) => (await one<{ id: number }>('SELECT id FROM item WHERE name = ?', name)).id;
const set = (name: string, cls: string | null, race: string | null = null) => env.DB.prepare('UPDATE character SET class = ?, race = ? WHERE name = ?').bind(cls, race, name).run();
const wear = (m: Member, o: Record<string, unknown>) => send(rawCmd(m, 'gear', 'wear', o));
const box = async (m: Member, char: string, slotKey: string, text: string) => send(submit(m, `wrm:${await charId(char)}:${slotKey}`, { item: text }));
const panel = async (m: Member, char: string) => send(press(m, `${PANEL_PREFIX}${await charId(char)}`));
const worn = async (char: string) =>
  Object.fromEntries(
    (await env.DB.prepare('SELECT slot, item_key FROM character_gear WHERE character_id = ? ORDER BY slot').bind(await charId(char)).all<{ slot: string; item_key: string }>()).results.map((r) => [r.slot, r.item_key]),
  );
const options = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components).find((c: any) => c.options)?.options as { label: string; value: string; description?: string }[];
/** Order 39: a reply's components, flat; its first line; whether Change a slot shows its prompt (no default option). */
const flat = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components) as any[];
const first = (r: Reply) => (r.data.content ?? '').split('\n')[0];
/** Order 44: what the member reads, the content then each embed's text (the panel's lines are in its embed). */
const seenText = (r: Reply) => [r.data.content ?? '', ...(r.data.embeds ?? []).map((e) => e.description ?? '')].join('\n');
const atPrompt = (r: Reply, id: number) => !flat(r).find((c) => c.custom_id === `wrs:${id}`).options.some((o: any) => o.default);
/** Order 39: the box's pick list (wrk:), on the slot view under Change a slot. */
const matches = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components).find((c: any) => c.custom_id?.startsWith('wrk:'))?.options as { label: string; value: string; description?: string }[];

describe('order 35, ITEM 1: race on characters', () => {
  it('Add and Edit character offer the race (mount races left out), set it and clear it', async () => {
    await send(rawCmd(ann, 'me', undefined));
    const form = await send(press(ann, `mea:${ANN}`));
    expect(form.type).toBe(9);
    const race = (form.data as any).components.find((c: any) => c.component?.custom_id === 'race').component;
    expect(race.options.map((o: any) => o.value)).toEqual(['none', 'HUM', 'ELF']); // HRS is a mount race; order 36: by name (Human, Wood Elf)
    expect((form.data as any).components.length).toBeLessThanOrEqual(5);
    await send(submit(ann, `meam:${ANN}`, { name: 'Testchar', class: 'INQ', level: '15', race: 'HUM' }));
    expect(await one('SELECT race FROM character WHERE name = ?', 'Testchar')).toEqual({ race: 'HUM' });
    const id = await charId('Testchar');
    // The card shows it.
    // Order 36: the name, from the code map; order 39: the one head, the race once, without "race".
    expect((await send(rawCmd(ann, 'me', undefined))).data.embeds![0].description).toContain('Inquisitor · level 15 · Human');
    await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: 'INQ', level: '', main: '', race: 'ELF' }));
    expect(await one('SELECT race FROM character WHERE id = ?', id)).toEqual({ race: 'ELF' });
    await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: 'INQ', level: '', main: '', race: 'none' }));
    expect(await one('SELECT race FROM character WHERE id = ?', id)).toEqual({ race: null });
    // A mount race (or anything not in the list) is refused, even typed by hand.
    const r = await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: 'INQ', level: '', main: '', race: 'HRS' }));
    expect(r.data.content).toContain("isn't a race in the list");
  });

  it('/officer edit-member sets it, recorded as the officer\'s', async () => {
    await add('Testchar');
    const id = await charId('Testchar');
    await send(submit(officer, `meem:${id}`, { name: 'Testchar', class: '', level: '', main: '', race: 'HUM' }));
    expect(await one('SELECT race FROM character WHERE id = ?', id)).toEqual({ race: 'HUM' });
    expect(await one("SELECT actor FROM audit_log WHERE action = 'character.edit'")).toEqual({ actor: '100000000000000009' });
  });

  it('a character with no race matches every item; with one, a race-limited item is refused', async () => {
    await add('Testchar');
    expect((await wear(ann, { item: 'Elf Tunic' })).data.content).toContain('**Chest:** Elf Tunic');
    await set('Testchar', null, 'HUM');
    await env.DB.prepare('DELETE FROM character_gear').run();
    expect((await wear(ann, { item: 'Elf Tunic' })).data.content).toBe(`${WEAR_COPY.raceRefused('HUM', 'Elf Tunic')}`);
  });
});

describe('order 35, ITEM 4: the Gear panel and changing a slot', () => {
  it('every one of the 20 slots saves (box, exact name), and the panel counts them', async () => {
    await add('Testchar');
    const empty = await panel(ann, 'Testchar');
    expect(seenText(empty)).toContain(WEAR_COPY.filled(0));
    expect(options(empty).map((o) => o.value)).toEqual(WEAR_SLOTS.map((w) => w.key));
    for (const w of WEAR_SLOTS) {
      const r = await box(ann, 'Testchar', w.key, `plain ${w.token.toLowerCase()} thing`);
      expect(r.data.content, w.key).toContain(`**${w.label}:** Plain ${w.token.toLowerCase()} thing (was empty)`);
    }
    expect(seenText(await panel(ann, 'Testchar'))).toContain(WEAR_COPY.filled(20));
  });

  it('order 39: the slot select updates the panel in place (deferred, no modal) to the slot view, the select at its prompt; Type the item opens the box', async () => {
    await add('Testchar');
    const id = await charId('Testchar');
    expect(planFor(select(ann, `wrs:${id}`, ['shirt']) as any)).toEqual({ defer: true, ack: 6, private: true });
    const view = await send(select(ann, `wrs:${id}`, ['shirt']));
    expect(view.type).toBe(7); // an update of the panel, never a new message
    expect(view.data.content).toBe(`**Testchar** · no class · no level · any race\n${WEAR_COPY.slotLine('Shirt', WEAR_COPY.slotEmpty)}`);
    const comps = flat(view);
    // Change a slot is redrawn with no default option, so the client shows its prompt again.
    const slotSel = comps.find((c: any) => c.custom_id === `wrs:${id}`);
    expect(slotSel.placeholder).toBe(WEAR_COPY.changeSlot);
    expect(slotSel.options.some((o: any) => o.default)).toBe(false);
    // Empty slot only when the slot is filled.
    expect(comps.filter((c: any) => c.type === 2).map((b: any) => [b.label, b.custom_id])).toEqual([[WEAR_COPY.typeItem, `wrt:${id}:shirt`], [WEAR_COPY.back, `wrv:${id}`]]);
    expect(planFor(press(ann, `wrt:${id}:shirt`) as any)).toEqual({ defer: false });
    const modal = await send(press(ann, `wrt:${id}:shirt`));
    expect(modal.type).toBe(9);
    expect((modal.data as any).custom_id).toBe(`wrm:${id}:shirt`);
    // Back: the panel, in place.
    const back = await send(press(ann, `wrv:${id}`));
    expect(back.type).toBe(7);
    expect(seenText(back)).toContain(WEAR_COPY.filled(0));
  });

  it('order 39: the box submit updates the panel in place with the saved line as its note; a blank box (or Empty slot) empties it', async () => {
    await add('Testchar');
    const id = await charId('Testchar');
    expect(planFor(submit(ann, `wrm:${id}:chest`, { item: 'x' }) as any)).toEqual({ defer: true, ack: 6, private: true });
    const saved = await box(ann, 'Testchar', 'chest', 'copper breastplate');
    expect(saved.type).toBe(7);
    // Order 44: the note and the head are the content; the filled line and the 20 lines are the panel's one embed.
    expect(saved.data.content).toBe([WEAR_COPY.saved('Chest', 'Copper Breastplate', null), '**Testchar** · no class · no level · any race'].join('\n'));
    expect(saved.data.embeds!.map((e) => e.description)).toEqual([
      [WEAR_COPY.filled(1), '', ...WEAR_SLOTS.map((w) => `${w.label}: ${w.key === 'chest' ? 'Copper Breastplate' : WEAR_COPY.empty}`)].join('\n'),
    ]);
    expect(atPrompt(saved, id)).toBe(true);
    // The slot view of a filled slot offers Empty slot; it empties in place.
    const view = await send(select(ann, `wrs:${id}`, ['chest']));
    expect(view.data.content).toContain(WEAR_COPY.slotLine('Chest', 'Copper Breastplate'));
    const emptied = await send(press(ann, `wre:${id}:chest`));
    expect(emptied.type).toBe(7);
    expect(first(emptied)).toBe(WEAR_COPY.emptied('Chest', 'Copper Breastplate'));
    await box(ann, 'Testchar', 'chest', 'copper breastplate');
    const r = await box(ann, 'Testchar', 'chest', '   ');
    expect(r.type).toBe(7);
    expect(first(r)).toBe(WEAR_COPY.emptied('Chest', 'Copper Breastplate'));
    expect(await worn('Testchar')).toEqual({});
    expect(first(await box(ann, 'Testchar', 'chest', ''))).toBe(WEAR_COPY.alreadyEmpty('Chest'));
  });

  it('order 39: refusals, no match and the pick list answer on the slot view, in place; the presser refused gets a private message', async () => {
    await add('Testchar');
    await set('Testchar', 'WIZ');
    const id = await charId('Testchar');
    const refused = await box(ann, 'Testchar', 'chest', 'copper breastplate');
    expect(refused.type).toBe(7);
    expect((refused.data.content ?? '').split('\n')).toEqual([WEAR_COPY.classRefused('WIZ', 'Copper Breastplate'), '**Testchar** · Wizard · no level · any race', WEAR_COPY.slotLine('Chest', WEAR_COPY.slotEmpty)]);
    const none = await box(ann, 'Testchar', 'chest', 'zzz');
    expect(none.type).toBe(7);
    expect(first(none)).toBe(WEAR_COPY.noMatch('Chest', 'zzz'));
    const noFit = await send(select(ann, `wrk:${id}:secondary`, [String(await itemId('Copper Breastplate'))]));
    expect(noFit.type).toBe(7);
    expect(first(noFit)).toBe(WEAR_COPY.noFit('Copper Breastplate', 'Secondary'));
    // Another member's copied box: refused privately, as a new message (the panel isn't theirs to change).
    const other = await send(submit(bo, `wrm:${id}:chest`, { item: 'buckler' }));
    expect(other.type).toBe(4);
    expect(other.data.content).toBe(WEAR_COPY.notYours);
    for (const r of [refused, none, noFit]) expect(atPrompt(r, id)).toBe(true);
    // Review: Empty slot and Back from someone else's copied panel are refused privately, and change nothing.
    await box(ann, 'Testchar', 'head', 'wizard hat');
    for (const cid of [`wre:${id}:head`, `wrv:${id}`]) {
      const r = await send(press(bo, cid));
      expect(r.type).toBe(4);
      expect(r.data.content).toBe(WEAR_COPY.notYours);
    }
    expect(await worn('Testchar')).toEqual({ head: 'wizard hat' });
  });

  it('the box: one exact match saves; several are a menu by name, told apart by slot and classes; over 24 says how many more; none offers the box again', async () => {
    await add('Testchar');
    const exact = await box(ann, 'Testchar', 'chest', 'ENCHANTED copper plate breastplate');
    expect(exact.data.content).toContain('**Chest:** Enchanted Copper Plate Breastplate (was empty)');
    const several = await box(ann, 'Testchar', 'chest', 'copper');
    expect(several.type).toBe(7);
    expect(matches(several).map((o) => o.label)).toEqual(['Copper Breastplate', 'Enchanted Copper Plate Breastplate']);
    expect(matches(several)[0].description).toBe('X · CLR INQ');
    const picked = await send(select(ann, `wrk:${await charId('Testchar')}:chest`, [String(await itemId('Copper Breastplate'))]));
    expect(picked.type).toBe(7);
    expect(picked.data.content).toContain('**Chest:** Copper Breastplate (replaced Enchanted Copper Plate Breastplate)');
    expect(seenText(picked)).toContain(WEAR_COPY.filled(1));
    const many = await box(ann, 'Testchar', 'head', 'leather cap');
    expect(matches(many).length).toBe(MATCH_MAX + 1);
    expect(matches(many)[MATCH_MAX]).toMatchObject({ label: WEAR_COPY.more(30 - MATCH_MAX), value: 'more' });
    const none = await box(ann, 'Testchar', 'chest', 'zzz');
    expect(first(none)).toBe(WEAR_COPY.noMatch('Chest', 'zzz'));
    // Order 39: no match answers on the slot's view (the panel, in place), with Type the item.
    expect(flat(none).find((c) => c.custom_id?.startsWith('wrt:')).label).toBe(WEAR_COPY.typeItem);
    expect((await send(press(ann, `wrt:${await charId('Testchar')}:chest`))).type).toBe(9);
    // Two items can't share a name: item.name_key is unique (the import keeps the first of a case-only pair).
    await expect(env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('copper BREASTPLATE', 'copper breastplate', 'wiki', 't')").run()).rejects.toThrow(/UNIQUE/);
  });

  it('a class change keeps the gear and marks what it can no longer use; the item gone upstream is shown as no longer listed', async () => {
    await add('Testchar');
    await set('Testchar', 'INQ');
    await box(ann, 'Testchar', 'chest', 'copper breastplate');
    await box(ann, 'Testchar', 'primary', 'short sword');
    await set('Testchar', 'WIZ');
    const p = await panel(ann, 'Testchar');
    expect(seenText(p)).toContain(`Chest: Copper Breastplate ${WEAR_COPY.cantUse('WIZ')}`);
    expect(seenText(p)).toContain('Primary: Short Sword\n');
    await env.DB.prepare("UPDATE item SET gone_at = 't' WHERE name = 'Short Sword'").run();
    expect(seenText(await panel(ann, 'Testchar'))).toContain(`Primary: Short Sword ${WEAR_COPY.noLongerListed}`);
    expect(await worn('Testchar')).toEqual({ chest: 'copper breastplate', primary: 'short sword' });
  });

  it('a removed character\'s panel and buttons say it no longer exists', async () => {
    await add('Testchar');
    const id = await charId('Testchar');
    await send(cmd(ann, 'character', 'remove', { name: 'Testchar' }));
    expect((await send(press(ann, `${PANEL_PREFIX}${id}`))).data.content).toBe(WEAR_COPY.gone);
    expect((await send(submit(ann, `wrm:${id}:chest`, { item: 'buckler' }))).data.content).toBe(WEAR_COPY.gone);
    // Review fix: the slot select and Type again check first, before any box opens.
    expect((await send(select(ann, `wrs:${id}`, ['chest']))).data.content).toBe(WEAR_COPY.gone);
    expect((await send(press(ann, `wrt:${id}:chest`))).data.content).toBe(WEAR_COPY.gone);
  });

  it('wrg: (more than 5 characters): /me offers one Gear select; the pick opens that character\'s panel, re-checked', async () => {
    for (const n of ['Aa', 'Bb', 'Cc', 'Dd', 'Ee', 'Ff']) await add(n);
    const r = await send(rawCmd(ann, 'me', undefined));
    const sel = (r.data.components as any).flatMap((x: any) => x.components).find((c: any) => c.custom_id?.startsWith(PANEL_PICK_PREFIX));
    expect(sel.custom_id).toBe(`${PANEL_PICK_PREFIX}${ANN}`);
    expect(sel.options.length).toBe(6);
    expect((await send(select(ann, sel.custom_id, [String(await charId('Ff'))]))).data.content).toContain('**Ff**');
    expect((await send(select(bo, sel.custom_id, [String(await charId('Ff'))]))).data.content).toBe(WEAR_COPY.notYours);
  });

  it('review fixes: a race the list no longer offers is kept by an unrelated edit; a gone item is never saved anew', async () => {
    await add('Testchar');
    const id = await charId('Testchar');
    await set('Testchar', null, 'OLD');
    const form = await send(press(ann, `mee:${ANN}`));
    const race = (form.data as any).components.find((c: any) => c.component?.custom_id === 'race').component;
    expect(race.options.find((o: any) => o.default).value).toBe('OLD');
    await send(submit(ann, `meem:${id}`, { name: 'Testchar', class: '', level: '20', main: '', race: 'OLD' }));
    expect(await one('SELECT race, level FROM character WHERE id = ?', id)).toEqual({ race: 'OLD', level: 20 });
    await env.DB.prepare("UPDATE item SET gone_at = 't' WHERE name = 'Buckler'").run();
    expect((await wear(ann, { item: 'Buckler' })).data.content).toBe(WEAR_COPY.noItem('Buckler'));
    expect((await send(press(ann, `wri:${await itemId('Buckler')}`))).data.content).toBe(WEAR_COPY.itemGone);
  });
});

describe('order 35, ITEM 4: /gear wear and the rules', () => {
  it('a paired slot fills the empty side, and asks only when both are filled', async () => {
    await add('Testchar');
    expect((await wear(ann, { item: 'Gold Ring' })).data.content).toContain('**Finger 1:** Gold Ring');
    expect((await wear(ann, { item: 'Silver Ring' })).data.content).toContain('**Finger 2:** Silver Ring');
    const ask = await wear(ann, { item: 'Bronze Ring' });
    expect(ask.data.content).toBe(WEAR_COPY.bothFull('Bronze Ring'));
    expect(options(ask).map((o) => o.value)).toEqual(['finger1', 'finger2']);
    const done = await send(select(ann, `wrz:${await charId('Testchar')}:${await itemId('Bronze Ring')}`, ['finger2']));
    expect(done.data.content).toContain('**Finger 2:** Bronze Ring (replaced Silver Ring)');
  });

  it('an item that fits two slots asks which; slot: given skips the question', async () => {
    await add('Testchar');
    const ask = await wear(ann, { item: 'Neck Or Back Charm' });
    expect(ask.data.content).toBe(WEAR_COPY.pickSlot('Neck Or Back Charm'));
    expect(options(ask).map((o) => o.value)).toEqual(['neck', 'back']);
    expect((await wear(ann, { item: 'Neck Or Back Charm', slot: 'back' })).data.content).toContain('**Back:** Neck Or Back Charm');
    expect((await wear(ann, { item: 'Buckler', slot: 'chest' })).data.content).toBe(WEAR_COPY.noFit('Buckler', 'Chest'));
  });

  it('class refused, with the reason (Brian\'s check: an Inquisitor and a wizard\'s robe)', async () => {
    await add('Testchar');
    await set('Testchar', 'INQ');
    expect((await wear(ann, { item: "Academy Student's Robe" })).data.content).toBe(WEAR_COPY.classRefused('INQ', "Academy Student's Robe"));
    expect(await worn('Testchar')).toEqual({});
  });

  it('a two-hander empties Secondary and says so; Secondary is refused under a two-hander', async () => {
    await add('Testchar');
    const empty = await wear(ann, { item: 'Copper Greatsword' });
    expect(empty.data.content).toContain('**Primary:** Copper Greatsword (was empty)');
    expect(empty.data.content).toContain(WEAR_COPY.twoHandEmpty);
    expect((await wear(ann, { item: 'Buckler' })).data.content).toBe(WEAR_COPY.underTwoHand('Copper Greatsword'));
    await wear(ann, { item: 'Short Sword', slot: 'primary' });
    await wear(ann, { item: 'Buckler' });
    const swap = await wear(ann, { item: 'Copper Greatsword' });
    expect(swap.data.content).toContain(WEAR_COPY.twoHandEmptied('Buckler'));
    expect(await worn('Testchar')).toEqual({ primary: 'copper greatsword' });
  });

  it('with several characters, character: is needed; only the caller\'s own; an unknown item says so', async () => {
    await add('Testchar');
    await add('Alt');
    await add('Bochar', bo);
    expect((await wear(ann, { item: 'Buckler' })).data.content).toBe(WEAR_COPY.severalCharacters(['Testchar', 'Alt']));
    expect((await wear(ann, { item: 'Buckler', character: 'Bochar' })).data.content).toContain('no character named');
    expect((await wear(ann, { item: 'Buckler', character: 'alt' })).data.content).toContain('**Secondary:** Buckler');
    expect((await wear(ann, { item: 'Nothing Like It', character: 'Alt' })).data.content).toBe(WEAR_COPY.noItem('Nothing Like It'));
  });

  it('autocomplete: item: filtered to gear the character: value can use; character: lists only the caller\'s own', async () => {
    await add('Inqchar');
    await add('Wizchar');
    await add('Bochar', bo);
    await set('Inqchar', 'INQ');
    await set('Wizchar', 'WIZ');
    const names = async (character: string) =>
      ((await send(auto(ann, 'gear', 'wear', { item: '', character }, 'item'))).data as any).choices.map((c: any) => c.value) as string[];
    expect(await names('Inqchar')).not.toContain("Academy Student's Robe");
    expect(await names('Inqchar')).toContain('Copper Breastplate');
    expect(await names('Wizchar')).toContain("Academy Student's Robe");
    expect(await names('Wizchar')).not.toContain('Copper Breastplate');
    const typed = ((await send(auto(ann, 'gear', 'wear', { item: 'acad', character: 'Inqchar' }, 'item'))).data as any).choices;
    expect(typed).toEqual([]);
    const chars = ((await send(auto(ann, 'gear', 'wear', { character: '' }, 'character'))).data as any).choices.map((c: any) => c.value);
    expect(chars.sort()).toEqual(['Inqchar', 'Wizchar']);
  });

  it('Order 35 rule: an old-shape /gear (options, no subcommand) is answered as /gear search, identically, until re-registration', async () => {
    const opts = { class: 'INQ', slot: 'CHEST' };
    const old = rawCmd(ann, 'gear', undefined, opts);
    // Routed (deferred like any routed command), never "not available".
    expect(planFor(old as any)).toEqual(planFor(rawCmd(ann, 'gear', 'search', opts) as any));
    expect(planFor(old as any)).toMatchObject({ defer: true });
    // A first command carries the one-time welcome: /me takes it, so both search replies compare without it.
    await send(rawCmd(ann, 'me', undefined));
    const sub = await send(rawCmd(ann, 'gear', 'search', opts));
    const flat = await send(old);
    expect(flat.data.content ?? '').not.toContain("isn't available");
    expect(flat.data.embeds!.length).toBeGreaterThan(0);
    expect(JSON.stringify(flat.data.embeds)).toContain('Copper Breastplate');
    expect(JSON.stringify(flat.data.embeds)).not.toContain("Academy Student's Robe");
    expect(flat.data.embeds).toEqual(sub.data.embeds);
    // Its zone autocomplete too (src/commands/autocomplete.ts).
    expect((await send(auto(ann, 'gear', undefined, { zone: '' }, 'zone'))).type).toBe(8);
  });
});

describe("order 35, ITEM 4: I'm wearing this", () => {
  it('on the /item card for wearable gear only; with one character it saves', async () => {
    await add('Testchar');
    const card = await send(rawCmd(ann, 'item', undefined, { name: 'Copper Greatsword' }));
    const b = (card.data.components as any).flatMap((r: any) => r.components).find((x: any) => x.label === WEAR_COPY.wearingButton);
    expect(b.custom_id).toBe(`wri:${await itemId('Copper Greatsword')}`);
    await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Rock', 'rock', 'wiki', 't')").run();
    const rock = await send(rawCmd(ann, 'item', undefined, { name: 'Rock' }));
    expect((rock.data.components as any).flatMap((r: any) => r.components).some((x: any) => x.label === WEAR_COPY.wearingButton)).toBe(false);
    const r = await send(press(ann, b.custom_id));
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('**Primary:** Copper Greatsword (was empty)');
    expect(r.data.content).toContain(WEAR_COPY.twoHandEmpty);
  });

  it('with two characters it asks which; pressed by another member it saves to theirs, never the card owner\'s', async () => {
    await add('Testchar');
    await add('Alt');
    const id = await itemId('Buckler');
    const ask = await send(press(ann, `wri:${id}`));
    expect(ask.data.content).toBe(WEAR_COPY.pickCharacter);
    expect(options(ask).map((o) => o.label)).toEqual(['Testchar (main)', 'Alt']);
    expect((await send(select(ann, `wrc:${id}`, [String(await charId('Alt'))]))).data.content).toContain('**Secondary:** Buckler');
    // Bo, on the same card: no characters yet, then their own.
    expect((await send(press(bo, `wri:${id}`))).data.content).toContain('no characters');
    await add('Bochar', bo);
    expect((await send(press(bo, `wri:${id}`))).data.content).toContain('**Secondary:** Buckler');
    expect(await worn('Bochar')).toEqual({ secondary: 'buckler' });
    // A crafted select naming Ann's character, pressed by Bo, is refused.
    expect((await send(select(bo, `wrc:${id}`, [String(await charId('Testchar'))]))).data.content).toBe(WEAR_COPY.ownOnly);
    expect(await worn('Testchar')).toEqual({});
  });
});

describe('order 35, ITEM 4: who, and removal', () => {
  it('/officer edit-member sees the Gear button and changes it, named in the reply and the row; another member can\'t', async () => {
    await add('Testchar');
    const view = await send(cmd(officer, 'officer', 'edit-member', { member: ANN }));
    const gear = (view.data.components as any).flatMap((r: any) => r.components).find((x: any) => x.label === ME_COPY.gear('Testchar'));
    expect(seenText(await send(press(officer, gear.custom_id)))).toContain(WEAR_COPY.filled(0));
    const r = await box(officer, 'Testchar', 'chest', 'copper breastplate');
    expect(r.data.content).toContain('**Chest:** Copper Breastplate');
    expect(r.data.content).toContain(WEAR_COPY.changedBy('Joegandomi'));
    expect(await one('SELECT set_by FROM character_gear')).toEqual({ set_by: '100000000000000009' });
    expect((await send(press(bo, gear.custom_id))).data.content).toBe(WEAR_COPY.notYours);
    expect((await box(bo, 'Testchar', 'chest', '')).data.content).toBe(WEAR_COPY.notYours);
    expect(await count('character_gear')).toBe(1);
  });

  it('Remove character, /officer remove-member and the departure notice\'s Remove take the gear with the character', async () => {
    await add('Testchar');
    await add('Alt');
    await wear(ann, { item: 'Buckler', character: 'Testchar' });
    await wear(ann, { item: 'Gold Ring', character: 'Alt' });
    await send(cmd(ann, 'character', 'remove', { name: 'Testchar' }));
    expect(await count('character_gear')).toBe(1);
    await send(press(officer, `rm:yes:${ANN}`));
    expect(await count('character_gear')).toBe(0);
    // The departure notice: Bo has left, with gear.
    await add('Bochar', bo);
    await wear(bo, { item: 'Buckler' });
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(BO).run();
    await send(press(officer, `dep:remove:${BO}`));
    expect(await count('character_gear')).toBe(0);
  });
});

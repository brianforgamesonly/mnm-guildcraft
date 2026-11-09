// Work order 44: the Gear panel's worn items link to their wiki pages, and View an item opens a worn item's /item card.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { characterHead } from '../../src/commands/character.ts';
import { OPENS_MODAL, planFor, SUBMITS_IN_PLACE } from '../../src/interactions.ts';
import { OPEN_PREFIX, UPGRADES_COPY } from '../../src/gear/upgrades.ts';
import { panelText, PANEL_PREFIX, VIEW_PREFIX, WEAR_COPY, WEAR_SLOTS } from '../../src/gear/wear.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';
import { linkUrl } from '../../src/gear/wiki-link.ts';
import { EMBED_LIMITS, md } from '../../src/discord.ts';
import { markImported, one, reset } from '../db.ts';
import { ADMIN, as, cmd, exchange, press, select, send, submit, type Reply } from '../discord.ts';

const ann = as('100000000000000001');
const bo = as('100000000000000002');
const officer = as('100000000000000009', { permissions: ADMIN, nick: 'Joegandomi' });
const WIKI = 'https://monstersandmemories.miraheze.org/wiki/';
const CLS = { CLR: 1, INQ: 2, WIZ: 4 } as const;
type Tok = (typeof SLOTS)[number];
const slot = (...t: Tok[]) => t.reduce((m, s) => m | bitOf(SLOTS, s), 0);
const HEAD = '**Testchar** · no class · no level · any race';

// name, slots, wiki_url, class_mask
const ITEMS: [string, Tok[], string | null, number][] = [
  ['Green Drakeling Scale Coat', ['CHEST'], `${WIKI}Green_Drakeling_Scale_Coat`, -1],
  ['Blacktide Earring', ['EAR'], `${WIKI}Blacktide_Earring`, -1],
  ['Plain Http Cap', ['HEAD'], 'http://example.org/Plain_Http_Cap', -1],
  ['No Page Cloak', ['BACK'], null, -1],
  ['Gone Gloves', ['HANDS'], `${WIKI}Gone_Gloves`, -1],
  ['Wizard Sash', ['WAIST'], `${WIKI}Wizard_Sash`, CLS.WIZ],
  ['Archer Bow (Faelindral)', ['RANGE'], `${WIKI}Archer_Bow_(Faelindral)`, -1],
  ['Copper Breastplate', ['CHEST'], `${WIKI}Copper_Breastplate`, -1],
];

beforeEach(async () => {
  await reset(undefined, [['CLR', 10], ['INQ', 10], ['WIZ', 10]]);
  await env.DB.batch([
    env.DB.prepare("UPDATE game_class SET bit = CASE code WHEN 'CLR' THEN 0 WHEN 'INQ' THEN 1 WHEN 'WIZ' THEN 2 END"),
    env.DB.prepare('DELETE FROM item'),
    ...ITEMS.map(([name, t, url, cm]) =>
      env.DB.prepare("INSERT INTO item (name, name_key, slot, stats_json, source, imported_at, slot_mask, class_mask, race_mask, wiki_url) VALUES (?, ?, 'X', '{\"ac\":3}', 'wiki', 't', ?, ?, -1, ?)").bind(
        name, name.toLowerCase(), slot(...t), cm, url,
      ),
    ),
  ]);
  await markImported();
});

const add = (name: string, m = ann) => send(cmd(m, 'character', 'add', { name }));
const charId = async (name = 'Testchar') => (await one<{ id: number }>('SELECT id FROM character WHERE name = ?', name)).id;
const itemId = async (name: string) => (await one<{ id: number }>('SELECT id FROM item WHERE name = ?', name)).id;
const wearIt = async (slotKey: string, key: string) =>
  env.DB.prepare("INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, '900000000000000001', ?, ?, 't', 'x')").bind(await charId(), slotKey, key.toLowerCase()).run();
const panel = async (m = ann) => send(press(m, `${PANEL_PREFIX}${await charId()}`));
const flat = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components) as any[];
const viewMenu = (r: Reply) => flat(r).find((c) => c.custom_id?.startsWith(VIEW_PREFIX));
const lineOf = (r: Reply, label: string) => r.data.embeds![0].description!.split('\n').find((l) => l.startsWith(`${label}: `));

/** The mixed panel: linked, http, no page, gone, can't use, a missing row, parentheses, and one item in both ears. */
async function mixed() {
  await add('Testchar');
  await env.DB.prepare("UPDATE character SET class = 'WIZ' WHERE name = 'Testchar'").run();
  await wearIt('chest', 'Green Drakeling Scale Coat');
  await wearIt('ear1', 'Blacktide Earring');
  await wearIt('ear2', 'Blacktide Earring');
  await wearIt('head', 'Plain Http Cap');
  await wearIt('back', 'No Page Cloak');
  await wearIt('hands', 'Gone Gloves');
  await wearIt('waist', 'Wizard Sash');
  await wearIt('range', 'Archer Bow (Faelindral)');
  await wearIt('feet', 'Boots The Data Never Had');
  await env.DB.prepare("UPDATE item SET gone_at = 't' WHERE name = 'Gone Gloves'").run();
  // The can't-use mark: the coat made INQ-only, so this Wizard can't use it (Wizard Sash, WIZ-only, it can).
  await env.DB.prepare('UPDATE item SET class_mask = ? WHERE name = ?').bind(CLS.INQ, 'Green Drakeling Scale Coat').run();
}

describe('order 44, ITEM 1: wiki links on the worn items', () => {
  it('each listed name links (https only), unbolded, its marks kept; gone, missing, http and no-page names stay plain', async () => {
    await mixed();
    const p = await panel();
    expect(p.data.content).toBe('**Testchar** · Wizard · no level · any race');
    expect(p.data.embeds).toHaveLength(1);
    expect(lineOf(p, 'Chest')).toBe(`Chest: [Green Drakeling Scale Coat](${WIKI}Green_Drakeling_Scale_Coat) ${WEAR_COPY.cantUse('WIZ')}`);
    expect(lineOf(p, 'Ear 1')).toBe(`Ear 1: [Blacktide Earring](${WIKI}Blacktide_Earring)`);
    expect(lineOf(p, 'Ear 2')).toBe(`Ear 2: [Blacktide Earring](${WIKI}Blacktide_Earring)`);
    expect(lineOf(p, 'Waist')).toBe(`Waist: [Wizard Sash](${WIKI}Wizard_Sash)`);
    // Parentheses in the address are encoded, so the link doesn't end early (the gear index's helper, shared).
    expect(lineOf(p, 'Range')).toBe(`Range: [Archer Bow (Faelindral)](${WIKI}Archer_Bow_%28Faelindral%29)`);
    expect(lineOf(p, 'Head')).toBe('Head: Plain Http Cap');
    expect(lineOf(p, 'Back')).toBe('Back: No Page Cloak');
    expect(lineOf(p, 'Hands')).toBe(`Hands: Gone Gloves ${WEAR_COPY.noLongerListed}`);
    expect(lineOf(p, 'Feet')).toBe(`Feet: boots the data never had ${WEAR_COPY.noLongerListed}`);
    expect(lineOf(p, 'Neck')).toBe(`Neck: ${WEAR_COPY.empty}`);
    expect(p.data.embeds![0].description).not.toContain('**');
    // No link in the content, where it would unfold a preview.
    expect(p.data.content).not.toContain('http');
  });

  it('the slot view stays content only (embeds []) and its name is plain, so nothing unfolds there', async () => {
    await mixed();
    const view = await send(select(ann, `wrs:${await charId()}`, ['ear1']));
    expect(view.type).toBe(7);
    expect(view.data.embeds).toEqual([]);
    expect(view.data.content).toBe(['**Testchar** · Wizard · no level · any race', WEAR_COPY.slotLine('Ear 1', 'Blacktide Earring')].join('\n'));
  });

  it('the worst case from the data fits 4,096 with every line linked: 20 slots, the longest name and address, the longest mark', () => {
    // Measured on the local D1 after npm run import:local (2026-11-09, mnm-tools 629970a): 3,156 wearable wiki items, all with
    // an https wiki_url; the longest name 44 characters, "Steadying Wristguards of the Experimentalist", whose address is
    // also the longest, 90. Used for all 20 slots, with the can't-use mark on every line (a stored class code is 3 letters).
    // These are fixed numbers from that import: the check against the data as it is now is the bench (npm run
    // bench:gear-panel prints the longest linked name over every wearable item, md-escaped: 138 on 2026-11-09). Future data
    // past it is safe by panelText's fallback, tested below.
    const name = 'Steadying Wristguards of the Experimentalist';
    const url = `${WIKI}Steadying_Wristguards_of_the_Experimentalist`;
    expect(url.length).toBe(90);
    const lines = WEAR_SLOTS.map((w) => ({ linked: `${w.label}: [${md(name)}](${linkUrl(url)}) ${WEAR_COPY.cantUse('WIZ')}`, plain: `${w.label}: ${md(name)} ${WEAR_COPY.cantUse('WIZ')}` }));
    const text = panelText(WEAR_COPY.filled(20), lines);
    expect(text.split('\n').slice(2)).toEqual(lines.map((l) => l.linked));
    // 20 × 158 (": [" 3, name 44, "](" 2, address 90, ") " 2, mark 17) + the labels' 114 + the filled line 21 + 21 newlines.
    expect(text.length).toBe(3316);
    expect(text.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    // The same 20 lines as message content (option b) would not fit 2,000, even unwrapped.
    expect(lines.map((l) => l.linked).join('\n').length).toBeGreaterThan(2000);
  });

  it('lines that do not fit lose their link from the bottom up, never cut mid-line; past even that, whole lines go with "+N more"', () => {
    const lines = WEAR_SLOTS.map((w) => ({ linked: `${w.label}: [${'x'.repeat(40)}](${WIKI}${'y'.repeat(150)})`, plain: `${w.label}: ${'x'.repeat(40)}` }));
    const text = panelText(WEAR_COPY.filled(20), lines);
    expect(text.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    const shown = text.split('\n').slice(2);
    expect(shown).toHaveLength(20);
    // Every line is whole, linked or plain; the linked ones are a top run, the plain ones the rest.
    shown.forEach((l, i) => expect([lines[i].linked, lines[i].plain]).toContain(l));
    const firstPlain = shown.findIndex((l, i) => l === lines[i].plain);
    expect(firstPlain).toBeGreaterThan(0);
    expect(shown.slice(firstPlain).every((l, i) => l === lines[firstPlain + i].plain)).toBe(true);
    expect(shown.slice(0, firstPlain).every((l, i) => l === lines[i].linked)).toBe(true);
    // And one more linked line would not have fitted.
    const oneMore = [WEAR_COPY.filled(20), '', ...shown.slice(0, firstPlain), lines[firstPlain].linked, ...shown.slice(firstPlain + 1)].join('\n');
    expect(oneMore.length).toBeGreaterThan(EMBED_LIMITS.description);
    // A limit even the plain lines pass: whole lines from the bottom, then "+N more".
    const tight = panelText(WEAR_COPY.filled(20), lines, 200);
    expect(tight.length).toBeLessThanOrEqual(200);
    const kept = tight.split('\n');
    expect(kept.at(-1)).toMatch(/^\+\d+ more$/);
    kept.slice(2, -1).forEach((l, i) => expect(l).toBe(lines[i].plain));
  });

  it('a note (a save\'s line) still shows first; every panel and slot-view form sends a non-empty content and an explicit embeds', async () => {
    await add('Testchar');
    const id = await charId();
    const check = (r: Reply, embeds: number, what: string) => {
      expect(r.type, what).toBe(7);
      expect(r.data.content, what).toBeTruthy();
      expect(r.data.embeds, what).toHaveLength(embeds);
    };
    const opened = await panel();
    expect(opened.data.content).toBe(HEAD);
    expect(opened.data.embeds).toHaveLength(1);
    // The slot view: embeds [] (clears the panel's embed).
    check(await send(select(ann, `wrs:${id}`, ['chest'])), 0, 'slot view');
    // Back: the head as the content (replacing the slot view's text), the panel's embed.
    const back = await send(press(ann, `wrv:${id}`));
    check(back, 1, 'Back');
    expect(back.data.content).toBe(HEAD);
    // A save from the box (wrm:, in place): the note first, then the head.
    const saved = await send(submit(ann, `wrm:${id}:chest`, { item: 'copper breastplate' }));
    check(saved, 1, 'save');
    expect(saved.data.content).toBe([WEAR_COPY.saved('Chest', 'Copper Breastplate', null), HEAD].join('\n'));
    expect(saved.data.embeds![0].description).toContain(`Chest: [Copper Breastplate](${WIKI}Copper_Breastplate)`);
    // A pick from the match list (wrk:).
    const picked = await send(select(ann, `wrk:${id}:chest`, [String(await itemId('Green Drakeling Scale Coat'))]));
    check(picked, 1, 'match pick');
    // Empty slot (wre:).
    const emptied = await send(press(ann, `wre:${id}:chest`));
    check(emptied, 1, 'Empty slot');
    expect(emptied.data.content).toBe([WEAR_COPY.emptied('Chest', 'Green Drakeling Scale Coat'), HEAD].join('\n'));
    // A refused save: the slot view with the reason (embeds []), from the box and from the match list.
    await env.DB.prepare("UPDATE character SET class = 'WIZ' WHERE id = ?").bind(id).run();
    await env.DB.prepare('UPDATE item SET class_mask = ? WHERE name = ?').bind(CLS.INQ, 'Copper Breastplate').run();
    const refused = await send(submit(ann, `wrm:${id}:chest`, { item: 'copper breastplate' }));
    check(refused, 0, 'refused save');
    expect(refused.data.content!.split('\n')[0]).toBe(WEAR_COPY.classRefused('WIZ', 'Copper Breastplate'));
    const refusedPick = await send(select(ann, `wrk:${id}:chest`, [String(await itemId('Copper Breastplate'))]));
    check(refusedPick, 0, 'refused match pick');
    expect(refusedPick.data.content!.split('\n')[0]).toBe(WEAR_COPY.classRefused('WIZ', 'Copper Breastplate'));
  });

  it('order 18: an old content-only panel is replaced whole: the edit Discord receives carries the new content and the embed', async () => {
    // A panel sent before order 44 holds its 20 lines in content. Back on it (wrv:, unchanged) PATCHes the message; Discord
    // keeps a field an edit leaves out, so the body must name both content and embeds (the old 20 lines don't survive).
    await add('Testchar');
    const { ack, calls } = await exchange(press(ann, `wrv:${await charId()}`));
    expect(ack.type).toBe(6);
    const edit = calls.filter((c) => c.method === 'PATCH').at(-1)!;
    expect(edit.body.content).toBe(HEAD);
    expect(edit.body.embeds).toHaveLength(1);
    expect(edit.body.embeds[0].description.split('\n')[0]).toBe(WEAR_COPY.filled(0));
  });
});

describe('order 44, ITEM 2: View an item', () => {
  it('one option per filled, listed slot, in slot order, valued by slot key (both ears distinct); the third row; no default', async () => {
    await mixed();
    const p = await panel();
    expect((p.data.components ?? []).length).toBe(3);
    const menu = viewMenu(p);
    expect(flat({ ...p, data: { ...p.data, components: [p.data.components![2]] } })[0]).toBe(menu);
    expect(menu.custom_id).toBe(`${VIEW_PREFIX}${await charId()}`);
    expect(menu.placeholder).toBe(WEAR_COPY.viewItem);
    expect(menu.options).toEqual([
      { label: 'Head: Plain Http Cap', value: 'head' },
      { label: 'Ear 1: Blacktide Earring', value: 'ear1' },
      { label: 'Ear 2: Blacktide Earring', value: 'ear2' },
      { label: 'Back: No Page Cloak', value: 'back' },
      { label: 'Chest: Green Drakeling Scale Coat', value: 'chest' },
      { label: 'Waist: Wizard Sash', value: 'waist' },
      { label: 'Range: Archer Bow (Faelindral)', value: 'range' },
    ]);
    expect(new Set(menu.options.map((o: any) => o.value)).size).toBe(menu.options.length);
    expect(menu.options.some((o: any) => 'default' in o)).toBe(false);
    // The slot view has no View an item.
    expect(viewMenu(await send(select(ann, `wrs:${await charId()}`, ['chest'])))).toBeUndefined();
  });

  it('no menu when no slot qualifies (empty, gone or missing only); the panel keeps its 2 rows', async () => {
    await add('Testchar');
    expect(viewMenu(await panel())).toBeUndefined();
    await wearIt('hands', 'Gone Gloves');
    await wearIt('feet', 'Boots The Data Never Had');
    await env.DB.prepare("UPDATE item SET gone_at = 't' WHERE name = 'Gone Gloves'").run();
    const p = await panel();
    expect(viewMenu(p)).toBeUndefined();
    expect((p.data.components ?? []).length).toBe(2);
  });

  it('a 20-slot panel: 20 options (within 25), each label at most 100 characters', async () => {
    await add('Testchar');
    const long = `A ${'Very '.repeat(30)}Long Thing`;
    await env.DB.prepare("INSERT INTO item (name, name_key, slot, source, imported_at, slot_mask, class_mask, race_mask, wiki_url) VALUES (?, ?, 'X', 'wiki', 't', ?, -1, -1, NULL)").bind(long, long.toLowerCase(), -1).run();
    for (const w of WEAR_SLOTS) await wearIt(w.key, long);
    const menu = viewMenu(await panel());
    expect(menu.options).toHaveLength(20);
    expect(menu.options.every((o: any) => o.label.length <= 100)).toBe(true);
  });

  it('the reply equals Open item\'s for the same item, privately, as a new message; the panel is not edited', async () => {
    await mixed();
    const pick = await exchange(select(ann, `${VIEW_PREFIX}${await charId()}`, ['chest']));
    expect(pick.ack.type).toBe(6);
    expect(pick.calls.map((c) => c.method)).toEqual(['POST']);
    const viewed = await send(select(ann, `${VIEW_PREFIX}${await charId()}`, ['chest']));
    const opened = await send(press(ann, `${OPEN_PREFIX}${await itemId('Green Drakeling Scale Coat')}`));
    expect(viewed).toEqual(opened);
    expect(viewed.data.flags).toBe(64);
    expect(viewed.data.embeds![0].title).toBe('Green Drakeling Scale Coat');
    // One item in both ears: each side opens the same card.
    expect(await send(select(ann, `${VIEW_PREFIX}${await charId()}`, ['ear2']))).toEqual(await send(select(ann, `${VIEW_PREFIX}${await charId()}`, ['ear1'])));
  });

  it('an officer viewing a member\'s panel can use it; another member is refused, as the panel\'s other controls', async () => {
    await mixed();
    const id = await charId();
    const byOfficer = await send(select(officer, `${VIEW_PREFIX}${id}`, ['waist']));
    expect(byOfficer.data.embeds![0].title).toBe('Wizard Sash');
    const byOther = await send(select(bo, `${VIEW_PREFIX}${id}`, ['waist']));
    expect(byOther.data.content).toBe(WEAR_COPY.notYours);
    expect(byOther.data.embeds ?? []).toEqual([]);
  });

  it('re-read on pick: an item gone since, a slot emptied since, a missing row or an unknown key answer the "gone" line', async () => {
    await mixed();
    const id = await charId();
    const pick = (v: string) => send(select(ann, `${VIEW_PREFIX}${id}`, [v]));
    await env.DB.prepare("UPDATE item SET gone_at = 't' WHERE name = 'Wizard Sash'").run();
    for (const v of ['waist', 'hands', 'feet', 'neck', 'nonsense']) {
      const r = await pick(v);
      expect(r.data.content, v).toBe(UPGRADES_COPY.gone);
      expect(r.data.flags, v).toBe(64);
    }
    await env.DB.prepare("DELETE FROM character_gear WHERE slot = 'chest'").run();
    expect((await pick('chest')).data.content).toBe(UPGRADES_COPY.gone);
    // A removed character answers as every panel control does.
    await env.DB.prepare('UPDATE character SET deleted_at = ? WHERE id = ?').bind('t', id).run();
    expect((await pick('ear1')).data.content).toBe(WEAR_COPY.gone);
  });

  it('routing (order 23): wrx: defers as a component (type 6), private, outside OPENS_MODAL and SUBMITS_IN_PLACE', () => {
    expect(planFor(select(ann, `${VIEW_PREFIX}1`, ['chest']) as any)).toEqual({ defer: true, ack: 6, private: true });
    expect(OPENS_MODAL.some((p) => `${VIEW_PREFIX}1`.startsWith(p))).toBe(false);
    expect(SUBMITS_IN_PLACE.some((p) => `${VIEW_PREFIX}1`.startsWith(p))).toBe(false);
  });

  describe('rows read', () => {
    const lines: string[] = [];
    beforeEach(() => {
      lines.length = 0;
      vi.spyOn(console, 'log').mockImplementation((s: unknown) => void lines.push(String(s)));
    });
    afterEach(() => vi.restoreAllMocks());
    const rowsOf = (cmdName: string) => {
      const t = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((x) => x?.gc === 'interaction' && x.cmd === cmdName).at(-1);
      return { q: t.q as number, rows: (t.rows_read as (number | null)[]).reduce<number>((n, r) => n + (r ?? 0), 0) };
    };
    it('one View costs Open item\'s reads plus the character and the slot\'s re-read', async () => {
      await mixed();
      const id = await charId();
      const coat = await itemId('Green Drakeling Scale Coat');
      // Once each first, so both are measured with the isolate's caches in the same state (warm).
      await send(press(ann, `${OPEN_PREFIX}${coat}`));
      await send(select(ann, `${VIEW_PREFIX}${id}`, ['chest']));
      await send(press(ann, `${OPEN_PREFIX}${coat}`));
      const open = rowsOf('guo');
      await send(select(ann, `${VIEW_PREFIX}${id}`, ['chest']));
      const view = rowsOf('wrx');
      console.info(`order 44 rows read: View ${JSON.stringify(view)}, Open item ${JSON.stringify(open)}`);
      expect(view.q).toBe(open.q + 2);
      expect(view.rows - open.rows).toBeLessThanOrEqual(3);
    });
  });
});

describe('order 44: one head (order 39), unchanged', () => {
  it('the panel\'s content is characterHead, as before', async () => {
    await add('Testchar');
    expect((await panel()).data.content).toBe(characterHead({ name: 'Testchar', class: null, level: null, race: null }, false));
  });
});

// Work order 36, ITEM 3: /gear upgrades, Find upgrades, and their controls (src/gear/upgrades.ts).
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { howToGet, levelText, OPEN_PREFIX, PAGE_PREFIX, RESULT_PREFIX, SLOT_PREFIX, UPGRADES_COPY, WEAR_NOW_PREFIX } from '../../src/gear/upgrades.ts';
import { FIND_UPGRADES_PREFIX, PANEL_PREFIX, WEAR_COPY } from '../../src/gear/wear.ts';
import { statVector, type GearItem } from '../../src/gear/score.ts';
import { GEAR_INDEX_SQL, toItem } from '../../src/gear/index.ts';
import { buildSourceIndex } from '../../src/gear/sources.ts';
import { questsByItem, withQuests } from '../../scripts/import/core.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';
import { FROM_FIND_PREFIX } from '../../src/requests.ts';
import { MOB_ZONES_SOURCE } from '../../src/zone/names.ts';
import { markImported, one, reset } from '../db.ts';
import { ADMIN, as, cmd, press, rawCmd, select, send, type Member, type Reply } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const ann = as(ANN);
const bo = as(BO);
const officer = as('100000000000000009', { permissions: ADMIN, nick: 'Joegandomi' });
type Tok = (typeof SLOTS)[number];
const slot = (...t: Tok[]) => t.reduce((m, s) => m | bitOf(SLOTS, s), 0);

interface Seed {
  name: string;
  slots: Tok[];
  stats?: Record<string, unknown>;
  low?: number | null;
  high?: number | null;
  kind?: string;
  kinds?: string;
  cls?: number;
}
const seed = (items: Seed[]) =>
  env.DB.batch([
    env.DB.prepare('DELETE FROM item'),
    ...items.map((i) =>
      env.DB.prepare(
        "INSERT INTO item (name, name_key, slot, stats_json, source, imported_at, slot_mask, class_mask, race_mask, level_low, level_high, level_kind, level_kinds) VALUES (?, ?, 'X', ?, 'wiki', 't', ?, ?, -1, ?, ?, ?, ?)",
      ).bind(i.name, i.name.toLowerCase(), JSON.stringify(i.stats ?? {}), slot(...i.slots), i.cls ?? -1, i.low === undefined ? 1 : i.low, i.high === undefined ? (i.low === undefined ? 1 : i.low) : i.high, i.kind ?? 'mob', i.kinds ?? i.kind ?? 'mob'),
    ),
  ]);

beforeEach(async () => {
  await reset(undefined, [['FTR', 10], ['INQ', 10], ['WIZ', 10]]);
  await env.DB.prepare("UPDATE game_class SET bit = CASE code WHEN 'FTR' THEN 0 WHEN 'INQ' THEN 1 WHEN 'WIZ' THEN 2 END").run();
});

const add = (name: string, m: Member = ann) => send(cmd(m, 'character', 'add', { name }));
const charId = async (name: string) => (await one<{ id: number }>('SELECT id FROM character WHERE name = ?', name)).id;
const itemId = async (name: string) => (await one<{ id: number }>('SELECT id FROM item WHERE name = ?', name)).id;
const setChar = (name: string, cls: string | null, level: number | null) => env.DB.prepare('UPDATE character SET class = ?, level = ? WHERE name = ?').bind(cls, level, name).run();
const wearIt = async (char: string, slotKey: string, item: string) =>
  env.DB.prepare("INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, '900000000000000001', ?, ?, 't', 'x')").bind(await charId(char), slotKey, item.toLowerCase()).run();
const upgrades = (m: Member, o: Record<string, unknown> = {}) => send(rawCmd(m, 'gear', 'upgrades', o));
const text = (r: Reply) => [r.data.content ?? '', ...(r.data.embeds ?? []).flatMap((e) => [e.title ?? '', e.description ?? '', e.footer?.text ?? ''])].join('\n');
const comps = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components) as any[];
const ids = (r: Reply) => comps(r).map((c) => c.custom_id).filter(Boolean) as string[];

/** Testchar, an Inquisitor at 15, with Chest candidates in each group (gains: AC × 0.35). */
async function testchar(level: number | null = 15) {
  await add('Testchar');
  await setChar('Testchar', 'INQ', level);
  await seed([
    { name: 'Low Tie', slots: ['CHEST'], stats: { ac: 6 }, low: 8 }, // +2.10
    { name: 'High Tie', slots: ['CHEST'], stats: { ac: 6 }, low: 10 }, // +2.10
    { name: 'Big Plate', slots: ['CHEST'], stats: { ac: 10 }, low: 5 }, // +3.50
    { name: 'Far Plate', slots: ['CHEST'], stats: { ac: 4 }, low: 30 }, // +1.40, above at window 10
    { name: 'Mystery Vest', slots: ['CHEST'], stats: { ac: 2 }, low: null, kind: 'unknown' }, // +0.70, level unknown
  ]);
  await markImported();
}

describe('order 36, ITEM 3: the slot list', () => {
  it('the three groups in order, each smallest first; ties by the lower level, then the name', async () => {
    await testchar();
    const r = await upgrades(ann, { slot: 'chest' });
    expect(r.data.flags).toBe(64);
    const t = text(r);
    const at = (s: string) => t.indexOf(s);
    // Order 36 follow-up: no cap by default: every level in one list, smallest first, then Level unknown.
    expect(at('__Upgrades__')).toBeLessThan(at('__Level unknown__'));
    expect(t).not.toContain('above Lv');
    expect([at('Far Plate'), at('Low Tie'), at('High Tie'), at('Big Plate'), at('Mystery Vest')].every((x, i, a) => x > 0 && (i === 0 || x > a[i - 1]))).toBe(true);
    expect(t).toContain('**Low Tie** **+2.10** · Lv 8 (drop)');
    expect(t).toContain('+6 AC');
    expect(t).toContain("Uses your guild's Inquisitor weights.");
    expect(t).toContain('Chest: empty (score 0.00)');
  });

  it('max_level: hides what is above it, with a quiet count; level-unknown items stay; an old-shape levels: reads as level + levels', async () => {
    await testchar();
    const capped = text(await upgrades(ann, { slot: 'chest', max_level: 20 }));
    expect(capped).not.toContain('Far Plate');
    expect(capped).toContain(UPGRADES_COPY.capNote(20));
    expect(capped).toContain(UPGRADES_COPY.hidden(1, 20)); // "1 more above Lv 20 not shown."
    expect(capped).toContain('Mystery Vest');
    expect(text(await upgrades(ann, { slot: 'chest', max_level: 30 }))).toContain('Far Plate');
    expect((await upgrades(ann, { slot: 'chest', max_level: 81 })).data.content).toBe(UPGRADES_COPY.capRange);
    // A client with the earlier definition: levels: 0 for a level-15 character is a cap of 15.
    expect(text(await upgrades(ann, { slot: 'chest', levels: 0 }))).toContain(UPGRADES_COPY.hidden(1, 15));
    // The summary counts what the cap hid, and its Pick a slot keeps the cap.
    const s = await upgrades(ann, { max_level: 20 });
    expect(s.data.embeds![0].footer!.text).toContain(UPGRADES_COPY.hidden(1, 20));
    expect(comps(s).find((c) => c.custom_id?.startsWith(SLOT_PREFIX)).custom_id).toMatch(/:c20$/);
    // A control sent before (a window number in its id) reads as no cap.
    const id = await charId('Testchar');
    expect(text(await send(select(ann, `${SLOT_PREFIX}${id}:10`, ['chest'])))).toContain('Far Plate');
  });

  it('pages of 5, ◀ Smaller and Bigger ▶ in place; every component within Discord\'s limits', async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 20);
    await seed(Array.from({ length: 7 }, (_, i) => ({ name: `Helm ${i + 1}`, slots: ['HEAD' as Tok], stats: { ac: i + 1 } })));
    await markImported();
    const p1 = await upgrades(ann, { slot: 'head' });
    expect(text(p1)).toContain('Page 1 of 2');
    const pick = comps(p1).find((c) => c.custom_id?.startsWith(RESULT_PREFIX));
    expect(pick.options.map((o: any) => o.label)).toEqual(['Helm 1', 'Helm 2', 'Helm 3', 'Helm 4', 'Helm 5']);
    const [smaller, bigger] = comps(p1).filter((c) => c.custom_id?.startsWith(PAGE_PREFIX));
    expect([smaller.disabled ?? false, bigger.disabled ?? false]).toEqual([true, false]);
    const p2 = await send(press(ann, bigger.custom_id));
    expect(p2.type).toBe(7);
    expect(text(p2)).toContain('Page 2 of 2');
    expect(comps(p2).find((c) => c.custom_id?.startsWith(RESULT_PREFIX)).options.map((o: any) => o.label)).toEqual(['Helm 6', 'Helm 7']);
    for (const r of [p1, p2]) limits(r);
  });

  it('nothing to show: "Nothing beats <item> for a <Class> in <slot>." and no hint of filtering', async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 20);
    await seed([{ name: 'Great Helm', slots: ['HEAD'], stats: { ac: 30 } }, { name: 'Tin Cap', slots: ['HEAD'], stats: { ac: 1 } }]);
    await markImported();
    await wearIt('Testchar', 'head', 'Great Helm');
    const t = text(await upgrades(ann, { slot: 'head' }));
    expect(t).toContain('Nothing beats Great Helm for a Fighter in Head.');
    expect(t).not.toMatch(/filter/i);
  });
});

describe('order 36, ITEM 3: the summary', () => {
  it('at most 8 lines, smallest first, then unknown-only; a footer counts the rest (no cap: every level listed)', async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 10);
    const tokens: Tok[] = ['HEAD', 'FACE', 'NECK', 'SHOULDERS', 'BACK', 'CHEST', 'SHIRT', 'HANDS', 'WAIST', 'LEGS'];
    await seed([
      ...tokens.map((t, i) => ({ name: `Thing ${String(i + 1).padStart(2, '0')}`, slots: [t], stats: { ac: 10 - i } })),
      { name: 'Far Boots', slots: ['FEET'], stats: { ac: 3 }, low: 40 },
      { name: 'Odd Bow', slots: ['RANGE'], stats: { ac: 3 }, low: null, kind: 'unknown' },
    ]);
    await markImported();
    const r = await upgrades(ann);
    const d = r.data.embeds![0].description!;
    const lines = d.split('\n').filter((l) => l.startsWith('**') && l.includes(':**'));
    expect(lines).toHaveLength(8);
    // Smallest gain first: Thing 10 (1 AC) leads.
    expect(lines[0]).toContain('Thing 10');
    // 11 listed (Far Boots too: no cap) + 1 unknown = 12 lines; 8 shown, 4 more; 17 − 12 = 5 slots with nothing better.
    expect(r.data.embeds![0].footer!.text).toContain('4 more slots with upgrades');
    expect(r.data.embeds![0].footer!.text).toContain('5 slots with nothing better');
    const pick = comps(r).find((c) => c.custom_id?.startsWith(SLOT_PREFIX));
    expect(pick.options).toHaveLength(12);
    limits(r);
  });

  it('a slot whose candidates are all above the cap is left out of the lines and the menu, and counted', async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 10);
    await seed([{ name: 'Far Boots', slots: ['FEET'], stats: { ac: 3 }, low: 40, high: 42 }, { name: 'Farther Boots', slots: ['FEET'], stats: { ac: 9 }, low: 50 }, { name: 'Cap', slots: ['HEAD'], stats: { ac: 1 } }]);
    await markImported();
    expect((await upgrades(ann)).data.embeds![0].description).toContain('**Feet:** **Far Boots** **+1.05** · Lv 40–42 (drop)');
    const r = await upgrades(ann, { max_level: 30 });
    expect(r.data.embeds![0].description).not.toContain('Feet');
    expect(r.data.embeds![0].footer!.text).toContain(UPGRADES_COPY.hidden(2, 30));
    // Review fix: Feet has upgrades (hidden), so it is not among the slots with nothing better: 17 − Head − Feet = 15.
    expect(r.data.embeds![0].footer!.text).toContain('15 slots with nothing better');
    expect(comps(r).find((c) => c.custom_id?.startsWith(SLOT_PREFIX)).options.map((o: any) => o.value)).toEqual(['head']);
    // And the Feet list with the cap says only what the cap hid, never "Nothing beats".
    const feet = text(await upgrades(ann, { slot: 'feet', max_level: 30 }));
    expect(feet).not.toContain('Nothing beats');
    expect(feet).toContain(UPGRADES_COPY.hidden(2, 30));
  });

  it('review fix: an item above the cap that fits two slots counts once in the summary', async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 10);
    await seed([{ name: 'Far Sword', slots: ['PRIMARY', 'SECONDARY'], stats: { ac: 3 }, low: 50 }]);
    await markImported();
    expect((await upgrades(ann, { max_level: 20 })).data.embeds![0].footer!.text).toContain(UPGRADES_COPY.hidden(1, 20));
  });

  it('the cap survives paging, and an old page id with a window number reads as no cap', async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 20);
    await seed([...Array.from({ length: 7 }, (_, i) => ({ name: `Helm ${i + 1}`, slots: ['HEAD' as Tok], stats: { ac: i + 1 }, low: 5 })), { name: 'Far Helm', slots: ['HEAD'], stats: { ac: 1 }, low: 60 }]);
    await markImported();
    const p1 = await upgrades(ann, { slot: 'head', max_level: 30 });
    const bigger = comps(p1).filter((c) => c.custom_id?.startsWith(PAGE_PREFIX))[1];
    expect(bigger.custom_id).toMatch(/:c30:1$/);
    const p2 = text(await send(press(ann, bigger.custom_id)));
    expect(p2).not.toContain('Far Helm');
    expect(p2).toContain(UPGRADES_COPY.hidden(1, 30)); // the last page carries the count
    const id = await charId('Testchar');
    // No cap: Far Helm (+0.35, the smallest gain) leads page 1.
    expect(text(await send(press(ann, `${PAGE_PREFIX}${id}:head:10:0`)))).toContain('Far Helm');
  });

  it('with several characters, leaving character: out is refused with the list; Find upgrades on the Gear panel opens the summary', async () => {
    await testchar();
    await add('Altchar');
    expect((await upgrades(ann)).data.content).toBe(WEAR_COPY.severalCharacters(['Testchar', 'Altchar']));
    const id = await charId('Testchar');
    const panel = await send(press(ann, `${PANEL_PREFIX}${id}`));
    const find = comps(panel).find((c) => c.custom_id === `${FIND_UPGRADES_PREFIX}${id}`);
    expect(find.label).toBe('Find upgrades');
    const s = await send(press(ann, find.custom_id));
    expect(s.data.embeds![0].title).toBe('Upgrades for Testchar');
    // No cap: Far Plate (Lv 30, +1.40) is the smallest Chest upgrade.
    expect(s.data.embeds![0].description).toContain('**Chest:** **Far Plate** **+1.40** · Lv 30 (drop)');
  });
});

describe('order 36, ITEM 5: the gear index', () => {
  it("D1's stat vector (STAT_VECTOR_SQL) equals statVector on every item, ratio rounded alike", async () => {
    await seed([
      { name: 'Full', slots: ['CHEST'], stats: { ac: 7, hp: -3, mana: 9, haste: 12, hpRegen: 1, manaRegen: 2, dmg: 7, delay: 30, stats: { STR: 1, STA: 2, DEX: 3, AGI: 4, INT: 5, WIS: 6, CHA: -7 }, resists: { MR: 1, PR: 2, DR: 3, FR: 4, CORR: 5, CR: 6, ER: 7, HR: 8 } } },
      { name: 'Half', slots: ['PRIMARY'], stats: { dmg: 5, delay: 10 } },
      { name: 'Bare', slots: ['HEAD'] },
      { name: 'Zero Delay', slots: ['PRIMARY'], stats: { dmg: 5, delay: 0 } },
    ]);
    const { results } = await env.DB.prepare(GEAR_INDEX_SQL.replace('slot_mask <> 0', "slot_mask <> 0 ORDER BY name")).all<Record<string, unknown>>();
    const stored = await env.DB.prepare("SELECT name, stats_json FROM item ORDER BY name").all<{ name: string; stats_json: string }>();
    expect(results.map((r) => toItem(r as any).v)).toEqual(stored.results.map((r) => statVector(r.stats_json)));
  });
});

describe('order 36, ITEM 3: the controls', () => {
  it("Pick a result → I'm wearing it now saves to Chest, and the list then compares against it", async () => {
    await testchar();
    const list = await upgrades(ann, { slot: 'chest' });
    const pick = comps(list).find((c) => c.custom_id?.startsWith(RESULT_PREFIX));
    const r = await send(select(ann, pick.custom_id, [String(await itemId('Low Tie'))]));
    expect(r.type).toBe(4);
    expect(r.data.flags).toBe(64);
    // Order 36 follow-up: the full /item card, under the upgrade's own lines; no Open item (it is the card).
    expect(r.data.embeds![0].title).toBe('Low Tie');
    expect(r.data.content).toContain("for Testchar's Chest");
    expect(r.data.content).toContain('**Low Tie** **+2.10**');
    const labels = comps(r).map((c) => c.label);
    expect(labels).toEqual(["I'm wearing it now"]); // not crafted: no Request a craft
    limits(r);
    const now = comps(r).find((c) => c.custom_id?.startsWith(WEAR_NOW_PREFIX));
    const after = await send(press(ann, now.custom_id));
    expect((await one<{ item_key: string }>("SELECT item_key FROM character_gear WHERE slot = 'chest'")).item_key).toBe('low tie');
    const t = text(after);
    expect(t).toContain('**Chest:** Low Tie (was empty).');
    expect(t).toContain('Chest: Low Tie (score 2.10)');
    // High Tie equals Low Tie: no longer an upgrade. Big Plate is now +1.40.
    expect(t).not.toContain('High Tie');
    expect(t).toContain('**Big Plate** **+1.40**');
  });

  it('Request a craft on a crafted result starts /request for it; Open item shows its /item card', async () => {
    await testchar();
    await env.DB.prepare("UPDATE item SET source_mask = 2, level_kind = 'crafted_floor', level_kinds = 'crafted_floor' WHERE name IN ('Low Tie', 'High Tie')").run();
    const id = await itemId('Low Tie');
    // Low Tie has a recipe; High Tie is marked crafted but the data holds no recipe for it.
    await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, acquisition, source, imported_at) VALUES ('lt', (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?, 40, 'vendor', 'wiki', 't')").bind(id).run();
    await markImported();
    const list = await upgrades(ann, { slot: 'chest' });
    const pick = comps(list).find((c) => c.custom_id?.startsWith(RESULT_PREFIX));
    const r = await send(select(ann, pick.custom_id, [String(id)]));
    expect(ids(r)).toContain(`${FROM_FIND_PREFIX}${id}`);
    const noRecipe = await send(select(ann, pick.custom_id, [String(await itemId('High Tie'))]));
    expect(comps(noRecipe).map((c) => c.label)).not.toContain('Request a craft');
    // A guo: button sent before the follow-up still opens the card (order 18: every sent custom_id stays handled).
    const card = await send(press(ann, `${OPEN_PREFIX}${id}`));
    expect(card.data.embeds![0].title).toBe('Low Tie');
    // With no request channel set, Request a craft answers as /request's button does everywhere.
    const req = await send(press(ann, `${FROM_FIND_PREFIX}${id}`));
    expect(req.data.flags).toBe(64);
  });

  it('Post to channel posts this page publicly with no buttons; an officer\'s view of a member\'s list has no Post to channel', async () => {
    await testchar();
    const list = await upgrades(ann, { slot: 'chest' });
    const post = comps(list).find((c) => c.label === 'Post to channel');
    const pub = await send(press(ann, post.custom_id));
    expect(pub.type).toBe(4);
    expect(pub.data.flags ?? 0).toBe(0);
    expect(pub.data.components ?? []).toEqual([]);
    expect(text(pub)).toContain('Low Tie');
    // The officer opens Testchar's summary from the member's Gear panel, then a slot: no Post to channel.
    const summary = await send(press(officer, `${FIND_UPGRADES_PREFIX}${await charId('Testchar')}`));
    const slotPick = comps(summary).find((c) => c.custom_id?.startsWith(SLOT_PREFIX));
    const slotList = await send(select(officer, slotPick.custom_id, ['chest']));
    expect(comps(slotList).map((c) => c.label)).not.toContain('Post to channel');
    // And a posted id pressed by the officer is refused (own characters only).
    expect((await send(press(officer, post.custom_id))).data.content).toBe(WEAR_COPY.ownOnly);
  });

  it("a Secondary result under a worn two-hander offers no I'm wearing it now (saved gear would refuse it)", async () => {
    await add('Testchar');
    await setChar('Testchar', 'FTR', 20);
    await seed([{ name: 'Greatsword', slots: ['PRIMARY'], stats: { stats: { STA: 1 }, handed: 'Two Handed' } }, { name: 'Tower Shield', slots: ['SECONDARY'], stats: { ac: 20 } }]);
    await markImported();
    await wearIt('Testchar', 'primary', 'Greatsword');
    const list = await upgrades(ann, { slot: 'secondary' });
    expect(text(list)).toContain('needs a one-handed Primary');
    const pick = comps(list).find((c) => c.custom_id?.startsWith(RESULT_PREFIX));
    const r = await send(select(ann, pick.custom_id, [String(await itemId('Tower Shield'))]));
    expect(comps(r).map((c) => c.label)).not.toContain("I'm wearing it now");
    expect(r.data.embeds![0].title).toBe('Tower Shield');
  });

  it('the gear index is read again after an import, and never cached while the newest import has no finish time', async () => {
    await testchar();
    expect(text(await upgrades(ann, { slot: 'chest' }))).toContain('Low Tie');
    await env.DB.prepare("UPDATE item SET name = 'Renamed Tie' WHERE name = 'Low Tie'").run();
    // Same import key: still the cached list.
    expect(text(await upgrades(ann, { slot: 'chest' }))).not.toContain('Renamed Tie');
    await env.DB.prepare("INSERT INTO data_import (source, source_version, status, started_at) VALUES ('test', 'x', 'running', 't')").run();
    expect(text(await upgrades(ann, { slot: 'chest' }))).toContain('Renamed Tie');
    await env.DB.prepare("UPDATE item SET name = 'Again Tie' WHERE name = 'Renamed Tie'").run();
    expect(text(await upgrades(ann, { slot: 'chest' }))).toContain('Again Tie');
  });

  it("another member can't press someone else's buttons", async () => {
    await testchar();
    await add('Bochar', bo);
    const list = await upgrades(ann, { slot: 'chest' });
    const id = await charId('Testchar');
    for (const custom_id of [`${FIND_UPGRADES_PREFIX}${id}`, `${PAGE_PREFIX}${id}:chest:10:0`, `${SLOT_PREFIX}${id}:10`, ...ids(list)]) {
      const value = custom_id.startsWith(SLOT_PREFIX) ? 'chest' : String(await itemId('Low Tie'));
      const r = custom_id.startsWith(RESULT_PREFIX) || custom_id.startsWith(SLOT_PREFIX) ? await send(select(bo, custom_id, [value])) : await send(press(bo, custom_id));
      expect([WEAR_COPY.notYours, WEAR_COPY.ownOnly], custom_id).toContain(r.data.content);
    }
    expect((await send(press(bo, `${WEAR_NOW_PREFIX}${id}:chest:10:${await itemId('Low Tie')}`))).data.content).toBe(WEAR_COPY.notYours);
    expect(await one('SELECT count(*) AS n FROM character_gear')).toEqual({ n: 0 });
  });
});

// ---------------------------------------------------------------- how to get it (pure, with hand-made page data)

const gi = (o: Partial<GearItem>): GearItem => ({
  id: 1, name: 'X', key: 'x', slotMask: 1, classMask: -1, raceMask: -1, sourceMask: 0, gone: false, twoHanded: false, levelLow: null, levelHigh: null, levelKind: null, levelKinds: null, v: statVector(null), ...o,
});
// Order 37: the drop and vendor lines read the source index (src/gear/sources.ts), not the page's mob rows.
const extras = (origin: unknown, d: Partial<{ recipes: unknown[]; crafters: unknown[] }> = {}, src: Partial<Parameters<typeof buildSourceIndex>[1]> = {}) => ({
  rows: new Map([[1, { origin_json: JSON.stringify(origin), source_mask: 0 }]]),
  d: { classes: [], mobs: [], recipes: [], crafters: [], version: null, ...d } as any,
  src: buildSourceIndex('t', { mobs: [], npcs: [], zoneNames: [], zones: [], ...src }),
});
const crafter = (owner: string, member: string, character: string, level: number) => ({ recipe_id: 7, character, owner_user_id: owner, member, class: null, char_level: null, level, knows_recipe: 0 });
const recipe = { id: 7, item_id: 1, tradeskill: 'Blacksmithing', trivial: 45, acquisition: 'vendor', trivial_corrected: 0, trivial_unconfirmed: 0 };

describe('order 36, ITEM 3: how to get it', () => {
  it('a drop with several mobs shows the lowest-level one, its zone and level, and "+N more"', () => {
    const mobs = [
      { key: 'A big rat', title: 'A big rat', level: '22 - 25', zones_json: '["Rat Hollow"]', loot_json: null },
      { key: 'A small rat', title: 'A small rat', level: '3 - 5', zones_json: '["Sungreet"]', loot_json: null },
    ];
    const zones = { zones: [{ key: 'rat hollow', name: 'Rat Hollow' }, { key: 'sungreet', name: 'Sungreet' }], zoneNames: [{ source: MOB_ZONES_SOURCE, name: 'Rat Hollow', zone_key: 'rat hollow' }, { source: MOB_ZONES_SOURCE, name: 'Sungreet', zone_key: 'sungreet' }] };
    const h = howToGet(gi({ levelKind: 'mob', levelKinds: 'mob', levelLow: 3, levelHigh: 25 }), extras({ from: ['A big rat', 'A small rat', 'A ghost'] }, {}, { mobs, ...zones }), ANN, 25);
    expect(h.lines).toEqual(['Drop: A small rat in Sungreet · Lv 3–5 · +2 more']);
    expect(h.zones).toEqual([{ source: MOB_ZONES_SOURCE, name: 'Sungreet' }]);
  });

  it('the zone fallback, and no level at all', () => {
    expect(howToGet(gi({ levelKind: 'zone', levelKinds: 'zone', levelLow: 20, levelHigh: 30 }), extras({ from: ['A ghost'] }), ANN, 25).lines).toEqual(['Drop: A ghost · zone Lv 20–30']);
    expect(howToGet(gi({ levelKind: 'unknown', levelKinds: 'mob' }), extras({ from: ['A ghost'] }), ANN, 25).lines).toEqual(['Drop: A ghost · level unknown']);
  });

  it('crafted: the tradeskill and trivial, then up to three Reliable members with their skill; or none yet', () => {
    const crafters = [crafter('201', 'Cara', 'Cyl', 210), crafter('202', 'Dee', 'Dorn', 180), crafter('202', 'Dee', 'Dorn2', 150), crafter('203', 'Eve', 'Ely', 90), crafter('204', 'Fay', 'Fen', 46), crafter('205', 'Gus', 'Gil', 10)];
    const h = howToGet(gi({ levelKind: 'crafted', levelKinds: 'crafted', levelLow: 12 }), extras({}, { recipes: [recipe], crafters }), ANN, 25);
    expect(h.lines).toEqual(['Crafted: Blacksmithing, trivial 45', 'Reliable in your guild: <@201> (Cara): Cyl 210, <@202> (Dee): Dorn 180, <@203> (Eve): Ely 90']);
    expect(h.craftable).toBe(true);
    expect(howToGet(gi({ levelKind: 'crafted', levelKinds: 'crafted' }), extras({}, { recipes: [recipe], crafters: [crafter('205', 'Gus', 'Gil', 10)] }), ANN, 25).lines[1]).toBe(UPGRADES_COPY.noReliable);
  });

  it("crafted with the searcher's own Reliable character says so first; a crafted floor shows \"Lv 14+\"", () => {
    const crafters = [crafter(ANN, 'Ann', 'Durgrim', 178), crafter('201', 'Cara', 'Cyl', 210)];
    const h = howToGet(gi({ levelKind: 'crafted_floor', levelKinds: 'crafted_floor', levelLow: 14 }), extras({}, { recipes: [recipe], crafters }), ANN, 25);
    expect(h.lines).toEqual(['Crafted: Blacksmithing, trivial 45 · Lv 14+', 'You can make this (Durgrim 178)', 'Reliable in your guild: <@201> (Cara): Cyl 210']);
  });

  it('vendor (order 37: merchants named from npc and zone_name), harvest, quest, and primary first', () => {
    const it = gi({ levelKind: 'vendor', levelKinds: 'vendor,harvest,quest,mob', levelLow: 0 });
    const src = {
      npcs: [{ name: 'Rais Alyssum', zone_key: 'night harbor', level: null, loot_json: null }, { name: 'Ilyra Luthielle', zone_key: 'evershade weald', level: null, loot_json: null }],
      zones: [{ key: 'night harbor', name: 'Night Harbor' }, { key: 'evershade weald', name: 'Evershade Weald' }],
      zoneNames: [{ source: 'wiki:zones', name: 'Night Harbor', zone_key: 'night harbor' }, { source: 'wiki:zones', name: 'Evershade Weald', zone_key: 'evershade weald' }],
    };
    const h = howToGet(it, extras({ soldBy: { vendors: ['Night Harbor', 'Rais Alyssum', 'Evershade Weald', 'Ilyra Luthielle'] }, from: [] }, {}, src), ANN, 25);
    expect(h.lines).toEqual(['Vendor: Rais Alyssum, Night Harbor; Ilyra Luthielle, Evershade Weald · any level', 'Harvested, any level', "Quest: the quest's name isn't recorded · level unknown", 'Drop: creature not recorded · level unknown']);
    expect(howToGet(gi({ levelKind: 'quest', levelKinds: 'quest', levelLow: 12 }), extras({}), ANN, 25).lines).toEqual(["Quest: the quest's name isn't recorded · Lv 12+"]);
  });

  it("order 36 follow-up: a quest's name, linked to its wiki page, and to monstersandmemories.wiki only when verified; +N more", () => {
    const quests = [
      { name: 'Armor from Vex', level: 12, wiki: 'https://monstersandmemories.miraheze.org/wiki/Armor_from_Vex' },
      { name: 'A Second Errand', level: null, wiki: null },
    ];
    const h = howToGet(gi({ levelKind: 'quest', levelKinds: 'quest', levelLow: 12 }), extras({ quests }), ANN, 25);
    // "Armor from Vex" is not among quest-sites.json's verified pages: the name links to the wiki only.
    expect(h.lines).toEqual(['Quest: [Armor from Vex](https://monstersandmemories.miraheze.org/wiki/Armor_from_Vex) · Lv 12+ · +1 more']);
    // A verified page gets its monstersandmemories.wiki link; parentheses in an address are encoded (review fix).
    const archer = { name: 'Archer Starter Quest (Faelindral)', level: 1, wiki: 'https://monstersandmemories.miraheze.org/wiki/Archer_Starter_Quest_(Faelindral)' };
    expect(howToGet(gi({ levelKind: 'quest', levelKinds: 'quest', levelLow: 1 }), extras({ quests: [archer] }), ANN, 25).lines).toEqual([
      'Quest: [Archer Starter Quest (Faelindral)](https://monstersandmemories.miraheze.org/wiki/Archer_Starter_Quest_%28Faelindral%29) ([monstersandmemories.wiki](https://monstersandmemories.wiki/quests/archer-starter-quest-faelindral)) · Lv 1+',
    ]);
    expect(howToGet(gi({ levelKind: 'quest', levelKinds: 'quest' }), extras({ quests: [quests[1]] }), ANN, 25).lines).toEqual(['Quest: A Second Errand · level unknown']);
  });

  it('order 36 follow-up: the import keeps each gear item\'s quests (name, level, a wiki link only for a page the snapshot holds)', () => {
    const snap = {
      pages: { 'Armor from Vex': { content: '' } },
      buckets: { quests: { schema: null, fields: [], rows: [
        { quest_name: 'Armor from Vex', quest_min_level: 12, quest_rewards: ['Vex Plate', 'Not Gear'] },
        { quest_name: 'Plate Errand', quest_min_level: 'soon', quest_rewards: ['vex plate'] },
        { quest_name: 'Armor from Vex', quest_min_level: 12, quest_rewards: ['Vex Plate'] },
      ] } },
    } as any;
    const q = questsByItem(snap, new Set(['vex plate']));
    expect(q.get('vex plate')).toEqual([
      { name: 'Armor from Vex', level: 12, wiki: 'https://monstersandmemories.miraheze.org/wiki/Armor_from_Vex' },
      { name: 'Plate Errand', level: null, wiki: null },
    ]);
    expect(q.has('not gear')).toBe(false);
    expect(withQuests('{"from":["a rat"]}', q.get('vex plate'))).toContain('"quests":[');
    expect(withQuests('{"from":["a rat"],"quests":[{"name":"x"}]}', undefined)).toBe('{"from":["a rat"]}');
  });

  it('a level always carries its kind', () => {
    expect([
      levelText({ levelLow: 22, levelHigh: 25, levelKind: 'mob' }),
      levelText({ levelLow: 20, levelHigh: 30, levelKind: 'zone' }),
      levelText({ levelLow: 14, levelHigh: null, levelKind: 'crafted_floor' }),
      levelText({ levelLow: 0, levelHigh: 0, levelKind: 'vendor' }),
      levelText({ levelLow: null, levelHigh: null, levelKind: 'unknown' }),
    ]).toEqual(['Lv 22–25 (drop)', 'zone Lv 20–30', 'Lv 14+ (crafted, component floor)', 'any level (vendor)', 'level unknown']);
  });
});

/** Discord's limits (src/gear/upgrades.ts): 5 rows, 5 buttons a row, 25 options, custom_id ≤ 100, 2,000 content, embed limits. */
function limits(r: Reply) {
  const rows = (r.data.components ?? []) as any[];
  expect(rows.length).toBeLessThanOrEqual(5);
  for (const row of rows) {
    expect(row.components.length).toBeLessThanOrEqual(5);
    for (const c of row.components) {
      if (c.custom_id) expect(c.custom_id.length).toBeLessThanOrEqual(100);
      if (c.options) expect(c.options.length).toBeLessThanOrEqual(25);
      if (c.type === 3) expect(row.components).toHaveLength(1);
    }
  }
  expect((r.data.content ?? '').length).toBeLessThanOrEqual(2000);
  for (const e of r.data.embeds ?? []) expect((e.description ?? '').length).toBeLessThanOrEqual(4096);
  expect(new Set(rows.flatMap((x) => x.components.map((c: any) => c.custom_id).filter(Boolean))).size).toBe(rows.flatMap((x) => x.components.filter((c: any) => c.custom_id)).length);
}

// Order 43: a Filter on one slot's upgrade list (minimum AC; minimum ratio on weapon slots), and /gear upgrades min_ac: and
// min_ratio:. A filter only removes candidates; the order, scores and gains are unchanged.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { FIND_UPGRADES_PREFIX, FILTER_MODAL_PREFIX, FILTER_PREFIX, PAGE_PREFIX, RESULT_PREFIX, SLOT_PREFIX, UPGRADES_COPY, WEAR_NOW_PREFIX } from '../../src/gear/upgrades.ts';
import { floorMiss, listFilter, listState, NO_FILTER, parseAc, parseRatio, type ListFilter } from '../../src/gear/filter.ts';
import { MIN_AC_MAX, MIN_RATIO_MAX } from '../../src/gear/options.ts';
import { statVector } from '../../src/gear/score.ts';
import { WEAPON_SLOTS, WEAR_SLOTS } from '../../src/gear/slots.ts';
import { OPENS_MODAL, planFor, SUBMITS_IN_PLACE, type Interaction } from '../../src/interactions.ts';
import { POST_PREFIX } from '../../src/commands/share.ts';
import { bitOf, SLOTS } from '../../src/gear/vocab.ts';
import { markImported, one, reset } from '../db.ts';
import { ADMIN, as, cmd, exchange, press, rawCmd, select, send, submit, type Member, type Reply } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
const officer = as('100000000000000009', { permissions: ADMIN, nick: 'Joegandomi' });
type Tok = (typeof SLOTS)[number];

interface Seed {
  name: string;
  slots: Tok[];
  stats?: Record<string, unknown>;
  low?: number | null;
}
const seed = (items: Seed[]) =>
  env.DB.batch([
    env.DB.prepare('DELETE FROM item'),
    ...items.map((i) =>
      env.DB.prepare(
        "INSERT INTO item (name, name_key, slot, stats_json, source, imported_at, slot_mask, class_mask, race_mask, level_low, level_high, level_kind, level_kinds) VALUES (?, ?, 'X', ?, 'wiki', 't', ?, -1, -1, ?, ?, 'mob', 'mob')",
      ).bind(i.name, i.name.toLowerCase(), JSON.stringify(i.stats ?? {}), i.slots.reduce((m, s) => m | bitOf(SLOTS, s), 0), i.low === undefined ? 1 : i.low, i.low === undefined ? 1 : i.low),
    ),
  ]);

beforeEach(async () => {
  await reset(undefined, [['FTR', 10], ['INQ', 10], ['WIZ', 10]]);
  await env.DB.prepare("UPDATE game_class SET bit = CASE code WHEN 'FTR' THEN 0 WHEN 'INQ' THEN 1 WHEN 'WIZ' THEN 2 END").run();
});

const charId = async () => (await one<{ id: number }>("SELECT id FROM character WHERE name = 'Testchar'")).id;
const upgrades = (m: Member, o: Record<string, unknown> = {}) => send(rawCmd(m, 'gear', 'upgrades', o));
const text = (r: Reply) => [r.data.content ?? '', ...(r.data.embeds ?? []).flatMap((e) => [e.title ?? '', e.description ?? '', e.footer?.text ?? ''])].join('\n');
const comps = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components) as any[];
const byPrefix = (r: Reply, p: string) => comps(r).filter((c) => c.custom_id?.startsWith(p));
const filterButton = (r: Reply) => byPrefix(r, FILTER_PREFIX)[0];
/** Press Filter, then submit the form with `inputs`: the redrawn list (or the private refusal). */
async function filterWith(r: Reply, inputs: Record<string, string>, m: Member = ann) {
  const form = await send(press(m, filterButton(r).custom_id));
  expect(form.type).toBe(9);
  return send(submit(m, form.data.custom_id!, inputs));
}
const boxes = (form: Reply) => (form.data.components ?? []).map((l: any) => ({ label: l.label, id: l.component.custom_id, value: l.component.value }));

/** Testchar, an Inquisitor at 15, with Chest candidates at AC 2, 4, 6, 8, 12 and one with no AC recorded. */
async function chest() {
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
  await env.DB.prepare("UPDATE character SET class = 'INQ', level = 15 WHERE name = 'Testchar'").run();
  await seed([
    { name: 'Vest 2', slots: ['CHEST'], stats: { ac: 2 } },
    { name: 'Vest 4', slots: ['CHEST'], stats: { ac: 4 } },
    { name: 'Vest 6', slots: ['CHEST'], stats: { ac: 6 } },
    { name: 'Vest 8', slots: ['CHEST'], stats: { ac: 8 }, low: 40 },
    { name: 'Vest 12', slots: ['CHEST'], stats: { ac: 12 } },
    { name: 'Robe of Mana', slots: ['CHEST'], stats: { mana: 40 } }, // no AC recorded
  ]);
  await markImported();
}

/** Testchar, a Fighter, with Primary candidates around a ratio of 0.450 (both round to 45 in the score's RATIO). */
async function primary(cls = 'FTR') {
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
  await env.DB.prepare('UPDATE character SET class = ?, level = 15 WHERE name = ?').bind(cls, 'Testchar').run();
  await seed([
    { name: 'Just Under', slots: ['PRIMARY', 'SECONDARY'], stats: { dmg: 4499, delay: 10000, ac: 5 } }, // 0.4499
    { name: 'Exactly At', slots: ['PRIMARY', 'SECONDARY'], stats: { dmg: 9, delay: 20, ac: 5 } }, // 0.450
    { name: 'Well Over', slots: ['PRIMARY', 'SECONDARY'], stats: { dmg: 12, delay: 20, ac: 1 } }, // 0.600
    { name: 'No Damage', slots: ['PRIMARY', 'SECONDARY'], stats: { ac: 20 } }, // ratio NULL
    { name: 'A Bow', slots: ['RANGE'], stats: { dmg: 5, delay: 30, ac: 1 } },
  ]);
  await markImported();
}

describe('order 43: the state segment', () => {
  it('round-trips every combination; old c, c30 and window-number ids parse as before', () => {
    const all: ListFilter[] = [];
    for (const cap of [null, 30]) for (const minAc of [null, 20]) for (const minRatio of [null, 450]) all.push({ cap, minAc, minRatio });
    expect(all.map(listState)).toEqual(['c', 'cr450', 'ca20', 'ca20r450', 'c30', 'c30r450', 'c30a20', 'c30a20r450']);
    for (const f of all) expect(listFilter(listState(f))).toEqual(f);
    expect(listFilter('c')).toEqual(NO_FILTER);
    expect(listFilter('c30')).toEqual({ ...NO_FILTER, cap: 30 });
    // A window number (before the cap), a missing segment or anything else: no cap and no filter.
    for (const old of ['10', '0', undefined, '', 'x', 'ca', 'c30r450a20']) expect(listFilter(old)).toEqual(NO_FILTER);
    // A floor of 0 or out of range is no floor.
    expect(listFilter(`ca0r${MIN_RATIO_MAX * 1000 + 1}`)).toEqual(NO_FILTER);
  });

  it('every custom_id stays within 100 characters at the longest values', () => {
    const state = listState({ cap: 80, minAc: MIN_AC_MAX, minRatio: MIN_RATIO_MAX * 1000 });
    expect(state).toBe('c80a9999r99000');
    const ch = '9'.repeat(12);
    const key = WEAR_SLOTS.map((s) => s.key).sort((a, b) => b.length - a.length)[0];
    const ids = [
      `${POST_PREFIX}gu:${ch}:${key}:${state}:99`,
      `${PAGE_PREFIX}${ch}:${key}:${state}:99`,
      `${RESULT_PREFIX}${ch}:${key}:${state}`,
      `${WEAR_NOW_PREFIX}${ch}:${key}:${state}:${'9'.repeat(12)}`,
      `${FILTER_PREFIX}${ch}:${key}:${state}`,
      `${FILTER_MODAL_PREFIX}${ch}:${key}:${state}`,
    ];
    const longest = Math.max(...ids.map((s) => s.length));
    expect(longest).toBeLessThanOrEqual(100);
    expect(longest).toBe(54); // guw:, with a 12-digit character id and item id, and a 9-letter slot key
  });

  it('a ratio just under the floor fails and one exactly at it passes, judged on the exact ratio; missing stats never pass', () => {
    const f = { ...NO_FILTER, minRatio: 450 };
    const v = statVector(null);
    expect(floorMiss({ v, ratio: 0.4499 }, f)).toBe('ratio');
    expect(floorMiss({ v, ratio: 9 / 20 }, f)).toBe(null);
    expect(floorMiss({ v, ratio: null }, f)).toBe('ratio');
    expect(floorMiss({ v, ratio: null }, { ...NO_FILTER, minAc: 1 })).toBe('ac'); // AC missing (0 in v)
    expect(floorMiss({ v, ratio: null }, NO_FILTER)).toBe(null);
  });

  it('typed values: empty is no floor; out of range or malformed is refused', () => {
    expect(parseAc('')).toEqual({ ok: true, value: null });
    expect(parseAc(' 10 ')).toEqual({ ok: true, value: 10 });
    expect(parseAc('0')).toEqual({ ok: true, value: null });
    for (const bad of ['abc', '-1', '1.5', '10000']) expect(parseAc(bad)).toEqual({ ok: false });
    expect(parseRatio('0.45')).toEqual({ ok: true, value: 450 });
    expect(parseRatio('.5')).toEqual({ ok: true, value: 500 });
    expect(parseRatio('99')).toEqual({ ok: true, value: 99000 });
    for (const bad of ['0.4499', '100', 'x', '-1', '1,5']) expect(parseRatio(bad)).toEqual({ ok: false });
  });
});

describe('order 43: the Filter button and its form', () => {
  it('routing: Filter opens a modal at once; its submit is deferred as an in-place update (type 6)', () => {
    const i = (type: number, custom_id: string) => ({ type, guild_id: '1', member: ann, data: { custom_id } }) as unknown as Interaction;
    expect(OPENS_MODAL).toContain(FILTER_PREFIX);
    expect(SUBMITS_IN_PLACE).toContain(FILTER_MODAL_PREFIX);
    expect(planFor(i(3, `${FILTER_PREFIX}1:chest:c`))).toEqual({ defer: false });
    expect(planFor(i(5, `${FILTER_MODAL_PREFIX}1:chest:c`))).toMatchObject({ defer: true, ack: 6 });
  });

  it('a Chest has one box (Minimum AC); Primary, Secondary and Range have two, for any class; each pre-filled', async () => {
    await primary('WIZ'); // a Caster: Secondary scores no ratio, yet takes the box (by slot token)
    const id = await charId();
    const chestForm = await send(press(ann, `${FILTER_PREFIX}${id}:chest:ca7r450`));
    expect(chestForm.data.title).toBe('Filter Chest upgrades');
    expect(boxes(chestForm)).toEqual([{ label: 'Minimum AC', id: 'ac', value: '7' }]);
    expect(chestForm.data.custom_id).toBe(`${FILTER_MODAL_PREFIX}${id}:chest:ca7`);
    for (const s of WEAPON_SLOTS) {
      const form = await send(press(ann, `${FILTER_PREFIX}${id}:${s.key}:c20r450`));
      expect(form.data.title).toBe(`Filter ${s.label} upgrades`);
      expect(boxes(form)).toEqual([{ label: 'Minimum AC', id: 'ac', value: undefined }, { label: 'Minimum ratio (damage ÷ delay)', id: 'ratio', value: '0.450' }]);
      expect(form.data.custom_id).toBe(`${FILTER_MODAL_PREFIX}${id}:${s.key}:c20r450`);
    }
    expect(WEAPON_SLOTS.map((s) => s.label)).toEqual(['Primary', 'Secondary', 'Range']);
    // Review fix: the Caster's Secondary list (its score counts no ratio) does apply a ratio floor, by slot token.
    const sec = text(await upgrades(ann, { slot: 'secondary', min_ratio: 0.45 }));
    expect(sec).toContain('Filtered: ratio 0.450+');
    expect(sec).not.toContain('Just Under');
    expect(sec).not.toContain('No Damage');
    expect(sec).toMatch(/more below ratio 0\.450 not shown\./);
  });

  it('submitting redraws the same message from page 1: the filter line, only items that pass, and the counts', async () => {
    await chest();
    const list = await upgrades(ann, { slot: 'chest' });
    expect(filterButton(list).label).toBe('Filter');
    const { ack, calls } = await exchange(submit(ann, (await send(press(ann, filterButton(list).custom_id))).data.custom_id!, { ac: '6' }));
    expect(ack.type).toBe(6);
    expect(calls.map((c) => c.method)).toEqual(['PATCH']); // the source message, edited in place
    const after = await upgrades(ann, { slot: 'chest', min_ac: 6 });
    const t = text(after);
    expect(t).toContain('Filtered: AC 6+');
    for (const shown of ['Vest 6', 'Vest 8', 'Vest 12']) expect(t).toContain(shown);
    for (const hidden of ['Vest 2', 'Vest 4', 'Robe of Mana']) expect(t).not.toContain(hidden);
    // The robe (no AC recorded) is counted with the hidden, never shown as 0.
    expect(t).toContain(UPGRADES_COPY.belowAc(3, 6));
    // Scores, gains and order unchanged: the passing items in the unfiltered list's order.
    const order = (r: Reply) => byPrefix(r, RESULT_PREFIX)[0].options.map((o: any) => `${o.label} ${o.description}`);
    const kept = ['Vest 6 +2.10 · Lv 1 (drop)', 'Vest 8 +2.80 · Lv 40 (drop)', 'Vest 12 +4.20 · Lv 1 (drop)'];
    // Review fix: the whole unfiltered list (both pages), so every kept item's gain and position is checked.
    const page2 = await send(press(ann, byPrefix(list, PAGE_PREFIX)[1].custom_id));
    expect([...order(list), ...order(page2)].filter((x: string) => kept.includes(x))).toEqual(kept);
    expect(order(after)).toEqual(kept);
    expect(text({ type: 7, data: calls[0].body } as Reply)).toBe(t);
  });

  it('a filter that hides everything keeps Filter (no select); "Nothing beats … with this filter." with the counts; clearing restores the list', async () => {
    await chest();
    const all = await filterWith(await upgrades(ann, { slot: 'chest' }), { ac: '99' });
    expect(all.type).toBe(7);
    const t = text(all);
    expect(t).toContain('Nothing beats an empty Chest for a Inquisitor in Chest with this filter.');
    expect(t).toContain(UPGRADES_COPY.belowAc(6, 99));
    expect(byPrefix(all, RESULT_PREFIX)).toHaveLength(0);
    expect(filterButton(all).custom_id).toMatch(/:ca99$/);
    expect(byPrefix(all, POST_PREFIX)).toHaveLength(0); // review fix: an emptied list can't be posted
    // Clearing: the same form, emptied.
    const cleared = await filterWith(all, { ac: '' });
    expect(text(cleared)).not.toContain('Filtered');
    expect(text(cleared)).not.toContain('not shown');
    expect(byPrefix(cleared, RESULT_PREFIX)[0].options).toHaveLength(5);
    expect(filterButton(cleared).custom_id).toMatch(/:c$/);
  });

  it('cap first, then AC, then ratio: an item is counted once, under the first test it fails', async () => {
    await chest();
    // Vest 8 is Lv 40: above the cap, and also above the AC floor: counted only by the cap's line.
    const t = text(await upgrades(ann, { slot: 'chest', max_level: 30, min_ac: 10 }));
    expect(t).toContain(UPGRADES_COPY.hidden(1, 30));
    expect(t).toContain(UPGRADES_COPY.belowAc(4, 10)); // Vest 2, 4, 6 and the robe; not Vest 8
    expect(t).toContain('Vest 12');
    // The weapons: No Damage (AC 20, no ratio) fails the ratio; Just Under fails AC first (AC 5 < 6), counted once.
    await primary();
    const w = text(await upgrades(ann, { slot: 'primary', min_ac: 1, min_ratio: 0.45 }));
    expect(w).toContain('Filtered: AC 1+ · ratio 0.450+');
    expect(w).toContain('Exactly At');
    expect(w).toContain('Well Over');
    expect(w).not.toContain('Just Under');
    expect(w).not.toContain('No Damage');
    expect(w).toContain(UPGRADES_COPY.belowRatio(2, 450));
    const both = text(await upgrades(ann, { slot: 'primary', min_ac: 6, min_ratio: 0.45 }));
    // Just Under and Exactly At (AC 5) and Well Over (AC 1) fail AC first, so none is counted again under ratio; No Damage
    // (AC 20) passes AC and fails the ratio (none recorded).
    expect(both).toContain(UPGRADES_COPY.belowAc(3, 6));
    expect(both).toContain(UPGRADES_COPY.belowRatio(1, 450));
    expect(both).toContain('with this filter.');
  });

  it('every carrier keeps the filter: paging, Pick a result, I\'m wearing it now, Post to channel; Pick a slot carries the cap only', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    await env.DB.prepare("UPDATE character SET class = 'FTR', level = 20 WHERE name = 'Testchar'").run();
    await seed(Array.from({ length: 9 }, (_, i) => ({ name: `Helm ${i + 1}`, slots: ['HEAD' as Tok], stats: { ac: i + 1 } })));
    await markImported();
    const id = await charId();
    const p1 = await upgrades(ann, { slot: 'head', max_level: 30, min_ac: 3 });
    for (const c of comps(p1)) expect(c.custom_id, c.custom_id).toContain(':c30a3');
    const bigger = byPrefix(p1, PAGE_PREFIX)[1];
    const p2 = await send(press(ann, bigger.custom_id));
    expect(text(p2)).toContain('Filtered: AC 3+');
    expect(text(p2)).toContain(UPGRADES_COPY.belowAc(2, 3));
    expect(byPrefix(p2, RESULT_PREFIX)[0].options.map((o: any) => o.label)).toEqual(['Helm 8', 'Helm 9']);
    // Pick a result → I'm wearing it now → the list again, still filtered.
    const pick = await send(select(ann, byPrefix(p1, RESULT_PREFIX)[0].custom_id, [String((await one<{ id: number }>("SELECT id FROM item WHERE name = 'Helm 4'")).id)]));
    const now = byPrefix(pick, WEAR_NOW_PREFIX)[0];
    expect(now.custom_id).toContain(':head:c30a3:');
    const after = await send(press(ann, now.custom_id));
    expect(text(after)).toContain('Filtered: AC 3+');
    expect(text(after)).not.toContain('Helm 3');
    // Post to channel: the filter line, no buttons.
    const post = byPrefix(p1, POST_PREFIX)[0];
    const pub = await send(press(ann, post.custom_id));
    expect(pub.data.flags ?? 0).toBe(0);
    expect(text(pub)).toContain('Filtered: AC 3+');
    expect(pub.data.components ?? []).toEqual([]);
    // The summary's Pick a slot carries the cap only, and a floor in a hand-made gus: id is dropped.
    expect(byPrefix(await upgrades(ann, { max_level: 30 }), SLOT_PREFIX)[0].custom_id).toBe(`${SLOT_PREFIX}${id}:c30`);
    expect(text(await send(select(ann, `${SLOT_PREFIX}${id}:c30a3`, ['head'])))).not.toContain('Filtered');
    // An old control with no filter state reads as no filter.
    expect(text(await send(press(ann, `${PAGE_PREFIX}${id}:head:10:0`)))).not.toContain('Filtered');
  });

  it("an officer's view of a member's list has Filter (no Post to channel), and filtering works there", async () => {
    await chest();
    const id = await charId();
    const r = await send(press(officer, `${FIND_UPGRADES_PREFIX}${id}`));
    const list = await send(select(officer, byPrefix(r, SLOT_PREFIX)[0].custom_id, ['chest']));
    expect(filterButton(list)).toBeTruthy();
    expect(byPrefix(list, POST_PREFIX)).toHaveLength(0);
    expect(text(await filterWith(list, { ac: '10' }, officer))).toContain('Filtered: AC 10+');
  });

  it('a bad value answers privately with what is allowed and changes nothing', async () => {
    await primary();
    const list = await upgrades(ann, { slot: 'primary' });
    const form = await send(press(ann, filterButton(list).custom_id));
    for (const [inputs, msg] of [[{ ac: 'ten' }, UPGRADES_COPY.badAc], [{ ac: '10000' }, UPGRADES_COPY.badAc], [{ ac: '', ratio: '0.4499' }, UPGRADES_COPY.badRatio], [{ ratio: '100' }, UPGRADES_COPY.badRatio]] as const) {
      const { ack, calls } = await exchange(submit(ann, form.data.custom_id!, inputs));
      expect(ack.type).toBe(6);
      expect(calls.map((c) => c.method)).toEqual(['POST']); // a private follow-up; the list is not edited
      expect(calls[0].body.content).toBe(msg);
      expect(calls[0].body.flags).toBe(64);
    }
  });
});

describe('order 43: min_ac: and min_ratio: on /gear upgrades', () => {
  it('apply with slot:; without it the summary says so once; min_ratio: on a non-weapon slot is ignored with one line', async () => {
    await chest();
    const s = await upgrades(ann, { min_ac: 10 });
    expect(s.data.content).toBe("min_ac and min_ratio apply to one slot's list: add slot:.");
    expect(text(s)).not.toContain('Filtered');
    const r = await upgrades(ann, { slot: 'chest', min_ratio: 0.5 });
    expect(text(r)).toContain('min_ratio applies to weapon slots (Primary, Secondary, Range).');
    expect(text(r)).not.toContain('Filtered');
    expect(filterButton(r).custom_id).toMatch(/:c$/);
    // The command and the form give the same list.
    const viaForm = await filterWith(await upgrades(ann, { slot: 'chest' }), { ac: '10' });
    expect(text(await upgrades(ann, { slot: 'chest', min_ac: 10 }))).toBe(text(viaForm));
    // min_ratio: is kept to 3 decimals, as /gear search keeps it.
    await primary();
    expect(filterButton(await upgrades(ann, { slot: 'primary', min_ratio: 0.44999 })).custom_id).toMatch(/:cr450$/);
  });
});

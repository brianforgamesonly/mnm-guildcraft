// Work order 36, PR B (ITEM 4): /gear weights and /gear settings (src/gear/weights.ts), and the race names.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OFFICER_ONLY } from '../../src/commands/members.ts';
import { NOT_YET } from '../../src/interactions.ts';
import { defaultWeights, weightsFor, WEIGHT_KEYS } from '../../src/gear/score.ts';
import { RACE_NAMES, raceLabel } from '../../src/gear/vocab.ts';
import { WEIGHTS_COPY } from '../../src/gear/weights.ts';
import { raceName } from '../../scripts/import/core.ts';
import { all, markImported, one, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, press, rawCmd, send, type Member, type Reply } from '../discord.ts';

const ANN = '100000000000000001';
const OFFICER = '100000000000000009';
const ann = as(ANN);
const officer = as(OFFICER, { permissions: ADMIN, nick: 'Joegandomi' });
const REVIEW = '600000000000000010';
const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const GUILD_ID = '900000000000000001';
let posted: { path: string; body: any }[];

beforeEach(async () => {
  await reset(undefined, [['FTR', 10], ['INQ', 10], ['WIZ', 10]]);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM gear_weight'),
    env.DB.prepare('DELETE FROM gear_setting'),
    env.DB.prepare("UPDATE game_class SET bit = CASE code WHEN 'FTR' THEN 0 WHEN 'INQ' THEN 1 WHEN 'WIZ' THEN 2 END"),
    env.DB.prepare('DELETE FROM item'),
    ...[
      ['Plate Vest', '{"ac":10}', 5], // INQ default: +3.50
      ['Stamina Vest', '{"stats":{"STA":2}}', 5], // +2.00
      ['Far Vest', '{"stats":{"STA":1}}', 30], // +1.00, Lv 30: above a level-15 character at window 10
    ].map(([name, stats, low]) =>
      env.DB.prepare("INSERT INTO item (name, name_key, slot, stats_json, source, imported_at, slot_mask, class_mask, race_mask, level_low, level_high, level_kind, level_kinds) VALUES (?, ?, 'X', ?, 'wiki', 't', 32, -1, -1, ?, ?, 'mob', 'mob')").bind(name, String(name).toLowerCase(), stats, low, low),
    ),
  ]);
  await markImported();
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

const weights = (m: Member, o: Record<string, unknown>) => send(rawCmd(m, 'gear', 'weights', o), TOKEN);
const settings = (m: Member, o: Record<string, unknown> = {}) => send(rawCmd(m, 'gear', 'settings', o), TOKEN);
const chest = async () => (await send(rawCmd(ann, 'gear', 'upgrades', { slot: 'chest' }), TOKEN)).data.embeds![0].description!;
/** The listed results (before Level unknown), in order. */
const order = (desc: string) => {
  const d = desc.split('__Level unknown__')[0];
  return ['Plate Vest', 'Stamina Vest', 'Far Vest'].filter((n) => d.includes(`**${n}**`)).sort((a, b) => d.indexOf(`**${a}**`) - d.indexOf(`**${b}**`));
};
const stored = () => all<{ class: string; stat: string; value: number; set_by: string }>('SELECT class, stat, value, set_by FROM gear_weight ORDER BY class, stat');
const field = (r: Reply, name: string) => r.data.embeds![0].fields!.find((f) => f.name === name)!.value;

async function testchar() {
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }), TOKEN);
  await env.DB.prepare("UPDATE character SET class = 'INQ', level = 15 WHERE name = 'Testchar'").run();
  await env.DB.prepare('UPDATE guild SET review_channel_id = ?').bind(REVIEW).run();
}

describe('order 36, ITEM 4: /gear weights', () => {
  it('shows a class\'s 22 weights in one embed, each "default" until changed', async () => {
    const r = await weights(officer, { class: 'INQ' });
    expect(r.data.embeds![0].title).toBe('Inquisitor weights');
    expect(r.data.embeds![0].fields).toHaveLength(22);
    expect(field(r, 'STA')).toBe('1 · default');
    expect(field(r, 'AC')).toBe('0.35 · default');
    expect(field(r, 'Mana regen')).toBe('1 · default');
    expect(posted).toEqual([]);
  });

  it('one weight change: stored as the absolute value with who, posted with who and old → new, and it changes the ranking', async () => {
    await testchar();
    expect(order(await chest())).toEqual(['Far Vest', 'Stamina Vest', 'Plate Vest']); // +1.00, +2.00, +3.50 (no cap)
    const r = await weights(officer, { class: 'INQ', stat: 'AC', value: 0.05 });
    expect(r.data.content).toBe(WEIGHTS_COPY.saved('Inquisitor', 'posted'));
    expect(await stored()).toEqual([{ class: 'INQ', stat: 'AC', value: 5, set_by: OFFICER }]);
    expect(posted).toHaveLength(1);
    expect(posted[0].path).toBe(`/channels/${REVIEW}/messages`);
    expect(posted[0].body.content).toBe(`**/gear upgrades weights:** <@${OFFICER}> (Joegandomi) set AC for **Inquisitor**.\nAC: 0.35 → 0.05`);
    expect(posted[0].body.allowed_mentions).toEqual({ parse: [] });
    // Plate Vest is now +0.50: the order changes. With AC 0, it goes.
    expect(order(await chest())).toEqual(['Plate Vest', 'Far Vest', 'Stamina Vest']);
    await weights(officer, { class: 'INQ', stat: 'AC', value: 0 });
    expect(order(await chest())).toEqual(['Far Vest', 'Stamina Vest']);
    expect(field(await weights(officer, { class: 'INQ' }), 'AC')).toMatch(/^\*\*0\*\* \(default 0\.35\) · changed by <@100000000000000009> \(Joegandomi\), <t:\d+:d>$/);
  });

  it('a preset, then one stat, then reset: only differences stored; reset deletes the rows; each change posted', async () => {
    await testchar();
    await weights(officer, { class: 'INQ', preset: 'Caster' });
    // The Caster preset with the Inquisitor's own priorities: AC 0.03, HP 0.05, Mana 0.08, resists 0.05, no ratio or haste,
    // HP regen 0.5, mana regen 2. Attributes unchanged, so not stored.
    const rows = await stored();
    expect(Object.fromEntries(rows.map((r) => [r.stat, r.value]))).toEqual({
      AC: 3, HP: 5, MANA: 8, MR: 5, PR: 5, DR: 5, FR: 5, CORR: 5, CR: 5, ER: 5, HR: 5, RATIO: 0, HASTE: 0, HPREGEN: 50, MANAREGEN: 200,
    });
    await weights(officer, { class: 'INQ', stat: 'HP', value: 0.1 }); // back to the default: its row goes
    expect((await stored()).some((r) => r.stat === 'HP')).toBe(false);
    await weights(officer, { class: 'INQ', reset: true });
    expect(await stored()).toEqual([]);
    expect(posted.map((p) => p.body.content.split('\n')[0])).toEqual([
      `**/gear upgrades weights:** <@${OFFICER}> (Joegandomi) applied the Caster preset for **Inquisitor**.`,
      `**/gear upgrades weights:** <@${OFFICER}> (Joegandomi) set HP for **Inquisitor**.`,
      `**/gear upgrades weights:** <@${OFFICER}> (Joegandomi) reset to the defaults for **Inquisitor**.`,
    ]);
    expect(await weightsFor(env.DB, GUILD_ID, 'INQ')).toEqual(defaultWeights('INQ'));
  });

  it('refused: non-officers; values out of range or off the 0.05 step; unlisted combinations; nothing stored or posted', async () => {
    await testchar();
    expect((await weights(ann, { class: 'INQ' })).data.content).toBe(OFFICER_ONLY);
    expect((await weights(ann, { class: 'INQ', stat: 'AC', value: 0 })).data.content).toBe(OFFICER_ONLY);
    expect((await weights(officer, { class: 'INQ', stat: 'AC', value: 2.05 })).data.content).toBe(WEIGHTS_COPY.range);
    expect((await weights(officer, { class: 'INQ', stat: 'AC', value: 0.07 })).data.content).toBe(WEIGHTS_COPY.step);
    for (const o of [{ stat: 'AC' }, { value: 1 }, { preset: 'Tank', stat: 'AC', value: 1 }, { preset: 'Tank', reset: true }, { reset: false }, { stat: 'AC', value: 1, reset: true }])
      expect((await weights(officer, { class: 'INQ', ...o })).data.content, JSON.stringify(o)).toBe(WEIGHTS_COPY.shapes);
    expect((await weights(officer, { class: 'XYZ' })).data.content).toBe(WEIGHTS_COPY.unknownClass('XYZ'));
    expect(await stored()).toEqual([]);
    expect(await all('SELECT * FROM gear_setting')).toEqual([]);
    expect(posted).toEqual([]);
  });

  it("one server's change doesn't touch another's", async () => {
    await testchar();
    await weights(officer, { class: 'INQ', stat: 'AC', value: 1 });
    expect((await weightsFor(env.DB, GUILD_ID, 'INQ')).AC).toBe(100);
    expect(await weightsFor(env.DB, '900000000000000002', 'INQ')).toEqual(defaultWeights('INQ'));
    expect(WEIGHT_KEYS).toHaveLength(22);
  });

  it('with no review channel set, the change applies and the reply says nothing was posted', async () => {
    const r = await weights(officer, { class: 'WIZ', stat: 'INT', value: 2 });
    expect(r.data.content).toBe(WEIGHTS_COPY.saved('Wizard', 'unset'));
    expect(posted).toEqual([]);
    expect(await stored()).toEqual([{ class: 'WIZ', stat: 'INT', value: 200, set_by: OFFICER }]);
  });

  it('a refused post is reported as refused (the change is saved), not as "no review channel"', async () => {
    await testchar();
    botApi.handle = () => new Response(JSON.stringify({ message: 'Missing Permissions', code: 50013 }), { status: 403 });
    const r = await weights(officer, { class: 'INQ', stat: 'AC', value: 0 });
    expect(r.data.content).toBe(WEIGHTS_COPY.saved('Inquisitor', 'refused'));
    expect(await stored()).toEqual([{ class: 'INQ', stat: 'AC', value: 0, set_by: OFFICER }]);
  });

  it("reset deletes every row of the class, even a stale one (a retired stat, a value the default has become); a setter with no name shows as the mention", async () => {
    await testchar();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO gear_weight (guild_id, class, stat, value, set_at, set_by) VALUES (?, 'INQ', 'SPELLHASTE', 50, 't', '1'), (?, 'INQ', 'AC', 35, '2026-11-06T00:00:00Z', '42')").bind(GUILD_ID, GUILD_ID),
    ]);
    // Weights equal the defaults, yet rows remain: reset still clears them.
    expect(field(await weights(officer, { class: 'INQ' }), 'AC')).toMatch(/^\*\*0\.35\*\* \(default 0\.35\) · changed by <@42>, <t:\d+:d>$/);
    const r = await weights(officer, { class: 'INQ', reset: true });
    expect(r.data.content).not.toBe(WEIGHTS_COPY.noChange('Inquisitor'));
    expect(await stored()).toEqual([]);
    // With nothing stored, a second reset changes nothing and posts nothing more.
    const n = posted.length;
    expect((await weights(officer, { class: 'INQ', reset: true })).data.content).toBe(WEIGHTS_COPY.noChange('Inquisitor'));
    expect(posted).toHaveLength(n);
  });
});

describe('order 36 follow-up: /gear settings is retired', () => {
  it('answers "not available" for anyone, writes nothing, posts nothing; a saved window row is ignored and kept', async () => {
    await testchar();
    await env.DB.prepare("INSERT INTO gear_setting (guild_id, key, value, set_at, set_by) VALUES (?, 'window', 0, 't', ?)").bind(GUILD_ID, OFFICER).run();
    for (const m of [officer, ann]) expect((await settings(m, { window: 5 })).data.content).toBe(NOT_YET);
    expect(posted).toEqual([]);
    // No cap: the stored window of 0 changes nothing; Far Vest (Lv 30) is listed.
    expect(order(await chest())).toEqual(['Far Vest', 'Stamina Vest', 'Plate Vest']);
    expect(await all('SELECT key, value FROM gear_setting')).toEqual([{ key: 'window', value: 0 }]);
  });
});

describe('order 36, PR B: race names', () => {
  it('the twelve character races have names; the mount races stay codes; the import writes the name', async () => {
    expect(Object.keys(RACE_NAMES).sort()).toEqual(['DDF', 'DEF', 'DGN', 'DWF', 'ELF', 'GNM', 'GOB', 'HFL', 'HIE', 'HUM', 'OGR', 'TRL']);
    expect([raceLabel('HUM'), raceLabel('ELF'), raceLabel('HRS'), raceLabel('DNK')]).toEqual(['Human', 'Wood Elf', 'HRS', 'DNK']);
    expect([raceName('DGN'), raceName('HRS')]).toEqual(['Deep Gnome', null]);
  });

  it('the Add character form lists races by name, keeping the code as the value', async () => {
    await env.DB.prepare("INSERT INTO game_race (code, item_count, bit, mount, name) VALUES ('HUM', 5, 0, 0, 'Human'), ('HIE', 5, 1, 0, 'High Elf'), ('HRS', 9, 2, 1, NULL)").run();
    await send(rawCmd(ann, 'me', undefined), TOKEN);
    const form = await send(press(ann, `mea:${ANN}`), TOKEN);
    const race = (form.data as any).components.find((c: any) => c.component?.custom_id === 'race').component;
    expect(race.options.map((o: any) => [o.label, o.value])).toEqual([['No race (any)', 'none'], ['High Elf', 'HIE'], ['Human', 'HUM']]);
  });
});

void one;

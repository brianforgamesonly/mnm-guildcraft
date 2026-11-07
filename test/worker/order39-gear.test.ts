// Work order 39: one character head, full item stats on /gear upgrades with the changes marked, and the shared stat line.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { characterHead, HEAD_COPY } from '../../src/commands/character.ts';
import { statFields } from '../../src/commands/find.ts';
import { markedLine, parseStats, plainLine, STAT_COPY } from '../../src/gear/statline.ts';
import { PANEL_PREFIX } from '../../src/gear/wear.ts';
import { RESULT_PREFIX, UPGRADES_COPY } from '../../src/gear/upgrades.ts';
import { POST_PREFIX } from '../../src/commands/share.ts';
import { bitOf, raceLabel, SLOTS } from '../../src/gear/vocab.ts';
import { markImported, one, reset } from '../db.ts';
import { as, cmd, press, rawCmd, select, send, type Member, type Reply } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
type Tok = (typeof SLOTS)[number];
const slot = (...t: Tok[]) => t.reduce((m, s) => m | bitOf(SLOTS, s), 0);
const S = (o: Record<string, unknown>) => parseStats(JSON.stringify(o));

describe('order 39, ITEM 3: the stat line (src/gear/statline.ts)', () => {
  const worn = S({ ac: 5, stats: { STA: 3, WIS: 4, AGI: 3 }, resists: { MR: 2 } });
  it('marks up, down, lost and unchanged; a stat on neither is not shown; values read as the card shows them', () => {
    const cand = S({ ac: 7, stats: { STA: 5, AGI: 1 }, resists: { MR: 2 } });
    expect(markedLine(cand, { items: [worn], hasteElsewhere: 0 }, false)).toBe('**AC 7 ▲+2** · **AGI +1 ▼−2** · **STA +5 ▲+2** · **WIS — ▼−4** · MR +2');
  });
  it('changes only: the unchanged stats go, the lost one stays', () => {
    const cand = S({ ac: 5, stats: { STA: 5 }, resists: { MR: 2 } });
    expect(markedLine(cand, { items: [worn], hasteElsewhere: 0 }, true)).toBe('**AGI — ▼−3** · **STA +5 ▲+2** · **WIS — ▼−4**');
  });
  it('an empty slot: every stat is new', () => {
    expect(markedLine(S({ ac: 3, hp: 10 }), { items: [], hasteElsewhere: 0 }, false)).toBe('**AC 3 ▲+3** · **HP +10 ▲+10**');
  });
  it('a pair: numbers add up (as scoring adds them); damage and delay against Primary, said so', () => {
    const primary = S({ dmg: 10, delay: 30, stats: { STR: 2 } });
    const secondary = S({ ac: 4, stats: { STR: 1 } });
    const twoHander = S({ dmg: 20, delay: 40, stats: { STR: 3 } });
    expect(markedLine(twoHander, { items: [primary, secondary], hasteElsewhere: 0 }, false)).toBe('**AC — ▼−4** · **Damage 20 ▲+10** / **40 delay ▲+10** (vs Primary) · STR +3');
  });
  it('haste is marked as scoring counts it (above the haste worn elsewhere), with the note whenever that limits it', () => {
    const note = `(${STAT_COPY.hasteNoStack(15)})`;
    expect(markedLine(S({ haste: 10 }), { items: [], hasteElsewhere: 15 }, false)).toBe(`Haste 10 ${note}`);
    expect(markedLine(S({ haste: 10 }), { items: [], hasteElsewhere: 15 }, true)).toBe('');
    expect(markedLine(S({ haste: 20 }), { items: [], hasteElsewhere: 15 }, false)).toBe(`**Haste 20 ▲+5** ${note}`);
    expect(markedLine(S({ haste: 20 }), { items: [], hasteElsewhere: 0 }, false)).toBe('**Haste 20 ▲+20**');
    // Review fix: a lost haste that didn't count anyway is no loss; one that did is.
    expect(markedLine(S({ ac: 1 }), { items: [S({ ac: 1, haste: 10 })], hasteElsewhere: 15 }, true)).toBe('');
    expect(markedLine(S({ ac: 1 }), { items: [S({ ac: 1, haste: 20 })], hasteElsewhere: 0 }, true)).toBe('**Haste — ▼−20**');
    expect(markedLine(S({ haste: 40 }), { items: [S({ haste: 10 })], hasteElsewhere: 30 }, true)).toBe('**Haste 40 ▲+10** (doesn\'t stack: Haste 30 worn elsewhere)');
  });
  it('review fix: against a pair, damage is Primary\'s even when Primary has none or is empty; a shared lost effect shows once; fractions stay tidy', () => {
    const dagger = S({ dmg: 5, delay: 20, effect: { name: 'Glow' } });
    const maul = S({ dmg: 30, delay: 40 });
    expect(markedLine(maul, { items: [S({ ac: 2, effect: { name: 'Glow' } }), dagger], hasteElsewhere: 0 }, true)).toBe(`**AC — ▼−2** · **Damage 30 ▲+30** / **40 delay ▲+40** (${STAT_COPY.vsPrimary}) · **${STAT_COPY.effectLost('Glow')}**`);
    expect(markedLine(maul, { items: [null, dagger], hasteElsewhere: 0 }, true)).toBe(`**Damage 30 ▲+30** / **40 delay ▲+40** (${STAT_COPY.vsPrimary}) · **${STAT_COPY.effectLost('Glow')}**`);
    expect(markedLine(S({ ac: 0.3 }), { items: [S({ ac: 0.1 }), S({ ac: 0.2 })], hasteElsewhere: 0 }, true)).toBe('');
  });
  it('the effect: plain when the same, marked when new or lost', () => {
    const fire = { name: 'Fire Bolt', trigger: 'Combat' };
    expect(markedLine(S({ ac: 1, effect: fire }), { items: [S({ ac: 1, effect: fire })], hasteElsewhere: 0 }, false)).toBe('AC 1 · Effect: Fire Bolt (Combat)');
    expect(markedLine(S({ ac: 1, effect: fire }), { items: [S({ ac: 1, effect: fire })], hasteElsewhere: 0 }, true)).toBe('');
    expect(markedLine(S({ ac: 1, effect: fire }), { items: [S({ ac: 1 })], hasteElsewhere: 0 }, true)).toBe(`**Effect: Fire Bolt (Combat) (${STAT_COPY.newEffect})**`);
    expect(markedLine(S({ ac: 1 }), { items: [S({ ac: 1, effect: fire })], hasteElsewhere: 0 }, true)).toBe(`**${STAT_COPY.effectLost('Fire Bolt (Combat)')}**`);
  });
  it('one stat line: the /item card shows the same words for every stat (Damage and delay together, as on the card)', () => {
    const json = { ac: 12, dmg: 20, delay: 30, skill: 'SLA', hp: 15, mana: -5, stats: { STR: 2, AGI: -1 }, resists: { FR: 3 }, haste: 10, hpRegen: 1, manaRegen: 2, effect: { name: 'Fire Bolt', trigger: 'Combat' }, weight: 4 };
    const card = statFields({ id: 1, name: 'X', icon_url: null, slot: 'PRIMARY', stats_json: JSON.stringify(json), wiki_url: null, source: 'wiki' });
    const v = (n: string) => card.find((f) => f.name === n)?.value;
    expect(plainLine(S(json))).toBe('AC 12 · Damage 20 / 30 delay · HP +15 · Mana -5 · AGI -1 · STR +2 · FR +3 · Haste 10 · HP regen 1 · Mana regen 2 · Effect: Fire Bolt (Combat)');
    expect([v('AC'), v('Damage'), v('HP'), v('Mana'), v('Stats'), v('Resists'), v('Haste'), v('HP regen'), v('Mana regen'), v('Effect')]).toEqual(['12', '20 / 30 delay · SLA', '+15', '-5', 'AGI -1 · STR +2', 'FR +3', '10', '1', '2', 'Fire Bolt (Combat)']);
  });
});

// ---------------------------------------------------------------- rendered (the member's artefact)

interface Seed {
  name: string;
  slots: Tok[];
  stats?: Record<string, unknown>;
}
const seed = (items: Seed[]) =>
  env.DB.batch([
    env.DB.prepare('DELETE FROM item'),
    ...items.map((i) =>
      env.DB.prepare("INSERT INTO item (name, name_key, slot, stats_json, source, imported_at, slot_mask, class_mask, race_mask, level_low, level_high, level_kind, level_kinds) VALUES (?, ?, 'X', ?, 'wiki', 't', ?, -1, -1, 5, 5, 'mob', 'mob')").bind(
        i.name, i.name.toLowerCase(), JSON.stringify(i.stats ?? {}), slot(...i.slots),
      ),
    ),
  ]);

beforeEach(async () => {
  await reset(undefined, [['FTR', 10], ['INQ', 10], ['RNG', 10]]);
  await env.DB.batch([
    env.DB.prepare("UPDATE game_class SET bit = CASE code WHEN 'FTR' THEN 0 WHEN 'INQ' THEN 1 WHEN 'RNG' THEN 2 END"),
    env.DB.prepare("INSERT INTO game_race (code, item_count, bit, mount) VALUES ('HFL', 5, 0, 0)"),
  ]);
});

const add = (name: string, m: Member = ann) => send(cmd(m, 'character', 'add', { name }));
const charId = async (name: string) => (await one<{ id: number }>('SELECT id FROM character WHERE name = ?', name)).id;
const setChar = (name: string, cls: string | null, level: number | null, race: string | null) => env.DB.prepare('UPDATE character SET class = ?, level = ?, race = ? WHERE name = ?').bind(cls, level, race, name).run();
const wearIt = async (char: string, slotKey: string, item: string) =>
  env.DB.prepare("INSERT INTO character_gear (character_id, guild_id, slot, item_key, set_at, set_by) VALUES (?, '900000000000000001', ?, ?, 't', 'x')").bind(await charId(char), slotKey, item.toLowerCase()).run();
const upgrades = (o: Record<string, unknown> = {}) => send(rawCmd(ann, 'gear', 'upgrades', o));
const desc = (r: Reply) => r.data.embeds![0].description!;
const comps = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components) as any[];

describe('order 39, ITEM 1: one character head', () => {
  it('the Gear panel, the card, the add/edit reply and /gear upgrades read the same; the class by name, the race once', async () => {
    await add('Banakil');
    await setChar('Banakil', 'RNG', 18, 'HFL');
    await markImported();
    const head = `**Banakil** · Ranger · level 18 · ${raceLabel('HFL')}`;
    const panel = await send(press(ann, `${PANEL_PREFIX}${await charId('Banakil')}`));
    expect(panel.data.content!.split('\n')[0]).toBe(head);
    expect((await send(rawCmd(ann, 'me', undefined))).data.embeds![0].description!.split('\n')[0]).toBe(`Ranger · level 18 · ${raceLabel('HFL')}`);
    expect(desc(await upgrades()).split('\n')[0]).toBe(head);
    expect((await send(cmd(ann, 'character', 'edit', { name: 'Banakil', level: 19 }))).data.content).toBe(`Updated **Banakil** · Ranger · level 19 · ${raceLabel('HFL')}.`);
    expect(head).not.toContain('race ');
  });
  it('no class, no level, no race; and a stored class outside the list, with its marker and the default-weights footer', async () => {
    expect(characterHead({ name: 'A', class: null, level: null, race: null }, false)).toBe('**A** · no class · no level · any race');
    await add('Banakil');
    await setChar('Banakil', 'Halfling', 18, 'HFL');
    await markImported();
    const head = `**Banakil** · Halfling ${HEAD_COPY.notGameClass} · level 18 · ${raceLabel('HFL')}`;
    expect((await send(press(ann, `${PANEL_PREFIX}${await charId('Banakil')}`))).data.content!.split('\n')[0]).toBe(head);
    const r = await upgrades();
    expect(desc(r).split('\n')[0]).toBe(head);
    expect(r.data.embeds![0].footer!.text).toContain(UPGRADES_COPY.defaultWeights);
    expect(r.data.embeds![0].footer!.text).not.toContain('HALFLING');
  });
});

describe('order 39, ITEM 3: full stats on /gear upgrades, changes marked', () => {
  /** An Inquisitor (STA 1, INT 0.5, STR 0.25, WIS 0.25; AGI 0) with two wrist items and a primary/secondary pair. */
  async function inq() {
    await add('Testchar');
    await setChar('Testchar', 'INQ', 20, null);
    await seed([
      { name: 'Old Bracer', slots: ['WRIST'], stats: { ac: 2, stats: { STA: 1, WIS: 4 } } },
      { name: 'Silver Bracer', slots: ['WRIST'], stats: { ac: 3, stats: { STA: 6, AGI: 2 } } },
      { name: 'Fine Bracer', slots: ['WRIST'], stats: { ac: 4, stats: { STA: 8, AGI: 1 } } },
      { name: 'Copper Blade', slots: ['PRIMARY'], stats: { dmg: 10, delay: 30, stats: { STA: 1 } } },
      { name: 'Small Shield', slots: ['SECONDARY'], stats: { ac: 4 } },
      { name: 'Great Maul', slots: ['PRIMARY'], stats: { dmg: 30, delay: 45, handed: 'Two Handed', stats: { STA: 9 } } },
      { name: 'Plain Shirt', slots: ['SHIRT'], stats: { ac: 1, stats: { STA: 2 } } },
    ]);
    await wearIt('Testchar', 'wrist1', 'Old Bracer');
    await wearIt('Testchar', 'wrist2', 'Silver Bracer');
    await wearIt('Testchar', 'primary', 'Copper Blade');
    await wearIt('Testchar', 'secondary', 'Small Shield');
    await markImported();
  }

  it('the Wrist list: each worn side with its score and full stats; each result its full stats marked against the side it replaces', async () => {
    await inq();
    const d = desc(await upgrades({ slot: 'wrist' }));
    const lines = d.split('\n');
    expect(lines).toContain('Wrist 1: Old Bracer (score 2.70)');
    expect(lines[lines.indexOf('Wrist 1: Old Bracer (score 2.70)') + 1]).toBe('AC 2 · STA +1 · WIS +4');
    expect(lines[lines.indexOf('Wrist 2: Silver Bracer (score 7.05)') + 1]).toBe('AC 3 · AGI +2 · STA +6');
    // Weaker side Wrist 1: the candidates compare with Old Bracer. AGI weighs 0 for an Inquisitor and is still marked.
    const fine = lines.findIndex((l) => l.startsWith('**Fine Bracer**'));
    expect(lines[fine]).toContain(UPGRADES_COPY.replaces('Wrist 1'));
    expect(lines[fine + 1]).toBe('**AC 4 ▲+2** · **AGI +1 ▲+1** · **STA +8 ▲+7** · **WIS — ▼−4**');
  });

  it('a two-hander against Primary and Secondary: the pair adds up, damage and delay against Primary', async () => {
    await inq();
    const d = desc(await upgrades({ slot: 'primary' }));
    const lines = d.split('\n');
    const maul = lines.findIndex((l) => l.startsWith('**Great Maul**'));
    expect(lines[maul + 1]).toBe(`**AC — ▼−4** · **Damage 30 ▲+20** / **45 delay ▲+15** (${STAT_COPY.vsPrimary}) · **STA +9 ▲+8**`);
    // The header shows both hands with their full stats.
    expect(lines[lines.indexOf('Primary: Copper Blade (score 4.30)') + 1]).toBe('Damage 10 / 30 delay · STA +1');
  });

  it('an empty slot: the header reads as before; every stat of a result is new', async () => {
    await inq();
    const lines = desc(await upgrades({ slot: 'shirt' })).split('\n');
    expect(lines).toContain(UPGRADES_COPY.wornEmpty('Shirt'));
    expect(lines[lines.findIndex((l) => l.startsWith('**Plain Shirt**')) + 1]).toBe('**AC 1 ▲+1** · **STA +2 ▲+2**');
  });

  it('the summary shows each line with its changed stats only, marked', async () => {
    await inq();
    const lines = desc(await upgrades()).split('\n');
    // The smallest Wrist upgrade is Silver Bracer (worn on the other side, still a candidate for the weaker one).
    const wrist = lines.findIndex((l) => l.startsWith('**Wrist:**'));
    expect(lines[wrist]).toContain('Silver Bracer');
    expect(lines[wrist + 1]).toBe('**AC 3 ▲+1** · **AGI +2 ▲+2** · **STA +6 ▲+5** · **WIS — ▼−4**');
    const shirt = lines.findIndex((l) => l.startsWith('**Shirt:**'));
    expect(lines[shirt + 1]).toBe('**AC 1 ▲+1** · **STA +2 ▲+2**');
  });

  it('Pick a result: the changed stats only above the card; the card keeps the full stats', async () => {
    await inq();
    await seed([
      { name: 'Old Bracer', slots: ['WRIST'], stats: { ac: 2, stats: { STA: 1, WIS: 4 } } },
      { name: 'Silver Bracer', slots: ['WRIST'], stats: { ac: 3, stats: { STA: 6, AGI: 2 } } },
      { name: 'Same Bracer', slots: ['WRIST'], stats: { ac: 2, stats: { STA: 3, WIS: 4 } } },
    ]);
    await markImported();
    const list = await upgrades({ slot: 'wrist' });
    const pick = comps(list).find((c) => c.custom_id?.startsWith(RESULT_PREFIX));
    const r = await send(select(ann, pick.custom_id, [String((await one<{ id: number }>("SELECT id FROM item WHERE name = 'Same Bracer'")).id)]));
    expect(r.data.content!.split('\n')[2]).toBe('**STA +3 ▲+2**'); // AC and WIS unchanged: not repeated
    expect(r.data.embeds![0].fields!.find((f) => f.name === 'Stats')!.value).toBe('STA +3 · WIS +4');
  });

  it('Post to channel: the posted page reads the same as the private one', async () => {
    await inq();
    const priv = await upgrades({ slot: 'wrist' });
    const post = comps(priv).find((c) => c.custom_id?.startsWith(POST_PREFIX));
    const posted = await send(press(ann, post.custom_id));
    expect(posted.data.embeds![0].description).toBe(desc(priv));
  });
});

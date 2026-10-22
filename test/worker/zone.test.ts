// Work order 17, ITEMs 2–3: /zone in workerd, on zone data loaded by the real import (scripts/import/core.ts, zones.ts).
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport } from '../../scripts/import/core.ts';
import { COMMANDS, commandLimitProblems, DEFINED } from '../../src/commands/definitions.ts';
import { HELP_TEXT } from '../../src/commands/help.ts';
import { ZONE_REPLY_COPY } from '../../src/commands/zone.ts';
import { WELCOME } from '../../src/commands/welcome.ts';
import { HOW_TO_GET_LISTED } from '../../src/board/render.ts';
import { decodeState, encodeState, sortByKey, ANY } from '../../src/gear/options.ts';
import { EMBED_LIMITS } from '../../src/discord.ts';
import { cleanNotes, creaturesOf, fitLines, ZONE_COPY } from '../../src/zone/card.ts';
import { count, reset } from '../db.ts';
import { as, botApi, GUILD, press, select, send, type Member } from '../discord.ts';
import small from '../fixtures/wiki-small.json';
import { withZoneWiki, zoneInput } from '../fixtures/zones-small.ts';

const ann = as('100000000000000001');
const zone = (name: string, m: Member = ann, opts: { env?: Record<string, unknown> } = {}) =>
  send({ type: 2, guild_id: GUILD, member: m, data: { name: 'zone', options: [{ type: 3, name: 'name', value: name }] } }, opts);
const auto = (command: string, sub: string | null, name: string, value: string) =>
  send({
    type: 4,
    guild_id: GUILD,
    member: ann,
    data: { name: command, options: sub ? [{ type: 1, name: sub, options: [{ type: 3, name, value, focused: true }] }] : [{ type: 3, name, value, focused: true }] },
  });
const field = (r: Awaited<ReturnType<typeof send>>, name: string | RegExp) => r.data.embeds![0].fields!.find((f) => (typeof name === 'string' ? f.name === name : name.test(f.name)));

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  await env.DB.batch(['item', 'data_import', 'mob', 'zone', 'zone_name', 'npc', 'import_source'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const f = withZoneWiki(small);
  f.items['Weald Mail'] = { slot: 'CHEST', class: 'ALL', ac: 9, wikiZones: ['Evershade Weald'] };
  f.items['Weald Ring'] = { slot: 'FINGER', class: 'ALL', ac: 2, wikiZones: ['Evershade Weald'] };
  f.items['Another Ring'] = { slot: 'FINGER', class: 'ALL', ac: 2, wikiZones: ['Evershade Weald'] };
  f.items['Old Weald Belt'] = { slot: 'WAIST', class: 'ALL', ac: 50, wikiZones: ['Evershade Weald'], categories: ['Removed Items'] };
  f.items['Elsewhere Helm'] = { slot: 'HEAD', class: 'ALL', ac: 30, wikiZones: ['Rothold'] };
  const res = await runImport(bindingDb(env.DB as never), f, { sourceSha: 'b'.repeat(40), now: () => new Date().toISOString(), zones: zoneInput() });
  expect(res.status).toBe('ok');
  botApi.reset();
});

describe('/zone: the card', () => {
  it('a big zone: level text, a one-line description, creatures by level with find-on-map links, drops by AC then name, spots, credits', async () => {
    const r = await zone('Evershade Weald');
    expect(r.data.flags).toBe(64);
    const e = r.data.embeds![0] as { title: string; url?: string; description: string; footer: { text: string } };
    expect(e.title).toBe('Evershade Weald');
    expect(e.url).toBe('https://monstersandmemories.miraheze.org/wiki/Evershade_Weald');
    expect(e.description).toBe('**Levels:** 1 - ??\nA forest.');
    // mnm-tools' "A gnoll scout" (L8 - 10) keeps its level; Mo Betta adds Marshal Harding (20); the jackal (3) is mnm-tools only.
    const creatures = field(r, /^Creatures/)!;
    expect(creatures.name).toBe('Creatures (3)');
    expect(creatures.value.split('\n')).toEqual([
      'A curious jackal (L3) · [find on map](https://www.mnmatlas.com/?find=A%20curious%20jackal&map=evershade-weald)',
      'A gnoll scout (L8 - 10) · [find on map](https://www.mnmatlas.com/?find=A%20gnoll%20scout&map=evershade-weald)',
      'Marshal Harding (L20) · [find on map](https://www.mnmatlas.com/?find=Marshal%20Harding&map=evershade-weald)',
    ]);
    // AC first (highest), then name; Removed Items left out; items without AC last.
    expect(field(r, /^Notable drops/)!.value.split('\n')).toEqual(['Weald Mail · AC 9', 'Another Ring · AC 2', 'Weald Ring · AC 2', 'Gnoll Tooth']);
    expect(field(r, ZONE_COPY.spots)!.value.split('\n')).toEqual(['Copper Vein (ore)', 'Old Hermit (quest) — Ask twice']);
    expect(field(r, ZONE_COPY.adjacent)!.value).toBe("Keeper's Bight · Fields of the Lost");
    expect(field(r, ZONE_COPY.map)!.value).toBe(`${ZONE_COPY.noMap} · [${ZONE_COPY.openAtlas}](https://www.mnmatlas.com/evershade-weald/)`);
    expect(e.footer.text).toBe(ZONE_COPY.footer);
    expect(r.data.embeds!.filter((x) => x.title !== WELCOME.title)).toHaveLength(1); // no licensed map, atlas pictures off
  });

  it('the buttons: Post to channel and two links, then Gear here, More creatures, More drops (2 rows)', async () => {
    const r = await zone('evershade weald');
    const [links, actions] = r.data.components!;
    expect(r.data.components).toHaveLength(2);
    expect(links.components.map((b: any) => b.label)).toEqual(['Post to channel', ZONE_COPY.openAtlas, ZONE_COPY.wikiPage]);
    expect(links.components[1].url).toBe('https://www.mnmatlas.com/evershade-weald/');
    expect(actions.components.map((b: any) => [b.label, b.custom_id, b.disabled ?? false])).toEqual([
      [ZONE_COPY.gearHere, 'zg:evershade weald', false],
      [ZONE_COPY.moreCreatures, 'zc:evershade weald', false],
      [ZONE_COPY.moreDrops, 'zd:evershade weald', false],
    ]);
  });

  it('matches only on case and curly apostrophes', async () => {
    expect((await zone('KEEPER’S BIGHT')).data.embeds![0].title).toBe("Keeper's Bight");
  });

  it('a zone with no data says what is missing and links to the atlas', async () => {
    const r = await zone("Ail'Vorith");
    expect(field(r, ZONE_COPY.missingName)!.value).toBe(ZONE_COPY.missing(['creatures', 'drops', 'map'], 'https://www.mnmatlas.com/'));
    // A merchant is stored, never shown as a creature.
    expect(field(r, /^Creatures/)).toBeUndefined();
    const [, actions] = r.data.components!;
    expect(actions.components.map((b: any) => b.disabled ?? false)).toEqual([true, true, true]);
  });

  it('an unknown zone gets suggestions, never a dead end', async () => {
    const r = await zone('Evershade');
    expect(r.data.content).toBe([ZONE_REPLY_COPY.unknown('Evershade'), ZONE_REPLY_COPY.suggest(['Evershade Weald'])].join('\n'));
    const none = await zone('Qqq');
    expect(none.data.content).toContain(ZONE_REPLY_COPY.allZones(["Ail'Vorith", 'Evershade Weald', "Keeper's Bight", 'Rothold', 'Sunken Resort']));
  });

  it('shows MnM Atlas\'s whole-zone picture only while ATLAS_ZONE_IMAGES is on, credited and linked', async () => {
    await zone('Rothold'); // the member's first command carries the one-time welcome embed
    const off = await zone('Rothold');
    expect(off.data.embeds).toHaveLength(1);
    const on = await zone('Rothold', ann, { env: { ATLAS_ZONE_IMAGES: 'on' } });
    expect(on.data.embeds).toHaveLength(2);
    expect(on.data.embeds![1]).toEqual({ title: ZONE_COPY.atlasCredit, url: 'https://www.mnmatlas.com/rothold/', image: { url: 'https://www.mnmatlas.com/assets/cards/rothold.jpg' } });
    expect(field(on, ZONE_COPY.map)).toBeUndefined();
  });

  it('Post to channel posts the card publicly; its buttons answer each presser privately', async () => {
    const r = await zone('Evershade Weald');
    const posted = await send(press(ann, r.data.components![0].components[0].custom_id));
    expect(posted.data.flags).toBeUndefined();
    expect(posted.data.embeds![0].title).toBe('Evershade Weald');
    expect(posted.data.content).toBe(`-# Shared by <@${ann.user.id}>`);
    const more = await send(press(as('100000000000000002'), posted.data.components!.at(-1).components[1].custom_id));
    expect(more.type).toBe(4);
    expect(more.data.flags).toBe(64);
  });

  it('writes nothing but its read audit row (zone.view)', async () => {
    const before = await count('audit_log');
    await zone('Evershade Weald');
    expect(await count('audit_log')).toBe(before + 1);
    expect(await count('audit_log', "action = 'zone.view'")).toBe(1);
  });
});

describe('/zone: More creatures, More drops, Gear here', () => {
  it('More drops: a private page, sorted by AC then name; Previous/Next edit it in place', async () => {
    const f = withZoneWiki(small);
    for (let i = 0; i < 25; i++) f.items[`Weald Trinket ${String(i).padStart(2, '0')}`] = { slot: 'NECK', class: 'ALL', ac: i % 5, wikiZones: ['Evershade Weald'] };
    await runImport(bindingDb(env.DB as never), f, { sourceSha: 'c'.repeat(40), now: () => new Date().toISOString(), zones: zoneInput() });
    await zone('Evershade Weald'); // a command first: buttons read the guild row, never create it
    const page = await send(press(ann, 'zd:evershade weald'));
    expect(page.type).toBe(4);
    expect(page.data.flags).toBe(64);
    expect(page.data.embeds![0].title).toBe(ZONE_COPY.dropsTitle('Evershade Weald'));
    const lines = page.data.embeds![0].description!.split('\n');
    expect(lines).toHaveLength(20);
    const acs = lines.map((l) => Number(/AC (\d+)$/.exec(l)?.[1] ?? -1));
    expect(acs).toEqual([...acs].sort((a, b) => b - a)); // AC, highest first
    expect(lines.filter((l) => l.endsWith('AC 4'))).toEqual(['Weald Trinket 04 · AC 4', 'Weald Trinket 09 · AC 4', 'Weald Trinket 14 · AC 4', 'Weald Trinket 19 · AC 4', 'Weald Trinket 24 · AC 4']); // then name
    expect(page.data.embeds![0].footer!.text).toBe(ZONE_COPY.pageFooter(1, 2, ZONE_COPY.dropSort));
    const next = await send(press(ann, page.data.components![0].components[1].custom_id));
    expect(next.type).toBe(7);
    expect(next.data.embeds![0].footer!.text).toBe(ZONE_COPY.pageFooter(2, 2, ZONE_COPY.dropSort));
  });

  it('Gear here: asks for the class (sorts offered), then shows /gear find filtered to the zone', async () => {
    await env.DB.prepare("INSERT INTO game_class (code, item_count, bit) VALUES ('CLR', 10, 0)").run();
    await zone('Evershade Weald'); // a command first: buttons read the guild row, never create it
    const menu = await send(press(ann, 'zg:evershade weald'));
    expect(menu.type).toBe(4);
    expect(menu.data.content).toBe(ZONE_REPLY_COPY.gearPick('Evershade Weald'));
    const [sorts, classes] = menu.data.components!;
    expect(sorts.components[0].options.find((o: any) => o.default).label).toBe(ZONE_REPLY_COPY.sortChosen('AC'));
    expect(sorts.components[0].options.length).toBeLessThanOrEqual(25);
    expect(classes.components[0].options[0].value).toBe(ANY);
    const byName = await send(select(ann, sorts.components[0].custom_id, [String(sorts.components[0].options.findIndex((o: any) => o.label === ZONE_REPLY_COPY.sortChosen('Name')))]));
    expect(byName.type).toBe(7);
    const cls = byName.data.components![1].components[0];
    const results = await send(select(ann, cls.custom_id, [ANY]));
    expect(results.type).toBe(7);
    const names = [...results.data.embeds![0].description!.matchAll(/^\*\*(?:\[)?([^\]*]+)/gm)].map((x) => x[1]);
    // Gear only, from this zone, by Name; Removed Items and other zones' gear left out.
    expect(names).toEqual(['Another Ring', 'Weald Mail', 'Weald Ring']);
  });

  it('/gear find zone: the same filter from the command, by name in any case', async () => {
    const r = await send({ type: 2, guild_id: GUILD, member: ann, data: { name: 'gear', options: [{ type: 1, name: 'find', options: [{ type: 3, name: 'class', value: 'Any' }, { type: 3, name: 'zone', value: 'ROTHOLD' }] }] } });
    expect(r.data.embeds![0].description).toContain('Elsewhere Helm');
    expect(r.data.embeds![0].description).not.toContain('Weald Mail');
  });
});

describe('/zone: autocomplete, definition, help', () => {
  it('autocomplete filters the zone list as the member types (25 at most), for /zone and /gear find zone', async () => {
    expect((await auto('zone', null, 'name', 'r')).data.choices!.map((c) => c.name)).toEqual(['Rothold', "Ail'Vorith", 'Evershade Weald', "Keeper's Bight", 'Sunken Resort']);
    expect((await auto('gear', 'find', 'zone', 'sunk')).data.choices!.map((c) => c.value)).toEqual(['Sunken Resort']);
  });

  it('is defined within Discord\'s limits and counts as built; /craft help and the board index list it once', () => {
    expect(commandLimitProblems(COMMANDS)).toEqual([]);
    expect(DEFINED.has('/zone')).toBe(true);
    expect(HELP_TEXT.split('\n').filter((l) => l.startsWith('`/zone`'))).toHaveLength(1);
    expect(HOW_TO_GET_LISTED.split('\n').filter((l) => l.includes('`/zone`'))).toHaveLength(1);
  });

  it('the gear state carries a zone, last, and still fits a custom_id with the longest key allowed', () => {
    const q = { cls: 'ABCDEFGH', stats: [], sort: sortByKey('AC')!, zone: 'z'.repeat(40) };
    expect(`gp:999:${encodeState(q)}`.length).toBeLessThanOrEqual(100);
    expect(decodeState(encodeState({ ...q, zone: 'st. odd.zone' }))).toEqual({ ...q, zone: 'st. odd.zone' });
  });
});

describe('/zone: lines and limits', () => {
  it('marker notes lose URLs and line breaks', () => {
    expect(cleanNotes('https://mnm-db.com/#/mob/Commander%20Rursk\n\nRoom has 6 mobs in it')).toBe('Room has 6 mobs in it');
    expect(cleanNotes('https://x.example/only')).toBeNull();
  });

  it('a field never passes 1,024 characters; "+N more" counts what is left off', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `${'x'.repeat(150)} ${i}`);
    const v = fitLines(lines, 10);
    expect(v.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    const shown = v.split('\n').length - 1;
    expect(v.endsWith(ZONE_COPY.more(30 - shown))).toBe(true);
  });

  it('creatures: the mob wins, Mo Betta fills; merchants left out; no level last', () => {
    const c = creaturesOf(
      [{ key: 'a rat', title: 'A rat', level: null, race: null, class: null, loot_json: null }],
      [
        { name: 'A Rat', kind: 'npc', level: '5', race: null, class: null, loot_json: null },
        { name: 'Shopkeep', kind: 'merchant', level: '1', race: null, class: null, loot_json: null },
        { name: 'A ghost', kind: null, level: '??', race: null, class: null, loot_json: null },
      ],
    );
    expect(c).toEqual([{ name: 'A rat', level: '5' }, { name: 'A ghost', level: '??' }]);
  });
});

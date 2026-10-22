// Work order 17, ITEMs 2–3, and 17b: /zone in workerd, on zone data loaded by the real import (scripts/import/core.ts, zones.ts).
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport } from '../../scripts/import/core.ts';
import { COMMANDS, commandLimitProblems, DEFINED } from '../../src/commands/definitions.ts';
import { pageText } from '../../src/commands/help.ts';
import { ZONE_REPLY_COPY } from '../../src/commands/zone.ts';
import { WELCOME } from '../../src/commands/welcome.ts';
import { HOW_TO_GET_LISTED } from '../../src/board/render.ts';
import { decodeState, encodeState, sortByKey, ANY } from '../../src/gear/options.ts';
import { EMBED_LIMITS } from '../../src/discord.ts';
import { GEAR_COPY } from '../../src/commands/gear.ts';
import { cleanNotes, creatureLine, creaturesOf, fitLines, safeUrl, ZONE_CONNECTIONS, ZONE_COPY, zoneSites } from '../../src/zone/card.ts';
import { ZONE_SUGGEST_COPY } from '../../src/zone/suggest.ts';
import { count, reset } from '../db.ts';
import { as, botApi, GUILD, press, select, send, type Member } from '../discord.ts';
import small from '../fixtures/wiki-small.json';
import { withZoneWiki, zoneInput } from '../fixtures/zones-small.ts';

/**
 * MnM Atlas's own address rule (its app.js, read for order 17b): mapIdOf opens the map named by the path's first segment
 * when the registry has it, else ?map=, else the world map; a ?find= link looks on &map= only when the registry has it.
 * So an atlas address opens a zone only when it names a registry id. The ids come from the registry the import read.
 */
const ATLAS_IDS = new Set((zoneInput().files['mnmatlas/maps.json'] as { maps: { id: string }[] }).maps.map((m) => m.id).filter((id) => id !== 'world'));
const opensAZone = (u: string) => {
  const url = new URL(u);
  const first = decodeURIComponent(url.pathname.split('/')[1] ?? '').toLowerCase();
  return ATLAS_IDS.has(first) || (first === '' && url.searchParams.has('find') && ATLAS_IDS.has(url.searchParams.get('map') ?? ''));
};
/** Every MnM Atlas address in a reply: link buttons, embed links and markdown links (the card's picture is not a link). */
const atlasAddresses = (r: Awaited<ReturnType<typeof send>>) =>
  [...JSON.stringify(r.data).matchAll(/https:\/\/(?:www\.)?mnmatlas\.com[^"\s)\\]*/g)].map((m) => m[0]).filter((u) => !u.includes('/assets/cards/'));

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
  it('a big zone: level text, a one-line description, creatures by level with find-on-map links, no drops list, spots, credits', async () => {
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
    // Order 17b: the drops list is gone (Gear here finds the zone's gear).
    expect(field(r, /drops/i)).toBeUndefined();
    expect(field(r, ZONE_COPY.spots)!.value.split('\n')).toEqual(['Copper Vein (ore)', 'Old Hermit (quest) — Ask twice']);
    expect(field(r, ZONE_COPY.adjacent)!.value).toBe("Keeper's Bight · Fields of the Lost");
    expect(field(r, ZONE_COPY.map)!.value).toBe(`${ZONE_COPY.noMap} · [${ZONE_COPY.openAtlas}](https://www.mnmatlas.com/evershade-weald/)`);
    expect(e.footer.text).toBe(ZONE_COPY.footer);
    expect(r.data.embeds!.filter((x) => x.title !== WELCOME.title)).toHaveLength(1); // no licensed map, atlas pictures off
  });

  it('the buttons: five links in one row (src/zone/sites.json), then Post to channel, Gear here, More creatures', async () => {
    const r = await zone('evershade weald');
    const [links, actions] = r.data.components!;
    expect(r.data.components).toHaveLength(2);
    const sites = zoneSites('evershade weald'); // the derived file's verified pages (both exist today)
    expect(sites.mnmWiki && sites.stories).toBeTruthy();
    expect(links.components.map((b: any) => [b.label, b.url])).toEqual([
      [ZONE_COPY.wikiPage, 'https://monstersandmemories.miraheze.org/wiki/Evershade_Weald'],
      [ZONE_COPY.mnmWiki, sites.mnmWiki],
      [ZONE_COPY.stories, sites.stories],
      [ZONE_COPY.connections, ZONE_CONNECTIONS],
      [ZONE_COPY.openAtlas, 'https://www.mnmatlas.com/evershade-weald/'],
    ]);
    expect(actions.components.map((b: any) => [b.label, b.custom_id, b.disabled ?? false])).toEqual([
      ['Post to channel', 'pub:zone:evershade weald', false],
      [ZONE_COPY.gearHere, 'zg:evershade weald', false],
      [ZONE_COPY.moreCreatures, 'zc:evershade weald', false],
    ]);
  });

  it('order 17b regression: every MnM Atlas address on every card opens that zone, never the world map', async () => {
    // Order 17 linked a zone without an atlas map to the atlas's root, which opens its world map (Ail'Vorith, Sunken Resort).
    for (const name of ["Ail'Vorith", 'Evershade Weald', "Keeper's Bight", 'Rothold', 'Sunken Resort']) {
      for (const images of [false, true]) {
        const r = await zone(name, ann, images ? { env: { ATLAS_ZONE_IMAGES: 'on' } } : {});
        const bad = atlasAddresses(r).filter((u) => !opensAZone(u));
        expect(bad, `${name}${images ? ' (pictures on)' : ''}`).toEqual([]);
        const posted = await send(press(ann, `pub:zone:${name.toLowerCase()}`), images ? { env: { ATLAS_ZONE_IMAGES: 'on' } } : {});
        expect(atlasAddresses(posted).filter((u) => !opensAZone(u)), `${name}, posted`).toEqual([]);
      }
    }
    const withMap = await zone('Rothold');
    expect(atlasAddresses(withMap)).toContain('https://www.mnmatlas.com/rothold/');
    expect(opensAZone('https://www.mnmatlas.com/')).toBe(false); // the control: the rule rejects the root
  });

  it('matches only on case and curly apostrophes', async () => {
    expect((await zone('KEEPER’S BIGHT')).data.embeds![0].title).toBe("Keeper's Bight");
  });

  it('a zone with no data and no atlas map says what is missing, with no atlas link and only the pages that exist', async () => {
    const r = await zone("Ail'Vorith");
    expect(field(r, ZONE_COPY.missingName)!.value).toBe(ZONE_COPY.missing(['creatures'], null));
    expect(field(r, ZONE_COPY.map)!.value).toBe(ZONE_COPY.noMap);
    // A merchant is stored, never shown as a creature.
    expect(field(r, /^Creatures/)).toBeUndefined();
    const [links, actions] = r.data.components!;
    const expected = (key: string) => {
      const s = zoneSites(key);
      return [...(s.mnmWiki ? [ZONE_COPY.mnmWiki] : []), ...(s.stories ? [ZONE_COPY.stories] : []), ZONE_COPY.connections];
    };
    expect(links.components.map((b: any) => b.label)).toEqual([ZONE_COPY.wikiPage, ...expected("ail'vorith")]);
    expect(actions.components.map((b: any) => b.disabled ?? false)).toEqual([false, false, true]);
    // Sunken Resort has no wiki link in the fixture and no atlas map; each site's button only where src/zone/sites.json has a page.
    const sunken = await zone('Sunken Resort');
    expect(sunken.data.components![0].components.map((b: any) => b.label)).toEqual(expected('sunken resort'));
    // A zone the file does not hold gets no other-site buttons at all.
    expect(zoneSites('no such zone')).toEqual({ mnmWiki: null, stories: null });
  });

  it('Gear here on a zone with no gear says so instead of offering a class menu', async () => {
    await zone("Ail'Vorith");
    const r = await send(press(ann, "zg:ail'vorith"));
    expect([r.type, r.data.content, r.data.components ?? []]).toEqual([4, ZONE_REPLY_COPY.noGear("Ail'Vorith"), []]);
  });

  it('an unknown zone gets suggestions, never a dead end', async () => {
    const r = await zone('Evershade');
    expect(r.data.content).toBe([ZONE_SUGGEST_COPY.unknown('Evershade'), ZONE_SUGGEST_COPY.suggest(['Evershade Weald'])].join('\n'));
    const none = await zone('Qqq');
    expect(none.data.content).toContain(ZONE_SUGGEST_COPY.allZones(["Ail'Vorith", 'Evershade Weald', "Keeper's Bight", 'Rothold', 'Sunken Resort']));
  });

  it('/gear find zone: an unknown zone gets the same suggestions, not a silent zero', async () => {
    await zone('Rothold');
    const r = await send({ type: 2, guild_id: GUILD, member: ann, data: { name: 'gear', options: [{ type: 3, name: 'class', value: 'Any' }, { type: 3, name: 'zone', value: 'Rothol' }] } });
    expect(r.data.content).toBe([ZONE_SUGGEST_COPY.unknown('Rothol'), ZONE_SUGGEST_COPY.suggest(['Rothold'])].join('\n'));
  });

  it('a find-on-map link survives brackets in a name; a non-https wiki link is left out', async () => {
    expect(creatureLine({ name: 'a skeleton (rare)', level: null }, 'x')).toBe('a skeleton (rare) · [find on map](https://www.mnmatlas.com/?find=a%20skeleton%20%28rare%29&map=x)');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('/wiki/Rothold')).toBeNull();
    expect(safeUrl('https://monstersandmemories.miraheze.org/wiki/Rothold')).toBe('https://monstersandmemories.miraheze.org/wiki/Rothold');
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

  it('Post to channel posts the card publicly, links kept; its buttons answer each presser privately', async () => {
    const r = await zone('Evershade Weald');
    const posted = await send(press(ann, r.data.components![1].components[0].custom_id));
    expect(posted.data.flags).toBeUndefined();
    expect(posted.data.embeds![0].title).toBe('Evershade Weald');
    expect(posted.data.content).toBe(`-# Shared by <@${ann.user.id}>`);
    expect(posted.data.components![0]).toEqual(r.data.components![0]); // the same five links, Open in MnM Atlas included
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

describe('/zone: More creatures, Gear here', () => {
  it('More drops on an order 17 card already posted says the list is gone; More creatures still pages', async () => {
    await zone('Evershade Weald'); // a command first: buttons read the guild row, never create it
    for (const id of ['zd:evershade weald', 'zdn:1:evershade weald']) {
      const r = await send(press(ann, id));
      expect([r.type, r.data.flags, r.data.content]).toEqual([4, 64, ZONE_REPLY_COPY.dropsRemoved]);
    }
    const page = await send(press(ann, 'zc:evershade weald'));
    expect(page.data.embeds![0].title).toBe(ZONE_COPY.creaturesTitle('Evershade Weald'));
    expect(page.data.embeds![0].footer!.text).toBe(ZONE_COPY.pageFooter(1, 1, ZONE_COPY.creatureSort));
  });

  it('Gear here: the class first; the results replace it, by AC, with a sort select that re-sorts them', async () => {
    await env.DB.prepare("INSERT INTO game_class (code, item_count, bit) VALUES ('CLR', 10, 0)").run();
    await zone('Evershade Weald'); // a command first: buttons read the guild row, never create it
    const menu = await send(press(ann, 'zg:evershade weald'));
    expect(menu.type).toBe(4);
    expect(menu.data.content).toBe(ZONE_REPLY_COPY.gearPick('Evershade Weald'));
    expect(menu.data.components).toHaveLength(1); // the class select only
    const classes = menu.data.components![0].components[0];
    expect(classes.options[0].value).toBe(ANY);
    const results = await send(select(ann, classes.custom_id, [ANY]));
    expect(results.type).toBe(7);
    const names = (r: typeof results) => [...r.data.embeds![0].description!.matchAll(/^\*\*(?:\[)?([^\]*]+)/gm)].map((x) => x[1]);
    // Gear only, from this zone, by AC (highest first); Removed Items and other zones' gear left out.
    expect(names(results)[0]).toBe('Weald Mail');
    expect(names(results).sort()).toEqual(['Another Ring', 'Weald Mail', 'Weald Ring']);
    expect(results.data.content!.split('\n')[0]).toBe(GEAR_COPY.fromZone('Evershade Weald'));
    const sorts = results.data.components!.at(-1).components[0];
    expect(sorts.options.find((o: any) => o.default).label).toBe(GEAR_COPY.sortOption('AC'));
    expect(sorts.options.length).toBeLessThanOrEqual(25);
    const byName = await send(select(ann, sorts.custom_id, [String(sorts.options.findIndex((o: any) => o.label === GEAR_COPY.sortOption('Name')))]));
    expect(byName.type).toBe(7);
    expect(names(byName)).toEqual(['Another Ring', 'Weald Mail', 'Weald Ring']);
    expect(byName.data.content!.split('\n')[0]).toBe(GEAR_COPY.fromZone('Evershade Weald'));
    expect(byName.data.components!.at(-1).components[0].options.find((o: any) => o.default).label).toBe(GEAR_COPY.sortOption('Name'));
    // An order 17 menu still open ("zgc:<sort index>:<key>") still reaches the zone.
    const old = await send(select(ann, 'zgc:0:evershade weald', [ANY]));
    expect(old.data.content!.split('\n')[0]).toBe(GEAR_COPY.fromZone('Evershade Weald'));
  });

  it('/gear find zone: the same filter from the command, by name in any case', async () => {
    const r = await send({ type: 2, guild_id: GUILD, member: ann, data: { name: 'gear', options: [{ type: 3, name: 'class', value: 'Any' }, { type: 3, name: 'zone', value: 'ROTHOLD' }] } });
    expect(r.data.embeds![0].description).toContain('Elsewhere Helm');
    expect(r.data.embeds![0].description).not.toContain('Weald Mail');
  });
});

describe('/zone: autocomplete, definition, help', () => {
  it('autocomplete filters the zone list as the member types (25 at most), for /zone and /gear find zone', async () => {
    expect((await auto('zone', null, 'name', 'r')).data.choices!.map((c) => c.name)).toEqual(['Rothold', "Ail'Vorith", 'Evershade Weald', "Keeper's Bight", 'Sunken Resort']);
    expect((await auto('gear', null, 'zone', 'sunk')).data.choices!.map((c) => c.value)).toEqual(['Sunken Resort']);
  });

  it('is defined within Discord\'s limits and counts as built; /help and the board index list it once', () => {
    expect(commandLimitProblems(COMMANDS)).toEqual([]);
    expect(DEFINED.has('/zone')).toBe(true);
    expect(pageText('find').split('\n').filter((l) => l.startsWith('`/zone`'))).toHaveLength(1);
    expect(HOW_TO_GET_LISTED.split('\n').filter((l) => l.includes('`/zone`'))).toHaveLength(1);
  });

  it('the gear state carries a zone, last, and still fits a custom_id with the longest key allowed', () => {
    const q = { cls: 'ABCDEFGH', stats: [], sort: sortByKey('AC')!, zone: 'z'.repeat(40) };
    expect(`gp:999:${encodeState(q)}`.length).toBeLessThanOrEqual(100);
    expect(`gs:${encodeState(q)}`.length).toBeLessThanOrEqual(100); // order 17b: the sort select
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

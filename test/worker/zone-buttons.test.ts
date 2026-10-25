// Work order 23: zone buttons under /gear results, the /item card and /gear's item card, each opening the zone's card as
// /zone does ("zo:<key>"), in workerd on zone data loaded by the real import.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport } from '../../scripts/import/core.ts';
import { ZONE_REPLY_COPY } from '../../src/commands/zone.ts';
import { CUSTOM_ID_MAX, LABEL_MAX, layoutZoneButtons, MESSAGE_ROWS, OPEN_PREFIX, ROW_BUTTONS, type ZoneMatch, type ZoneRef } from '../../src/zone/buttons.ts';
import { MOB_ZONES_SOURCE, WIKI_ZONES_SOURCE } from '../../src/zone/names.ts';
import { count, one, reset } from '../db.ts';
import { as, botApi, GUILD, press, select, send, type Reply } from '../discord.ts';
import small from '../fixtures/wiki-small.json';
import { withZoneWiki, zoneInput } from '../fixtures/zones-small.ts';

const ann = as('100000000000000001');
const bob = as('100000000000000002');
const zone = (name: string, opts: { env?: Record<string, unknown> } = {}) =>
  send({ type: 2, guild_id: GUILD, member: ann, data: { name: 'zone', options: [{ type: 3, name: 'name', value: name }] } }, opts);
const gear = (options: Record<string, string>) =>
  send({ type: 2, guild_id: GUILD, member: ann, data: { name: 'gear', options: Object.entries(options).map(([name, value]) => ({ type: 3, name, value })) } });
const item = (name: string) => send({ type: 2, guild_id: GUILD, member: ann, data: { name: 'item', options: [{ type: 3, name: 'name', value: name }] } });
const zoneButtons = (r: Reply) => (r.data.components ?? []).flatMap((row: any) => row.components).filter((b: any) => b.custom_id?.startsWith(OPEN_PREFIX));
const labels = (r: Reply) => zoneButtons(r).map((b: any) => b.label);
const idOf = async (name: string) => (await one<{ id: number }>('SELECT id FROM item WHERE name = ?', name)).id;

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  await env.DB.batch(['item', 'data_import', 'mob', 'zone', 'zone_name', 'npc', 'import_source'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const f = withZoneWiki(small);
  f.items['Weald Mail'] = { slot: 'CHEST', class: 'ALL', ac: 9, wikiZones: ['Evershade Weald'] };
  f.items['Two Zone Vest'] = { slot: 'CHEST', class: 'ALL', ac: 8, wikiZones: ['Evershade Weald', 'Rothold'] };
  // A mob's zone (the gnoll scout's Evershade Weald), and two spellings of one zone (one key, so one button).
  f.items['Gnoll Hide'] = { slot: 'CHEST', class: 'ALL', ac: 7, from: ['a gnoll scout'], wikiZones: ["Keeper's Bight", 'KEEPER’S BIGHT'] };
  f.items['Lost Vest'] = { slot: 'CHEST', class: 'ALL', ac: 6, wikiZones: ['Nowhere Land'] };
  // Page 1 of CHEST by AC: ten from Sunken Resort; the four above are on page 2.
  for (let n = 0; n < 10; n++) f.items[`Resort Plate ${n}`] = { slot: 'CHEST', class: 'ALL', ac: 100 + n, wikiZones: ['Sunken Resort'] };
  const res = await runImport(bindingDb(env.DB as never), f, { sourceSha: 'b'.repeat(40), now: () => new Date().toISOString(), zones: zoneInput() });
  expect(res.status).toBe('ok');
  // An unmatched name, as the mapping records one (zone_key NULL): reported by the import, never a button.
  await env.DB.prepare("UPDATE zone_name SET zone_key = NULL WHERE name = 'Nowhere Land'").run();
  botApi.reset();
});

describe('zo: opens the zone card as /zone does', () => {
  it('the same embeds, link buttons, action buttons and Post to channel, as a new private message', async () => {
    for (const env of [{}, { ATLAS_ZONE_IMAGES: 'on' }]) {
      await zone('Rothold', { env }); // the first command carries the one-time welcome
      const byCommand = await zone('Rothold', { env });
      const byButton = await send(press(ann, 'zo:rothold'), { env });
      // type 4 here is a follow-up (a new message): the message the button was on is not edited.
      expect([byButton.type, byButton.data.flags]).toEqual([4, 64]);
      expect(byButton.data.embeds).toEqual(byCommand.data.embeds);
      expect(byButton.data.components).toEqual(byCommand.data.components);
    }
  });

  it('a zone gone from the data answers "gone"; a press writes nothing (no audit row)', async () => {
    await zone('Rothold');
    const before = await count('audit_log');
    expect((await send(press(ann, 'zo:rothold'))).data.embeds![0].title).toBe('Rothold');
    await env.DB.prepare("UPDATE zone SET active = 0 WHERE key = 'rothold'").run();
    expect((await send(press(ann, 'zo:rothold'))).data.content).toBe(ZONE_REPLY_COPY.gone);
    expect(await count('audit_log')).toBe(before);
  });

  it('the new prefix routes (SENT_BEFORE in next-commands.test.ts stays frozen)', async () => {
    const { STALE_FORM } = await import('../../src/interactions.ts');
    await zone('Rothold');
    const r = await send(press(ann, 'zo:x'));
    expect(r.data.content).not.toBe(STALE_FORM);
    expect(r.data.content).toBe(ZONE_REPLY_COPY.gone);
  });
});

describe('/gear results: a button per zone the page shows', () => {
  it('in the order the zones first appear; one per zone; none for an unmatched name; paging redraws them', async () => {
    const p1 = await gear({ class: 'Any', slot: 'CHEST' });
    expect(p1.data.embeds![0].description).toContain('Resort Plate 9');
    expect(labels(p1)).toEqual(['Sunken Resort']);
    expect(p1.data.components).toHaveLength(3); // nav, details, one row of zone buttons
    const p2 = await send(press(ann, p1.data.components![0].components[1].custom_id));
    expect(p2.type).toBe(7);
    // Weald Mail (Evershade Weald), Two Zone Vest (+ Rothold), Gnoll Hide (its mob's Evershade Weald; Keeper's Bight in two
    // spellings), Lost Vest (Nowhere Land, unmatched).
    expect(p2.data.embeds![0].description).toContain('Nowhere Land');
    expect(labels(p2)).toEqual(['Evershade Weald', 'Rothold', "Keeper's Bight"]);
    expect(zoneButtons(p2).map((b: any) => b.custom_id)).toEqual(['zo:evershade weald', 'zo:rothold', "zo:keeper's bight"]);
    const back = await send(press(ann, p2.data.components![0].components[0].custom_id));
    expect(labels(back)).toEqual(['Sunken Resort']);
  });

  it('a zone gone inactive gets no button', async () => {
    await env.DB.prepare("UPDATE zone SET active = 0 WHERE key = 'rothold'").run();
    const p1 = await gear({ class: 'Any', slot: 'CHEST' });
    const p2 = await send(press(ann, p1.data.components![0].components[1].custom_id));
    expect(labels(p2)).toEqual(['Evershade Weald', "Keeper's Bight"]);
  });

  it('zone mode: no button for its own zone; the sort redraws the buttons', async () => {
    const r = await gear({ class: 'Any', zone: 'Evershade Weald' });
    expect(labels(r)).toEqual(['Rothold']);
    expect(r.data.components).toHaveLength(4); // nav, details, sort, zone buttons
    const sorts = r.data.components![2].components[0];
    const byName = await send(select(ann, sorts.custom_id, [String(sorts.options.findIndex((o: any) => o.label === 'Sort: Name'))]));
    expect(byName.type).toBe(7);
    expect(labels(byName)).toEqual(['Rothold']);
    expect(byName.data.components![2].components[0].options.find((o: any) => o.default).label).toBe('Sort: Name');
  });
});

describe('the item cards: /item, posted /item, /gear details', () => {
  it('/item: one button per zone the card shows, under its rows; an item with none is unchanged', async () => {
    await item('Gnoll Hide'); // the welcome
    const r = await item('Gnoll Hide');
    expect(r.data.components).toHaveLength(3);
    expect(labels(r)).toEqual(['Evershade Weald', "Keeper's Bight"]);
    expect(labels(await item('Weald Mail'))).toEqual(['Evershade Weald']);
    const none = await item('Copper Bar');
    expect(none.data.components).toHaveLength(2);
    expect(labels(none)).toEqual([]);
    expect(labels(await item('Lost Vest'))).toEqual([]); // unmatched only
  });

  it('a posted /item card carries them, and a press answers the presser privately', async () => {
    await item('Gnoll Hide');
    const posted = await send(press(ann, `pub:item:${await idOf('Gnoll Hide')}`));
    expect(posted.data.flags).toBeUndefined();
    expect(labels(posted)).toEqual(['Evershade Weald', "Keeper's Bight"]);
    const opened = await send(press(bob, zoneButtons(posted)[1].custom_id));
    expect([opened.type, opened.data.flags]).toEqual([4, 64]);
    expect(opened.data.embeds!.at(-1)!.title).toBe("Keeper's Bight");
  });

  it('/gear details (gd:) and its posted copy (pub:gear:) carry them too', async () => {
    const results = await gear({ class: 'Any', slot: 'CHEST' });
    const id = await idOf('Two Zone Vest');
    const details = await send(select(ann, results.data.components![1].components[0].custom_id, [String(id)]));
    expect(labels(details)).toEqual(['Evershade Weald', 'Rothold']);
    expect(labels(await send(press(ann, `pub:gear:${id}`)))).toEqual(['Evershade Weald', 'Rothold']);
  });
});

describe('the layout keeps within Discord\'s limits', () => {
  const many = (n: number): { refs: ZoneRef[]; matches: ZoneMatch[] } => {
    const names = Array.from({ length: n }, (_, i) => `Zone ${String(i).padStart(2, '0')} ${'x'.repeat(i === 3 ? 80 : 0)}`); // Zone 03: 88 characters, its key still fits
    return {
      refs: names.map((name, i) => ({ source: i % 2 ? WIKI_ZONES_SOURCE : MOB_ZONES_SOURCE, name })),
      matches: names.map((name, i) => ({ source: i % 2 ? WIKI_ZONES_SOURCE : MOB_ZONES_SOURCE, name, key: name.toLowerCase(), zone: name })),
    };
  };
  it('the rows a message leaves, five a row, unique ids, labels and ids in range; the overflow is counted', () => {
    const { refs, matches } = many(40);
    for (const used of [2, 3]) {
      const z = layoutZoneButtons(refs, matches, used);
      expect(z.rows.length).toBe(MESSAGE_ROWS - used);
      const buttons = (z.rows as any[]).flatMap((r) => r.components);
      for (const r of z.rows as any[]) expect(r.components.length).toBeLessThanOrEqual(ROW_BUTTONS);
      expect(buttons).toHaveLength((MESSAGE_ROWS - used) * ROW_BUTTONS);
      expect(new Set(buttons.map((b: any) => b.custom_id)).size).toBe(buttons.length);
      for (const b of buttons) expect([b.label.length <= LABEL_MAX, b.custom_id.length <= CUSTOM_ID_MAX]).toEqual([true, true]);
      expect(buttons[3].label).toHaveLength(LABEL_MAX); // the long name, truncated
      expect([z.zones, z.shown]).toEqual([40, (MESSAGE_ROWS - used) * ROW_BUTTONS]);
    }
    expect(layoutZoneButtons(refs, matches, MESSAGE_ROWS).rows).toEqual([]);
  });
  it('a key too long for a custom_id gets no button, and is counted', () => {
    const key = 'k'.repeat(CUSTOM_ID_MAX - OPEN_PREFIX.length + 1);
    const z = layoutZoneButtons([{ source: WIKI_ZONES_SOURCE, name: 'Long' }], [{ source: WIKI_ZONES_SOURCE, name: 'Long', key, zone: 'Long' }], 2);
    expect([z.rows, z.zones, z.tooLong]).toEqual([[], 1, 1]);
  });
});

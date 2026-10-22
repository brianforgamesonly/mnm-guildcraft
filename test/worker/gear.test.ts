// Work order 13, ITEMs 3–4: /gear find in workerd, on data loaded by the real import (scripts/import/core.ts).
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport, type WikiData } from '../../scripts/import/core.ts';
import { COMMANDS, commandLimitProblems, commandsWith } from '../../src/commands/definitions.ts';
import { DETAILS_PREFIX, GEAR_COPY, PAGE_PREFIX } from '../../src/commands/gear.ts';
import { HELP_TEXT } from '../../src/commands/help.ts';
import { ITEM_REPORT_MODAL_PREFIX, ITEM_REPORT_PREFIX, MAX_OPEN_REPORTS } from '../../src/commands/reports.ts';
import { HOW_TO_GET_LISTED } from '../../src/board/render.ts';
import { embedChars, EMBED_LIMITS } from '../../src/discord.ts';
import { ANY, decodeState, encodeState, SORTS, STAT_FILTERS, sortByKey, TOTAL_STATS_SQL, type GearQuery } from '../../src/gear/options.ts';
import migration11 from '../../migrations/0011_item_reports.sql?raw';
import { filters, searchStatement } from '../../src/gear/search.ts';
import { RESISTS, SLOTS, SOURCES, STATS, WEAPON_TYPES } from '../../src/gear/vocab.ts';
import { one, reset } from '../db.ts';
import { as, botApi, cmd, GUILD, press, select, send, submit } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const ANN = '100000000000000001';
const ann = as(ANN);
const at = '2026-10-20T00:00:00Z';

function fixture(): WikiData {
  const items: WikiData['items'] = {
    'Iron Breastplate': { hasPage: true, slot: 'CHEST', class: 'CLR SHM', ac: 10, stats: { STA: 5, WIS: 2 }, flags: ['MAGIC'], from: ['a skeleton', 'a ghoul'], wikiZones: ['Tomb'] },
    'Silk Robe': { hasPage: true, slot: 'Chest', class: 'ALL', ac: 3, stats: { WIS: 4, INT: 4, STA: 1 }, soldBy: { base: 115, shady: null, vendors: ['Night Harbor', 'a tailor'] } },
    'Mystery Vest': { slot: 'CHEST', class: 'INQNEC' },
    'Old Plate': { slot: 'CHEST', class: 'ALL', ac: 50, categories: ['Removed Items'] },
    'Rusty Sword': { hasPage: true, slot: 'PRIMARY', class: 'ALL', skill: 'SLA', dmg: 6, delay: 20, from: ['a skeleton'] },
    'Fine Sword': { hasPage: true, slot: 'PRIMARY SECONDARY', class: 'ARC', skill: 'SLA', dmg: 10, delay: 25, stats: { STR: 3 } },
    'Broken Blade': { slot: 'PRIMARY', class: 'ALL', skill: 'SLA', dmg: 5, delay: 0 },
    'Quest Helm': { slot: 'HEAD', class: 'ALL', ac: 4, categories: ['Quest Items', 'Pages with incorrect item stats'] },
    'Iron Bar': { hasPage: true },
  };
  for (let i = 0; i < 150; i++) items[`Class Filler ${i}`] = { class: 'ARC BRD CLR SHM' };
  return {
    generatedAt: '2026-10-20T07:00:00.000Z',
    items,
    recipes: [{ tradeskill: 'Blacksmithing', result: { qty: 1, item: 'Fine Sword' }, components: [{ qty: 2, item: 'Iron Bar' }], trivial: 40 }],
    nodes: {},
    mobs: {
      'a skeleton': { title: 'A skeleton', level: '3 - 10', zone: '[[Tomb]]' },
      'a ghoul': { title: 'A ghoul', level: null, zone: 'Tomb, Crypt' },
    },
  };
}

async function crafter(name: string, level: number) {
  const owner = `20000000000000${String(level).padStart(4, '0')}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO guild (id, name, created_at) VALUES (?, 'Test Guild', ?)").bind(GUILD, at),
    env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?)").bind(GUILD, owner, name, at),
    env.DB.prepare('INSERT INTO character (guild_id, owner_user_id, name, name_key, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').bind(GUILD, owner, name, name.toLowerCase(), at, at),
    env.DB.prepare("INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES ((SELECT id FROM character WHERE name_key = ?), (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?, ?, 'x')").bind(name.toLowerCase(), level, at),
  ]);
}

const gear = (o: Record<string, unknown>, m = ann) => send(cmd(m, 'gear', 'find', o));
const names = (description: string | undefined) => [...(description ?? '').matchAll(/^\*\*(?:\[)?([^\]*]+)/gm)].map((x) => x[1]);
const query = (q: Partial<GearQuery>): GearQuery => ({ cls: ANY, stats: [], sort: sortByKey('AC')!, ...q });

beforeEach(async () => {
  await reset(['Blacksmithing'], []);
  await env.DB.batch(['item', 'data_import', 'mob'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  const res = await runImport(bindingDb(env.DB as never), fixture(), { sourceSha: 'c'.repeat(40), now: () => new Date().toISOString() });
  expect(res.status).toBe('ok');
  botApi.reset();
});

describe('the command definition (Discord limits)', () => {
  it('class is the first option and required; options in the order set; every list derived', () => {
    const find = COMMANDS.find((c) => c.name === 'gear')!.options[0];
    expect(find.options.map((o) => o.name)).toEqual(['class', 'slot', 'weapon_type', 'min_ac', 'min_ratio', 'stat1', 'stat2', 'stat3', 'source', 'sort', 'zone']);
    expect(find.options[0]).toMatchObject({ required: true });
    const opt = (n: string) => find.options.find((o) => o.name === n) as { choices?: { value: string }[] };
    expect(opt('slot').choices!.map((c) => c.value)).toEqual([...SLOTS]);
    expect(opt('weapon_type').choices!.map((c) => c.value)).toEqual([...WEAPON_TYPES]);
    expect(opt('stat1').choices!.length).toBe(STATS.length + RESISTS.length + 5);
    expect(opt('source').choices!.map((c) => c.value)).toEqual([ANY, ...SOURCES]);
    expect(opt('sort').choices!.map((c) => c.value)).toEqual(SORTS.map((s) => s.key));
    const withClasses = commandsWith(['ARC', 'BRD']).find((c) => c.name === 'gear')!.options[0].options[0] as { choices: { value: string }[] };
    expect(withClasses.choices.map((c) => c.value)).toEqual([ANY, 'ARC', 'BRD']);
  });

  it('CI guard: no choice list over 25, no command over 25 options or 8,000 characters (with 24 classes); 25 classes fail', () => {
    const classes = (n: number) => Array.from({ length: n }, (_, i) => `C${String(i).padStart(2, '0')}`);
    expect(commandLimitProblems(commandsWith(classes(24)))).toEqual([]);
    expect(commandLimitProblems(commandsWith(classes(25)))).toEqual(['/gear find class: 26 choices, over 25']);
    // Today's lists: slots 24 of 25, sorts 22, stats 20.
    expect(SLOTS.length).toBe(24);
    expect([SORTS.length, STAT_FILTERS.length]).toEqual([22, 20]);
  });

  it('item.total_stats (migrations/0011) is TOTAL_STATS_SQL, derived from STATS', () => {
    expect(migration11).toContain(`GENERATED ALWAYS AS (${TOTAL_STATS_SQL}) VIRTUAL`);
  });

  it('the paging state fits a custom_id (100) with every option set to its longest value', () => {
    const longest = <T>(xs: readonly T[], f: (x: T) => number) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
    const q: GearQuery = {
      cls: 'ABCDEFGH',
      slot: SLOTS[SLOTS.length - 1],
      weaponType: WEAPON_TYPES[WEAPON_TYPES.length - 1],
      minAc: 9999,
      minRatio: 98.765,
      stats: STAT_FILTERS.slice(-3),
      source: SOURCES[SOURCES.length - 1],
      sort: longest(SORTS, (s) => String(SORTS.indexOf(s)).length),
    };
    const id = `${PAGE_PREFIX}999:${encodeState(q)}`;
    expect(id.length).toBeLessThanOrEqual(100);
    expect(decodeState(encodeState(q))).toEqual(q);
  });
});

describe('/gear find', () => {
  it('control: class Any, slot CHEST returns chest pieces (never 0), Removed Items excluded, sorted by AC', async () => {
    const r = await gear({ class: 'Any', slot: 'CHEST' });
    expect(r.data.flags).toBe(64);
    expect(names(r.data.embeds![0].description)).toEqual(['Iron Breastplate', 'Silk Robe', 'Mystery Vest']);
    expect(r.data.embeds![0].title).toBe(GEAR_COPY.title);
    expect(r.data.components![0].components[1].disabled).toBe(true); // 3 matches: no next page
    expect(r.data.content).toContain('Ratio = damage ÷ delay');
  });

  it('class: ALL counts for every class; an item with only unrecognised class tokens matches only Any', async () => {
    expect(names((await gear({ class: 'CLR', slot: 'CHEST' })).data.embeds![0].description)).toEqual(['Iron Breastplate', 'Silk Robe']);
    expect(names((await gear({ class: 'ARC', slot: 'CHEST' })).data.embeds![0].description)).toEqual(['Silk Robe']);
  });

  it('stats: only items with every chosen stat; sort Total stats; AC still on every line', async () => {
    const r = await gear({ class: 'Any', slot: 'CHEST', stat1: 'STA', stat2: 'WIS', sort: 'TOTAL' });
    const d = r.data.embeds![0].description!;
    expect(names(d)).toEqual(['Silk Robe', 'Iron Breastplate']); // total 9 before 7
    expect(d).toContain('AC 3');
    expect(d).toContain('**STA +1**');
    expect(d).toContain('**total stats 9**');
  });

  it('weapons: min_ratio drops items with no ratio (delay 0); the default sort is Ratio', async () => {
    const r = await gear({ class: 'Any', weapon_type: 'SLA', min_ratio: 0.3 });
    const d = r.data.embeds![0].description!;
    expect(names(d)).toEqual(['Fine Sword', 'Rusty Sword']); // 0.4, then 0.3 (≥ 0.3); Broken Blade (delay 0) has no ratio
    expect(r.data.embeds![0].footer!.text).toContain('sorted by Ratio');
  });

  it('a weapon line, an armor line, an Unknown-source line, and the crafted line with its guild crafters', async () => {
    await crafter('Smithy', 45);
    await crafter('Novice', 10);
    const d = (await gear({ class: 'Any' })).data.embeds![0].description!;
    const entry = (n: string) => d.split('\n\n').find((e) => e.includes(n))!;
    expect(entry('Fine Sword')).toContain('ratio 0.4 (10/25)');
    expect(entry('Fine Sword')).toContain('Crafted: Blacksmithing, trivial 40, 1 guild character can make it');
    expect(entry('Iron Breastplate')).toContain('Drop: a skeleton (L3 - 10, Tomb), a ghoul (Tomb) · zones: Tomb');
    expect(entry('Iron Breastplate')).toContain('Classes: CLR SHM · MAGIC');
    expect(entry('Mystery Vest')).toContain(`Unknown: ${GEAR_COPY.unknownSource}`);
    expect(entry('Mystery Vest')).toContain(`Classes: ${GEAR_COPY.noClass}`);
    expect(entry('Silk Robe')).toContain('Vendor: price 115 · Night Harbor, a tailor');
    expect(entry('Quest Helm')).toContain(`⚠ ${GEAR_COPY.incorrectStats}`);
    expect(entry('Quest Helm')).toContain('-# Quest');
  });

  it('source: Unknown shows only items whose source is not recorded', async () => {
    const r = await gear({ class: 'Any', source: 'Unknown' });
    expect(names(r.data.embeds![0].description)).toEqual(['Broken Blade', 'Mystery Vest']);
  });

  it('zero matches: names the filter that removed the most and suggests relaxing it', async () => {
    const r = await gear({ class: 'Any', slot: 'CHEST', min_ac: 999 });
    expect(r.data.content).toContain(GEAR_COPY.none);
    expect(r.data.content).toContain(GEAR_COPY.relax('min_ac: 999', 3));
  });

  it('paging: 10 per page, Next edits the results in place; the details menu lists the page', async () => {
    const f = fixture();
    for (let i = 0; i < 15; i++) f.items[`Ring ${String(i).padStart(2, '0')}`] = { slot: 'FINGER', class: 'ALL', ac: i };
    await runImport(bindingDb(env.DB as never), f, { sourceSha: 'd'.repeat(40), now: () => new Date().toISOString() });
    const r = await gear({ class: 'Any', slot: 'FINGER' });
    expect(names(r.data.embeds![0].description)).toHaveLength(10);
    const [nav, menu] = r.data.components!;
    expect(nav.components.map((b: any) => b.disabled ?? false)).toEqual([true, false]);
    expect(menu.components[0].custom_id).toBe(DETAILS_PREFIX);
    expect(menu.components[0].options).toHaveLength(10);
    const next = await send(press(ann, nav.components[1].custom_id));
    expect(next.type).toBe(7);
    expect(names(next.data.embeds![0].description)).toEqual(['Ring 04', 'Ring 03', 'Ring 02', 'Ring 01', 'Ring 00']);
    expect(next.data.embeds![0].footer!.text).toMatch(/^Page 2 · sorted by AC/);
    expect(next.data.components![0].components.map((b: any) => b.disabled ?? false)).toEqual([false, true]);
  });

  it('every reply fits the embed limits with room for the welcome', async () => {
    const f = fixture();
    for (let i = 0; i < 12; i++)
      f.items[`Loaded Cloak ${i}`] = { slot: 'BACK', class: 'ALL', ac: 5, stats: { STR: 1, STA: 1, AGI: 1, DEX: 1, WIS: 1, INT: 1, CHA: 1 }, from: Array.from({ length: 160 }, (_, j) => `a very long mob name number ${j}`), wikiZones: Array.from({ length: 19 }, (_, j) => `Zone ${j}`) };
    await runImport(bindingDb(env.DB as never), f, { sourceSha: 'e'.repeat(40), now: () => new Date().toISOString() });
    const r = await gear({ class: 'Any', slot: 'BACK' });
    expect(embedChars(r.data.embeds as never)).toBeLessThanOrEqual(EMBED_LIMITS.total - 1000);
    expect(r.data.embeds![0].description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
  });

  it('a member with no registered character can search', async () => {
    const r = await gear({ class: 'Any' }, as('100000000000000099'));
    expect(r.data.embeds![0].title).toMatch(/^Gear finder/);
  });

  it('writes nothing per search except its read audit row (gear.find)', async () => {
    await gear({ class: 'Any' }); // the first command also adds the guild and member rows (existing behaviour)
    const before = await one<{ a: number; i: number }>("SELECT (SELECT count(*) FROM audit_log) AS a, (SELECT count(*) FROM item) AS i");
    await gear({ class: 'Any', slot: 'CHEST' });
    const after = await one<{ a: number; i: number }>("SELECT (SELECT count(*) FROM audit_log) AS a, (SELECT count(*) FROM item) AS i");
    expect(after).toEqual({ a: before.a + 1, i: before.i });
    expect(await one("SELECT action FROM audit_log ORDER BY id DESC LIMIT 1")).toEqual({ action: 'gear.find' });
    const { meta } = await searchStatement(env.DB, query({ slot: 'CHEST' }), 0).all();
    expect(meta.rows_written).toBe(0);
  });

  it('the class, slot and source filters are read through an index (EXPLAIN QUERY PLAN)', async () => {
    for (const q of [query({ cls: 'CLR' }), query({ slot: 'CHEST' }), query({ source: 'Drop' }), query({ cls: 'CLR', slot: 'CHEST', source: 'Drop' })]) {
      const fs = filters(q);
      const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN SELECT id FROM item WHERE slot_mask <> 0 AND (source_mask & 32) = 0 AND ${fs.map((f) => f.sql).join(' AND ')}`)
        .bind(...fs.flatMap((f) => f.binds))
        .all<{ detail: string }>();
      const scans = plan.results.map((r) => r.detail).filter((d) => /^(SCAN|SEARCH) item/.test(d));
      expect(scans, JSON.stringify(plan.results)).toEqual([expect.stringMatching(/USING (COVERING )?INDEX item_gear/)]);
    }
  });
});

describe('the item card, and item reports', () => {
  it('details: a private card with full stats and sources; a craftable item shows its crafter groups; Post to channel', async () => {
    await crafter('Smithy', 45);
    const id = (await one<{ id: number }>("SELECT id FROM item WHERE name = 'Fine Sword'")).id;
    const r = await send(select(ann, DETAILS_PREFIX, [String(id)]));
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds![0].title).toBe('Fine Sword');
    expect(r.data.embeds![1].title).toBe('Blacksmithing · trivial 40');
    expect(JSON.stringify(r.data.embeds![1])).toContain('Smithy');
    const ids = r.data.components!.flatMap((row: any) => row.components.map((b: any) => b.custom_id ?? b.url));
    expect(ids).toEqual(expect.arrayContaining([`pub:gear:${id}`, `${ITEM_REPORT_PREFIX}${id}`, `img:${id}`]));
    const posted = await send(press(ann, `pub:gear:${id}`));
    expect(posted.data.flags ?? 0).toBe(0);
    expect(posted.data.embeds![0].title).toBe('Fine Sword');
    const drop = (await one<{ id: number }>("SELECT id FROM item WHERE name = 'Iron Breastplate'")).id;
    const card = await send(select(ann, DETAILS_PREFIX, [String(drop)]));
    expect(JSON.stringify(card.data.embeds![0].fields)).toContain('a skeleton (L3 - 10, Tomb)');
  });

  it('Report a problem: a modal of item issues; the card goes to the review channel; the 5-report limit is shared', async () => {
    const posted: any[] = [];
    botApi.handle = (method, path, body) => {
      posted.push({ method, path, body });
      return new Response(JSON.stringify({ id: '1' }), { status: 200 });
    };
    await gear({ class: 'Any' }); // creates the guild row on first use
    await env.DB.prepare("UPDATE guild SET review_channel_id = '700000000000000001' WHERE id = ?").bind(GUILD).run();
    const id = (await one<{ id: number }>("SELECT id FROM item WHERE name = 'Silk Robe'")).id;
    const modal = await send(press(ann, `${ITEM_REPORT_PREFIX}${id}`));
    expect(modal.type).toBe(9);
    expect(JSON.stringify(modal.data)).toContain('Wrong stats');
    const ok = await send(submit(ann, `${ITEM_REPORT_MODAL_PREFIX}${id}`, { issue: 'stats', details: 'AC is 4' }), TOKEN);
    expect(ok.data.content).toContain('Wrong stats');
    expect(await one('SELECT kind, issue FROM recipe_report ORDER BY id DESC LIMIT 1')).toEqual({ kind: 'item', issue: 'stats' });
    const cardBody = posted.find((p) => p.path === '/channels/700000000000000001/messages')!.body;
    expect(cardBody.embeds[0].title).toBe('Item report: Silk Robe');
    expect(cardBody.components[0].components.map((b: any) => b.label)).toEqual(['Mark fixed', 'Dismiss']);
    // Shared limit: 4 recipe reports plus this item report make 5; the next of either kind is refused.
    for (let i = 0; i < MAX_OPEN_REPORTS - 1; i++)
      await env.DB.prepare("INSERT INTO recipe_report (guild_id, item_id, reporter, issue, status, created_at) VALUES (?, ?, ?, 'trivial', 'open', ?)").bind(GUILD, id, ANN, at).run();
    const refused = await send(submit(ann, `${ITEM_REPORT_MODAL_PREFIX}${id}`, { issue: 'class' }));
    expect(refused.data.content).toContain(`You already have ${MAX_OPEN_REPORTS} reports`);
  });
});

describe('copy', () => {
  it('/craft help and the board index list /gear find in one line each', () => {
    expect(HELP_TEXT.split('\n').filter((l) => l.includes('/gear find'))).toHaveLength(1);
    expect(HOW_TO_GET_LISTED.split('\n').filter((l) => l.includes('/gear find'))).toHaveLength(1);
  });
});

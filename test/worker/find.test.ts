// ITEM 1.1 / 1.2: /craft find in workerd — autocomplete, the reply for the four required kinds of item,
// tiers, overflow (200 crafters), removed and departed members, Post to channel, links.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CONFIRM_NOTE, fitLines, mnmdbUrl, mnmrealmUrl } from '../../src/commands/find.ts';
import { WELCOME } from '../../src/commands/welcome.ts';
import { crafterTier } from '../../src/crafters.ts';
import { embedChars, EMBED_LIMITS } from '../../src/discord.ts';
import { markImported, one, reset } from '../db.ts';
import { as, auto, cmd, GUILD, send } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
/** Order 16: every crafter line ends with the member's mention and saved name. */
const TAG = ` · <@${ANN}> (Global ${ANN})`;
const at = '2026-10-19T00:00:00Z';
const WIKI = 'https://monstersandmemories.miraheze.org/wiki/';

async function item(name: string, o: { icon?: string; slot?: string; stats?: unknown; page?: boolean; stub?: boolean } = {}): Promise<number> {
  const r = await env.DB.prepare('INSERT INTO item (name, name_key, icon_url, slot, stats_json, wiki_url, source, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(name, name.toLowerCase(), o.icon ?? null, o.slot ?? null, o.stats ? JSON.stringify(o.stats) : null, o.page ? `${WIKI}${encodeURIComponent(name.replace(/ /g, '_'))}` : null, o.stub ? 'stub' : 'wiki', at)
    .run();
  return r.meta.last_row_id;
}

let variant = 0;
async function recipe(skill: string, result: number, trivial: number | null, comps: [number, number][], o: { unconfirmed?: boolean; unknown?: number } = {}) {
  const r = await env.DB.prepare(
    "INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, trivial_unconfirmed, unknown_components, source, imported_at) VALUES (?, (SELECT id FROM tradeskill WHERE name = ?), ?, ?, ?, ?, 'wiki', ?)",
  )
    .bind(`k${++variant}`, skill, result, trivial, o.unconfirmed ? 1 : 0, o.unknown ?? 0, at)
    .run();
  for (const [id, qty] of comps) await env.DB.prepare('INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES (?, ?, ?)').bind(r.meta.last_row_id, id, qty).run();
}

/** Characters with one skill each, owned by distinct members, inserted directly (fixture). */
async function crafters(skill: string, levels: number[], o: { prefix?: string } = {}) {
  await env.DB.batch(
    levels.flatMap((level, i) => {
      const owner = `2000000000000${String(i).padStart(5, '0')}`;
      const name = `${o.prefix ?? 'Crafter'}${String(i).padStart(3, '0')}`;
      return [
        env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?)").bind(GUILD, owner, `m${i}`, at),
        env.DB.prepare('INSERT INTO character (guild_id, owner_user_id, name, name_key, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)').bind(GUILD, owner, name, name.toLowerCase(), at, at),
        env.DB.prepare("INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES ((SELECT id FROM character WHERE name_key = ?), (SELECT id FROM tradeskill WHERE name = ?), ?, ?, 'x')").bind(name.toLowerCase(), skill, level, at),
      ];
    }),
  );
}

const find = (name: string, m = ann) => send(cmd(m, 'craft', 'find', { item: name }));
const BOOTS_STATS = { ac: 9, weight: 3, size: 'MEDIUM', class: 'CLR FTR INQ PAL SHD', race: 'ALL' };
const ICON = 'https://static.wikitide.net/monstersandmemorieswiki/thumb/6/65/Itemicon0034AC.png/64px-Itemicon0034AC.png';

beforeEach(async () => {
  await env.DB.batch(['recipe_component', 'recipe', 'item', 'data_import'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await reset(['Blacksmithing', 'Cooking', 'Tailoring', 'Tinkering']);
  const scraps = await item('Bronze Scraps', { page: true });
  const corroded = await item('Corroded Bronze Plate Boots', { page: true });
  const copperBar = await item('Copper Bar', { page: true });
  const plate = await item('Bronze Plate', { page: true });
  const strap = await item('Hide Strap', { page: true });
  const boots = await item('Tarnished Bronze Plate Boots', { icon: ICON, slot: 'FEET', stats: BOOTS_STATS, page: true });
  await recipe('Blacksmithing', boots, 20, [[scraps, 2], [corroded, 1]]);
  await recipe('Blacksmithing', await item('Copper Axe', { slot: 'PRIMARY SECONDARY', stats: { dmg: 9, delay: 40, skill: 'SLA' }, page: true }), 30, [[copperBar, 7]]);
  await recipe('Blacksmithing', await item('Bronze Plate Boots', { slot: 'FEET', page: true }), 125, [[plate, 1], [strap, 2]]);
  await recipe('Cooking', await item('Prison Gruel', { page: true }), 10, [], { unknown: 1 });
  await recipe('Tailoring', await item('Wool Cap', { page: true }), 15, [[scraps, 1]], { unconfirmed: true });
  const canvas = await item('Rawhide Canvas', { page: true });
  await recipe('Tailoring', canvas, 12, [[strap, 2]]);
  await recipe('Tailoring', canvas, null, [[scraps, 3]], { unknown: 2 });
  await recipe('Tinkering', await item('Chompers (item)', { stub: true }), null, [[copperBar, 1]]);
  await item('Copper Ore', { page: true }); // has a page, no recipe
  await markImported();
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
  await send(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
});

describe('crafterTier (the one decider)', () => {
  const r = (trivial: number | null, acquisition = 'unknown') => ({ trivial, acquisition });
  it('reliable at or above the trivial; learning within the window; below past it; unknown without a trivial', () => {
    expect(crafterTier(20, r(20), false, 25)).toBe('reliable');
    expect(crafterTier(25, r(20), false, 25)).toBe('reliable');
    expect(crafterTier(19, r(20), false, 25)).toBe('learning');
    expect(crafterTier(5, r(30), false, 25)).toBe('learning');
    expect(crafterTier(4, r(30), false, 25)).toBe('below');
    expect(crafterTier(25, r(125), false, 25)).toBe('below');
    expect(crafterTier(25, r(30), false, 0)).toBe('below');
    expect(crafterTier(0, r(null), false, 25)).toBe('unknown');
  });
  it('reputation and discovery recipes need the recipe marked known (FR-3.1)', () => {
    expect(crafterTier(300, r(20, 'reputation'), false, 25)).toBe('unconfirmed');
    expect(crafterTier(300, r(20, 'discovery'), true, 25)).toBe('reliable');
    expect(crafterTier(300, r(20, 'vendor'), false, 25)).toBe('reliable');
  });
});

describe('/craft find autocomplete', () => {
  it('offers only recipe results, prefix matches first, then substring; ungated game data', async () => {
    const r = await send(auto(ann, 'craft', 'find', { item: 'bronze' }, 'item'));
    expect(r.data.choices!.map((c) => c.value)).toEqual(['Bronze Plate Boots', 'Tarnished Bronze Plate Boots']);
    const t = await send(auto(ann, 'craft', 'find', { item: 'Tarnished Bronze' }, 'item'));
    expect(t.data.choices!.map((c) => c.value)).toEqual(['Tarnished Bronze Plate Boots']);
    await env.DB.prepare('UPDATE guild SET member_role_id = ?').bind('700000000000000001').run();
    const gated = await send(auto(as('100000000000000077'), 'craft', 'find', { item: 'cop' }, 'item'));
    expect(gated.data.choices!.map((c) => c.value)).toEqual(['Copper Axe']);
  });

  it('at most 25 choices; a new import is seen on the next keystroke', async () => {
    const before = await send(auto(ann, 'craft', 'find', { item: '' }, 'item'));
    expect(before.data.choices).toHaveLength(7);
    for (let i = 0; i < 30; i++) await recipe('Tailoring', await item(`Zz Cloth ${i}`), 5, []);
    const stale = await send(auto(ann, 'craft', 'find', { item: 'zz' }, 'item'));
    expect(stale.data.choices).toHaveLength(0); // no completed import yet: the cache still holds the last one
    await markImported();
    const fresh = await send(auto(ann, 'craft', 'find', { item: 'zz' }, 'item'));
    expect(fresh.data.choices).toHaveLength(25);
  });
});

describe('/craft find reply', () => {
  it('known trivial (Tarnished Bronze Plate Boots, 20): card, recipe, Testchar reliable, links, private with Post to channel', async () => {
    const r = await find('Tarnished Bronze Plate Boots');
    console.log('[find:known-trivial]', JSON.stringify(r.data));
    expect(r.data.flags).toBe(64);
    const [card, rec] = r.data.embeds as any[];
    expect(card.title).toBe('Tarnished Bronze Plate Boots');
    expect(card.thumbnail).toEqual({ url: ICON });
    expect(card.fields.map((f: any) => `${f.name}: ${f.value}`)).toEqual([
      'Slot: FEET', 'AC: 9', 'Weight · Size: 3 wt · MEDIUM', 'Class / Race: CLR FTR INQ PAL SHD / ALL',
    ]);
    expect(card.footer.text).toMatch(/^Item data: Monsters and Memories Wiki, CC BY-SA 4\.0 · data test\d{3} \(2026-10-19\)$/);
    expect(rec.title).toBe('Blacksmithing · trivial 20');
    expect(rec.description).toBe(`2 × Bronze Scraps\n1 × Corroded Bronze Plate Boots\n\n${CONFIRM_NOTE}`);
    expect(rec.fields).toEqual([{ name: 'Reliable (Blacksmithing 20+) · 1', value: `**Testchar** 25${TAG}` }]);
    const buttons = r.data.components![0].components;
    expect(buttons.map((b: any) => b.label)).toEqual(['Post to channel', 'Wiki', 'MnMdb', 'MNM Realm']);
    expect(buttons[1].url).toBe(`${WIKI}Tarnished_Bronze_Plate_Boots`);
    expect(buttons[2].url).toBe('https://mnm-db.com/#/item/tarnished_bronze_plate_boots');
    expect(buttons[3].url).toBe('https://mnmrealm.com/items?q=Tarnished%20Bronze%20Plate%20Boots');
  });

  it('Copper Axe (30): Testchar still learning; Bronze Plate Boots (125): further below 1', async () => {
    const axe = (await find('copper axe')).data.embeds![1] as any;
    expect(axe.fields).toEqual([{ name: 'Still learning (Blacksmithing 5–29) · 1', value: `**Testchar** 25${TAG}` }]);
    const card = (await find('Copper Axe')).data.embeds![0] as any;
    expect(card.fields.find((f: any) => f.name === 'Damage').value).toBe('9 / 40 delay · SLA');
    const boots = (await find('Bronze Plate Boots')).data.embeds![1] as any;
    expect(boots.fields).toBeUndefined();
    expect(boots.description).toContain('\nFurther below: 1\n');
  });

  it('unconfirmed trivial shows N?; Prison Gruel shows "Ingredients unknown (1)"', async () => {
    const cap = await find('Wool Cap');
    console.log('[find:unconfirmed]', JSON.stringify(cap.data.embeds));
    expect((cap.data.embeds![1] as any).title).toBe('Tailoring · trivial 15?');
    const gruel = await find('Prison Gruel');
    console.log('[find:prison-gruel]', JSON.stringify(gruel.data.embeds));
    const rec = gruel.data.embeds![1] as any;
    expect(rec.title).toBe('Cooking · trivial 10');
    expect(rec.description.split('\n')[0]).toBe('Ingredients unknown (1)');
    expect(rec.description).toContain('No one in the guild has recorded Cooking yet.');
  });

  it('two recipes: each shown; "plus N unknown ingredients"; trivial unknown lists everyone with the skill', async () => {
    await send(cmd(ann, 'craft', 'set', { skill: 'Tailoring', level: 3 }));
    const r = await find('Rawhide Canvas');
    console.log('[find:two-recipes]', JSON.stringify(r.data.embeds));
    const [, a, b] = r.data.embeds as any[];
    expect(r.data.embeds).toHaveLength(3);
    expect(a.title).toBe('Recipe 1 of 2: Tailoring · trivial 12');
    expect(a.fields).toEqual([{ name: 'Still learning (Tailoring 0–11) · 1', value: `**Testchar** 3${TAG}` }]);
    expect(b.title).toBe('Recipe 2 of 2: Tailoring · trivial unknown');
    expect(b.description.split('\n').slice(0, 2)).toEqual(['3 × Bronze Scraps', 'plus 2 unknown ingredients']);
    expect(b.fields).toEqual([{ name: 'Trivial unknown: everyone with Tailoring · 1', value: `**Testchar** 3${TAG}` }]);
  });

  it('a stub result shows its name only: no icon, no stats, no links', async () => {
    const r = await find('Chompers (item)');
    const card = r.data.embeds![0] as any;
    expect(card).toEqual({ title: 'Chompers (item)', footer: card.footer });
    expect(r.data.components![0].components.map((b: any) => b.label)).toEqual(['Post to channel']);
  });

  it('no recipe: a polite message, with the wiki link when the item has a page', async () => {
    const ore = await find('Copper Ore');
    expect(ore.data.content).toBe('No recipe found for **Copper Ore**. Pick an item from the list as you type.');
    expect(ore.data.components![0].components[0]).toMatchObject({ style: 5, label: 'Wiki', url: `${WIKI}Copper_Ore` });
    const none = await find('Basket of Dreams');
    expect(none.data.content).toBe('No recipe found for **Basket of Dreams**. Pick an item from the list as you type.');
    expect(none.data.components).toBeUndefined();
  });

  it('removed characters and departed members never appear', async () => {
    await crafters('Blacksmithing', [50, 40], { prefix: 'Other' });
    await env.DB.prepare("UPDATE character SET deleted_at = ? WHERE name = 'Other000'").bind(at).run();
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = (SELECT owner_user_id FROM character WHERE name = 'Other001')").run();
    const rec = (await find('Tarnished Bronze Plate Boots')).data.embeds![1] as any;
    expect(rec.fields).toEqual([{ name: 'Reliable (Blacksmithing 20+) · 1', value: `**Testchar** 25${TAG}` }]);
  });

  it('overflow: 200 crafters stay inside every embed limit, with "+M more"', async () => {
    await crafters('Blacksmithing', Array.from({ length: 200 }, (_, i) => 20 + (i % 100)));
    const r = await find('Tarnished Bronze Plate Boots');
    const embeds = r.data.embeds as any[];
    const rel = embeds[1].fields[0];
    console.log('[find:overflow]', JSON.stringify({ chars: embedChars(embeds), field: rel.name, lines: rel.value.split('\n').length, last: rel.value.split('\n').at(-1) }));
    expect(rel.name).toBe('Reliable (Blacksmithing 20+) · 201');
    expect(rel.value.split('\n')).toHaveLength(16);
    expect(rel.value.split('\n').at(-1)).toBe('+186 more');
    expect(rel.value.length).toBeLessThanOrEqual(EMBED_LIMITS.fieldValue);
    expect(embedChars(embeds)).toBeLessThanOrEqual(EMBED_LIMITS.total);
    // With the one-time welcome added (a new member's first command), still inside the limit.
    expect(embedChars([...embeds, WELCOME])).toBeLessThanOrEqual(EMBED_LIMITS.total);
    for (const e of embeds) expect((e.fields ?? []).length).toBeLessThanOrEqual(EMBED_LIMITS.fields);
  });

  it('fitLines respects the character cap too', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `**${'x'.repeat(30)}${i}** 99`);
    const out = fitLines(lines, 100, 1024);
    expect(out.length).toBeLessThanOrEqual(1024);
    expect(out.split('\n').at(-1)).toMatch(/^\+\d+ more$/);
  });

  it('learning window comes from guild.learning_window (default 25)', async () => {
    expect((await one<{ w: number }>('SELECT learning_window AS w FROM guild')).w).toBe(25);
    await env.DB.prepare('UPDATE guild SET learning_window = 4').run();
    const axe = (await find('Copper Axe')).data.embeds![1] as any;
    expect(axe.description).toContain('Further below: 1');
  });
});

describe('Post to channel', () => {
  it('re-posts the same content publicly, link buttons kept, mentions never ping', async () => {
    const priv = await find('Tarnished Bronze Plate Boots');
    const id = priv.data.components![0].components[0].custom_id;
    expect(id).toMatch(/^pub:find:\d+$/);
    const pub = await send({ type: 3, guild_id: GUILD, member: ann, data: { custom_id: id, component_type: 2 } });
    expect(pub.type).toBe(4);
    expect(pub.data.flags).toBeUndefined();
    expect(pub.data.embeds).toEqual(priv.data.embeds);
    expect(pub.data.content).toBe(`-# Shared by <@${ANN}>`);
    expect((pub.data as any).allowed_mentions).toEqual({ parse: [] });
    expect(pub.data.components![0].components.map((b: any) => b.label)).toEqual(['Wiki', 'MnMdb', 'MNM Realm']);
  });
});

describe('link builders', () => {
  it('MnMdb uses slugify(name); MNM Realm uses its search page', () => {
    expect(mnmdbUrl("Chompers' Tooth")).toBe('https://mnm-db.com/#/item/chompers_tooth');
    expect(mnmdbUrl('Enchant Belt: Minor Stamina')).toBe('https://mnm-db.com/#/item/enchant_belt_minor_stamina');
    expect(mnmrealmUrl("Chompers' Tooth")).toBe("https://mnmrealm.com/items?q=Chompers'%20Tooth");
  });
});

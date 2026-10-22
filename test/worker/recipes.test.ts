// Order 9, ITEM 1 (FR-2, FR-3.1) and the corrections of ITEM 2 (FR-7): /craft know | forget, the I know this recipe
// button (single, several, posted), /recipe source and /recipe override (the guild correction layer), the four
// acquisition types on /craft find, /roster recipes, /craft me, and that the nightly import never changes a correction.
import { env } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bindingDb } from '../../scripts/import/binding.ts';
import { runImport, type WikiData } from '../../scripts/import/core.ts';
import { KNOWN_MARK, loadFind } from '../../src/commands/find.ts';
import { RARE_EMPTY, parseComponents, resolveRecipe, whoText } from '../../src/commands/recipes.ts';
import { crafterTier } from '../../src/crafters.ts';
import { ACQUISITIONS } from '../../src/recipes.ts';
import migration0009 from '../../migrations/0009_corrections_reports_images.sql?raw';
import small from '../fixtures/wiki-small.json';
import { all, count, markImported, one, reset } from '../db.ts';
import { ADMIN, as, auto, botApi, cmd, exchange, GUILD, press, seen, select, send, webhookCalls } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const ann = as(ANN);
const bo = as(BO);
const officer = as('100000000000000009', { permissions: ADMIN });
const at = '2026-10-19T00:00:00Z';

async function item(name: string): Promise<number> {
  return (await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES (?, ?, 'wiki', ?)").bind(name, name.toLowerCase(), at).run()).meta.last_row_id;
}
let variant = 0;
async function recipe(skill: string, result: number, trivial: number | null, comps: [number, number][] = []): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, source, imported_at) VALUES (?, (SELECT id FROM tradeskill WHERE name = ?), ?, ?, 'wiki', ?)")
    .bind(`k${++variant}`, skill, result, trivial, at)
    .run();
  for (const [id, qty] of comps) await env.DB.prepare('INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES (?, ?, ?)').bind(r.meta.last_row_id, id, qty).run();
  return r.meta.last_row_id;
}

let sword: number;
let swordRecipe: number;
let canvas: number;
const find = (name: string, m = ann) => send(cmd(m, 'craft', 'find', { item: name }));
const text = (r: Awaited<ReturnType<typeof send>>) => JSON.stringify(r.data);

const CLEAR = ['recipe_correction_component', 'recipe_correction', 'recipe_report', 'item_image', 'character_recipe', 'recipe_component', 'recipe', 'item', 'data_import'];
beforeEach(async () => {
  await env.DB.batch(CLEAR.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  await reset(['Blacksmithing', 'Tailoring']);
  const bar = await item('Copper Bar');
  await item('Flux');
  sword = await item('Copper Sword');
  swordRecipe = await recipe('Blacksmithing', sword, 20, [[bar, 3]]);
  canvas = await item('Rawhide Canvas');
  await recipe('Tailoring', canvas, 12);
  await recipe('Tailoring', canvas, null);
  await markImported();
  await send(cmd(ann, 'character', 'add', { name: 'Annsmith' }));
  await send(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
  await send(cmd(bo, 'character', 'add', { name: 'Bohammer' }));
  await send(cmd(bo, 'craft', 'set', { skill: 'Blacksmithing', level: 40 }));
  await send(cmd(officer, 'character', 'add', { name: 'Offy' }));
});
afterEach(() => botApi.reset());

describe('crafterTier: the four acquisition types (FR-3.1)', () => {
  const r = (acquisition: string, trivial: number | null = 20) => ({ trivial, acquisition });
  it('vendor and unknown use the skill tiers for everyone, known or not', () => {
    for (const a of ['vendor', 'unknown']) {
      expect(crafterTier(25, r(a), false, 25)).toBe('reliable');
      expect(crafterTier(10, r(a), false, 25)).toBe('learning');
      expect(crafterTier(0, r(a, null), true, 25)).toBe('unknown');
    }
  });
  it('reputation and discovery: only a known recipe counts, and it still goes through the tiers', () => {
    for (const a of ['reputation', 'discovery']) {
      expect(crafterTier(300, r(a), false, 25)).toBe('unconfirmed');
      expect(crafterTier(25, r(a), true, 25)).toBe('reliable');
      expect(crafterTier(10, r(a), true, 25)).toBe('learning'); // a known recipe never skips the tiers
      expect(crafterTier(1, r(a, 100), true, 25)).toBe('below');
    }
  });
  it('the acquisition list is held once: migration 0009 checks the same values', () => {
    const check = /acquisition TEXT CHECK \(acquisition IN \(([^)]*)\)\)/.exec(migration0009)![1];
    expect(check.split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...ACQUISITIONS]);
  });
});

describe('/craft know and /craft forget', () => {
  it('recipe autocomplete: one choice per recipe, with tradeskill and trivial; it never writes', async () => {
    const before = await count('audit_log');
    const r = await send(auto(ann, 'craft', 'know', { recipe: 'rawhide' }, 'recipe'));
    expect(r.data.choices).toEqual([
      { name: 'Rawhide Canvas · Tailoring · trivial unknown', value: expect.stringMatching(/^#\d+$/) },
      { name: 'Rawhide Canvas · Tailoring · trivial 12', value: expect.stringMatching(/^#\d+$/) },
    ]);
    expect(await count('audit_log')).toBe(before);
    expect(await count('character_recipe')).toBe(0);
  });

  // Order 18: /craft know and /craft forget are the I know this recipe button (/item) and Forget a recipe (/me).
  it('one character, one recipe: the button marks it privately; Forget a recipe offers only the presser\'s marked ones', async () => {
    const swordItem = (await one<{ id: number }>("SELECT id FROM item WHERE name = 'Copper Sword'")).id;
    const k = await send(press(ann, `know:${swordItem}`));
    expect(k.data.content).toBe('Marked **Copper Sword · Blacksmithing · trivial 20** as known for **Annsmith**: `/item` shows the 📜 marker. **Forget a recipe** on `/me` undoes it.');
    expect(k.data.flags).toBe(64);
    const again = await send(press(ann, `know:${swordItem}`));
    expect(again.data.content).toBe('**Annsmith** already has **Copper Sword · Blacksmithing · trivial 20** marked known.');
    expect(await count('character_recipe')).toBe(1);
    // An item with two recipes: the presser picks which; never guessed.
    const canvas = (await one<{ id: number }>("SELECT id FROM item WHERE name = 'Rawhide Canvas'")).id;
    const pick = await send(press(ann, `know:${canvas}`));
    expect(pick.data.components![0].components[0].options.map((o: any) => o.description)).toEqual(['Tailoring · trivial 12', 'Tailoring · trivial unknown']);
    const offered = await send(press(ann, `mef:${ANN}:0`));
    expect(offered.data.components![0].components[0].options.map((o: any) => o.label)).toEqual(['Copper Sword · Blacksmithing']);
    expect((await send(press(bo, `mef:${BO}:0`))).data.content).toMatch(/^No recipes are marked known yet/); // Bo's own only
    const f = await send(cmd(ann, 'craft', 'forget', { recipe: `#${swordRecipe}` }));
    expect(f.data.content).toBe('**Annsmith** no longer has **Copper Sword · Blacksmithing · trivial 20** marked known.');
    expect(await count('character_recipe')).toBe(0);
  });

  it('more than 25 character × recipe pairs: the dropdown is paged, so every pair can be marked', async () => {
    for (let n = 0; n < 4; n++) await send(cmd(ann, 'character', 'add', { name: `Alt${n}` }));
    const item = await env.DB.prepare("INSERT INTO item (name, name_key, source, imported_at) VALUES ('Many Ways', 'many ways', 'wiki', '2026-10-19T00:00:00Z')").run();
    for (let n = 0; n < 6; n++)
      await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, source, imported_at) VALUES (?, (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?, ?, 'wiki', '2026-10-19T00:00:00Z')").bind(`mw${n}`, item.meta.last_row_id, n).run();
    const first = await send(press(ann, `know:${item.meta.last_row_id}`));
    expect(first.data.content).toBe('Which character knows which recipe? (1–25 of 30)');
    const next = first.data.components![0].components[1].custom_id;
    const second = await send(press(ann, next));
    expect(second.type).toBe(7);
    expect(second.data.content).toBe('Which character knows which recipe? (26–30 of 30)');
    expect(second.data.components![1].components[0].options).toHaveLength(5);
  });

  it('/craft me lists the known recipes, truncated with a count', async () => {
    await send(cmd(ann, 'craft', 'know', { recipe: 'Copper Sword' }));
    expect(JSON.stringify((await send(cmd(ann, 'craft', 'me'))).data.embeds)).toContain('Known recipes: Copper Sword (Blacksmithing)');
  });
});

describe('the I know this recipe button', () => {
  const findButtons = async (m = ann) => (await find('Copper Sword', m)).data.components!.flatMap((r: any) => r.components);

  it('is on /craft find with Report a problem and Stat image', async () => {
    // Order 18: /item's card for a craftable item.
    expect((await findButtons()).map((b: any) => b.label)).toEqual(['Post to channel', 'MnMdb', 'MNM Realm', 'I know this recipe', 'Report a recipe problem', 'Report item data', 'Request a craft', 'Stat image']);
  });

  it('one character, one recipe: one press marks it, with a new private reply naming the character', async () => {
    const { ack, calls } = await exchange(press(ann, `know:${sword}`));
    expect(ack.type).toBe(6);
    expect(calls.map((c) => c.method)).toEqual(['POST']); // a new message, never an edit of the message pressed
    const r = seen(ack, calls);
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('as known for **Annsmith**');
    expect(await all('SELECT c.name FROM character_recipe k JOIN character c ON c.id = k.character_id')).toEqual([{ name: 'Annsmith' }]);
  });

  it('several recipes: a dropdown, then the mark; several characters too', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Annalt' }));
    const r = await send(press(ann, `know:${canvas}`));
    const menu = r.data.components![0].components[0];
    expect(menu.options.map((o: any) => `${o.label} / ${o.description}`)).toEqual([
      'Annsmith (main) / Tailoring · trivial 12', 'Annsmith (main) / Tailoring · trivial unknown', 'Annalt / Tailoring · trivial 12', 'Annalt / Tailoring · trivial unknown',
    ]);
    const done = await send(select(ann, menu.custom_id, [menu.options[2].value]));
    expect(done.type).toBe(7); // the presser's own private dropdown becomes the answer
    expect(done.data.content).toContain('as known for **Annalt**');
    // Another member's character id in a forged pick is refused.
    const bohammer = (await one<{ id: number }>("SELECT id FROM character WHERE name = 'Bohammer'")).id;
    expect((await send(select(ann, menu.custom_id, [`${bohammer}:${swordRecipe}`]))).data.content).toMatch(/no longer available/);
  });

  it('on a posted reply it marks the presser, never the original asker, and replies privately', async () => {
    const posted = await send(press(ann, `pub:find:${sword}`));
    expect(posted.data.flags ?? 0).toBe(0);
    const know = posted.data.components!.flatMap((r: any) => r.components).find((b: any) => b.label === 'I know this recipe');
    const before = webhookCalls.length;
    const r = await send(press(bo, know.custom_id));
    expect(webhookCalls.slice(before).every((c) => c.method === 'POST')).toBe(true);
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toContain('for **Bohammer**');
  });

  it('a member with no character gets the same guidance as everywhere else', async () => {
    expect((await send(press(as('100000000000000055'), `know:${sword}`))).data.content).toBe('You have no characters yet. Add one with **Add character** on `/me`.');
  });
});

describe('/recipe source (officers; the guild correction layer)', () => {
  it('is officer only, re-checked; reputation needs a faction', async () => {
    expect((await send(cmd(ann, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'vendor' }))).data.content).toBe('Only officers can do that.');
    expect((await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation' }))).data.content).toMatch(/needs `faction:`/);
    expect(await count('recipe_correction')).toBe(0);
  });

  it('reputation: only the known character counts as able, with the marker; others need reputation', async () => {
    await send(cmd(ann, 'craft', 'know', { recipe: `#${swordRecipe}` }));
    const s = await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation', faction: 'Test Faction' }));
    expect(s.data.content).toMatch(/^Saved for this server: \*\*Copper Sword · Blacksmithing · trivial 20\*\* is now \*\*Reputation\*\* \(Test Faction\)/);
    const r = await find('Copper Sword');
    const fields = r.data.embeds![1] as any;
    expect(fields.fields.map((f: any) => `${f.name} = ${f.value}`)).toEqual([`Reliable (Blacksmithing 20+) · 1 = **Annsmith** 25 ${KNOWN_MARK} · <@${ANN}> (Global ${ANN})`, `Has skill, needs reputation (Test Faction) · 1 = **Bohammer** 40 · <@${BO}> (Global ${BO})`]);
    expect(fields.description).toContain('**Reputation recipe** (Test Faction): only characters who marked it known');
    // The shared recipe row is untouched: another guild still sees Unknown.
    expect(await one('SELECT acquisition, faction FROM recipe WHERE id = ?', swordRecipe)).toEqual({ acquisition: 'unknown', faction: null });
  });

  it('order 10, ITEM 0: a new faction name typed freely saves, /craft find names it, and unknown clears it', async () => {
    const name = 'The Order of the Unlisted Lantern';
    const s = await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation', faction: name }));
    expect(s.data.content).toContain(`is now **Reputation** (${name})`);
    expect(text(await find('Copper Sword'))).toContain(`Has skill, needs reputation (${name}) · 2`);
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'unknown' }));
    const back = text(await find('Copper Sword'));
    expect(back).not.toContain('needs reputation');
    expect(back).toContain('Reliable (Blacksmithing 20+) · 2');
    expect(await one('SELECT acquisition, faction FROM recipe_correction')).toEqual({ acquisition: 'unknown', faction: null });
  });

  it('faction autocomplete: the typed name first, as typed, then this server\'s factions; it never writes', async () => {
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation', faction: 'Red Mantle' }));
    const writes = await count('audit_log');
    const ac = (typed: string) => send(auto(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation', faction: typed }, 'faction'));
    expect((await ac('')).data.choices).toEqual([{ name: 'Red Mantle', value: 'Red Mantle' }]);
    expect((await ac('red')).data.choices).toEqual([{ name: 'red', value: 'red' }, { name: 'Red Mantle', value: 'Red Mantle' }]);
    expect((await ac('Test Faction')).data.choices).toEqual([{ name: 'Test Faction', value: 'Test Faction' }]);
    expect((await ac('red mantle')).data.choices).toEqual([{ name: 'red mantle', value: 'red mantle' }]);
    expect(await count('audit_log')).toBe(writes);
    // Another guild's factions are never offered.
    await env.DB.prepare("INSERT OR IGNORE INTO guild (id, name, created_at) VALUES ('999', 'other', ?)").bind(at).run();
    await env.DB.prepare("INSERT INTO recipe_correction (guild_id, recipe_id, acquisition, faction, updated_by, updated_at) VALUES ('999', ?, 'reputation', 'Elsewhere', 'x', ?)").bind(swordRecipe, at).run();
    expect(JSON.stringify((await ac('')).data.choices)).not.toContain('Elsewhere');
  });

  it('discovery, vendor and back to unknown', async () => {
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'discovery' }));
    expect(text(await find('Copper Sword'))).toContain('Has skill, recipe not marked known · 2');
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'vendor', note: 'Smith in Bastion' }));
    const v = await find('Copper Sword');
    expect(text(v)).toContain('**Vendor recipe**: may need buying first · Note: Smith in Bastion. (guild-corrected)');
    expect(text(v)).toContain('Reliable (Blacksmithing 20+) · 2');
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'unknown' }));
    const u = await find('Copper Sword');
    expect(u.data.embeds![1].description).toContain('-# How this recipe is obtained is not recorded: check the crafter has it.');
    expect(await one('SELECT acquisition, faction, note FROM recipe_correction')).toEqual({ acquisition: 'unknown', faction: null, note: null });
  });
});

describe('one correction rule (order 10, ITEM 1.3)', () => {
  it('resolveRecipe (src/recipes.ts) and loadFind read the same corrected values, before and after a correction', async () => {
    const pick = (r: any) => ({ trivial: r.trivial, acquisition: r.acquisition, faction: r.faction, note: r.note, trivial_corrected: !!r.trivial_corrected, acquisition_corrected: !!r.acquisition_corrected });
    const both = async () => {
      const a = await resolveRecipe(env.DB, GUILD, `#${swordRecipe}`);
      const b = (await loadFind(env.DB, GUILD, { id: sword })).recipes.find((r) => r.id === swordRecipe);
      return [pick((a as any).recipe), pick(b)];
    };
    const [a0, b0] = await both();
    expect(a0).toEqual(b0);
    expect(a0).toMatchObject({ trivial: 20, acquisition: 'unknown', trivial_corrected: false });
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation', faction: 'Red Mantle', note: 'Revered' }));
    await send(cmd(officer, 'recipe', 'override', { item: `#${swordRecipe}`, trivial: 31 }));
    const [a1, b1] = await both();
    expect(a1).toEqual(b1);
    expect(a1).toEqual({ trivial: 31, acquisition: 'reputation', faction: 'Red Mantle', note: 'Revered', trivial_corrected: true, acquisition_corrected: true });
  });
});

describe('/roster recipes', () => {
  it('order 16: who knows it, by character name, five named and the rest counted', () => {
    const who = ['eve', 'Bob', 'carl', 'Al', 'dan', 'Fay', 'gus'].map((name, i) => ({ name, user: `10000000000000000${i}`, member: `M${i}` }));
    expect(whoText(JSON.stringify(who))).toBe(
      'Al <@100000000000000003> (M3), Bob <@100000000000000001> (M1), carl <@100000000000000002> (M2), dan <@100000000000000004> (M4), eve <@100000000000000000> (M0), +2 more',
    );
  });

  it('explains itself when empty, then lists known reputation and discovery recipes and who knows them', async () => {
    const empty = await send(cmd(ann, 'roster', 'recipes'));
    expect(empty.data.embeds![0].description).toBe(RARE_EMPTY);
    await send(cmd(ann, 'craft', 'know', { recipe: `#${swordRecipe}` }));
    await send(cmd(bo, 'craft', 'know', { recipe: `#${swordRecipe}` }));
    expect((await send(cmd(ann, 'roster', 'recipes'))).data.embeds![0].description).toBe(RARE_EMPTY); // still Unknown: not rare
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'reputation', faction: 'Red Mantle' }));
    const r = await send(cmd(ann, 'roster', 'recipes', { skill: 'Blacksmithing' }));
    expect(r.data.embeds![0]).toMatchObject({ title: 'Reputation and discovery recipes · Blacksmithing: 1', description: `**Copper Sword** · Blacksmithing · Reputation (Red Mantle): Annsmith <@${ANN}> (Global ${ANN}), Bohammer <@${BO}> (Global ${BO})`, footer: { text: 'Page 1 of 1' } });
    expect(r.data.components![0].components.map((b: any) => b.label)).toEqual(['◀ Previous', 'Next ▶', 'Post to channel']);
  });
});

describe('/recipe override (officers)', () => {
  it('refuses unmatched component names, listing them, and writes nothing', async () => {
    const r = await send(cmd(officer, 'recipe', 'override', { item: `#${swordRecipe}`, components: '2 Copper Bar, 1 Flux, 1 Copper Bars, 1 Magic Dust' }));
    expect(r.data.content).toBe('Nothing was changed. No item is named exactly: **Copper Bars**, **Magic Dust**. Check the spelling against `/item`.');
    expect(await count('recipe_correction')).toBe(0);
    expect(parseComponents('2 Copper Bar, Flux')).toEqual([{ qty: 2, name: 'Copper Bar' }, { qty: 1, name: 'Flux' }]);
  });

  it('corrects trivial and components (case-insensitive exact names), marks them, and reset removes it', async () => {
    const r = await send(cmd(officer, 'recipe', 'override', { item: `#${swordRecipe}`, trivial: 30, components: '2 copper bar, 1 FLUX' }));
    expect(r.data.content).toMatch(/now shows trivial \*\*30\*\* and ingredients 2 × copper bar, 1 × FLUX/);
    const f = await find('Copper Sword');
    expect(f.data.embeds![1].title).toBe('Blacksmithing · trivial 30 (guild-corrected)');
    expect(f.data.embeds![1].description).toMatch(/^2 × Copper Bar\n1 × Flux\n-# Ingredients \(guild-corrected\)/);
    await send(cmd(officer, 'recipe', 'override', { item: `#${swordRecipe}`, reset: true }));
    const back = await find('Copper Sword');
    expect(back.data.embeds![1].title).toBe('Blacksmithing · trivial 20');
    expect(back.data.embeds![1].description).toMatch(/^3 × Copper Bar\n/);
    expect(await count('recipe_correction')).toBe(0);
  });
});

describe('corrections survive the nightly import', () => {
  it('a correction applied, then the import run on the local database: the correction still wins', async () => {
    await env.DB.batch(CLEAR.filter((t) => t !== 'data_import').map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
    const db = bindingDb(env.DB as never);
    const now = () => new Date().toISOString();
    const data = () => structuredClone(small) as unknown as WikiData;
    expect((await runImport(db, data(), { sourceSha: 'a'.repeat(40), now })).status).toBe('ok');
    const target = await one<{ id: number; name: string }>("SELECT r.id, i.name FROM recipe r JOIN item i ON i.id = r.result_item_id WHERE r.trivial IS NOT NULL ORDER BY r.id LIMIT 1");
    await send(cmd(officer, 'recipe', 'override', { item: `#${target.id}`, trivial: 299 }));
    await send(cmd(officer, 'recipe', 'source', { item: `#${target.id}`, how: 'discovery' }));
    // The source changes that recipe's trivial upstream; the import runs again.
    const changed = data();
    for (const r of changed.recipes) if (r.trivial !== null) r.trivial += 1;
    const again = await runImport(db, changed, { sourceSha: 'b'.repeat(40), now });
    expect(again.status).toBe('ok');
    expect(again.written!.recipe.changes).toBeGreaterThan(0); // the import did write the shared row
    expect(await one('SELECT trivial, acquisition FROM recipe_correction WHERE recipe_id = ?', target.id)).toEqual({ trivial: 299, acquisition: 'discovery' });
    const f = await send(cmd(ann, 'craft', 'find', { item: target.name }));
    expect(JSON.stringify(f.data.embeds)).toContain('trivial 299 (guild-corrected)');
    expect(JSON.stringify(f.data.embeds)).toContain('**Discovery recipe**');
  });
});

describe('writes per action', () => {
  it('know: the mark + 1 audit row; a repeat: nothing; source: 1 row + audit; override with 2 components: 2 rows (+ the correction row) + audit', async () => {
    const audits = () => count('audit_log');
    let a = await audits();
    await send(cmd(ann, 'craft', 'know', { recipe: `#${swordRecipe}` }));
    expect([await count('character_recipe'), (await audits()) - a]).toEqual([1, 1]);
    a = await audits();
    await send(cmd(ann, 'craft', 'know', { recipe: `#${swordRecipe}` }));
    expect((await audits()) - a).toBe(0);
    a = await audits();
    await send(cmd(officer, 'recipe', 'source', { item: `#${swordRecipe}`, how: 'vendor' }));
    expect([await count('recipe_correction'), (await audits()) - a]).toEqual([1, 1]);
    a = await audits();
    await send(cmd(officer, 'recipe', 'override', { item: `#${swordRecipe}`, components: '1 Copper Bar, 1 Flux' }));
    expect([await count('recipe_correction_component'), (await audits()) - a]).toEqual([2, 1]);
  });
});

void GUILD;

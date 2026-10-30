// Work order 18: the simpler command list (src/commands/definitions.ts COMMANDS) on the old handlers:
// /skills, /item, /gear, /request, /help, /officer, /guildcraft; autocomplete keyed by command and option.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { CRAFTABLE_MARK, LISTS, listKey } from '../../src/commands/autocomplete.ts';
import { COMMANDS as NEXT_COMMANDS, DEFINED, SUBCOMMAND } from '../../src/commands/definitions.ts';
import { ROUTES } from '../../src/interactions.ts';
import { DKP_COMMAND } from '../../src/dkp/definition.ts';
import { ITEM_COPY, USED_IN_SQL } from '../../src/commands/item.ts';
import { SCREENSHOTS_OFF } from '../../src/commands/images.ts';
import { OFFICER_ONLY } from '../../src/commands/members.ts';
import { MISSING_MODAL_PREFIX, MISSING_PREFIX } from '../../src/commands/reports.ts';
import { SKILLS_COPY } from '../../src/commands/skills.ts';
import { OPENS_MODAL, planFor } from '../../src/interactions.ts';
import { NO_REQUEST_CHANNEL } from '../../src/requests.ts';
import { markImported, one, reset } from '../db.ts';
import { ADMIN, as, cmd, exchange, GUILD, press, send, submit, type Member } from '../discord.ts';

const ANN = '100000000000000001';
const ann = as(ANN);
const officer = as('100000000000000009', { permissions: ADMIN });
const at = '2026-10-19T00:00:00Z';

const optType = (v: unknown) => (typeof v === 'number' ? 4 : typeof v === 'boolean' ? 5 : 3);
/** A command without subcommands: its options at the top (as Discord sends /zone, /item, /skills). */
const top = (m: Member, name: string, options: Record<string, unknown> = {}, focus?: string) => ({
  type: focus ? 4 : 2,
  guild_id: GUILD,
  member: m,
  data: { name, options: Object.entries(options).map(([n, value]) => ({ type: optType(value), name: n, value, ...(n === focus ? { focused: true } : {}) })) },
});

async function item(name: string, o: { slot?: string; stats?: unknown } = {}): Promise<number> {
  const r = await env.DB.prepare("INSERT INTO item (name, name_key, slot, stats_json, source, imported_at) VALUES (?, ?, ?, ?, 'wiki', ?)")
    .bind(name, name.toLowerCase(), o.slot ?? null, o.stats ? JSON.stringify(o.stats) : null, at)
    .run();
  return r.meta.last_row_id;
}
let variant = 0;
async function recipe(skill: string, result: number, trivial: number | null, comps: [number, number][]) {
  const r = await env.DB.prepare("INSERT INTO recipe (source_key, tradeskill_id, result_item_id, trivial, source, imported_at) VALUES (?, (SELECT id FROM tradeskill WHERE name = ?), ?, ?, 'wiki', ?)")
    .bind(`n${++variant}`, skill, result, trivial, at)
    .run();
  for (const [id, qty] of comps) await env.DB.prepare('INSERT INTO recipe_component (recipe_id, item_id, qty) VALUES (?, ?, ?)').bind(r.meta.last_row_id, id, qty).run();
  return r.meta.last_row_id;
}

let powder = 0;
let ids: Record<string, number> = {};
beforeEach(async () => {
  await reset();
  await env.DB.batch(['recipe_component', 'recipe', 'item'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  powder = await item('Enchanted Powder');
  const bar = await item('Copper Bar');
  ids = {
    powder,
    bar,
    sword: await item('Copper Sword', { slot: 'PRIMARY', stats: { dmg: 8, delay: 30 } }),
    ring: await item('Plain Ring', { slot: 'FINGER', stats: { ac: 2 } }),
  };
  await recipe('Blacksmithing', ids.sword, 20, [[bar, 2], [powder, 1]]);
  await recipe('Tailoring', await item('Glowing Cloak', { slot: 'BACK' }), 40, [[powder, 3]]);
  await recipe('Alchemy', await item('Glowing Draught'), null, [[powder, 1]]);
  await markImported();
  await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
});

describe('the new definitions (order 18)', () => {
  it('are the ten commands of the approved table, and only /officer and /guildcraft carry Manage Server', () => {
    expect(NEXT_COMMANDS.map((c) => c.name).sort()).toEqual(['gear', 'guildcraft', 'help', 'item', 'me', 'officer', 'request', 'roster', 'skills', 'zone'].sort());
    for (const c of NEXT_COMMANDS)
      expect('default_member_permissions' in c ? c.default_member_permissions : undefined, c.name).toBe(c.name === 'officer' || c.name === 'guildcraft' ? String(1 << 5) : undefined);
    const subs = (n: string) => ((NEXT_COMMANDS.find((c) => c.name === n) as { options: readonly { name: string }[] }).options).map((o) => o.name);
    expect(subs('officer')).toEqual(['recipe-source', 'recipe-fix', 'remove-member', 'edit-member', 'requests']);
    expect(subs('guildcraft')).toEqual(['setup', 'status', 'rebuild-board']);
  });

  it('one route per registered command and subcommand, and no route for anything unregistered', () => {
    const routed = Object.keys(ROUTES).map((k) => `/${k}`).sort();
    expect(routed).toEqual([...DEFINED].sort());
  });

  it('every one of them is answered (deferred privately); nothing new answers "not yet"', async () => {
    const calls: [unknown, string][] = [];
    for (const c of NEXT_COMMANDS) {
      const opts = (c as { options?: readonly { type: number; name: string }[] }).options ?? [];
      const subs = opts.filter((o) => o.type === SUBCOMMAND);
      if (subs.length) for (const s of subs) calls.push([cmd(officer, c.name, s.name), `/${c.name} ${s.name}`]);
      else calls.push([top(officer, c.name), `/${c.name}`]);
    }
    for (const [body, label] of calls) {
      const { ack, calls: delivered } = await exchange(body);
      expect(ack, label).toEqual({ type: 5, data: { flags: 64 } });
      expect(delivered.length, label).toBeGreaterThan(0);
    }
  });
});

describe('autocomplete, keyed by command and option', () => {
  type Opt = { type: number; name: string; autocomplete?: boolean; options?: readonly Opt[] };
  // Order 29: a subcommand group's subcommands are "group sub" (src/discord.ts subcommand).
  const subOptions = (cmd: string, sub: string, o: Opt) => (o.options ?? []).filter((p) => p.autocomplete).map((p) => listKey(cmd, sub, p.name));
  const autocompleteOptions = (list: readonly object[]) =>
    (list as readonly { name: string; options?: readonly Opt[] }[]).flatMap((c) =>
      (c.options ?? []).flatMap((o) =>
        o.type === SUBCOMMAND
          ? subOptions(c.name, o.name, o)
          : o.type === 2
            ? (o.options ?? []).flatMap((s) => subOptions(c.name, `${o.name} ${s.name}`, s))
            : o.autocomplete
              ? [listKey(c.name, undefined, o.name)]
              : [],
      ),
    );
  it('every autocomplete option in both lists has a list, and every list names one (derived both ways)', () => {
    // Order 27: /dkp's per-server definition has its lists too.
    const defined = new Set(autocompleteOptions([...NEXT_COMMANDS, DKP_COMMAND]));
    expect([...defined].filter((k) => !LISTS[k])).toEqual([]);
    expect(Object.keys(LISTS).filter((k) => !defined.has(k))).toEqual([]);
  });

  it('/item name: every item, prefix matches first, craftable ones marked; /request item: recipe results only', async () => {
    const r = await send(top(ann, 'item', { name: 'p' }, 'name'));
    expect(r.data.choices).toEqual([
      { name: 'Plain Ring', value: 'Plain Ring' },
      { name: 'Copper Bar', value: 'Copper Bar' },
      { name: `Copper Sword${CRAFTABLE_MARK}`, value: 'Copper Sword' },
      { name: 'Enchanted Powder', value: 'Enchanted Powder' },
    ]);
    const req = await send(top(ann, 'request', { item: 'glow' }, 'item'));
    expect(req.data.choices!.map((c) => c.value)).toEqual(['Glowing Cloak', 'Glowing Draught']);
    const ring = await send(top(ann, 'request', { item: 'ring' }, 'item'));
    expect(ring.data.choices).toEqual([]);
  });

  it('/officer recipe-source item: keeps the recipe list; /skills character: the caller\'s characters', async () => {
    const r = await send({ type: 4, guild_id: GUILD, member: officer, data: { name: 'officer', options: [{ type: 1, name: 'recipe-source', options: [{ type: 3, name: 'item', value: 'Copper', focused: true }] }] } });
    expect(r.data.choices!.map((c) => c.name)).toEqual(['Copper Sword · Blacksmithing · trivial 20']);
    expect((await send(top(ann, 'skills', { character: '' }, 'character'))).data.choices).toEqual([{ name: 'Testchar', value: 'Testchar' }]);
  });
});

describe('/item', () => {
  const card = (name: string, m = ann) => send(top(m, 'item', { name }));
  const labels = (r: Awaited<ReturnType<typeof send>>) => r.data.components!.map((row: any) => row.components.map((b: any) => b.label ?? b.placeholder));

  it('"used in" seeks recipe_component by item, never scanning it (order 19, ITEM 2: EXPLAIN QUERY PLAN)', async () => {
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${USED_IN_SQL}`).bind(ids.sword, GUILD).all<{ detail: string }>();
    const reads = plan.results.map((r) => r.detail).filter((d) => /^(SCAN|SEARCH) recipe_component\b/.test(d));
    expect(reads, JSON.stringify(plan.results)).toEqual([expect.stringMatching(/^SEARCH recipe_component USING COVERING INDEX recipe_component_by_item \(item_id=\?\)/)]);
  });

  it('a craftable item: its recipe, the I know / Report / Request buttons (order 24: no Stat image), and Post to channel', async () => {
    const r = await card('Copper Sword');
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds!.map((e) => e.title)).toEqual(['Copper Sword', 'Blacksmithing · trivial 20']);
    expect(labels(r)).toEqual([['Post to channel', 'MnMdb', 'MNM Realm'], [ITEM_COPY.knowButton, ITEM_COPY.recipeReportButton, ITEM_COPY.itemReportButton, ITEM_COPY.requestButton]]);
    expect(r.data.components![1].components.map((b: any) => b.custom_id)).toEqual([`know:${ids.sword}`, `rpt:${ids.sword}`, `rpi:${ids.sword}`, `rqf:${ids.sword}`]);
    // Post to channel rebuilds it publicly, with the same buttons.
    const pub = await send(press(ann, r.data.components![0].components[0].custom_id));
    expect(pub.data.flags).toBeUndefined();
    expect(pub.data.embeds!.map((e) => e.title)).toEqual(['Copper Sword', 'Blacksmithing · trivial 20']);
  });

  it('a gear item with no recipe: stats and source, Report a problem (item issues); order 24: no Stat image', async () => {
    const r = await card('plain ring');
    expect(r.data.embeds!.length).toBe(1);
    expect(r.data.embeds![0].fields!.map((f) => f.name)).toEqual(expect.arrayContaining(['Slot', 'AC']));
    expect(r.data.components![1].components.map((b: any) => b.custom_id)).toEqual([`rpi:${ids.ring}`]);
  });

  it('an ingredient-only item: the recipes that use it', async () => {
    const r = await card('Enchanted Powder');
    const used = r.data.embeds!.at(-1)!;
    expect(used.title).toBe('Used in 3 recipes');
    expect(used.description!.split('\n')).toEqual(['**Copper Sword** · Blacksmithing · trivial 20', '**Glowing Cloak** · Tailoring · trivial 40', '**Glowing Draught** · Alchemy · trivial unknown']);
  });

  it('a guild correction that drops the ingredient drops the recipe from "used in"', async () => {
    const draught = await one<{ id: number }>("SELECT r.id FROM recipe r JOIN item i ON i.id = r.result_item_id WHERE i.name = 'Glowing Draught'");
    await env.DB.prepare("INSERT INTO recipe_correction (guild_id, recipe_id, updated_by, updated_at) VALUES (?, ?, 'x', ?)").bind(GUILD, draught.id, at).run();
    await env.DB.prepare('INSERT INTO recipe_correction_component (guild_id, recipe_id, item_id, qty) VALUES (?, ?, ?, 1)').bind(GUILD, draught.id, ids.bar).run();
    expect((await card('Enchanted Powder')).data.embeds!.at(-1)!.title).toBe('Used in 2 recipes');
    expect((await card('Copper Bar')).data.embeds!.at(-1)!.description).toContain('Glowing Draught');
  });

  it('an unknown name: "No item called", and Report a missing recipe files a report with no item and the name in details', async () => {
    const r = await card('Moonsteel Ingot');
    expect(r.data.content).toBe(ITEM_COPY.noItem('Moonsteel Ingot'));
    const b = r.data.components![0].components[0];
    expect(b).toMatchObject({ label: ITEM_COPY.missingButton, custom_id: `${MISSING_PREFIX}Moonsteel Ingot` });
    expect(planFor(press(ann, b.custom_id) as any)).toEqual({ defer: false });
    const modal = await send(press(ann, b.custom_id));
    expect(modal.type).toBe(9);
    expect(modal.data.custom_id).toBe(MISSING_MODAL_PREFIX);
    const done = await send(submit(ann, MISSING_MODAL_PREFIX, { name: 'Moonsteel Ingot', details: 'Blacksmithing, 2 Moonsteel Ore' }));
    expect(done.data.content).toBe('Thanks: your report on **Moonsteel Ingot** (Missing recipe) is saved for your officers.');
    expect(await one('SELECT item_id, issue, details FROM recipe_report')).toEqual({ item_id: null, issue: 'missing', details: 'Item: Moonsteel Ingot\nBlacksmithing, 2 Moonsteel Ore' });
  });

  it('a lookup writes the craft.find audit row; a stale screenshot: is told screenshots are off (order 24), with no lookup row', async () => {
    await card('Copper Sword');
    expect(await one("SELECT action, target FROM audit_log WHERE action = 'craft.find'")).toEqual({ action: 'craft.find', target: 'item' });
    const shot = await send({ ...top(ann, 'item', { name: 'Copper Sword', screenshot: 'att1' }) });
    expect(shot.data.content).toBe(SCREENSHOTS_OFF);
    expect((await one<{ n: number }>("SELECT count(*) AS n FROM audit_log WHERE action = 'craft.find'")).n).toBe(1);
  });
});

describe('/skills', () => {
  it('skill and level: sets one; neither: the pick-up-to-5 select; one without the other: says what is missing', async () => {
    expect((await send(top(ann, 'skills', { skill: 'Blacksmithing', level: 31 }))).data.content).toBe('**Testchar**: Blacksmithing set to **31**.');
    expect((await send(top(ann, 'skills'))).data.content).toBe('Pick up to 5 tradeskills for **Testchar**. A form then opens with a level box for each.');
    expect((await send(top(ann, 'skills', { level: 3 }))).data.content).toBe(SKILLS_COPY.levelWithoutSkill);
    expect((await send(top(ann, 'skills', { skill: 'Brewing' }))).data.content).toBe(SKILLS_COPY.skillWithoutLevel('Brewing'));
  });
});

describe('/gear, /request, /help', () => {
  it('/gear without the subcommand: the same search', async () => {
    const r = await send(top(ann, 'gear', { class: 'Any', slot: 'FINGER' }));
    expect(r.data).toEqual((await send(cmd(ann, 'gear', 'find', { class: 'Any', slot: 'FINGER' }))).data);
    expect(await one("SELECT action FROM audit_log WHERE action = 'gear.find'")).toEqual({ action: 'gear.find' });
  });
  it('/request: the same request flow (here: no request channel set)', async () => {
    expect((await send(top(ann, 'request', { item: 'Copper Sword' }))).data.content).toBe(NO_REQUEST_CHANNEL);
  });
});

describe('/officer', () => {
  it('a member who is not an officer is refused on every subcommand, whatever Discord shows them', async () => {
    for (const sub of ['recipe-source', 'recipe-fix', 'remove-member', 'edit-member', 'requests'])
      expect((await send(cmd(ann, 'officer', sub))).data.content, sub).toBe(OFFICER_ONLY);
  });
  it('recipe-source, recipe-fix and remove-member run the old officer handlers', async () => {
    const src = await send(cmd(officer, 'officer', 'recipe-source', { item: 'Copper Sword', how: 'vendor' }));
    expect(src.data.content).toMatch(/^Saved for this server: \*\*Copper Sword · Blacksmithing · trivial 20\*\* is now \*\*Vendor/);
    const fix = await send(cmd(officer, 'officer', 'recipe-fix', { item: 'Copper Sword', trivial: 25 }));
    expect(fix.data.content).toMatch(/now shows trivial \*\*25\*\*/);
    const rm = await send(cmd(officer, 'officer', 'remove-member', { member: ANN }));
    expect(rm.data.content).toMatch(/^This will remove 1 character: \*\*Testchar\*\*/);
  });
  it('requests: every open request, paged; the page buttons re-check the officer role', async () => {
    await env.DB.prepare('UPDATE guild SET request_channel_id = ? WHERE id = ?').bind('700000000000000001', GUILD).run();
    for (let n = 0; n < 12; n++) {
      const r = await env.DB.prepare("INSERT INTO craft_request (guild_id, requester, status, created_at, opened_at, thread_id) VALUES (?, ?, 'open', ?, ?, ?)").bind(GUILD, ANN, at, at, `71000000000000${String(n).padStart(4, '0')}`).run();
      await env.DB.prepare("INSERT INTO craft_request_item (request_id, position, item_id, quantity) VALUES (?, 1, ?, 1)").bind(r.meta.last_row_id, ids.sword).run();
    }
    const p1 = await send(cmd(officer, 'officer', 'requests'));
    expect(p1.data.content!.split('\n')[0]).toBe('**Open craft requests** 1–10 of 12, oldest first:');
    expect(p1.data.components![0].components[0].options.length).toBe(10);
    const next = p1.data.components![1].components[1].custom_id;
    const p2 = await send(press(officer, next));
    expect(p2.data.content!.split('\n')[0]).toBe('**Open craft requests** 11–12 of 12, oldest first:');
    expect((await send(press(ann, next))).data.content).toBe(OFFICER_ONLY);
  });
});

describe('buttons on messages sent before order 18 keep working', () => {
  // Every custom_id prefix the code sent at e597826 (the base of order 18), with a plausible id. Each must reach its
  // handler: an answer that is neither "that menu has expired" nor the error reply. (Handlers may still say the item or
  // request is gone: these ids point at nothing.) A frozen list on purpose: it is the history the guild's messages carry.
  const SENT_BEFORE: [string, 'press' | 'select' | 'submit', string[]?][] = [
    ['dep:keep:1', 'press'], ['rm:no:1', 'press'], ['rpf:0', 'press'], ['rpd:0', 'press'], ['ima:0', 'press'], ['imr:0', 'press'],
    ['know:0', 'press'], ['knows:0', 'select', ['0:0']], ['img:0', 'press'], ['rpt:0', 'press'], ['rptm:0', 'submit'], ['rpi:0', 'press'], ['rpim:0', 'submit'],
    ['rqf:0', 'press'], ['rqa:0', 'press'], ['rqam:0', 'submit'], ['rqs:0', 'press'], ['rqz:0', 'press'], ['rqi:c:0:1', 'press'], ['rql:', 'select', ['0']],
    ['pub:find:0', 'press'], ['pub:gear:0', 'press'], ['pub:zone:x', 'press'], ['pub:rr:0:0', 'press'], ['pub:rs:0:0:0', 'press'], ['pub:rm:1', 'press'], ['pub:rt', 'press'],
    ['rr:0:0', 'press'], ['rs:0:0:0', 'press'], ['rss:0:0', 'select', ['0']], ['upb:0', 'press'], ['upd:0:0', 'select', ['0']], ['updm:0', 'submit'],
    ['gp:0:x', 'press'], ['gd:', 'select', ['0']], ['gs:x', 'select', ['0']], ['zc:x', 'press'], ['zcn:0:x', 'press'], ['zd:x', 'press'], ['zdn:0:x', 'press'], ['zg:x', 'press'], ['zgc:x', 'select', ['Any']],
  ];
  it('every one reaches its handler', async () => {
    const { STALE_FORM } = await import('../../src/interactions.ts');
    const { ERROR_REPLY } = await import('../../src/respond.ts');
    await send(top(officer, 'help'));
    for (const [id, kind, values] of SENT_BEFORE) {
      const body = kind === 'press' ? press(officer, id) : kind === 'select' ? { ...press(officer, id), data: { custom_id: id, component_type: 3, values } } : submit(officer, id, {});
      const r = await send(body);
      expect([STALE_FORM, ERROR_REPLY], id).not.toContain(r.data.content);
    }
  });
});

describe('modal-opening buttons are answered at once (order 18 adds Report a missing recipe)', () => {
  it('every prefix in OPENS_MODAL is planned without a deferral', () => {
    for (const p of OPENS_MODAL) expect(planFor(press(ann, `${p}1`) as any), p).toEqual({ defer: false });
  });
});

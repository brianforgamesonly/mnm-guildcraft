// ITEM 1.3: /roster skill | member | top in workerd — paging across 31+ characters, the tradeskill
// switcher, removed and departed exclusions, Post to channel.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { PAGE_SIZE } from '../../src/commands/roster.ts';
import { reset } from '../db.ts';
import { as, cmd, GUILD, select, send } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const ann = as(ANN);
const at = new Date().toISOString();

const button = (m: ReturnType<typeof as>, custom_id: string) => ({ type: 3, guild_id: GUILD, member: m, data: { custom_id, component_type: 2 } });

/** n characters with Blacksmithing levels n..1 (distinct members), plus Tailoring on the first three. */
async function seed(n: number) {
  const stmts = [];
  for (let i = 0; i < n; i++) {
    const owner = `3000000000000${String(i).padStart(5, '0')}`;
    const name = `Smith${String(i + 1).padStart(2, '0')}`;
    stmts.push(
      env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', ?)").bind(GUILD, owner, `m${i}`, at),
      env.DB.prepare('INSERT INTO character (guild_id, owner_user_id, name, name_key, class, level, is_main, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').bind(GUILD, owner, name, name.toLowerCase(), 'WAR', 10, at, at),
      env.DB.prepare("INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES ((SELECT id FROM character WHERE name_key = ?), (SELECT id FROM tradeskill WHERE name = 'Blacksmithing'), ?, ?, 'x')").bind(name.toLowerCase(), n - i, at),
    );
    if (i < 3)
      stmts.push(env.DB.prepare("INSERT INTO character_skill (character_id, tradeskill_id, level, updated_at, updated_by) VALUES ((SELECT id FROM character WHERE name_key = ?), (SELECT id FROM tradeskill WHERE name = 'Tailoring'), ?, ?, 'x')").bind(name.toLowerCase(), 50 + i, at));
  }
  await env.DB.batch(stmts);
}

beforeEach(async () => {
  await reset();
  await send(cmd(ann, 'character', 'add', { name: 'Testchar', class: 'clr', level: 12 }));
});

const lines = (r: any) => (r.data.embeds[0].description as string).split('\n');

describe('/roster skill', () => {
  it('ranked by skill level, 15 per page; Previous/Next page across 33 characters; each press a new interaction', async () => {
    await seed(32);
    await send(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
    const r = await send(cmd(ann, 'roster', 'skill', { skill: 'blacksmithing' }));
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds![0].title).toBe('Blacksmithing: 33 characters');
    expect(lines(r)).toHaveLength(PAGE_SIZE);
    expect(lines(r)[0]).toBe('**1.** **Smith01** 32 · WAR level 10');
    // A tie at 25 with Smith08 is ordered by name.
    expect(lines(r).slice(7, 9)).toEqual(['**8.** **Smith08** 25 · WAR level 10', '**9.** **Testchar** 25 · CLR level 12']);
    const nav = r.data.components![0].components;
    expect(nav.map((b: any) => [b.label, !!b.disabled])).toEqual([['◀ Previous', true], ['Next ▶', false], ['Post to channel', false]]);

    const p2 = await send(button(ann, nav[1].custom_id));
    expect(p2.type).toBe(7); // UPDATE_MESSAGE: edits the private reply in place
    expect(lines(p2)[0]).toMatch(/^\*\*16\.\*\* /);
    expect((p2.data as any).embeds[0].footer.text).toBe('Page 2 of 3');
    const p3 = await send(button(ann, p2.data.components![0].components[1].custom_id));
    expect(lines(p3)).toHaveLength(3);
    expect(lines(p3).at(-1)).toBe('**33.** **Smith32** 1 · WAR level 10');
    expect(p3.data.components![0].components[1].disabled).toBe(true);
    const back = await send(button(ann, p3.data.components![0].components[0].custom_id));
    expect((back.data as any).embeds[0].footer.text).toBe('Page 2 of 3');
  });

  it('min_level filters; the dropdown lists only skills in use and switches tradeskill', async () => {
    await seed(5);
    const r = await send(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing', min_level: 3 }));
    expect(r.data.embeds![0].title).toBe('Blacksmithing: 3 characters at 3+');
    const sel = r.data.components![1].components[0];
    expect(sel.options.map((o: any) => o.label)).toEqual(['Blacksmithing', 'Tailoring']);
    expect(sel.options[0].default).toBe(true);
    const tailor = sel.options[1].value;
    const sw = await send(select(ann, sel.custom_id, [tailor]));
    expect(sw.type).toBe(7);
    expect((sw.data as any).embeds[0].title).toBe('Tailoring: 3 characters at 3+');
    expect(lines(sw)[0]).toBe('**1.** **Smith03** 52 · WAR level 10');
  });

  it('removed characters and departed members are left out', async () => {
    await seed(3);
    await env.DB.prepare("UPDATE character SET deleted_at = ? WHERE name = 'Smith01'").bind(at).run();
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = (SELECT owner_user_id FROM character WHERE name = 'Smith02')").run();
    const r = await send(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing' }));
    expect(lines(r)).toEqual(['**1.** **Smith03** 1 · WAR level 10']);
  });

  it('Post to channel posts the current page publicly, without the paging controls', async () => {
    await seed(3);
    const r = await send(cmd(ann, 'roster', 'skill', { skill: 'Blacksmithing' }));
    const pub = await send(button(ann, r.data.components![0].components[2].custom_id));
    expect(pub.type).toBe(4);
    expect(pub.data.flags).toBeUndefined();
    expect(pub.data.embeds).toEqual(r.data.embeds);
    expect(pub.data.components).toEqual([]);
  });

  it('an unknown tradeskill is refused politely', async () => {
    expect((await send(cmd(ann, 'roster', 'skill', { skill: 'Basketry' }))).data.content).toMatch(/^I don't know a tradeskill called \*\*Basketry\*\*/);
  });
});

describe('/roster member', () => {
  it("all of one member's live characters and skills, grouped by character; removed excluded", async () => {
    await send(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
    await send(cmd(ann, 'character', 'add', { name: 'Alt' }));
    await send(cmd(ann, 'craft', 'set', { skill: 'Tailoring', level: 7, character: 'Alt' }));
    await send(cmd(ann, 'character', 'add', { name: 'Gone' }));
    await send(cmd(ann, 'character', 'remove', { name: 'Gone' }));
    await send(cmd(as(BO), 'craft', 'me')); // BO's first command carries the one-time welcome
    const r = await send(cmd(as(BO), 'roster', 'member', { member: ANN }));
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toBe(`<@${ANN}>: 2 characters`);
    expect(r.data.embeds!.map((e) => [e.title, e.description])).toEqual([
      ['Testchar (main)', 'CLR level 12\n**Blacksmithing** 25'],
      ['Alt', '**Tailoring** 7'],
    ]);
  });

  it('a member with no characters, or who left, shows none', async () => {
    expect((await send(cmd(ann, 'roster', 'member', { member: BO }))).data.content).toBe(`<@${BO}> has no characters on the roster.`);
    await env.DB.prepare("UPDATE member SET status = 'left' WHERE discord_user_id = ?").bind(ANN).run();
    expect((await send(cmd(as(BO), 'roster', 'member', { member: ANN }))).data.content).toBe(`<@${ANN}> has no characters on the roster.`);
  });
});

describe('/roster top', () => {
  it('the top 3 in each tradeskill as one compact list', async () => {
    await seed(5);
    await send(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
    const r = await send(cmd(ann, 'roster', 'top'));
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds![0].description).toBe('**Blacksmithing**: Testchar 25 · Smith01 5 · Smith02 4\n**Tailoring**: Smith03 52 · Smith02 51 · Smith01 50');
    expect(r.data.components![0].components[0].label).toBe('Post to channel');
  });
});

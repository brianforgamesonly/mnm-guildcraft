// ITEM 1.4: /craft set | update | me, the select → modal → submit flow in workerd, and the two-select split.
import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_PICK, SELECT_MAX_OPTIONS, skillGroups } from '../../src/commands/skills.ts';
import { matchChoices } from '../../src/discord.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, as, auto, cmd, send, select, submit } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const ann = as(ANN);
const bo = as(BO);
const officer = as('100000000000000009', { permissions: ADMIN });

beforeEach(() => reset());

const set = (m = ann, options: Record<string, unknown> = {}) => send(cmd(m, 'craft', 'set', options));
const skillId = async (name: string) => (await one<{ id: number }>('SELECT id FROM tradeskill WHERE name = ?', name)).id;
const levels = () => all<{ name: string; level: number; updated_by: string }>(
  'SELECT t.name, s.level, s.updated_by FROM character_skill s JOIN tradeskill t ON t.id = s.tradeskill_id ORDER BY t.name',
);

describe('/craft set', () => {
  it('with no character, points to /character add', async () => {
    const r = await set(ann, { skill: 'Blacksmithing', level: 25 });
    expect(r.data.content).toBe('You have no characters yet. Add one with `/character add`.');
  });

  it("sets the main's level by default, case-insensitive skill; writes updated_at, updated_by and an audit row", async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    expect((await set(ann, { skill: 'blacksmithing', level: 25 })).data.content).toBe('**Testchar**: Blacksmithing set to **25**.');
    expect((await set(ann, { skill: 'Blacksmithing', level: 30 })).data.content).toBe('**Testchar**: Blacksmithing set to **30** (was 25).');
    expect(await levels()).toEqual([{ name: 'Blacksmithing', level: 30, updated_by: ANN }]);
    const a = await one<{ action: string; detail_json: string }>("SELECT action, detail_json FROM audit_log WHERE action = 'skill.set' ORDER BY id DESC LIMIT 1");
    expect(JSON.parse(a.detail_json)).toEqual({ before: { Blacksmithing: 25 }, after: { Blacksmithing: 30 } });
  });

  it('an out-of-range level is refused against guild.skill_cap', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    expect((await set(ann, { skill: 'Brewing', level: 301 })).data.content).toBe('Level must be a whole number from 0 to 300.');
    expect((await set(ann, { skill: 'Brewing', level: -1 })).data.content).toBe('Level must be a whole number from 0 to 300.');
    await env.DB.prepare('UPDATE guild SET skill_cap = 50').run();
    expect((await set(ann, { skill: 'Brewing', level: 51 })).data.content).toBe('Level must be a whole number from 0 to 50.');
    expect((await set(ann, { skill: 'Brewing', level: 0 })).data.content).toMatch(/set to \*\*0\*\*/);
    expect(await count('character_skill')).toBe(1);
  });

  it('an unknown skill is refused', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    expect((await set(ann, { skill: 'Basket weaving', level: 5 })).data.content).toMatch(/^I don't know a tradeskill called \*\*Basket weaving\*\*/);
  });

  it('officer path: member:@user sets another member\'s level, recorded as updated_by the officer; refused for a non-officer', async () => {
    await send(cmd(bo, 'character', 'add', { name: 'Bochar' }));
    expect((await set(ann, { skill: 'Brewing', level: 9, member: BO })).data.content).toBe("Only officers can change another member's characters.");
    expect((await set(ann, { skill: 'Brewing', level: 9, character: 'Bochar' })).data.content).toBe('You have no character named **Bochar**.');
    expect((await set(officer, { skill: 'Brewing', level: 9, member: BO })).data.content).toBe('**Bochar**: Brewing set to **9**.');
    expect(await levels()).toEqual([{ name: 'Brewing', level: 9, updated_by: '100000000000000009' }]);
  });
});

describe('/craft update', () => {
  const start = async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    await set(ann, { skill: 'Blacksmithing', level: 25 });
    const r = await send(cmd(ann, 'craft', 'update'));
    return { r, charId: (await one<{ id: number }>('SELECT id FROM character')).id };
  };

  it('replies privately with one string select of tradeskills, max_values 5, the character id in custom_id', async () => {
    const { r, charId } = await start();
    expect(r.data.flags).toBe(64);
    expect(r.data.components).toHaveLength(1);
    const sel = r.data.components![0].components[0];
    expect(sel).toMatchObject({ type: 3, custom_id: `upd:${charId}:0`, min_values: 1, max_values: MAX_PICK });
    expect(sel.options.map((o: { label: string }) => o.label)).toEqual(['Alchemy', 'Blacksmithing', 'Brewing', 'Fletching', 'Tailoring']);
    expect(sel.options[1].description).toBe('Now 25');
  });

  it('end to end in workerd: select opens a modal of Label components; a valid submit saves every box', async () => {
    const { charId } = await start();
    const ids = [await skillId('Blacksmithing'), await skillId('Tailoring')];
    const modal = await send(select(ann, `upd:${charId}:0`, ids.map(String)));
    expect(modal.type).toBe(9);
    expect(modal.data.custom_id).toBe(`updm:${charId}`);
    expect(modal.data.title).toBe('Levels for Testchar');
    const comps = modal.data.components!;
    expect(comps).toHaveLength(2);
    for (const c of comps) {
      expect(c.type).toBe(18); // Label
      expect(c.label.length).toBeLessThanOrEqual(45);
      expect(c.component).toMatchObject({ type: 4, max_length: 3, required: true });
    }
    expect(comps[0]).toMatchObject({ label: 'Blacksmithing', component: { custom_id: `lvl:${ids[0]}`, value: '25' } });
    expect(comps[1].component.value).toBeUndefined();

    const saved = await send(submit(ann, `updm:${charId}`, { [`lvl:${ids[0]}`]: '40', [`lvl:${ids[1]}`]: '012' }));
    expect(saved.data.content).toBe('Saved for **Testchar**: Blacksmithing **40** (was 25), Tailoring **12**.');
    expect((await levels()).map((l) => [l.name, l.level])).toEqual([['Blacksmithing', 40], ['Tailoring', 12]]);
    expect(await count('audit_log', "action = 'skill.update'")).toBe(1);
  });

  it('a partly invalid modal writes nothing and names the bad box', async () => {
    const { charId } = await start();
    const [b, t, f] = [await skillId('Blacksmithing'), await skillId('Tailoring'), await skillId('Fletching')];
    const r = await send(submit(ann, `updm:${charId}`, { [`lvl:${b}`]: '41', [`lvl:${t}`]: 'abc', [`lvl:${f}`]: '999' }));
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toBe(
      'Nothing was saved. **Tailoring**: "abc" is not a whole number from 0 to 300. **Fletching**: "999" is not a whole number from 0 to 300.\nRun `/craft update` again to retry.',
    );
    expect((await levels()).map((l) => [l.name, l.level])).toEqual([['Blacksmithing', 25]]);
  });

  it("another member's select or modal is refused and writes nothing", async () => {
    const { charId } = await start();
    const b = await skillId('Blacksmithing');
    expect((await send(select(bo, `upd:${charId}:0`, [String(b)]))).data.content).toMatch(/no longer available/);
    expect((await send(submit(bo, `updm:${charId}`, { [`lvl:${b}`]: '99' }))).data.content).toMatch(/no longer available/);
    expect((await levels())[0].level).toBe(25);
  });

  it('more than 25 tradeskills split into two selects, A–M and N–Z (synthetic fixture of 30)', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `${String.fromCharCode(65 + (i % 26))}skill ${i}`);
    await reset(names);
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const r = await send(cmd(ann, 'craft', 'update'));
    const sels = r.data.components!.map((row) => row.components[0]);
    expect(sels).toHaveLength(2);
    expect(sels.map((s) => s.placeholder)).toEqual(['Tradeskills A–M: pick up to 5', 'Tradeskills N–Z: pick up to 5']);
    for (const s of sels) {
      expect(s.options.length).toBeLessThanOrEqual(SELECT_MAX_OPTIONS);
      expect(s.max_values).toBe(MAX_PICK);
    }
    expect(sels[0].options.every((o: { label: string }) => /^[A-M]/.test(o.label))).toBe(true);
    expect(sels[1].options.every((o: { label: string }) => /^[N-Z]/.test(o.label))).toBe(true);
    expect(sels.flatMap((s) => s.options.map((o: { label: string }) => o.label)).sort()).toEqual([...names].sort());
    expect(new Set(sels.map((s) => s.custom_id)).size).toBe(2);
  });

  it('a half that still overflows 25 is cut again', () => {
    const groups = skillGroups(Array.from({ length: 30 }, (_, i) => ({ name: `Alpha ${i}` })));
    expect(groups.map((g) => [g.label, g.skills.length])).toEqual([['Tradeskills A–M (1/2)', 25], ['Tradeskills A–M (2/2)', 5]]);
  });
});

describe('/craft me', () => {
  it('no characters: a pointer to /character add', async () => {
    expect((await send(cmd(ann, 'craft', 'me'))).data.content).toBe('You have no characters yet. Add one with `/character add`.');
  });

  it('private; characters, skills, levels and Discord timestamps; stale marked; removed characters excluded', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar', class: 'clr', level: 10 }));
    await send(cmd(ann, 'character', 'add', { name: 'Alt' }));
    await set(ann, { skill: 'Blacksmithing', level: 25 });
    await set(ann, { skill: 'Tailoring', level: 7 });
    await env.DB.prepare("UPDATE character_skill SET updated_at = '2026-01-01T00:00:00.000Z' WHERE tradeskill_id = ?").bind(await skillId('Tailoring')).run();
    await send(cmd(ann, 'character', 'add', { name: 'Gone' }));
    await send(cmd(ann, 'character', 'remove', { name: 'Gone' }));

    const r = await send(cmd(ann, 'craft', 'me'));
    expect(r.data.flags).toBe(64);
    expect(r.data.embeds!.map((e) => e.title)).toEqual(['Testchar (main)', 'Alt']);
    const lines = r.data.embeds![0].description!.split('\n');
    expect(lines[0]).toBe('CLR · level 10');
    expect(lines[1]).toMatch(/^\*\*Blacksmithing\*\* 25 · <t:\d{10}:d>$/);
    expect(lines[2]).toBe(`**Tailoring** 7 · <t:${Date.parse('2026-01-01T00:00:00.000Z') / 1000}:d> · *stale*`);
    expect(r.data.embeds![1].description).toBe('No skills yet: `/craft set` or `/craft update`.');
    // Order 16: the member's craft request opt-ins (none yet).
    expect(r.data.content).toBe('**Craft request notices:** off (`/craft notify` turns them on for a tradeskill)\n-# *stale* = not updated in 60 days.');
  });
});

describe('skill autocomplete', () => {
  it('prefix matches first, then substring matches, at most 25', async () => {
    const r = await send(auto(ann, 'craft', 'set', { skill: 'ing' }, 'skill'));
    expect(r.data.choices!.map((c) => c.value)).toEqual(['Blacksmithing', 'Brewing', 'Fletching', 'Tailoring']);
    const b = await send(auto(ann, 'craft', 'set', { skill: 'b' }, 'skill'));
    expect(b.data.choices!.map((c) => c.value)).toEqual(['Blacksmithing', 'Brewing']);
    expect(matchChoices(['Xb', 'Bx', 'Ab'], 'b')).toEqual(['Bx', 'Xb', 'Ab']);
    expect(matchChoices(Array.from({ length: 40 }, (_, i) => `S${i}`), 's')).toHaveLength(25);
  });
});

// Order 3, ITEM 2: the Update skills button on the add-character and /skills replies opens the same skill select /skills
// opens; order 18: /me has one Update skills button that asks which character when there are several. The descriptions.
import { describe, expect, it, beforeEach } from 'vitest';
import { COMMANDS } from '../../src/commands/definitions.ts';
import { ME_COPY } from '../../src/commands/me.ts';
import { reset } from '../db.ts';
import { as, cmd, GUILD, select, send, top } from '../discord.ts';

const ann = as('100000000000000001');
const bo = as('100000000000000002');
const press = (m: ReturnType<typeof as>, custom_id: string) => ({ type: 3, guild_id: GUILD, member: m, data: { custom_id, component_type: 2 } });

beforeEach(() => reset());

const updateSelect = async () => (await send(top(ann, 'skills'))).data;

describe('Update skills button', () => {
  it('on Add character: opens the same select as /skills, for that character', async () => {
    const add = await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const b = add.data.components![0].components[0];
    expect(b).toMatchObject({ type: 2, style: 1, label: 'Update skills' });
    const opened = await send(press(ann, b.custom_id));
    expect(opened.data.flags).toBe(64);
    expect(opened.data).toEqual(await updateSelect());
  });

  it('on /skills skill: level:: one button for the character just set', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const set = await send(top(ann, 'skills', { skill: 'Brewing', level: 3 }));
    const opened = await send(press(ann, set.data.components![0].components[0].custom_id));
    expect(opened.data).toEqual(await updateSelect());
  });

  it('on /me: one button; with several characters it asks which, then opens that one\'s select', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const me = async () => (await send(top(ann, 'me'))).data.components!.flatMap((r: any) => r.components).find((b: any) => b.label === ME_COPY.update);
    expect((await send(press(ann, (await me()).custom_id))).data).toEqual(await updateSelect());
    await send(cmd(ann, 'character', 'add', { name: 'Alt' }));
    const pick = await send(press(ann, (await me()).custom_id));
    expect(pick.data.content).toBe(ME_COPY.pickUpdate);
    const sel = pick.data.components![0].components[0];
    const alt = await send(select(ann, sel.custom_id, [sel.options.find((o: any) => o.label === 'Alt').value]));
    expect(alt.type).toBe(7);
    expect(alt.data.content).toBe('Pick up to 5 tradeskills for **Alt**. A form then opens with a level box for each.');
  });

  it("another member's button is refused", async () => {
    const add = await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const r = await send(press(bo, add.data.components![0].components[0].custom_id));
    expect(r.data.content).toBe('That character is no longer available. Run `/skills` again.');
  });
});

describe('descriptions (Discord limit: 100 characters)', () => {
  type Def = { description: string; options?: readonly Def[] };
  it('say what happens', () => {
    const skills = COMMANDS.find((c) => c.name === 'skills') as unknown as Def;
    expect(skills.description).toBe('Set one tradeskill level, or leave the options out to update up to 5 at once');
    expect(skills.options![2].description).toBe('Optional; defaults to your main');
    const visit = (d: Def) => {
      expect(d.description.length, d.description).toBeLessThanOrEqual(100);
      for (const o of d.options ?? []) visit(o);
    };
    for (const c of COMMANDS) visit(c as unknown as Def);
  });
});

// ITEM 2: the Update skills button on /craft me, /craft set and /character add replies opens the same
// skill select /craft update opens; the new command descriptions.
import { describe, expect, it, beforeEach } from 'vitest';
import { COMMANDS } from '../../src/commands/definitions.ts';
import { reset } from '../db.ts';
import { as, cmd, GUILD, send } from '../discord.ts';

const ann = as('100000000000000001');
const bo = as('100000000000000002');
const press = (m: ReturnType<typeof as>, custom_id: string) => ({ type: 3, guild_id: GUILD, member: m, data: { custom_id, component_type: 2 } });

beforeEach(() => reset());

const updateSelect = async () => (await send(cmd(ann, 'craft', 'update'))).data;

describe('Update skills button', () => {
  it('on /character add: opens the same select as /craft update, for that character', async () => {
    const add = await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const b = add.data.components![0].components[0];
    expect(b).toMatchObject({ type: 2, style: 1, label: 'Update skills' });
    const opened = await send(press(ann, b.custom_id));
    expect(opened.data.flags).toBe(64);
    expect(opened.data).toEqual(await updateSelect());
  });

  it('on /craft set: one button for the character just set', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const set = await send(cmd(ann, 'craft', 'set', { skill: 'Brewing', level: 3 }));
    const opened = await send(press(ann, set.data.components![0].components[0].custom_id));
    expect(opened.data).toEqual(await updateSelect());
  });

  it('on /craft me: one button per character, named when there are several', async () => {
    await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    expect((await send(cmd(ann, 'craft', 'me'))).data.components![0].components.map((b: any) => b.label)).toEqual(['Update skills']);
    await send(cmd(ann, 'character', 'add', { name: 'Alt' }));
    const me = await send(cmd(ann, 'craft', 'me'));
    expect(me.data.components![0].components.map((b: any) => b.label)).toEqual(['Update Testchar', 'Update Alt']);
    const alt = await send(press(ann, me.data.components![0].components[1].custom_id));
    expect(alt.data.content).toBe('Pick up to 5 tradeskills for **Alt**. A form then opens with a level box for each.');
  });

  it("another member's button is refused", async () => {
    const add = await send(cmd(ann, 'character', 'add', { name: 'Testchar' }));
    const r = await send(press(bo, add.data.components![0].components[0].custom_id));
    expect(r.data.content).toBe('That character is no longer available. Run `/craft update` again.');
  });
});

describe('descriptions (Discord limit: 100 characters)', () => {
  const craft = COMMANDS.find((c) => c.name === 'craft')!;
  const update = craft.options.find((o) => o.name === 'update')! as unknown as { description: string; options: readonly { name: string; description: string }[] };
  it('say what happens', () => {
    expect(update.description).toBe('Update up to 5 skills: press Enter, pick skills, then type levels');
    expect(update.options[0].description).toBe('Optional; defaults to your main');
    for (const c of COMMANDS) {
      expect(c.description.length).toBeLessThanOrEqual(100);
      for (const o of c.options as readonly { description: string; options?: readonly { description: string }[] }[]) {
        expect(o.description.length, o.description).toBeLessThanOrEqual(100);
        for (const p of o.options ?? []) expect(p.description.length, p.description).toBeLessThanOrEqual(100);
      }
    }
  });
});

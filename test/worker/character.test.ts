// ITEM 1.3: /character add | edit | remove, name resolution and privacy, audit rows.
import { beforeEach, describe, expect, it } from 'vitest';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, as, auto, cmd, send } from '../discord.ts';

const ANN = '100000000000000001';
const BO = '100000000000000002';
const OFFICER = '100000000000000009';
const ann = as(ANN);
const bo = as(BO);
const officer = as(OFFICER, { permissions: ADMIN });

beforeEach(() => reset());

const add = (m = ann, options: Record<string, unknown> = {}) => send(cmd(m, 'character', 'add', options));
const edit = (m = ann, options: Record<string, unknown> = {}) => send(cmd(m, 'character', 'edit', options));
const remove = (m = ann, options: Record<string, unknown> = {}) => send(cmd(m, 'character', 'remove', options));
const chars = () => all<{ name: string; owner_user_id: string; is_main: number; deleted: number; class: string | null; level: number | null }>(
  'SELECT name, owner_user_id, is_main, deleted_at IS NOT NULL AS deleted, class, level FROM character ORDER BY id',
);

describe('/character add', () => {
  it('the first character becomes main; a class picked from the list is stored as its code', async () => {
    const r = await add(ann, { name: '  Testchar ', class: 'shd', level: 10 });
    expect(r.data.content).toBe('Added **Testchar** (SHD, level 10). It is your main (your first character).');
    expect(await chars()).toEqual([{ name: 'Testchar', owner_user_id: ANN, is_main: 1, deleted: 0, class: 'SHD', level: 10 }]);
  });

  it('names are unique per guild whatever their capitals, across members', async () => {
    await add(ann, { name: 'Testchar' });
    const own = await add(ann, { name: 'testchar' });
    const other = await add(bo, { name: 'TESTCHAR' });
    for (const r of [own, other]) expect(r.data.content).toMatch(/is already taken in this guild\. Character names are unique, whatever their capitals\.$/);
    expect(await count('character')).toBe(1);
  });

  it('rejects an empty name and a level outside 1 to 100', async () => {
    expect((await add(ann, { name: '   ' })).data.content).toBe("A character name can't be empty.");
    expect((await add(ann, { name: 'A', level: 0 })).data.content).toBe('Level must be a whole number from 1 to 100.');
    expect((await add(ann, { name: 'A', level: 101 })).data.content).toBe('Level must be a whole number from 1 to 100.');
    expect(await count('character')).toBe(0);
  });

  it('a class not on the list is accepted as typed, and the reply says so; a deactivated code counts as not on the list', async () => {
    const r = await add(ann, { name: 'Oddball', class: 'Spellsword' });
    expect(r.data.content).toContain("Class **Spellsword** isn't in the class list");
    await add(ann, { name: 'Oldie', class: 'old' });
    expect((await chars()).map((c) => c.class)).toEqual(['Spellsword', 'old']);
  });

  it('a second character is not main unless asked; main:true moves the main in the same write', async () => {
    await add(ann, { name: 'First' });
    await add(ann, { name: 'Second' });
    const r = await add(ann, { name: 'Third', main: true });
    expect(r.data.content).toContain('It is now your main.');
    expect((await chars()).map((c) => [c.name, c.is_main])).toEqual([['First', 0], ['Second', 0], ['Third', 1]]);
  });
});

describe('removed names', () => {
  it("the caller's own removed character is restored by add, with its skills", async () => {
    await add(ann, { name: 'Testchar', class: 'SHD', level: 10 });
    await send(cmd(ann, 'craft', 'set', { skill: 'Blacksmithing', level: 25 }));
    await send(cmd(ann, 'craft', 'set', { skill: 'Tailoring', level: 3 }));
    await remove(ann, { name: 'Testchar' });
    const r = await add(ann, { name: 'TESTCHAR' });
    expect(r.data.content).toBe('Restored **Testchar** (SHD, level 10), which you removed earlier, with its 2 saved skills. It is your main.');
    expect(await chars()).toEqual([{ name: 'Testchar', owner_user_id: ANN, is_main: 1, deleted: 0, class: 'SHD', level: 10 }]);
    expect(await count('character_skill')).toBe(2);
  });

  it("another member's removed character: add refuses and says an officer can rename it; the officer can", async () => {
    await add(ann, { name: 'Testchar' });
    await remove(ann, { name: 'Testchar' });
    const r = await add(bo, { name: 'testchar' });
    expect(r.data.content).toBe("**Testchar** belongs to a removed character, so it can't be reused yet. An officer can rename the removed character to free the name.");
    expect(await count('character', 'owner_user_id = ?', BO)).toBe(0);
    const o = await add(officer, { name: 'Testchar' });
    expect(o.data.content).toContain(`It belongs to <@${ANN}>`);
    // The officer frees the name by renaming the removed character, which stays removed.
    expect((await edit(officer, { name: 'Testchar', new_name: 'Testchar-old', member: ANN })).data.content).toMatch(/^Updated \*\*Testchar-old\*\* \(was \*\*Testchar\*\*\)\./);
    expect((await add(bo, { name: 'Testchar' })).data.content).toMatch(/^Added \*\*Testchar\*\*/);
    expect((await chars()).map((c) => [c.name, c.owner_user_id, c.deleted])).toEqual([['Testchar-old', ANN, 1], ['Testchar', BO, 0]]);
  });
});

describe('/character edit', () => {
  it('renames, with the same uniqueness check as add', async () => {
    await add(ann, { name: 'Alpha' });
    await add(bo, { name: 'Bravo' });
    expect((await edit(ann, { name: 'alpha', new_name: 'BRAVO' })).data.content).toMatch(/is already taken in this guild/);
    expect((await edit(ann, { name: 'alpha', new_name: 'ALPHA' })).data.content).toBe('Updated **ALPHA** (was **Alpha**).');
    expect((await edit(ann, { name: 'Alpha', new_name: ' ' })).data.content).toBe("A character name can't be empty.");
  });

  it('setting main clears the previous main in the same transaction; unsetting the main is refused', async () => {
    await add(ann, { name: 'One' });
    await add(ann, { name: 'Two' });
    expect((await edit(ann, { name: 'Two', main: true })).data.content).toBe('Updated **Two**. It is now the main.');
    expect((await chars()).map((c) => c.is_main)).toEqual([0, 1]);
    expect((await edit(ann, { name: 'Two', main: false })).data.content).toBe('**Two** is the main. To change that, set `main` on another character.');
    expect(await count('character', 'is_main = 1')).toBe(1);
  });

  it("a non-officer naming another member's character gets the same 'not found' as a missing name", async () => {
    await add(bo, { name: 'Bochar' });
    const other = await edit(ann, { name: 'Bochar', level: 50 });
    const missing = await edit(ann, { name: 'Nobody', level: 50 });
    expect(other.data.content).toBe('You have no character named **Bochar**.');
    expect(missing.data.content).toBe('You have no character named **Nobody**.');
    expect((await remove(ann, { name: 'Bochar' })).data.content).toBe('You have no character named **Bochar**.');
    expect((await send(cmd(ann, 'craft', 'me', { character: 'Bochar' }))).data.content).toBe('You have no character named **Bochar**.');
    expect(await chars()).toEqual([{ name: 'Bochar', owner_user_id: BO, is_main: 1, deleted: 0, class: null, level: null }]);
  });

  it('member:@user is refused for a non-officer and works for an officer', async () => {
    await add(bo, { name: 'Bochar' });
    expect((await edit(ann, { name: 'Bochar', level: 5, member: BO })).data.content).toBe("Only officers can change another member's characters.");
    expect((await edit(officer, { name: 'Bochar', level: 5, member: BO })).data.content).toBe('Updated **Bochar** (level 5).');
    expect((await remove(ann, { name: 'Bochar', member: BO })).data.content).toBe("Only officers can change another member's characters.");
  });

  it('nothing to change is answered, not written', async () => {
    await add(ann, { name: 'One' });
    expect((await edit(ann, { name: 'One' })).data.content).toMatch(/^Nothing to change/);
    expect(await count('audit_log', "action = 'character.edit'")).toBe(0);
  });
});

describe('/character remove', () => {
  it('sets deleted_at, keeps the skills stored; if it was the main, the oldest remaining becomes main', async () => {
    await add(ann, { name: 'Oldest' });
    await add(ann, { name: 'Middle' });
    await add(ann, { name: 'Newest', main: true });
    await send(cmd(ann, 'craft', 'set', { skill: 'Brewing', level: 7 }));
    const r = await remove(ann, { name: 'Newest' });
    expect(r.data.content).toBe('Removed **Newest**. Its skills are kept: `/character add name:Newest` restores it.\n**Oldest** is now the main.');
    expect((await chars()).map((c) => [c.name, c.is_main, c.deleted])).toEqual([['Oldest', 1, 0], ['Middle', 0, 0], ['Newest', 0, 1]]);
    expect(await count('character_skill')).toBe(1);
  });

  it('an officer can remove a member\'s character with member:@user', async () => {
    await add(bo, { name: 'Bochar' });
    expect((await remove(officer, { name: 'bochar', member: BO })).data.content).toMatch(/^Removed \*\*Bochar\*\*/);
    expect((await chars())[0].deleted).toBe(1);
  });
});

describe('audit', () => {
  it('one add, one edit and one remove each record actor, action, target and before/after', async () => {
    await add(ann, { name: 'Auditee', class: 'WIZ', level: 3 });
    await edit(ann, { name: 'Auditee', level: 4 });
    await remove(ann, { name: 'Auditee' });
    const id = (await one<{ id: number }>('SELECT id FROM character')).id;
    const rows = await all<{ actor: string; action: string; target: string; detail_json: string }>(
      "SELECT actor, action, target, detail_json FROM audit_log WHERE action LIKE 'character.%' ORDER BY id",
    );
    expect(rows.map((r) => [r.actor, r.action, r.target])).toEqual([
      [ANN, 'character.add', `character:${id}`],
      [ANN, 'character.edit', `character:${id}`],
      [ANN, 'character.remove', `character:${id}`],
    ]);
    const [a, e, r] = rows.map((x) => JSON.parse(x.detail_json));
    expect(a).toEqual({ before: null, after: { name: 'Auditee', class: 'WIZ', level: 3, is_main: 1, deleted_at: null } });
    expect(e.before.level).toBe(3);
    expect(e.after.level).toBe(4);
    expect(r.before.deleted_at).toBeNull();
    expect(r.after.deleted_at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(r.after.is_main).toBe(0);
  });
});

describe('autocomplete', () => {
  it('class: codes from game_class with item_count > 0, prefix matches first', async () => {
    const r = await send(auto(ann, 'character', 'add', { name: 'X', class: 'c' }, 'class'));
    expect(r.type).toBe(8);
    expect(r.data.choices!.map((c) => c.value)).toEqual(['CLR']);
    const all = await send(auto(ann, 'character', 'add', { class: '' }, 'class'));
    expect(all.data.choices!.map((c) => c.value)).toEqual(['CLR', 'SHD', 'WIZ']);
  });

  it("name: only the caller's own live characters", async () => {
    await add(ann, { name: 'Annchar' });
    await add(bo, { name: 'Bochar' });
    await add(ann, { name: 'Gone' });
    await remove(ann, { name: 'Gone' });
    const r = await send(auto(ann, 'character', 'edit', { name: '' }, 'name'));
    expect(r.data.choices!.map((c) => c.value)).toEqual(['Annchar']);
    const sneaky = await send(auto(ann, 'character', 'edit', { name: '', member: BO }, 'name'));
    expect(sneaky.data.choices!.map((c) => c.value)).toEqual(['Annchar']);
    const off = await send(auto(officer, 'character', 'edit', { name: '', member: BO }, 'name'));
    expect(off.data.choices!.map((c) => c.value)).toEqual(['Bochar']);
  });
});

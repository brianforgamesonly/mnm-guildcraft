// Order 24, ITEM 2: the factions board, built by the tradeskill board's machinery (src/board/refresh.ts) against a fake
// Discord forum (test/fake-forum.ts): one post per faction A→Z, an index, NO_MENTIONS, the preview line, the wiki's
// labels, overflow messages, the 40-call cap shared with the tradeskill board, and re-rendering what the import changed.
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { BOARD_CALL_CAP, botApi as makeBotApi } from '../../src/board/api.ts';
import { FACTION_COPY, renderFactionIndex, renderFactionPost, type FactionLine } from '../../src/board/factions.ts';
import { FACTIONS } from '../../src/board/kinds.ts';
import { FACTIONS_FLOOR, refreshGuildBoard } from '../../src/board/refresh.ts';
import { BOARD_PERMISSIONS } from '../../src/commands/setup.ts';
import { EMBED_LIMITS, embedChars } from '../../src/discord.ts';
import { all, one, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, exchange, GUILD, seen, spyOnFetch, webhook } from '../discord.ts';
import { FORUM, fakeForum } from '../fake-forum.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const FACTION_FORUM = '600000000000000005';
const admin = as('100000000000000001', { permissions: ADMIN, nick: 'Ann' });
const ALL_BOARD_PERMS = String(BOARD_PERMISSIONS.reduce((b, [bit]) => b | bit, 0n));

let forum: ReturnType<typeof fakeForum>;
let logs: string[];
beforeEach(async () => {
  await reset();
  await env.DB.batch(['zone', 'npc'].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
  webhook.reset();
  spyOnFetch();
  forum = fakeForum();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
});
afterEach(() => {
  botApi.reset();
  vi.restoreAllMocks();
});

type Link = [zone: string, creature: string, faction: string, kind: 'lost' | 'gained', level?: string | null, location?: string | null];
/** Zones, npc rows, factions and links as the import writes them (changed_at set). */
async function seedFactions(links: Link[], at = '2026-10-27T00:00:00.000Z') {
  const zones = [...new Set(links.map((l) => l[0]))];
  const npcs = [...new Map(links.map((l) => [`${l[0]}|${l[1]}`, l])).values()];
  const factions = [...new Set(links.map((l) => l[2]))];
  await env.DB.batch([
    ...zones.map((z) => env.DB.prepare('INSERT INTO zone (key, name) VALUES (?, ?)').bind(z.toLowerCase(), z)),
    ...npcs.map(([z, n, , , level, location]) => env.DB.prepare('INSERT INTO npc (zone_key, name, level, location) VALUES (?, ?, ?, ?)').bind(z.toLowerCase(), n, level ?? null, location ?? null)),
    ...factions.map((f) => env.DB.prepare('INSERT INTO faction (name, changed_at) VALUES (?, ?)').bind(f, at)),
    ...links.map(([z, n, f, k]) =>
      env.DB.prepare('INSERT INTO npc_faction (zone_key, npc_name, faction_id, kind) SELECT ?, ?, id, ? FROM faction WHERE name = ?').bind(z.toLowerCase(), n, k, f),
    ),
  ]);
}
const setGuild = (factionForum: string | null = FACTION_FORUM, board: string | null = null) =>
  env.DB.prepare("INSERT INTO guild (id, name, created_at, faction_board_channel_id, board_channel_id) VALUES (?, 'The Test Guild', '2026-10-19T00:00:00Z', ?, ?)").bind(GUILD, factionForum, board).run();
const api = (cap = BOARD_CALL_CAP) => makeBotApi('test-bot-token', { d1: () => 0, discord: 0, cap, deadline: Date.now() + 60_000 });
const refresh = (cap?: number) => refreshGuildBoard(env.DB, api(cap), GUILD, { kind: FACTIONS });

const STEEL: Link[] = [
  ['Shaded Dunes', 'A bandit', "Vermahn's Brood", 'lost', '10', null],
  ['Shaded Dunes', 'A bandit', 'Steel Talons', 'gained', '10', null],
  ['Night Harbor', 'A highwayman', 'Steel Talons', 'gained', null, 'West gate'],
  ['Night Harbor', 'Talon Sergeant', 'Steel Talons', 'lost', '~45', 'Garrison'],
  ['Night Harbor', 'Talon Sergeant', 'Night Harbor Garrison', 'lost', '~45', 'Garrison'],
];

describe('order 24: the factions board', () => {
  it('builds one post per faction A→Z under a creation-date sort, then a pinned index; nobody is pinged', async () => {
    await seedFactions(STEEL);
    await setGuild();
    const r = await refresh();
    expect(r).toMatchObject({ board: 'factions', created: 3, index: 'created', in_order: true, errors: [] });
    expect(forum.display(FACTION_FORUM)).toEqual([FACTIONS.indexTitle, 'Night Harbor Garrison', 'Steel Talons', "Vermahn's Brood"]);
    for (const t of forum.posts(FACTION_FORUM)) for (const m of t.messages.values()) expect(m.allowed_mentions).toEqual({ parse: [] });
    expect(await one('SELECT count(*) AS n FROM faction_post WHERE dirty = 0')).toEqual({ n: 3 });
  });

  it('a post: the preview line, Reputation Gained then Lost, creatures by zone with whichever of level and location is known, and the source footer', async () => {
    await seedFactions(STEEL);
    await setGuild();
    await refresh();
    const steel = forum.byName('Steel Talons')!;
    expect(forum.line(steel)).toBe('Steel Talons · 3 creatures: reputation gained from 2, lost from 1');
    expect(forum.text(steel)).toBe(
      [
        'Steel Talons',
        '**Reputation Gained** · 2 creatures',
        '__Night Harbor__',
        '• A highwayman (West gate)',
        '__Shaded Dunes__',
        '• A bandit (level 10)',
        '',
        '**Reputation Lost** · 1 creature',
        '__Night Harbor__',
        // md() escapes the tilde, which Discord shows as ~45.
        '• Talon Sergeant (level \\~45, Garrison)',
        FACTION_COPY.footer,
      ].join('\n'),
    );
  });

  it('a faction with no creature on one side says so; the index links every post with its count', async () => {
    await seedFactions(STEEL);
    await setGuild();
    await refresh();
    expect(forum.text(forum.byName('Night Harbor Garrison'))).toContain(`**Reputation Gained** · 0 creatures\n${FACTION_COPY.none}`);
    const index = forum.byName(FACTIONS.indexTitle)!;
    expect(forum.line(index)).toBe("Factions · 3 posts, A→Z · from each creature's wiki page");
    expect(forum.text(index)).toContain(`<#${forum.byName('Steel Talons')!.id}> · 3 creatures`);
    expect(index.flags & 2).toBe(2);
  });

  it('within the call cap a run creates what it can, Z→A; the next run continues; the board ends A→Z', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `Faction ${String.fromCharCode(65 + Math.floor(i / 10))}${i % 10}`);
    await seedFactions(names.map((f): Link => ['Night Harbor', `A creature ${f}`, f, 'lost']));
    await setGuild();
    const first = await refresh(12);
    expect(first.created).toBeGreaterThan(0);
    expect(first.created).toBeLessThan(30);
    let runs = 1;
    while ((await one<{ n: number }>('SELECT count(*) AS n FROM faction_post')).n < 30 && runs < 10) {
      await refresh(12);
      runs++;
    }
    expect(runs).toBeGreaterThan(1);
    expect(forum.display(FACTION_FORUM).filter((n) => n !== FACTIONS.indexTitle)).toEqual([...names].sort());
    // The index counts posts still coming in one line, never naming each (it would overflow while the board fills).
    expect(renderFactionIndex(names.map((f) => ({ faction: f, thread_id: null, creatures: 1 })), 0).message.embeds[0].description).toContain(FACTION_COPY.coming(30));
  });

  it('re-renders only posts whose faction changed after they were rendered (faction.changed_at); unchanged posts are not edited', async () => {
    await seedFactions(STEEL, '2026-10-01T00:00:00.000Z');
    await setGuild();
    await refresh();
    const again = await refresh();
    expect(again).toMatchObject({ created: 0, edited: 0, skipped_unchanged: 0 });
    // The import changed the bandit's level: it touches the bandit's factions.
    await env.DB.batch([
      env.DB.prepare("UPDATE npc SET level = '11' WHERE name = 'A bandit'"),
      env.DB.prepare("UPDATE faction SET changed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 second') WHERE name IN ('Steel Talons', 'Vermahn''s Brood')"),
    ]);
    const after = await refresh();
    expect(after).toMatchObject({ edited: 2, created: 0 });
    expect(forum.text(forum.byName('Steel Talons'))).toContain('A bandit (level 11)');
  });

  it('a big faction overflows into more bot messages, each inside Discord\'s embed limits', () => {
    const lines: FactionLine[] = Array.from({ length: 400 }, (_, i) => ({
      faction_id: 1, kind: i % 3 ? 'gained' : 'lost', creature: `A citizen of the harbor number ${i}`, zone: `Zone ${Math.floor(i / 40)}`, level: '~45', location: 'Near the old lighthouse on the west pier',
    }));
    const msgs = renderFactionPost('Citizens of Night Harbor', lines);
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) {
      expect(m.embeds.length).toBeLessThanOrEqual(EMBED_LIMITS.embeds);
      expect(embedChars(m.embeds)).toBeLessThanOrEqual(EMBED_LIMITS.total);
      for (const e of m.embeds) expect(e.description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
    }
    expect(msgs[0].content).toMatch(/^Citizens of Night Harbor · 400 creatures/);
    expect(msgs.slice(1).every((m) => m.content === undefined)).toBe(true);
  });

  it('the index of 130 factions stays one message inside Discord\'s limits', () => {
    const entries = Array.from({ length: 130 }, (_, i) => ({ faction: `F${i}`, thread_id: String(1_300_000_000_000_000_000n + BigInt(i)), creatures: 175 }));
    const { message } = renderFactionIndex(entries, Date.parse('2026-10-27T00:00:00Z'));
    expect(embedChars(message.embeds)).toBeLessThanOrEqual(EMBED_LIMITS.total);
    for (const e of message.embeds) expect(e.description!.length).toBeLessThanOrEqual(EMBED_LIMITS.description);
  });

  it('names stay as written: plainText in the preview line, markdown escaped in the embed', () => {
    const [m] = renderFactionPost('Sons_of *Kar*', [{ faction_id: 1, kind: 'lost', creature: 'a_b', zone: 'Z*', level: null, location: null }]);
    expect(m.content).toBe('Sons_​of *​Kar*​ · 1 creature: reputation gained from 0, lost from 1');
    expect(m.embeds[0].description).toContain('• a\\_b');
  });
});

describe('order 24: setup, status, rebuild and the shared sweep', () => {
  const setupFactions = (channel = FACTION_FORUM) => {
    const i = cmd(admin, 'guildcraft', 'setup', { factions: channel }) as any;
    i.data.resolved = { channels: { [channel]: { id: channel, name: 'factions', type: 15, permissions: ADMIN, app_permissions: ALL_BOARD_PERMS } } };
    return exchange(i, TOKEN);
  };

  it('/guildcraft setup factions: saves the forum and starts the build after the reply', async () => {
    await seedFactions(STEEL);
    const { ack, calls } = await setupFactions();
    const reply = seen(ack, calls);
    expect(reply.data.content).toContain('Factions board: <#600000000000000005>');
    expect(reply.data.content).toContain('Building the factions board now: 3 faction posts plus a pinned index post. The factions board fills in over the next few hours.');
    expect(await one('SELECT faction_board_channel_id AS f FROM guild')).toEqual({ f: FACTION_FORUM });
    expect(forum.posts(FACTION_FORUM).length).toBe(4);
  });

  it('/guildcraft rebuild-board which:Factions asks for the factions rebuild only', async () => {
    await seedFactions(STEEL);
    await setGuild(FACTION_FORUM, FORUM);
    const { ack, calls } = await exchange(cmd(admin, 'guildcraft', 'rebuild-board', { which: 'factions' }), TOKEN);
    expect(seen(ack, calls).data.content).toMatch(/^Rebuilding the factions board in <#600000000000000005>/);
    expect(await one('SELECT board_rebuild_since AS b, faction_rebuild_since IS NOT NULL AS f FROM guild')).toEqual({ b: null, f: 1 });
  });

  it('the sweep serves the tradeskill board first, then the factions board down to FACTIONS_FLOOR, within the 40-call cap', async () => {
    const names = Array.from({ length: 60 }, (_, i) => `Faction ${String(i).padStart(2, '0')}`);
    await seedFactions(names.map((f): Link => ['Night Harbor', `A creature ${f}`, f, 'gained']));
    await setGuild(FACTION_FORUM, FORUM);
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ scheduledTime: Date.parse('2026-10-27T12:15:00Z'), cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
    await waitOnExecutionContext(ctx);
    const line = logs.map((l) => JSON.parse(l)).find((l) => l.gc === 'board');
    expect(line.results.map((r: { board: string }) => r.board)).toEqual(['tradeskills', 'factions']);
    expect(line.d1_calls + line.discord_calls).toBeLessThanOrEqual(BOARD_CALL_CAP - FACTIONS_FLOOR + 1);
    // The tradeskill board is whole; the factions board has part of its posts, the rest waits for the next sweep.
    expect((await all('SELECT 1 FROM board_post')).length).toBe(5);
    const made = (await all('SELECT 1 FROM faction_post')).length;
    expect(made).toBeGreaterThan(0);
    expect(made).toBeLessThan(60);
  });
});

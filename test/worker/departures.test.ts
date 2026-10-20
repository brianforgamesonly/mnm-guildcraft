// Order 7, ITEM 3 (PRD FR-8): the review channel, the nightly departure run, its notices and their buttons, and
// /guildcraft remove-member, against a fake Discord (the member list and the review channel). Also ITEM 1.1's
// read audit rows. The live notice is checked on the next real departure (a deferred rule-12 check).
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../../src/index.ts';
import { BOARD_CALL_CAP, botApi as makeApi } from '../../src/board/api.ts';
import { departuresForGuild, isDepartureRun, MAX_MARK, MAX_NOTICES, MEMBER_PAGE, noticeMessage, pastCeiling } from '../../src/departures.ts';
import { REVIEW_PERMISSIONS } from '../../src/commands/setup.ts';
import { all, count, one, reset } from '../db.ts';
import { ADMIN, as, botApi, cmd, GUILD, press, send, spyOnFetch, webhook } from '../discord.ts';

const TOKEN = { env: { DISCORD_BOT_TOKEN: 'test-bot-token' } };
const REVIEW = '600000000000000010';
const ANN = '100000000000000001';
const BO = '100000000000000002';
const CY = '100000000000000003';
const OFFICER_ROLE = '700000000000000002';
const admin = as(ANN, { permissions: ADMIN, nick: 'Ann' });
const bo = as(BO, { nick: 'Bo' });
const cy = as(CY, { nick: 'Cy' });
const officer = as(CY, { nick: 'Cy', roles: [OFFICER_ROLE] });
const REVIEW_BITS = String(REVIEW_PERMISSIONS.reduce((b, [bit]) => b | bit, 0n));

/** The fake server: who is in it, how the member list answers, and what the bot posted. */
let server: { members: string[]; failPage?: number; failStatus?: number; failCode?: number; posted: { channel: string; body: any }[]; calls: string[] };
let logs: string[];

beforeEach(async () => {
  await reset();
  webhook.reset();
  spyOnFetch();
  logs = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void logs.push(a.map(String).join(' ')));
  server = { members: [ANN, BO, CY], posted: [], calls: [] };
  botApi.handle = (method, path, body) => {
    server.calls.push(`${method} ${path.replace(/\d{15,}/g, '{id}')}`);
    const list = path.match(/^\/guilds\/\d+\/members\?limit=(\d+)&after=(\d+)$/);
    if (method === 'GET' && list) {
      // Page 1 starts at after=0; any later page carries the last id seen.
      const page = list[2] === '0' ? 1 : 2;
      if (server.failPage === page) return new Response(JSON.stringify({ message: 'Missing Access', code: server.failCode ?? 0 }), { status: server.failStatus ?? 500 });
      const after = BigInt(list[2]);
      const ids = server.members.filter((id) => BigInt(id) > after).sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1)).slice(0, Number(list[1]));
      return new Response(JSON.stringify(ids.map((id) => ({ user: { id } }))), { status: 200 });
    }
    const msg = path.match(/^\/channels\/(\d+)\/messages$/);
    if (method === 'POST' && msg) {
      server.posted.push({ channel: msg[1], body });
      return new Response(JSON.stringify({ id: `55500000000000${String(server.posted.length).padStart(4, '0')}` }), { status: 200 });
    }
    if (method === 'GET' && /^\/guilds\/\d+$/.test(path)) return new Response(JSON.stringify({ name: 'Test Guild' }), { status: 200 });
    return new Response(JSON.stringify({ message: 'not faked', code: 0 }), { status: 404 });
  };
});
afterEach(() => {
  botApi.reset();
  vi.restoreAllMocks();
});

const setupReview = (type = 0, app_permissions: string | null = REVIEW_BITS) => {
  const i = cmd(admin, 'guildcraft', 'setup', { review: REVIEW }) as any;
  i.data.resolved = { channels: { [REVIEW]: { id: REVIEW, name: 'guildcraft-review', type, permissions: ADMIN, ...(app_permissions === null ? {} : { app_permissions }) } } };
  return send(i, TOKEN);
};
/** Ann (admin), Bo and Cy each register a character; Bo has a skill. */
async function members() {
  await send(cmd(admin, 'character', 'add', { name: 'Testchar', class: 'clr', level: 12 }), TOKEN);
  await send(cmd(bo, 'character', 'add', { name: 'Bochar', class: 'wiz', level: 30 }), TOKEN);
  await send(cmd(bo, 'craft', 'set', { skill: 'Blacksmithing', level: 40 }), TOKEN);
  await send(cmd(cy, 'character', 'add', { name: 'Cychar' }), TOKEN);
}
const status = async (id: string) => (await one<{ status: string }>('SELECT status FROM member WHERE discord_user_id = ?', id)).status;
const actions = async () => (await all<{ action: string; target: string }>('SELECT action, target FROM audit_log ORDER BY id')).map((x) => `${x.action} ${x.target}`);
const api = () => {
  const budget = { d1: () => 0, discord: 0, cap: BOARD_CALL_CAP, deadline: Date.now() + 60_000 };
  return makeApi('test-bot-token', budget);
};
const guildRow = async () => one<{ id: string; review_channel_id: string | null }>('SELECT id, review_channel_id FROM guild');
const runCron = async (iso: string) => {
  const ctx = createExecutionContext();
  await worker.scheduled(createScheduledController({ scheduledTime: Date.parse(iso), cron: '*/15 * * * *' }), { ...env, ...TOKEN.env } as any, ctx);
  await waitOnExecutionContext(ctx);
};

describe('/guildcraft setup review:', () => {
  it('refuses a channel that is not a text channel, and names each missing permission; nothing is saved', async () => {
    let r = await setupReview(15);
    expect(r.data.content).toMatch(/is not a text channel/);
    r = await setupReview(0, String(1n << 10n));
    expect(r.data.content).toContain('Nothing was changed');
    expect(r.data.content).toContain('Send Messages');
    expect(r.data.content).toContain('Embed Links');
    expect(r.data.content).not.toContain('View Channel');
    expect((await guildRow()).review_channel_id).toBeNull();
  });

  it('saves the channel from the resolved app_permissions, audits it, and shows it in setup and status', async () => {
    const r = await setupReview();
    expect(r.data.content).toContain(`Review channel: <#${REVIEW}>`);
    expect((await guildRow()).review_channel_id).toBe(REVIEW);
    // No permission fallback (its third call reads the bot's member); order 8's privacy check reads the channel and roles.
    expect(server.calls.filter((c) => c.includes('/channels/') || c.includes('/roles') || c.includes('/members/'))).toEqual(['GET /channels/{id}', 'GET /guilds/{id}/roles']);
    expect(await actions()).toContain(`guild.setup guild:${GUILD}`);
    const s = await send(cmd(admin, 'guildcraft', 'status'), TOKEN);
    expect(s.data.content).toContain(`**Review channel:** <#${REVIEW}>`);
    expect(s.data.content).toContain('**Departures:** 0 members marked as left · last nightly check never');
  });

  // Order 8, ITEM 3.4: warn (never refuse) when @everyone can view the review channel.
  const VIEW = 1n << 10n;
  const privacy = (everyoneRole: bigint, overwrite?: { allow: bigint; deny: bigint }) => {
    const base = botApi.handle!;
    botApi.handle = (method, path, body) => {
      if (method === 'GET' && path === `/channels/${REVIEW}`)
        return new Response(JSON.stringify({ id: REVIEW, permission_overwrites: overwrite ? [{ id: GUILD, type: 0, allow: String(overwrite.allow), deny: String(overwrite.deny) }] : [] }), { status: 200 });
      if (method === 'GET' && path === `/guilds/${GUILD}/roles`) return new Response(JSON.stringify([{ id: GUILD, permissions: String(everyoneRole) }]), { status: 200 });
      return base(method, path, body);
    };
  };
  it('warns when @everyone can view the channel, and still saves it', async () => {
    privacy(VIEW);
    const r = await setupReview();
    expect(r.data.content).toContain('everyone in the server can see');
    expect((await guildRow()).review_channel_id).toBe(REVIEW);
  });
  it('says nothing when the channel denies @everyone View Channel', async () => {
    privacy(VIEW, { allow: 0n, deny: VIEW });
    const r = await setupReview();
    expect(r.data.content).not.toContain('**Note:**');
    expect((await guildRow()).review_channel_id).toBe(REVIEW);
  });
  it('warns when the channel overwrite opens a hidden server to @everyone', async () => {
    privacy(0n, { allow: VIEW, deny: 0n });
    expect((await setupReview()).data.content).toContain('everyone in the server can see');
  });
  it('says it could not check when Discord does not answer', async () => {
    const r = await setupReview();
    expect(r.data.content).toContain("I couldn't check who can see");
    expect((await guildRow()).review_channel_id).toBe(REVIEW);
  });
});

describe('the departure run', () => {
  it('dry run: reports who would be marked and changes nothing', async () => {
    await members();
    await setupReview();
    server.members = [ANN, CY];
    const before = await actions();
    const r = await departuresForGuild(env.DB, api(), await guildRow(), { dryRun: true });
    expect(r).toMatchObject({ dry_run: true, active: 3, listed: 2, pages: 1, would_mark: [BO], marked: 0, notices_pending: 1, notices_posted: 0, stopped: null });
    expect(await status(BO)).toBe('active');
    expect(await actions()).toEqual(before);
    expect(server.posted).toEqual([]);
  });

  it('real run: marks the member left, hides them, posts one notice; the next run posts nothing more', async () => {
    await members();
    await setupReview();
    server.members = [ANN, CY];
    const a = api();
    const r = await departuresForGuild(env.DB, a, await guildRow());
    expect(r).toMatchObject({ marked: 1, notices_posted: 1, stopped: null, errors: [] });
    // The budget: 1 member-list call (3 members, one page) + 1 notice; D1 is counted by the Worker's binding.
    expect(a.log.map((c) => c.route)).toEqual(['GET /guilds/{id}/members?limit=1000&after=0', 'POST /channels/{id}/messages']);
    expect(await status(BO)).toBe('left');
    expect(await count('character', 'deleted_at IS NULL')).toBe(3); // nothing deleted
    expect(await actions()).toEqual(expect.arrayContaining([`member.left member:${BO}`, `member.notified member:${BO}`, `departures.run guild:${GUILD}`]));
    // Hidden from /roster (the core query filters left members).
    const roster = await send(cmd(admin, 'roster', 'skill', { skill: 'Blacksmithing' }), TOKEN);
    expect(JSON.stringify(roster.data)).not.toContain('Bochar');
    // The notice.
    expect(server.posted).toHaveLength(1);
    expect(server.posted[0].channel).toBe(REVIEW);
    const n = server.posted[0].body;
    expect(n.embeds[0].title).toBe('Bo left the server');
    expect(n.embeds[0].description).toContain('**Bochar** (WIZ, level 30)');
    expect(n.components[0].components.map((b: any) => [b.label, b.custom_id])).toEqual([['Remove characters', `dep:remove:${BO}`], ['Keep', `dep:keep:${BO}`]]);
    expect(n.allowed_mentions).toEqual({ parse: [] });
    const again = await departuresForGuild(env.DB, api(), await guildRow());
    expect(again).toMatchObject({ marked: 0, notices_posted: 0, notices_pending: 0 });
  });

  it('marks only on a complete list: a failed page, a 403 and the ceiling each mark nobody', async () => {
    await members();
    await setupReview();
    server.members = [ANN];
    server.failPage = 1;
    let r = await departuresForGuild(env.DB, api(), await guildRow());
    expect(r.marked).toBe(0);
    // Order 11: status shows officers the plain note; the operator's detail stays in the run's errors (the logs).
    expect(r.stopped).toBe('Discord refused the member list. Tell Joegandomi.');
    expect(r.errors.join()).toMatch(/member list refused: HTTP 500/);
    server.failStatus = 403;
    server.failCode = 50001;
    r = await departuresForGuild(env.DB, api(), await guildRow());
    expect(r.marked).toBe(0);
    expect(r.stopped).not.toContain('Server Members Intent');
    expect(r.errors.join()).toContain('Server Members Intent');
    expect(r.errors.join()).toContain('Privileged Gateway Intents');
    // A later page failing: the first page (1000 members) answered, the second refused.
    server.failStatus = 500;
    server.failPage = 2;
    server.members = Array.from({ length: MEMBER_PAGE + 5 }, (_, k) => `2000000000000${String(k).padStart(5, '0')}`);
    r = await departuresForGuild(env.DB, api(), await guildRow());
    expect(r).toMatchObject({ marked: 0, pages: 2 });
    expect(r.errors.join()).toMatch(/HTTP 500/);
    server.failPage = undefined;
    server.members = [ANN];
    // The ceiling rule itself, then a run past it.
    expect(pastCeiling(MAX_MARK + 1, 1000)).toBe(true);
    expect(pastCeiling(3, 9)).toBe(true);
    expect(pastCeiling(2, 3)).toBe(false);
    expect(pastCeiling(3, 10)).toBe(false);
    for (let k = 4; k <= 12; k++) await env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', '2026-10-20T00:00:00Z')").bind(GUILD, `1000000000000001${String(k).padStart(2, '0')}`, `M${k}`).run();
    r = await departuresForGuild(env.DB, api(), await guildRow());
    expect(r.stopped).toBe('11 of 12 members seemed to leave at once, so nobody was hidden (safety check).');
    expect(r.errors.join()).toMatch(/^ceiling: 11 of 12/);
    expect(r.marked).toBe(0);
    expect(await count('member', "status = 'left'")).toBe(0);
    expect(await actions()).toEqual(expect.not.arrayContaining([expect.stringMatching(/^member.left/)]));
  });

  it('pages with after=: a full page of 1000 is followed by the next page before marking', async () => {
    await members();
    server.members = [ANN, CY, ...Array.from({ length: MEMBER_PAGE }, (_, k) => `2000000000000${String(k).padStart(5, '0')}`)];
    const a = api();
    const r = await departuresForGuild(env.DB, a, await guildRow());
    expect(r.pages).toBe(2);
    expect(r.listed).toBe(1002);
    expect(a.log[1].route).toMatch(/after=\{id\}$/);
    expect(r.marked).toBe(1);
  });

  it(`posts at most ${MAX_NOTICES} notices a night; the rest carry to the next run`, async () => {
    await setupReview();
    await env.DB.batch(
      Array.from({ length: 12 }, (_, k) =>
        env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', '2026-10-20T00:00:00Z')").bind(GUILD, `3000000000000000${String(k).padStart(2, '0')}`, `Gone ${k}`),
      ),
    );
    for (let k = 0; k < 30; k++) await env.DB.prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?, ?, ?, 'active', '2026-10-20T00:00:00Z')").bind(GUILD, `4000000000000000${String(k).padStart(2, '0')}`, `Stays ${k}`).run();
    server.members = [ANN, ...Array.from({ length: 30 }, (_, k) => `4000000000000000${String(k).padStart(2, '0')}`)];
    const first = await departuresForGuild(env.DB, api(), await guildRow());
    expect(first).toMatchObject({ marked: 12, notices_posted: MAX_NOTICES });
    expect(first.stopped).toBe(`More notices come tomorrow night (up to ${MAX_NOTICES} a night).`);
    const second = await departuresForGuild(env.DB, api(), await guildRow());
    expect(second).toMatchObject({ marked: 0, notices_posted: 2, notices_pending: 2 });
  });

  it('without a review channel it marks, and the notices wait for the channel', async () => {
    await members();
    server.members = [ANN, CY];
    const r = await departuresForGuild(env.DB, api(), await guildRow());
    expect(r).toMatchObject({ marked: 1, notices_posted: 0, notices_pending: 1 });
    expect(r.stopped).toMatch(/no review channel set/);
  });

  it('runs in the 08:15 UTC slot only, inside the cron trigger, and logs no names', async () => {
    expect(isDepartureRun(Date.parse('2026-10-20T08:15:00Z'))).toBe(true);
    expect(isDepartureRun(Date.parse('2026-10-20T08:00:00Z'))).toBe(false);
    expect(isDepartureRun(Date.parse('2026-10-20T08:30:00Z'))).toBe(false);
    await members();
    server.members = [ANN, CY];
    await runCron('2026-10-20T08:00:00Z');
    expect(await status(BO)).toBe('active');
    await runCron('2026-10-20T08:15:00Z');
    expect(await status(BO)).toBe('left');
    const line = logs.find((l) => l.startsWith('{"gc":"departures"'))!;
    expect(line).toBeDefined();
    expect(line).not.toContain(BO);
    expect(line).not.toContain('Bo');
  });

  it('a member back in the server before their notice went out is owed no notice', async () => {
    await members();
    server.members = [ANN, CY];
    await departuresForGuild(env.DB, api(), await guildRow()); // no review channel yet: the notice waits
    await setupReview();
    server.members = [ANN, BO, CY];
    const r = await departuresForGuild(env.DB, api(), await guildRow());
    expect(r).toMatchObject({ notices_pending: 0, notices_posted: 0 });
    expect(server.posted).toEqual([]);
  });

  it('a member marked left comes back on their own next command; the run never reactivates anyone', async () => {
    await members();
    server.members = [ANN, CY];
    await departuresForGuild(env.DB, api(), await guildRow());
    server.members = [ANN, BO, CY];
    await departuresForGuild(env.DB, api(), await guildRow());
    expect(await status(BO)).toBe('left');
    await send(cmd(bo, 'craft', 'me'), TOKEN);
    expect(await status(BO)).toBe('active');
  });
});

describe('the notice buttons', () => {
  async function departed() {
    await members();
    await setupReview();
    await send(cmd(admin, 'guildcraft', 'setup', { officer_role: OFFICER_ROLE }), TOKEN);
    server.members = [ANN, CY];
    await departuresForGuild(env.DB, api(), await guildRow());
  }

  it('a non-officer is refused, and nothing changes', async () => {
    await departed();
    const r = await send(press(cy, `dep:keep:${BO}`), TOKEN);
    expect(r.data.content).toBe('Only officers can do that.');
    expect(r.data.flags).toBe(64);
    expect(await actions()).not.toContain(`member.keep member:${BO}`);
  });

  it('Keep records the decision, edits the notice, and the member is not notified again', async () => {
    await departed();
    const r = await send(press(officer, `dep:keep:${BO}`), TOKEN);
    expect(r.type).toBe(7);
    expect(r.data.content).toContain("kept **Bo**'s characters");
    expect(r.data.components).toEqual([]);
    expect(await actions()).toContain(`member.keep member:${BO}`);
    expect(await count('character', 'deleted_at IS NULL')).toBe(3);
    const next = await departuresForGuild(env.DB, api(), await guildRow());
    expect(next).toMatchObject({ notices_pending: 0, notices_posted: 0 });
  });

  it('Remove soft-deletes the characters, as remove-member does', async () => {
    await departed();
    const r = await send(press(admin, `dep:remove:${BO}`), TOKEN);
    expect(r.data.content).toContain('removed **Bo** and 1 character: **Bochar** (WIZ, level 30)');
    expect(await one<{ n: number }>("SELECT count(*) AS n FROM character WHERE owner_user_id = ? AND deleted_at IS NOT NULL", BO)).toEqual({ n: 1 });
    expect(await actions()).toContain(`member.removed member:${BO}`);
  });
});

describe('/guildcraft remove-member user:', () => {
  const remove = (who: ReturnType<typeof as>, user: string) => send(cmd(who, 'guildcraft', 'remove-member', { user }), TOKEN);

  it('is officer-only', async () => {
    await members();
    const r = await remove(bo, CY);
    expect(r.data.content).toBe('Only officers can do that.');
  });

  it('previews first, with Confirm and Cancel; Cancel changes nothing', async () => {
    await members();
    const r = await remove(admin, ANN); // an officer may target themselves
    expect(r.data.flags).toBe(64);
    expect(r.data.content).toMatch(/^This will remove 1 character: \*\*Testchar\*\* \(CLR, level 12\)\./);
    expect(r.data.components![0].components.map((b: any) => [b.label, b.custom_id])).toEqual([['Confirm', `rm:yes:${ANN}`], ['Cancel', `rm:no:${ANN}`]]);
    const before = await actions();
    const c = await send(press(admin, `rm:no:${ANN}`), TOKEN);
    expect(c.data.content).toBe('Cancelled. Nothing was changed.');
    expect(await actions()).toEqual(before);
    expect(await status(ANN)).toBe('active');
  });

  it('Confirm soft-deletes every character, marks the member left, dirties the board, audits; the member stays left while still in the server', async () => {
    await members();
    await env.DB.prepare("INSERT INTO board_post (guild_id, tradeskill_id, thread_id, message_ids_json, dirty) SELECT ?, id, '1', '[]', 0 FROM tradeskill WHERE name = 'Blacksmithing'").bind(GUILD).run();
    const r = await send(press(admin, `rm:yes:${BO}`), TOKEN);
    expect(r.data.content).toMatch(/^Done: removed \*\*Bo\*\* and 1 character: \*\*Bochar\*\*/);
    expect(await count('character', 'owner_user_id = ? AND deleted_at IS NULL', BO)).toBe(0);
    expect(await count('character', 'owner_user_id = ?', BO)).toBe(1); // soft-deleted, not deleted
    expect(await count('character_skill')).toBe(1);
    expect(await status(BO)).toBe('left');
    expect((await one<{ dirty: number }>('SELECT dirty FROM board_post')).dirty).toBe(1);
    expect(await actions()).toContain(`member.removed member:${BO}`);
    // Bo is still in the server: the nightly run does not set him back to active, and posts no notice (no member.left).
    await setupReview();
    const run = await departuresForGuild(env.DB, api(), await guildRow());
    expect(run).toMatchObject({ marked: 0, notices_pending: 0 });
    expect(await status(BO)).toBe('left');
  });

  it("order 2's restore path still holds: the member's /character add with the same name restores it, with its skills", async () => {
    await members();
    await send(press(admin, `rm:yes:${BO}`), TOKEN);
    const r = await send(cmd(bo, 'character', 'add', { name: 'Bochar' }), TOKEN);
    expect(r.data.content).toMatch(/^Restored \*\*Bochar\*\*.*with its 1 saved skill/);
    expect(await status(BO)).toBe('active');
  });

  it('a member who never used GuildCraft has nothing to remove', async () => {
    await members();
    const r = await remove(admin, '100000000000000099');
    expect(r.data.content).toMatch(/never used GuildCraft/);
    expect(r.data.components).toBeUndefined();
  });
});

describe('read audit rows (order 7, ITEM 1.1)', () => {
  it('/guildcraft status and /roster write their audit row after delivery, and the timing line names it', async () => {
    await members();
    await send(cmd(admin, 'guildcraft', 'status'), TOKEN);
    await send(cmd(admin, 'roster', 'top'), TOKEN);
    const rows = await all<{ action: string; actor: string; target: string }>("SELECT action, actor, target FROM audit_log WHERE action IN ('guildcraft.status', 'roster.view') ORDER BY id");
    expect(rows).toEqual([
      { action: 'guildcraft.status', actor: ANN, target: 'guildcraft status' },
      { action: 'roster.view', actor: ANN, target: 'roster top' },
    ]);
    const lines = logs.filter((l) => l.startsWith('{"gc":"interaction"')).map((l) => JSON.parse(l));
    expect(lines.filter((l) => l.audit).map((l) => l.audit)).toEqual(['guildcraft.status', 'roster.view']);
    expect(lines.find((l) => l.cmd === 'craft set')?.audit).toBeUndefined();
  });
});

it('the notice as rendered (quoted in the order 7 report)', () => {
  const n = noticeMessage(BO, 'Bo', [{ id: 1, name: 'Bochar', class: 'WIZ', level: 30 }]);
  expect(n.embeds[0].description).toContain('Officers only.');
});

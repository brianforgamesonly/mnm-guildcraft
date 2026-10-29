// Order 27 (ITEM 2): /dkp adjust, /dkp settings, /dkp named-value, the approval card's Approve, and Full standings.
// Every change is posted publicly in GC-DKP and applies from then on. Nobody changes, or approves a change to, their own
// points (src/access.ts dkpSelfConflict, called by every route here that changes points).
import { audit, dkpSelfConflict, isAdmin, isDkpRunner, now } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, memberTag, optInt, optString, row, STYLE_SUCCESS, truncate, updateMessage, type MessageReply, type Option } from '../discord.ts';
import { zoneKey } from '../zone/names.ts';
import { DKP_COPY } from './copy.ts';
import { payStatement, POOL_GUILD, registerPool, dkpRead } from './ledger.ts';
import { FULL_PAGE, FULL_STANDINGS_PREFIX, poolNames, postIn, refreshStandings, standingLine } from './messages.ts';
import { RUNNER_ROLE, settingOf, SETTINGS } from './settings.ts';
import type { DkpState } from './state.ts';
import { correctCommand, correctionStatements, historyCommand, killCommand, raidCommand } from './raid.ts';

export const APPROVE_PREFIX = 'dkpap:';
/** Full standings' paging, in the presser's own private message (edited in place). */
export const FULL_PAGE_PREFIX = 'dkpfp:';
/** Discord calls a /dkp command may make: the notice or card, and standings for one pool. */
const DKP_COMMAND_CAP = 6;

export type DkpRun = (c: Ctx, opts: Option[], d: DkpState) => Promise<MessageReply>;
/** runner: isDkpRunner · admin: Administrator or Manage Server · member: the member-role gate. */
export const DKP_ROUTES: Record<string, { access: 'runner' | 'admin' | 'member'; run: DkpRun }> = {
  'dkp adjust': { access: 'runner', run: adjust },
  'dkp settings': { access: 'admin', run: settings },
  'dkp named-value': { access: 'runner', run: namedValue },
  // Order 27, PR B: raid nights and history.
  'dkp raid': { access: 'runner', run: (c, o, d) => raidCommand(c, o, d) },
  'dkp kill': { access: 'runner', run: (c, o, d) => killCommand(c, o, d) },
  'dkp correct': { access: 'runner', run: (c, o, d) => correctCommand(c, o, d) },
  'dkp history': { access: 'member', run: (c, o, d) => historyCommand(c, o, d) },
};

const apiFor = (c: Ctx, cap = DKP_COMMAND_CAP): BotApi | null => (c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap, deadline: Date.now() + 10_000 }) : null);
const spent = (c: Ctx, api: BotApi | null) => {
  if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
};
const by = (c: Ctx) => memberTag(c.userId, c.member.nick || c.member.user.global_name || c.member.user.username);

/** A pool option: the guild pool, or a zone (by its name, as /zone takes it). */
async function resolvePool(db: D1Database, typed: string): Promise<{ key: string; name: string } | null> {
  if (typed === POOL_GUILD || typed.toLowerCase() === DKP_COPY.guildPool.toLowerCase()) return { key: POOL_GUILD, name: DKP_COPY.guildPool };
  return db.prepare('SELECT key, name FROM zone WHERE key = ? AND active = 1').bind(zoneKey(typed.trim())).first<{ key: string; name: string }>();
}

/** The member a /dkp option names, with a member row (the standings read members from it), named as Discord resolved them. */
async function targetMember(c: Ctx, id: string): Promise<string> {
  const u = c.resolved?.users?.[id];
  const m = c.resolved?.members?.[id];
  const name = m?.nick || u?.global_name || u?.username || id;
  const row = await c.db
    .prepare("INSERT INTO member (guild_id, discord_user_id, display_name, status, first_seen_at) VALUES (?1, ?2, ?3, 'active', ?4) ON CONFLICT DO UPDATE SET display_name = display_name RETURNING display_name")
    .bind(c.guild.id, id, name, now())
    .first<{ display_name: string }>();
  return row?.display_name ?? name;
}

async function adjust(c: Ctx, opts: Option[], d: DkpState): Promise<MessageReply> {
  const member = optString(opts, 'member') ?? '';
  const points = optInt(opts, 'points') ?? 0;
  const reason = (optString(opts, 'reason') ?? '').trim();
  if (dkpSelfConflict(c.userId, { member })) return ephemeral(DKP_COPY.own);
  if (!reason) return ephemeral(DKP_COPY.adjustReason);
  if (!points) return ephemeral(DKP_COPY.noPoints);
  const typed = optString(opts, 'pool') ?? '';
  const pool = await resolvePool(c.db, typed);
  if (!pool) return ephemeral(DKP_COPY.unknownPool(truncate(typed, 100)));
  const name = await targetMember(c, member);
  const at = now();
  const api = apiFor(c);
  try {
    if (Math.abs(points) > d.settings.second_officer_over) return await askApproval(c, d, api, { member, name, pool, points, reason, at });
    await c.db.batch([
      registerPool(c.db, c.guild.id, pool.key, at),
      payStatement(c.db, { guildId: c.guild.id, pool: pool.key, members: [member], asked: points, cap: d.settings.cap, kind: 'adjust', reason, actor: c.userId, at }),
      audit(c.db, c.guild.id, c.userId, 'dkp.adjust', `member:${member}`, null, { pool: pool.key, points }),
    ]);
    const posted = await announce(c, d, api, member, name, pool, points, at);
    return ephemeral(DKP_COPY.adjustDone(posted));
  } finally {
    spent(c, api);
  }
}

/** Posts the applied change in GC-DKP (with the balance it left) and refreshes that pool's standings. */
async function announce(c: Ctx, d: DkpState, api: BotApi | null, member: string, name: string, pool: { key: string; name: string }, points: number, at: string): Promise<boolean> {
  if (!api || !d.channel_id) return false;
  const row = await c.db
    .prepare('SELECT amount, cut, balance_after, reason FROM dkp_ledger WHERE guild_id = ? AND pool = ? AND member_id = ? AND at = ? ORDER BY id DESC LIMIT 1')
    .bind(c.guild.id, pool.key, member, at)
    .first<{ amount: number; cut: number; balance_after: number; reason: string }>();
  if (!row) return false;
  const posted = await postIn(api, d.channel_id, { content: DKP_COPY.adjustLine(memberTag(member, name), points, pool.name, row.balance_after, by(c), row.reason, row.cut) });
  await refreshStandings(c.db, api, c.guild.id, d.channel_id, [pool.key]);
  return !!posted;
}

/** A change over the second-officer threshold: an adjustment, or (order 27, PR B) a correction of a kill or a raid. */
export async function askApproval(
  c: Ctx,
  d: DkpState,
  api: BotApi | null,
  a: { member: string; name: string; pool: { key: string; name: string }; points: number; reason: string; at: string; correction?: { action: 'add' | 'remove'; raidId: number; killId: number | null } },
): Promise<MessageReply> {
  // No card, no approval: nobody could press Approve (review of PR A).
  if (!api || !d.channel_id) return ephemeral(DKP_COPY.noChannel);
  const due = Date.parse(a.at) + d.settings.approval_hours * 3_600_000;
  const p = await c.db
    .prepare(
      'INSERT INTO dkp_pending (guild_id, kind, member_id, pool, amount, action, raid_id, kill_id, reason, asked_by, asked_at, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    )
    .bind(
      c.guild.id, a.correction ? 'correction' : 'adjust', a.member, a.pool.key, a.points, a.correction?.action ?? null, a.correction?.raidId ?? null, a.correction?.killId ?? null, a.reason,
      c.userId, a.at, new Date(due).toISOString(),
    )
    .first<{ id: number }>();
  c.effects.dkpTimers = { guildId: c.guild.id, items: [{ key: `lapse:${p!.id}`, due }] };
  {
    const id = await postIn(api, d.channel_id, {
      embeds: [{ description: DKP_COPY.approvalCard(memberTag(a.member, a.name), a.points, a.pool.name, by(c), a.reason, String(Math.floor(due / 1000))) }],
      components: [row([button(`${APPROVE_PREFIX}${p!.id}`, DKP_COPY.approve, STYLE_SUCCESS)])],
    });
    if (id) await c.db.prepare('UPDATE dkp_pending SET message_id = ? WHERE id = ?').bind(id, p!.id).run();
  }
  return ephemeral(DKP_COPY.approvalPosted(d.settings.second_officer_over));
}

/** dkpap:<pending id> (the runner check is from this press). */
export async function approveButton(c: Ctx, id: string, d: DkpState): Promise<MessageReply> {
  if (!isDkpRunner(c.guild, d.settings.runner_role, c.member)) return ephemeral(DKP_COPY.notRunner);
  const pid = Number(id.slice(APPROVE_PREFIX.length));
  const p = await c.db.prepare('SELECT member_id, pool, amount, reason, asked_by, kind, action, raid_id, kill_id, message_id, status, due_at FROM dkp_pending WHERE id = ? AND guild_id = ?').bind(pid, c.guild.id).first<{
    member_id: string; pool: string; amount: number; reason: string; asked_by: string; kind: string; action: 'add' | 'remove' | null; raid_id: number | null; kill_id: number | null; message_id: string | null; status: string; due_at: string;
  }>();
  if (!p) return ephemeral(DKP_COPY.notOpen);
  const conflict = dkpSelfConflict(c.userId, { member: p.member_id, askedBy: p.asked_by });
  if (conflict) return ephemeral(conflict === 'own' ? DKP_COPY.own : DKP_COPY.asked);
  const at = now();
  // One approval wins, and it pays in the same batch (review of PR A): the status changes once, and the payment is
  // gated on the row this press approved, so a failed batch changes neither and a second press pays nothing. A
  // correction's statements need no gate: a reversal acts only where the member is credited on the kill, a re-add only
  // where they are not, so a second run of either writes nothing.
  const pays =
    p.kind === 'correction' && p.raid_id !== null && p.action
      ? await correctionStatements(c.db, c.guild.id, d.settings.cap, { member: p.member_id, action: p.action, raidId: p.raid_id, killId: p.kill_id, reason: p.reason, actor: c.userId, at })
      : [
          registerPool(c.db, c.guild.id, p.pool, at),
          payStatement(c.db, { guildId: c.guild.id, pool: p.pool, members: [p.member_id], asked: p.amount, cap: d.settings.cap, kind: 'adjust', reason: p.reason, actor: c.userId, at, approvedPending: pid }),
        ];
  const [took] = await c.db.batch([
    c.db.prepare("UPDATE dkp_pending SET status = 'approved', decided_by = ?1, decided_at = ?2 WHERE id = ?3 AND status = 'open' AND due_at > ?2").bind(c.userId, at, pid),
    ...pays,
  ]);
  if (took.meta.changes !== 1) return ephemeral(DKP_COPY.notOpen);
  await audit(c.db, c.guild.id, c.userId, 'dkp.approve', `pending:${pid}`, { status: 'open' }, { status: 'approved' }).run();
  // Its lapse timer stays set and finds it approved (lapse acts only on an open row).
  const api = apiFor(c);
  try {
    if (api && d.channel_id) {
      if (p.message_id) await api.call('PATCH', `/channels/${d.channel_id}/messages/${p.message_id}`, { content: DKP_COPY.approved(by(c)), components: [], allowed_mentions: { parse: [] } });
      await refreshStandings(c.db, api, c.guild.id, d.channel_id, p.kind === 'correction' ? [p.pool, POOL_GUILD] : [p.pool]);
    }
  } finally {
    spent(c, api);
  }
  return ephemeral(DKP_COPY.approvedReply);
}

async function settings(c: Ctx, opts: Option[], d: DkpState): Promise<MessageReply> {
  const key = optString(opts, 'setting');
  const value = optInt(opts, 'value');
  const role = optString(opts, 'runner_role');
  const show = () =>
    [
      DKP_COPY.settingsNow,
      ...SETTINGS.map((s) => `${s.label}: **${d.settings[s.key]}** ${s.unit}${d.settings[s.key] === s.default ? '' : ` (default ${s.default})`}`),
      `${DKP_COPY.whoRuns}: ${d.settings.runner_role ? DKP_COPY.runnerRole(d.settings.runner_role) : DKP_COPY.runnerDefault}`,
    ].join('\n');
  const changes: [string, string, string][] = [];
  if (key !== undefined && value !== undefined) {
    const s = settingOf(key);
    if (!s) return ephemeral(show());
    if (value < s.min || value > s.max) return ephemeral(DKP_COPY.settingRange(s.label, s.min, s.max));
    changes.push([s.key, String(value), `${value} ${s.unit}`]);
  }
  if (role !== undefined) changes.push([RUNNER_ROLE, role, DKP_COPY.runnerRole(role)]);
  if (!changes.length) return ephemeral(show());
  const at = now();
  await c.db.batch(
    changes.flatMap(([k, v]) => [
      c.db.prepare('INSERT INTO dkp_setting (guild_id, key, value, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (guild_id, key) DO UPDATE SET value = ?3, set_at = ?4, set_by = ?5').bind(c.guild.id, k, v, at, c.userId),
      audit(c.db, c.guild.id, c.userId, 'dkp.setting', `setting:${k}`, { value: k === RUNNER_ROLE ? d.settings.runner_role : d.settings[k as keyof typeof d.settings] }, { value: v }),
    ]),
  );
  const api = apiFor(c, 2);
  try {
    if (api && d.channel_id)
      for (const [k, , shown] of changes) await postIn(api, d.channel_id, { content: DKP_COPY.settingChanged(k === RUNNER_ROLE ? DKP_COPY.whoRuns : settingOf(k)!.label, shown, by(c)) });
  } finally {
    spent(c, api);
  }
  return ephemeral(DKP_COPY.settingSaved);
}

async function namedValue(c: Ctx, opts: Option[], d: DkpState): Promise<MessageReply> {
  const typed = optString(opts, 'zone') ?? '';
  const zone = await c.db.prepare('SELECT key, name FROM zone WHERE key = ? AND active = 1').bind(zoneKey(typed.trim())).first<{ key: string; name: string }>();
  if (!zone) return ephemeral(DKP_COPY.unknownZone(truncate(typed, 100)));
  const named = (optString(opts, 'named') ?? '').trim().slice(0, 100);
  const points = optInt(opts, 'points') ?? 0;
  const at = now();
  await c.db.batch([
    c.db
      .prepare('INSERT INTO dkp_named_value (guild_id, zone_key, name, points, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO UPDATE SET points = ?4, set_at = ?5, set_by = ?6')
      .bind(c.guild.id, zone.key, named, points, at, c.userId),
    audit(c.db, c.guild.id, c.userId, 'dkp.named-value', `named:${zone.key}`, null, { points }),
  ]);
  const api = apiFor(c, 1);
  try {
    if (api && d.channel_id) await postIn(api, d.channel_id, { content: DKP_COPY.namedValue(named, zone.name, points, by(c)) });
  } finally {
    spent(c, api);
  }
  return ephemeral(DKP_COPY.settingSaved);
}

/** dkpfs:<pool>:<page> (a new private message) and dkpfp:<pool>:<page> (that message, edited in place). Open to members. */
export async function fullStandings(c: Ctx, id: string): Promise<MessageReply> {
  const inPlace = id.startsWith(FULL_PAGE_PREFIX);
  // The page is after the last ':' (a zone key may hold one; review of PR A).
  const rest = id.slice((inPlace ? FULL_PAGE_PREFIX : FULL_STANDINGS_PREFIX).length);
  const pool = rest.slice(0, rest.lastIndexOf(':'));
  const pageText = rest.slice(rest.lastIndexOf(':') + 1);
  const [{ standings }, names] = await Promise.all([dkpRead(c.db, c.guild.id, { pools: [pool] }), poolNames(c.db, [pool])]);
  const list = standings.get(pool) ?? [];
  const pages = Math.max(1, Math.ceil(list.length / FULL_PAGE));
  const page = Math.min(Math.max(0, Number(pageText) || 0), pages - 1);
  const lines = list.slice(page * FULL_PAGE, (page + 1) * FULL_PAGE).map((s, i) => standingLine(s, page * FULL_PAGE + i + 1));
  const data = {
    embeds: [{ title: DKP_COPY.standingsTitle(names.get(pool)!), description: lines.length ? lines.join('\n') : DKP_COPY.nobody, footer: { text: DKP_COPY.page(page + 1, pages) } }],
    components:
      pages > 1
        ? [row([button(`${FULL_PAGE_PREFIX}${pool}:${page - 1}`, 'Previous', undefined, page === 0), button(`${FULL_PAGE_PREFIX}${pool}:${page + 1}`, 'Next', undefined, page === pages - 1)])]
        : [],
  };
  return inPlace ? updateMessage(data) : ephemeral('', data);
}

/** Admins see /dkp settings; the runner check for the rest (rights from this call). */
export const mayRun = (c: Ctx, access: 'runner' | 'admin' | 'member', d: DkpState) =>
  access === 'admin' ? isAdmin(c.member) : access === 'runner' ? isDkpRunner(c.guild, d.settings.runner_role, c.member) : true;

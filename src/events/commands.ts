// Order 32: /event's routes. Settings are admins'; each change is posted publicly in GC-Events and applies from then on.
import { audit, isAdmin, isEventRunner, now } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { ephemeral, memberTag, md, NO_PINGS, optBool, optInt, optString, truncate, type MessageReply, type Option } from '../discord.ts';
import { EVENT_COPY } from './copy.ts';
import { DEFAULT_TIME_ZONE, EVENT_SETTINGS, EVENTS_ROLE, eventSettingOf, roleLabelKey, SIGNUP_ROLE, SUPPORT_ON, TIME_ZONE, typeLabelKey, validTimeZone } from './settings.ts';
import type { EventState } from './state.ts';
import { ROLES, TYPES, type Role } from './types.ts';
import { cancelCommand, createCommand, editCommand, listCommand } from './manage.ts';
import { rosterCommand } from './press.ts';

export type EventRun = (c: Ctx, opts: Option[], d: EventState) => Promise<MessageReply>;
/** runner: isEventRunner · admin: Administrator or Manage Server · member: the member-role gate. */
export type EventAccess = 'runner' | 'admin' | 'member';
export const EVENT_ROUTES: Record<string, { access: EventAccess; run: EventRun }> = {
  'event settings': { access: 'admin', run: settings },
  'event create': { access: 'runner', run: (c, o, d) => createCommand(c, o, d) },
  'event edit': { access: 'runner', run: (c, o, d) => editCommand(c, o, d) },
  'event cancel': { access: 'runner', run: (c, o, d) => cancelCommand(c, o, d) },
  'event list': { access: 'member', run: (c, o, d) => listCommand(c, o, d) },
  'event roster': { access: 'runner', run: (c, o, d) => rosterCommand(c, o, d) },
};

export const mayRunEvent = (c: Ctx, access: EventAccess, d: EventState) =>
  access === 'admin' ? isAdmin(c.member) : access === 'runner' ? isEventRunner(c.guild, d.settings.events_role, c.member) : true;

export const eventApi = (c: Ctx, cap: number): BotApi | null => (c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap, deadline: Date.now() + 10_000 }) : null);
export const spentEvent = (c: Ctx, api: BotApi | null) => {
  if (api) c.effects.discordCalls = (c.effects.discordCalls ?? 0) + api.budget.discord;
};
export const byName = (c: Ctx) => memberTag(c.userId, c.member.nick || c.member.user.global_name || c.member.user.username);

const roleName = (id: string) => `<@&${id}>`;

function settingsText(d: EventState, classes: { class_code: string; role: Role }[]): string {
  const s = d.settings;
  return [
    EVENT_COPY.settingsNow,
    `${EVENT_COPY.timeZone}: **${s.time_zone}**${s.time_zone === DEFAULT_TIME_ZONE ? '' : ` (default ${DEFAULT_TIME_ZONE})`}`,
    ...EVENT_SETTINGS.map((n) => `${n.label}: **${s[n.key]}** ${n.unit}${s[n.key] === n.default ? '' : ` (default ${n.default})`}`),
    `${EVENT_COPY.whoCreates}: ${s.events_role ? roleName(s.events_role) : EVENT_COPY.officerRole}`,
    `${EVENT_COPY.defaultSignup}: ${s.signup_role ? roleName(s.signup_role) : EVENT_COPY.none}`,
    `${EVENT_COPY.roleLabels}: ${ROLES.map((r) => md(s.role_labels[r])).join(', ')}; ${EVENT_COPY.support} ${s.support_on ? EVENT_COPY.on : EVENT_COPY.off_}`,
    `${EVENT_COPY.typeLabels}: ${TYPES.map((t) => md(s.type_labels[t])).join(', ')}`,
    `${EVENT_COPY.classRoles}: ${classes.length ? classes.map((x) => `${md(x.class_code)} ${md(s.role_labels[x.role])}`).join(', ') : EVENT_COPY.none}`,
  ].join('\n');
}

async function settings(c: Ctx, opts: Option[], d: EventState): Promise<MessageReply> {
  const g = c.guild.id;
  const s = d.settings;
  /** key, stored value (null deletes the row), how the public notice shows it, and the value before. */
  const changes: { key: string; label: string; value: string | null; shown: string; before: unknown }[] = [];
  const tz = optString(opts, 'time_zone')?.trim();
  if (tz !== undefined) {
    if (!validTimeZone(tz)) return ephemeral(EVENT_COPY.badTimeZone(md(truncate(tz, 64))));
    changes.push({ key: TIME_ZONE, label: EVENT_COPY.timeZone, value: tz, shown: tz, before: s.time_zone });
  }
  for (const n of EVENT_SETTINGS) {
    const v = optInt(opts, n.key);
    if (v !== undefined && eventSettingOf(n.key)) changes.push({ key: n.key, label: n.label, value: String(v), shown: `${v} ${n.unit}`, before: s[n.key] });
  }
  const eventsRole = optString(opts, 'events_role');
  if (eventsRole !== undefined) changes.push({ key: EVENTS_ROLE, label: EVENT_COPY.whoCreates, value: eventsRole, shown: roleName(eventsRole), before: s.events_role });
  const signupRole = optString(opts, 'signup_role');
  if (signupRole !== undefined) changes.push({ key: SIGNUP_ROLE, label: EVENT_COPY.defaultSignup, value: signupRole, shown: roleName(signupRole), before: s.signup_role });
  const clear = optString(opts, 'clear');
  if (clear === EVENTS_ROLE) changes.push({ key: EVENTS_ROLE, label: EVENT_COPY.whoCreates, value: null, shown: EVENT_COPY.officerRole, before: s.events_role });
  if (clear === SIGNUP_ROLE) changes.push({ key: SIGNUP_ROLE, label: EVENT_COPY.defaultSignup, value: null, shown: EVENT_COPY.none, before: s.signup_role });
  const support = optBool(opts, 'support');
  if (support !== undefined) changes.push({ key: SUPPORT_ON, label: EVENT_COPY.support, value: support ? '1' : '0', shown: support ? EVENT_COPY.on : EVENT_COPY.off_, before: s.support_on });
  for (const r of ROLES) {
    const v = optString(opts, `role_${r}`)?.trim();
    if (v) changes.push({ key: roleLabelKey(r), label: `${EVENT_COPY.roleLabels}: ${md(s.role_labels[r])}`, value: v, shown: md(v), before: s.role_labels[r] });
  }
  for (const t of TYPES) {
    const v = optString(opts, `type_${t}`)?.trim();
    if (v) changes.push({ key: typeLabelKey(t), label: `${EVENT_COPY.typeLabels}: ${md(s.type_labels[t])}`, value: v, shown: md(v), before: s.type_labels[t] });
  }
  const typedClass = optString(opts, 'class')?.trim();
  const role = optString(opts, 'role') as Role | 'none' | undefined;
  if (!!typedClass !== !!role) return ephemeral(EVENT_COPY.classNeedsRole);
  if (!changes.length && !typedClass) {
    const { results } = await c.db.prepare('SELECT class_code, role FROM event_class_role WHERE guild_id = ? ORDER BY class_code').bind(g).all<{ class_code: string; role: Role }>();
    return ephemeral(truncate(settingsText(d, results), 2000));
  }
  // A class is one the game has (autocomplete accepts free text). None clears what is stored, whatever it says.
  let cls = typedClass;
  const known = cls ? await c.db.prepare('SELECT code FROM game_class WHERE code = ? COLLATE NOCASE').bind(cls).first<{ code: string }>() : null;
  if (cls && role !== 'none') {
    if (!known) return ephemeral(EVENT_COPY.unknownClass(md(truncate(cls, 32))));
    cls = known.code;
  }
  const at = now();
  const stmts: D1PreparedStatement[] = changes.flatMap((x) => [
    x.value === null
      ? c.db.prepare('DELETE FROM event_setting WHERE guild_id = ? AND key = ?').bind(g, x.key)
      : c.db.prepare('INSERT INTO event_setting (guild_id, key, value, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (guild_id, key) DO UPDATE SET value = ?3, set_at = ?4, set_by = ?5').bind(g, x.key, x.value, at, c.userId),
    audit(c.db, g, c.userId, 'event.setting', `setting:${x.key}`, { value: x.before }, { value: x.value }),
  ]);
  const notices = changes.map((x) => EVENT_COPY.changed(x.label, x.shown));
  if (cls && role) {
    const was = await c.db.prepare('SELECT role FROM event_class_role WHERE guild_id = ? AND class_code = ?').bind(g, cls).first<{ role: Role }>();
    stmts.push(
      role === 'none'
        ? c.db.prepare('DELETE FROM event_class_role WHERE guild_id = ? AND class_code = ?').bind(g, cls)
        : c.db.prepare('INSERT INTO event_class_role (guild_id, class_code, role, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (guild_id, class_code) DO UPDATE SET role = ?3, set_at = ?4, set_by = ?5').bind(g, cls, role, at, c.userId),
      audit(c.db, g, c.userId, 'event.setting', `class:${cls}`, { role: was?.role ?? null }, { role }),
    );
    notices.push(EVENT_COPY.changed(EVENT_COPY.classRole(md(cls)), role === 'none' ? EVENT_COPY.none : md(s.role_labels[role])));
  }
  notices.push(EVENT_COPY.changedBy(byName(c)));
  await c.db.batch(stmts);
  const api = eventApi(c, 1);
  try {
    // One message for the whole command: Discord's 2,000 characters hold every option's line.
    if (api && d.channel_id) {
      const posted = await api.call('POST', `/channels/${d.channel_id}/messages`, { content: truncate(notices.join('\n'), 2000), allowed_mentions: NO_PINGS });
      return ephemeral(posted.ok ? EVENT_COPY.saved : EVENT_COPY.savedQuiet);
    }
  } finally {
    spentEvent(c, api);
  }
  return ephemeral(EVENT_COPY.savedQuiet);
}

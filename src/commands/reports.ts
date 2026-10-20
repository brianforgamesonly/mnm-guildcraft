// Reports and officer review (order 9, ITEM 2; PRD FR-7 as amended by order 9 override 4):
//   /craft report item: issue: [details], and the "Report a problem" button on /craft find (a modal, at once);
//   the report card in the review channel (order 9 override 1: posted by the Worker after a member's report), with
//   Mark fixed and Dismiss for officers. The officer fixes the data with /recipe; the buttons only record it.
// DRAFT copy throughout: the operator approves it before launch (docs/COPY.md).
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import { audit, now } from '../access.ts';
import { botApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, optString, row, STYLE_SECONDARY, truncate, updateMessage, type Embed, type InteractionReply, type MessageReply, type ModalComponent, type Option } from '../discord.ts';
import { issueLabel, REPORT_ISSUES } from '../recipes.ts';
import { OFFICER_ONLY } from './members.ts';

/** A member may have this many reports open at once (order 9, ITEM 2). */
export const MAX_OPEN_REPORTS = 5;
export const DETAILS_MAX = 300;
export const REPORT_MODAL_PREFIX = 'rptm:';
export const FIXED_PREFIX = 'rpf:';
export const DISMISS_PREFIX = 'rpd:';
const ISSUE_INPUT = 'issue';
const DETAILS_INPUT = 'details';

interface ReportRow {
  id: number;
  item: string | null;
  reporter: string;
  issue: string;
  details: string | null;
  status: string;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
}

const ts = (iso: string) => `<t:${Math.floor(Date.parse(iso) / 1000)}:f>`;

export function reportCard(r: ReportRow): Embed {
  return {
    title: truncate(`Report: ${r.item ?? 'unknown item'}`, 256),
    description: [`**Issue:** ${issueLabel(r.issue)}`, `**From:** <@${r.reporter}> · ${ts(r.created_at)}`, r.details ? `**Details:** ${md(r.details)}` : null].filter(Boolean).join('\n'),
    footer: { text: `Report #${r.id} · fix the data with /recipe override or /recipe source, then mark it fixed` },
  };
}

const cardButtons = (id: number) => [row([button(`${FIXED_PREFIX}${id}`, 'Mark fixed', 3), button(`${DISMISS_PREFIX}${id}`, 'Dismiss', STYLE_SECONDARY)])];

/** Files a report: one row and its audit row, then the card in the review channel (when one is set). */
async function fileReport(c: Ctx, item: { id: number; name: string }, issue: string, rawDetails: string | undefined): Promise<MessageReply> {
  if (!REPORT_ISSUES.some((i) => i.value === issue)) return ephemeral(`Pick an issue from the list: ${REPORT_ISSUES.map((i) => i.label).join(', ')}.`);
  const details = rawDetails?.trim() || null;
  if (details && details.length > DETAILS_MAX) return ephemeral(`Details can be at most ${DETAILS_MAX} characters. Nothing was saved.`);
  const open = await c.db.prepare("SELECT count(*) AS n FROM recipe_report WHERE guild_id = ? AND reporter = ? AND status = 'open'").bind(c.guild.id, c.userId).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_REPORTS)
    return ephemeral(`You already have ${MAX_OPEN_REPORTS} reports waiting for an officer. Once one is marked fixed or dismissed you can file another.`);
  const createdAt = now();
  const [inserted] = await c.db.batch([
    c.db
      .prepare("INSERT INTO recipe_report (guild_id, item_id, reporter, issue, details, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?) RETURNING id")
      .bind(c.guild.id, item.id, c.userId, issue, details, createdAt),
    audit(c.db, c.guild.id, c.userId, 'report.create', `item:${item.id}`, null, { issue }),
  ]);
  const id = (inserted.results as { id: number }[])[0].id;
  const saved = `Thanks: your report on **${md(item.name)}** (${issueLabel(issue)}) is saved.`;
  if (!c.guild.review_channel_id || !c.botToken) return ephemeral(`${saved} Officers will see it in \`/guildcraft status\`.`);
  const card = reportCard({ id, item: item.name, reporter: c.userId, issue, details, status: 'open', resolved_by: null, resolved_at: null, created_at: createdAt });
  const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: 2, deadline: Date.now() + 10_000 });
  const sent = await api.call('POST', `/channels/${c.guild.review_channel_id}/messages`, { embeds: [card], components: cardButtons(id), allowed_mentions: { parse: [] } });
  if (!sent.ok) console.error('report card refused', JSON.stringify(api.log));
  return ephemeral(sent.ok ? `${saved} Officers have been sent it to review.` : `${saved} Officers will see it in \`/guildcraft status\`.`);
}

const findItem = (db: D1Database, by: { key: string } | { id: number }) =>
  db.prepare(`SELECT id, name FROM item WHERE ${'key' in by ? 'name_key' : 'id'} = ?`).bind('key' in by ? by.key : by.id).first<{ id: number; name: string }>();

export async function craftReport(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const typed = (optString(opts, 'item') ?? '').trim();
  const item = await findItem(c.db, { key: typed.toLowerCase() });
  if (!item) return ephemeral(`I don't know an item called **${md(typed || '(nothing)')}**. Pick one from the list as you type.`);
  return fileReport(c, item, optString(opts, 'issue') ?? '', optString(opts, 'details'));
}

/**
 * rpt:<item id>, the Report a problem button: a modal at once (type 9; a modal cannot follow a deferral). An issue
 * select inside a Label, then an optional details box. No D1 here beyond the caller's member gate.
 */
export function reportModal(itemId: number): InteractionReply {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${REPORT_MODAL_PREFIX}${itemId}`,
      title: 'Report a problem',
      components: [
        {
          type: MessageComponentTypes.LABEL,
          label: 'What is wrong?',
          component: {
            type: MessageComponentTypes.STRING_SELECT,
            custom_id: ISSUE_INPUT,
            min_values: 1,
            max_values: 1,
            required: true,
            options: REPORT_ISSUES.map((i) => ({ label: i.label, value: i.value })),
          },
        },
        {
          type: MessageComponentTypes.LABEL,
          label: 'Details (optional)',
          description: `What should it be? Up to ${DETAILS_MAX} characters.`,
          component: { type: MessageComponentTypes.INPUT_TEXT, custom_id: DETAILS_INPUT, style: 2, required: false, max_length: DETAILS_MAX },
        },
      ],
    },
  };
}

/** The values of a modal's components, by custom_id: a select's first value, or a text input's value. */
export function modalValues(components: ModalComponent[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (x: ModalComponent) => {
    if (x.custom_id) out.set(x.custom_id, x.values?.[0] ?? x.value ?? '');
    if (x.component) visit(x.component);
    for (const y of x.components ?? []) visit(y);
  };
  for (const x of components ?? []) visit(x);
  return out;
}

/** rptm:<item id>: the modal's submit (deferred, private). */
export async function reportSubmitted(c: Ctx, customId: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const item = await findItem(c.db, { id: Number(customId.slice(REPORT_MODAL_PREFIX.length)) });
  if (!item) return ephemeral('That item is no longer in the data. Nothing was saved.');
  const v = modalValues(components);
  return fileReport(c, item, v.get(ISSUE_INPUT) ?? '', v.get(DETAILS_INPUT));
}

/** rpf:<id> / rpd:<id>: an officer records the outcome. The card is edited to say who and when; its buttons go. */
export async function reportButton(c: Ctx, customId: string): Promise<MessageReply> {
  if (!c.officer) return ephemeral(OFFICER_ONLY);
  const fixed = customId.startsWith(FIXED_PREFIX);
  const id = Number(customId.slice((fixed ? FIXED_PREFIX : DISMISS_PREFIX).length));
  const at = now();
  const [upd, read] = await c.db.batch([
    c.db.prepare("UPDATE recipe_report SET status = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND guild_id = ? AND status = 'open'").bind(fixed ? 'fixed' : 'dismissed', c.userId, at, id, c.guild.id),
    c.db
      .prepare('SELECT r.id, i.name AS item, r.reporter, r.issue, r.details, r.status, r.resolved_by, r.resolved_at, r.created_at FROM recipe_report r LEFT JOIN item i ON i.id = r.item_id WHERE r.id = ? AND r.guild_id = ?')
      .bind(id, c.guild.id),
  ]);
  const r = (read.results as ReportRow[])[0];
  if (!r) return ephemeral('That report is no longer recorded.');
  // Audited only when this press resolved it; a second press re-shows the outcome and writes nothing.
  if (upd.meta.changes) await audit(c.db, c.guild.id, c.userId, fixed ? 'report.fixed' : 'report.dismissed', `report:${id}`, null, null).run();
  const outcome = `${r.status === 'fixed' ? '✅ Marked fixed' : '✖️ Dismissed'} by <@${r.resolved_by}> · ${ts(r.resolved_at ?? at)}`;
  return updateMessage({ content: outcome, embeds: [reportCard(r)], components: [] });
}

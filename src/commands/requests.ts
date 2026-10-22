// Craft requests (order 16, ITEM 2): /craft notify, /craft request, the Request a craft button on /craft find,
// /craft requests, and the buttons in a request's thread. The routing, the thread's text and the sweep are in
// src/requests.ts. Every reply here is private; the only messages others see are the thread's (its first message, and
// the claim, done and cancel notices), and those ping only as order 16's override 2 allows.
import { InteractionResponseType, MessageComponentTypes } from 'discord-interactions';
import { audit, now } from '../access.ts';
import { botApi, type BotApi } from '../board/api.ts';
import { AUTO_ARCHIVE_MINUTES } from '../board/refresh.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, memberTag, mention, optBool, optInt, optString, pingOnly, plural, row, STYLE_DANGER, STYLE_PRIMARY, STYLE_SECONDARY, truncate, updateMessage, type InteractionReply, type MessageReply, type ModalComponent, type Option } from '../discord.ts';
import {
  auditIfChanged, closeStatements, syncChanged, crafters, involved, isEligible, ITEM_PREFIX, ITEMS_SQL, loadRequest, MAX_ADDED, MAX_ITEMS, MAX_OPEN_PER_MEMBER, MAX_QUANTITY, namesOf, NO_REQUEST_CHANNEL, NOTE_MAX, prefixOf,
  REQUEST_COLS, requestComponents, requestContent, routeItems, syncThread, syncWrite, target, threadName, whoCanView, UNSENT_MS, type Crafter, type ItemAction, type ItemRoute, type ItemRow, type Names, type RequestRow,
} from '../requests.ts';
import { visibleTo } from '../recipes.ts';
import { noRecipe } from './find.ts';
import { OFFICER_ONLY } from './members.ts';
import { modalValues } from './reports.ts';

export const SEND_PREFIX = 'rqs:';
export const ADD_PREFIX = 'rqa:';
export const ADD_MODAL_PREFIX = 'rqam:';
export const DISCARD_PREFIX = 'rqz:';
export const LIST_PREFIX = 'rql:';
const ITEM_INPUT = 'item';
const QTY_INPUT = 'qty';

/** The Discord calls one button may make: a send is 4 reads, a create, up to MAX_ADDED + 1 adds and a message. */
const apiFor = (c: Ctx): BotApi | null =>
  c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap: MAX_ADDED + 12, deadline: Date.now() + 20_000 }) : null;

/** One log line per request action: its D1 rows written (measured from D1's own meta) and its Discord calls. */
function logAction(action: string, rowsWritten: number, api: BotApi | null, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ gc: 'request', action, rows_written: rowsWritten, discord_calls: api?.budget.discord ?? 0, calls: api?.log ?? [], ...extra }));
}
const written = (rs: D1Result[]) => rs.reduce((n, r) => n + (r.meta.rows_written ?? 0), 0);

const tagOf = (names: Names, id: string) => (names.has(id) ? memberTag(id, names.get(id)!) : mention(id));
const crafterList = (cs: Crafter[]) => cs.map((x) => memberTag(x.userId, x.member)).join(', ');

// ---------------------------------------------------------------- /craft notify tradeskill: on:

export const ALL_SKILLS = 'All';

export async function notifyLine(db: D1Database, guildId: string, userId: string): Promise<string> {
  const { results } = await db
    .prepare('SELECT t.name FROM craft_notify n JOIN tradeskill t ON t.id = n.tradeskill_id WHERE n.guild_id = ? AND n.discord_user_id = ? ORDER BY t.name COLLATE NOCASE')
    .bind(guildId, userId)
    .all<{ name: string }>();
  return results.length
    ? `**Craft request notices:** ${results.map((r) => r.name).join(', ')} (\`/craft notify\` changes them)`
    : '**Craft request notices:** off (`/craft notify` turns them on for a tradeskill)';
}

export async function craftNotify(c: Ctx, opts: Option[]): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const typed = (optString(opts, 'tradeskill') ?? '').trim();
  const on = optBool(opts, 'on');
  if (on === undefined) return ephemeral('Pick `on:` True or False.');
  const all = typed.toLowerCase() === ALL_SKILLS.toLowerCase();
  const { results: skills } = all
    ? await c.db.prepare('SELECT id, name FROM tradeskill ORDER BY name COLLATE NOCASE').all<{ id: number; name: string }>()
    : await c.db.prepare('SELECT id, name FROM tradeskill WHERE name = ? COLLATE NOCASE').bind(typed).all<{ id: number; name: string }>();
  if (!skills.length) return ephemeral(`I don't know a tradeskill called **${md(typed)}**. Pick one from the list as you type, or **All**.`);
  const ids = JSON.stringify(skills.map((s) => s.id));
  const res = await c.db.batch([
    on
      ? c.db.prepare('INSERT OR IGNORE INTO craft_notify (guild_id, discord_user_id, tradeskill_id, created_at) SELECT ?, ?, value, ? FROM json_each(?)').bind(c.guild.id, c.userId, now(), ids)
      : c.db.prepare('DELETE FROM craft_notify WHERE guild_id = ? AND discord_user_id = ? AND tradeskill_id IN (SELECT value FROM json_each(?))').bind(c.guild.id, c.userId, ids),
    audit(c.db, c.guild.id, c.userId, 'craft.notify', `member:${c.userId}`, null, { on, tradeskills: all ? ALL_SKILLS : skills[0].name }),
  ]);
  logAction('notify', written(res), null);
  const what = all ? 'every tradeskill' : skills[0].name;
  const lines = [
    on
      ? `Craft request notices **on** for ${what}. When someone asks for an item one of your characters can make, you're added to a private thread in <#${c.guild.request_channel_id}> and pinged there.`
      : `Craft request notices **off** for ${what}.`,
    await notifyLine(c.db, c.guild.id, c.userId),
  ];
  return ephemeral(lines.join('\n'));
}

// ---------------------------------------------------------------- the unsent: /craft request, Request a craft, Add item

interface ItemPick {
  id: number;
  name: string;
}

const ITEM_WITH_RECIPE = (guild: string) => `SELECT i.id, i.name FROM item i WHERE i.name_key = ?1 AND EXISTS (SELECT 1 FROM recipe r WHERE r.result_item_id = i.id AND ${visibleTo(guild)})`;

async function openCount(c: Ctx): Promise<number> {
  // A claim whose thread was never written (its run died) stops counting after an hour (sendUnsent).
  const r = await c.db
    .prepare("SELECT count(*) AS n FROM craft_request WHERE guild_id = ? AND requester = ? AND status = 'open' AND (thread_id IS NOT NULL OR opened_at > ?)")
    .bind(c.guild.id, c.userId, new Date(Date.now() - 3_600_000).toISOString())
    .first<{ n: number }>();
  return r?.n ?? 0;
}

export const TOO_MANY_OPEN = `You already have ${MAX_OPEN_PER_MEMBER} open requests. Mark one done or cancel one (\`/craft requests\`) before asking for more.`;

/** Adds an item to the member's unsent (a new unsent when none is recent), then shows the unsent. */
async function addToUnsent(c: Ctx, item: ItemPick, quantity: number, note: string | undefined): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return ephemeral(`\`quantity\` must be a whole number from 1 to ${MAX_QUANTITY}.`);
  if (note !== undefined && note.length > NOTE_MAX) return ephemeral(`Keep the note to ${NOTE_MAX} characters.`);
  if ((await openCount(c)) >= MAX_OPEN_PER_MEMBER) return ephemeral(TOO_MANY_OPEN);
  const unsent = await c.db
    .prepare("SELECT id, created_at, (SELECT count(*) FROM craft_request_item q WHERE q.request_id = r.id) AS n, (SELECT position FROM craft_request_item q WHERE q.request_id = r.id AND q.item_id = ?3) AS same FROM craft_request r WHERE guild_id = ?1 AND requester = ?2 AND status = 'unsent' ORDER BY id DESC LIMIT 1")
    .bind(c.guild.id, c.userId, item.id)
    .first<{ id: number; created_at: string; n: number; same: number | null }>();
  const stmts: D1PreparedStatement[] = [];
  let unsentId = unsent?.id ?? null;
  if (unsent && Date.now() - Date.parse(unsent.created_at) > UNSENT_MS) {
    stmts.push(c.db.prepare("UPDATE craft_request SET status = 'closed', close_reason = 'discarded', closed_at = ? WHERE id = ? AND status = 'unsent'").bind(now(), unsent.id));
    unsentId = null;
  }
  if (unsentId !== null && unsent!.same === null && unsent!.n >= MAX_ITEMS) return ephemeral(`A request holds up to ${MAX_ITEMS} items. Send this one first, then start another.`, { components: unsentRows(unsentId, unsent!.n, true) });
  if (unsentId === null) {
    stmts.push(
      c.db.prepare("INSERT INTO craft_request (guild_id, requester, note, status, created_at) VALUES (?, ?, ?, 'unsent', ?)").bind(c.guild.id, c.userId, note ?? null, now()),
      c.db
        .prepare("INSERT INTO craft_request_item (request_id, position, item_id, quantity) VALUES ((SELECT max(id) FROM craft_request WHERE guild_id = ? AND requester = ? AND status = 'unsent'), 1, ?, ?)")
        .bind(c.guild.id, c.userId, item.id, quantity),
    );
  } else if (unsent!.same !== null) {
    stmts.push(c.db.prepare('UPDATE craft_request_item SET quantity = ? WHERE request_id = ? AND position = ?').bind(quantity, unsentId, unsent!.same));
  } else {
    stmts.push(c.db.prepare('INSERT INTO craft_request_item (request_id, position, item_id, quantity) VALUES (?, ?, ?, ?)').bind(unsentId, unsent!.n + 1, item.id, quantity));
  }
  if (unsentId !== null && note !== undefined) stmts.push(c.db.prepare('UPDATE craft_request SET note = ? WHERE id = ?').bind(note, unsentId));
  const res = await c.db.batch(stmts);
  logAction('compose', written(res), null);
  const id =
    unsentId ??
    (await c.db.prepare("SELECT max(id) AS id FROM craft_request WHERE guild_id = ? AND requester = ? AND status = 'unsent'").bind(c.guild.id, c.userId).first<{ id: number }>())!.id;
  return unsentView(c, id);
}

function unsentRows(unsentId: number, items: number, canSend: boolean): unknown[] {
  return [
    row([
      button(`${SEND_PREFIX}${unsentId}`, 'Send request', STYLE_PRIMARY, !canSend),
      button(`${ADD_PREFIX}${unsentId}`, 'Add item', STYLE_SECONDARY, items >= MAX_ITEMS),
      button(`${DISCARD_PREFIX}${unsentId}`, 'Discard', STYLE_DANGER),
    ]),
  ];
}

/** What the requester can do about an item no opted-in crafter can make: the crafters /craft find lists, to ask directly. */
function noCrafterLine(route: ItemRoute): string {
  if (!route.notOptedIn.length) return "No opted-in crafter can make it yet, and no one else in the guild can either (by `/craft find`'s Reliable list).";
  return `No opted-in crafter can make it yet. These crafters can, but haven't turned on request notices, so ask them directly: ${crafterList(route.notOptedIn)}`;
}

async function unsentView(c: Ctx, unsentId: number, update = false): Promise<MessageReply> {
  const loaded = await loadRequest(c.db, c.guild.id, unsentId);
  if (!loaded || loaded.req.requester !== c.userId || loaded.req.status !== 'unsent') return ephemeral('That request was already sent or discarded. Run `/craft request` to start another.');
  const { req, items } = loaded;
  const routes = await routeItems(c.db, c.guild.id, c.userId, items.map((i) => i.item_id), c.guild.learning_window);
  const many = items.length > 1;
  const lines = [
    `**Your craft request** (not sent yet) · for <#${c.guild.request_channel_id}>`,
    ...items.map((it, k) => {
      const r = routes[k];
      const head = `${many ? `${k + 1}. ` : ''}**${md(it.name)}** ×${it.quantity}`;
      return r.eligible.length ? `${head} · ${plural(r.eligible.length, 'opted-in crafter')} can make it: ${crafterList(r.eligible)}` : `${head} · ${noCrafterLine(r)}`;
    }),
    req.note ? `**Note:** ${md(req.note)}` : null,
    `-# **Send request** opens a private thread in <#${c.guild.request_channel_id}> with you and the crafters, who are pinged there. Up to ${MAX_ITEMS} items: **Add item**, or run \`/craft request\` again.`,
  ].filter(Boolean) as string[];
  const canSend = routes.some((r) => r.eligible.length > 0);
  const data = { content: truncate(lines.join('\n'), 2000), components: unsentRows(unsentId, items.length, canSend) };
  return update ? updateMessage(data) : ephemeral(data.content, { components: data.components });
}

export async function craftRequest(c: Ctx, opts: Option[]): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const typed = (optString(opts, 'item') ?? '').trim();
  const item = await c.db.prepare(ITEM_WITH_RECIPE('?2')).bind(typed.toLowerCase(), c.guild.id).first<ItemPick>();
  if (!item) return ephemeral(noRecipe(typed || '(nothing)'));
  return addToUnsent(c, item, optInt(opts, 'quantity') ?? 1, optString(opts, 'note'));
}

/** rqf:<item id>: Request a craft on a /craft find reply. Always a new private message, even on a posted card. */
export async function requestFromFind(c: Ctx, itemId: number): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const item = await c.db.prepare(`SELECT i.id, i.name FROM item i WHERE i.id = ?1 AND EXISTS (SELECT 1 FROM recipe r WHERE r.result_item_id = i.id AND ${visibleTo('?2')})`).bind(itemId, c.guild.id).first<ItemPick>();
  if (!item) return ephemeral('That item no longer has a recipe. Run `/craft find` again.');
  return addToUnsent(c, item, 1, undefined);
}

/** rqa:<unsent id>: a modal at once (item name and quantity; a modal has no autocomplete). */
export function addItemModal(customId: string): InteractionReply {
  return {
    type: InteractionResponseType.MODAL,
    data: {
      custom_id: `${ADD_MODAL_PREFIX}${customId.slice(ADD_PREFIX.length)}`,
      title: 'Add an item',
      components: [
        {
          type: MessageComponentTypes.LABEL,
          label: 'Item',
          description: 'The exact item name. Or run /craft request again: it picks from a list and adds to this request.',
          component: { type: MessageComponentTypes.INPUT_TEXT, custom_id: ITEM_INPUT, style: 1, required: true, max_length: 100 },
        },
        {
          type: MessageComponentTypes.LABEL,
          label: 'Quantity',
          component: { type: MessageComponentTypes.INPUT_TEXT, custom_id: QTY_INPUT, style: 1, required: false, max_length: 4, value: '1' },
        },
      ],
    },
  };
}

/** rqam:<unsent id>: the Add item modal's answer, a new private message with the unsent. */
export async function addItemSubmitted(c: Ctx, customId: string, components: ModalComponent[] | undefined): Promise<MessageReply> {
  const unsentId = Number(customId.slice(ADD_MODAL_PREFIX.length));
  const v = modalValues(components);
  const typed = (v.get(ITEM_INPUT) ?? '').trim();
  const qtyText = (v.get(QTY_INPUT) ?? '').trim() || '1';
  const unsent = await c.db.prepare("SELECT id FROM craft_request WHERE id = ? AND guild_id = ? AND requester = ? AND status = 'unsent'").bind(unsentId, c.guild.id, c.userId).first();
  if (!unsent) return ephemeral('That request was already sent or discarded. Run `/craft request` to start another.');
  const item = await c.db.prepare(ITEM_WITH_RECIPE('?2')).bind(typed.toLowerCase(), c.guild.id).first<ItemPick>();
  if (!item) return ephemeral(`${noRecipe(typed || '(nothing)')} In the form the name must match exactly; \`/craft request item:\` picks from the list and adds to this request.`);
  if (!/^\d+$/.test(qtyText)) return ephemeral(`\`quantity\` must be a whole number from 1 to ${MAX_QUANTITY}.`);
  return addToUnsent(c, item, Number(qtyText), undefined);
}

/** rqz:<unsent id>: Discard (the unsent is closed, never deleted). */
export async function discardUnsent(c: Ctx, customId: string): Promise<MessageReply> {
  const id = Number(customId.slice(DISCARD_PREFIX.length));
  const res = await c.db.batch([
    c.db.prepare("UPDATE craft_request SET status = 'closed', close_reason = 'discarded', closed_at = ? WHERE id = ? AND guild_id = ? AND requester = ? AND status = 'unsent'").bind(now(), id, c.guild.id, c.userId),
  ]);
  logAction('discard', written(res), null);
  return updateMessage({ content: res[0].meta.changes ? 'Discarded. Nothing was sent.' : 'That request was already sent or discarded.', components: [] });
}

// ---------------------------------------------------------------- Send request: the thread

/** Why a crafter was left out, privately to the requester. */
type LeftOut = { userId: string; member: string; why: string };

export async function sendUnsent(c: Ctx, customId: string): Promise<MessageReply> {
  const id = Number(customId.slice(SEND_PREFIX.length));
  const channel = c.guild.request_channel_id;
  if (!channel) return ephemeral(NO_REQUEST_CHANNEL);
  const loaded = await loadRequest(c.db, c.guild.id, id);
  if (!loaded || loaded.req.requester !== c.userId || loaded.req.status !== 'unsent') return updateMessage({ content: 'That request was already sent or discarded. Run `/craft request` to start another.', components: [] });
  const { req, items } = loaded;
  if ((await openCount(c)) >= MAX_OPEN_PER_MEMBER) return ephemeral(TOO_MANY_OPEN);
  const routes = await routeItems(c.db, c.guild.id, c.userId, items.map((i) => i.item_id), c.guild.learning_window);
  // Each item's crafters in turn (its first, then the next item's first, ...), so the MAX_ADDED places are shared.
  const byUser = new Map<string, Crafter>();
  for (let k = 0; routes.some((r) => k < r.eligible.length); k++) for (const r of routes) if (r.eligible[k] && !byUser.has(r.eligible[k].userId)) byUser.set(r.eligible[k].userId, r.eligible[k]);
  const candidates = [...byUser.values()];
  const noOne = (left: LeftOut[] = []) =>
    ephemeral(
      [
        'Not sent: no opted-in crafter can make it yet, so no thread was opened. Your request is kept, unsent.',
        ...items.map((it, k) => `**${md(it.name)}**: ${noCrafterLine({ ...routes[k], eligible: [] })}`),
        ...(left.length ? ['Left out:', ...left.map((l) => `${memberTag(l.userId, l.member)}: ${l.why}`)] : []),
      ].join('\n').slice(0, 2000),
    );
  if (!candidates.length) return noOne();
  const api = apiFor(c);
  if (!api) return ephemeral("Sorry, GuildCraft can't reach Discord right now. Nothing was sent; please try again.");

  const view = await whoCanView(api, c.guild.id, channel, [c.userId, ...candidates.map((x) => x.userId)]);
  if ('error' in view) {
    logAction('create', 0, api, { refused: 'view check' });
    return ephemeral(`Sorry, I couldn't check who can see <#${channel}>. Nothing was sent; please try again.`);
  }
  if (!view.canView.has(c.userId)) return ephemeral(`You can't see <#${channel}>, so you couldn't open your request's thread. Ask an admin for access to it.`);
  const left: LeftOut[] = [];
  for (const x of candidates) {
    if (view.notInServer.has(x.userId)) left.push({ userId: x.userId, member: x.member, why: 'no longer in the server' });
    else if (view.cannotView.has(x.userId)) left.push({ userId: x.userId, member: x.member, why: `can't see <#${channel}>` });
  }
  let added = candidates.filter((x) => view.canView.has(x.userId));
  for (const x of added.slice(MAX_ADDED)) left.push({ userId: x.userId, member: x.member, why: `over the ${MAX_ADDED}-crafter limit for one request` });
  added = added.slice(0, MAX_ADDED);
  if (!added.length) {
    logAction('create', 0, api, { refused: 'no crafter can view' });
    return noOne(left);
  }

  // Claim the request before any thread exists: a second press of Send (the button works until this message changes)
  // finds it no longer unsent, and the 5-open limit is checked in the same statement. A claim whose thread never got
  // written (the run died) stops counting after an hour.
  const openedAt = now();
  const claimed = await c.db
    .prepare(
      `UPDATE craft_request SET status = 'open', opened_at = ?1 WHERE id = ?2 AND status = 'unsent'
         AND (SELECT count(*) FROM craft_request WHERE guild_id = ?3 AND requester = ?4 AND status = 'open' AND (thread_id IS NOT NULL OR opened_at > ?5)) < ?6`,
    )
    .bind(openedAt, id, c.guild.id, c.userId, new Date(Date.now() - 3_600_000).toISOString(), MAX_OPEN_PER_MEMBER)
    .run();
  if (claimed.meta.changes !== 1) return ephemeral((await openCount(c)) >= MAX_OPEN_PER_MEMBER ? TOO_MANY_OPEN : 'That request was already sent or discarded.');
  const unclaim = () => c.db.prepare("UPDATE craft_request SET status = 'unsent', opened_at = NULL WHERE id = ? AND status = 'open' AND thread_id IS NULL").bind(id).run();

  // The thread: private, members cannot invite others, the longest auto-archive time.
  const open: RequestRow = { ...req, status: 'open', opened_at: openedAt };
  const name = threadName(prefixOf(open, items), items, req.main);
  const made = await api.call<{ id: string }>('POST', `/channels/${channel}/threads`, { name, type: 12, invitable: false, auto_archive_duration: AUTO_ARCHIVE_MINUTES });
  if (!made.ok) {
    await unclaim();
    logAction('create', 0, api, { refused: `create ${made.status} ${made.code ?? ''}` });
    return ephemeral(`Sorry, Discord refused to open the thread in <#${channel}> (${made.status}). Nothing was sent; your request is kept, unsent. An admin can check \`/guildcraft setup requests:\`.`);
  }
  const thread = made.body.id;
  const inThread = new Set<string>();
  for (const userId of [c.userId, ...added.map((x) => x.userId)]) {
    const p = await api.call('PUT', `/channels/${thread}/thread-members/${userId}`);
    if (p.ok) inThread.add(userId);
    else if (userId !== c.userId) {
      const x = added.find((a) => a.userId === userId)!;
      left.push({ userId, member: x.member, why: `Discord refused to add them (${p.status})` });
    }
  }
  const sentTo = added.filter((x) => inThread.has(x.userId));
  const withCrafters = items.map((it, k) => ({ ...it, crafters_json: JSON.stringify(routes[k].eligible.map((x) => x.userId).filter((u) => inThread.has(u))) }));
  const names: Names = new Map([...sentTo.map((x) => [x.userId, x.member] as const), ...(await namesOf(c.db, c.guild.id, [c.userId]))]);
  const first = await api.call<{ id: string }>('POST', `/channels/${thread}/messages`, {
    content: requestContent(open, withCrafters, names),
    components: requestComponents(open, withCrafters),
    // The only pings: the crafters it adds (order 16, override 2).
    allowed_mentions: pingOnly(sentTo.map((x) => x.userId)),
  });
  const res = await c.db.batch([
    ...withCrafters.map((it) => c.db.prepare('UPDATE craft_request_item SET crafters_json = ? WHERE request_id = ? AND position = ?').bind(it.crafters_json, id, it.position)),
    c.db.prepare('UPDATE craft_request SET thread_id = ?, message_id = ?, thread_name = ? WHERE id = ? AND thread_id IS NULL').bind(thread, first.ok ? first.body.id : null, name, id),
    auditIfChanged(c.db, c.guild.id, c.userId, 'request.create', target(id), null, { items: items.map((i) => ({ item: i.item_id, quantity: i.quantity })), added: sentTo.length, left_out: left.length }),
  ]);
  logAction('create', written([claimed, ...res]), api, { items: items.length, added: sentTo.length, left_out: left.length });
  const lines = [
    `Sent: <#${thread}>. ${plural(sentTo.length, 'crafter')} added and pinged there.`,
    ...withCrafters.map((it) => `**${md(it.name)}** ×${it.quantity}: ${crafters(it).length ? crafters(it).map((u) => tagOf(names, u)).join(', ') : 'no crafter added'}`),
    ...(left.length ? ['Left out:', ...left.map((l) => `${memberTag(l.userId, l.member)}: ${l.why}`)] : []),
    ...(first.ok ? [] : ["-# The thread's first message didn't go out; it is posted within 15 minutes."]),
  ];
  return updateMessage({ content: lines.join('\n').slice(0, 2000), components: [] });
}

// ---------------------------------------------------------------- the thread's buttons

const IT = (it: ItemRow) => `**${md(it.name)}** ×${it.quantity}`;

/** rqi:<c|d|x>:<request id>:<position>: I'll craft this, Done, Cancel. Rights re-checked on every press. */
export async function itemButton(c: Ctx, customId: string): Promise<MessageReply> {
  const [action, idText, posText] = customId.slice(ITEM_PREFIX.length).split(':') as [ItemAction, string, string];
  const loaded = await loadRequest(c.db, c.guild.id, Number(idText));
  if (!loaded || loaded.req.status !== 'open') return ephemeral('This request is closed.');
  const { req } = loaded;
  const it = loaded.items.find((i) => i.position === Number(posText));
  if (!it) return ephemeral('That item is no longer in this request.');
  const me = c.userId;
  let next: Partial<ItemRow>;
  let from: string;
  let auditAction: string;
  let ping: string[];
  let notice: string;
  let reply: string;
  if (action === 'c') {
    if (it.status !== 'open') return ephemeral(it.claimer === me ? 'You already took this item.' : 'Someone already took this item.');
    if (!(await isEligible(c.db, c.guild.id, me, it.item_id, req.requester, c.guild.learning_window)))
      return ephemeral(me === req.requester ? "You asked for this item, so you can't take it." : `Only opted-in crafters whose characters can make ${IT(it)} can take it.`);
    next = { status: 'claimed', claimer: me };
    from = 'open';
    auditAction = 'request.claim';
    ping = [req.requester];
    notice = `${mention(req.requester)}: ${mention(me)} will craft ${IT(it)}.`;
    reply = `You're down to craft ${IT(it)}. ${mention(req.requester)} has been told. Press **Done** when it's handed over.`;
  } else if (action === 'd') {
    if (it.status !== 'claimed') return ephemeral('Only an item someone has taken can be marked done.');
    if (me !== it.claimer && me !== req.requester) return ephemeral('Only the crafter who took it, or the requester, can mark it done.');
    next = { status: 'done' };
    from = 'claimed';
    auditAction = 'request.done';
    const other = me === it.claimer ? req.requester : it.claimer!;
    ping = [other];
    notice = `${mention(other)}: ${IT(it)} is done (marked by ${mention(me)}).`;
    reply = `Marked ${IT(it)} done.`;
  } else if (action === 'x') {
    if (it.status !== 'open' && it.status !== 'claimed') return ephemeral('That item is already closed.');
    if (me !== req.requester && !c.officer) return ephemeral('Only the requester can cancel an item. Officers can cancel a whole request with `/craft requests`.');
    next = { status: 'cancelled' };
    from = it.status;
    auditAction = 'request.cancel';
    ping = [...(it.claimer && it.claimer !== me ? [it.claimer] : []), ...(me !== req.requester ? [req.requester] : [])];
    notice = `${ping.length ? `${ping.map(mention).join(' ')}: ` : ''}${IT(it)} was cancelled by ${mention(me)}.`;
    reply = `Cancelled ${IT(it)}.`;
  } else return ephemeral('Sorry, that button has expired.');

  const at = now();
  const res = await c.db.batch([
    c.db
      .prepare("UPDATE craft_request_item SET status = ?, claimer = coalesce(?, claimer) WHERE request_id = ? AND position = ? AND status = ? AND EXISTS (SELECT 1 FROM craft_request WHERE id = ? AND status = 'open')")
      .bind(next.status, next.claimer ?? null, req.id, it.position, from, req.id),
    auditIfChanged(c.db, c.guild.id, me, auditAction, target(req.id), { item: it.position, status: from }, { item: it.position, status: next.status }),
    // The request closes when no item is open or claimed: 'done' if any item was done.
    c.db
      .prepare(
        `UPDATE craft_request SET status = 'closed', closed_at = ?1, close_reason = CASE WHEN EXISTS (SELECT 1 FROM craft_request_item WHERE request_id = ?2 AND status = 'done') THEN 'done' ELSE 'cancelled' END
         WHERE id = ?2 AND status = 'open' AND NOT EXISTS (SELECT 1 FROM craft_request_item WHERE request_id = ?2 AND status IN ('open', 'claimed'))`,
      )
      .bind(at, req.id),
  ]);
  // Someone else changed it first: nothing was written (the audit row is guarded by the update).
  if (res[0].meta.changes !== 1) return ephemeral('Someone changed that item first. Look at the thread for its status.');
  const closed = res[2].meta.changes === 1;
  const items = loaded.items.map((i) => (i.position === it.position ? { ...i, ...next } : i));
  const after: RequestRow = closed ? { ...req, status: 'closed', close_reason: items.some((i) => i.status === 'done') ? 'done' : 'cancelled' } : req;
  if (closed) notice += ' Every item is done or cancelled, so this thread is now closed.';
  const api = apiFor(c);
  let rows = written(res);
  if (api) {
    const names = await namesOf(c.db, c.guild.id, involved(after, items));
    const s = await syncThread(api, after, items, names, { content: notice, ping });
    if (syncChanged(after, s)) rows += written(await c.db.batch([syncWrite(c.db, after, s)]));
    logAction(auditAction.replace('request.', ''), rows, api, { closed, errors: s.errors });
  } else {
    // No way to reach Discord now: the sweep brings the thread up to date (thread_name cleared marks it behind).
    rows += written(await c.db.batch([c.db.prepare('UPDATE craft_request SET thread_name = NULL WHERE id = ?').bind(req.id)]));
    logAction(auditAction.replace('request.', ''), rows, null, { closed, errors: ['no bot token'] });
  }
  return ephemeral(reply);
}

// ---------------------------------------------------------------- /craft requests (private): open requests, with Cancel

/** Open requests' lines and the Cancel select (custom_id rql:, handled by cancelFromList), for /craft requests and /officer requests. */
async function requestList(c: Ctx, reqs: RequestRow[], withRequester: boolean): Promise<{ lines: string[]; select: unknown }> {
  const { results: items } = await c.db.prepare(ITEMS_SQL).bind(JSON.stringify(reqs.map((r) => r.id))).all<ItemRow>();
  const names = await namesOf(c.db, c.guild.id, reqs.map((r) => r.requester));
  const summary = (r: RequestRow) => {
    const its = items.filter((i) => i.request_id === r.id);
    return `${its[0] ? `${its[0].name} ×${its[0].quantity}` : 'Craft request'}${its.length > 1 ? ` +${its.length - 1} more` : ''}`;
  };
  const lines = reqs.map(
    (r) =>
      `**#${r.id}** ${r.thread_id ? `<#${r.thread_id}>` : ''} · ${md(summary(r))} · ${prefixOf(r, items.filter((i) => i.request_id === r.id))}${withRequester ? ` · from ${tagOf(names, r.requester)}` : ''} · <t:${Math.floor(Date.parse(r.opened_at ?? r.created_at) / 1000)}:R>`,
  );
  const select = {
    type: 3,
    custom_id: LIST_PREFIX,
    placeholder: 'Cancel a request',
    min_values: 1,
    max_values: 1,
    options: reqs.map((r) => ({ label: truncate(`#${r.id} ${summary(r)}`, 100), value: String(r.id) })),
  };
  return { lines, select };
}

export async function craftRequests(c: Ctx): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const { results: reqs } = await c.db
    .prepare(`SELECT ${REQUEST_COLS} FROM craft_request r WHERE r.guild_id = ?1 AND r.status = 'open' AND r.thread_id IS NOT NULL AND (?3 = 1 OR r.requester = ?2) ORDER BY r.id LIMIT 25`)
    .bind(c.guild.id, c.userId, c.officer ? 1 : 0)
    .all<RequestRow>();
  if (!reqs.length) return ephemeral(c.officer ? 'No open craft requests in this server.' : 'You have no open craft requests. `/craft request` starts one.');
  const { lines, select } = await requestList(c, reqs, c.officer);
  const head = c.officer ? `**Open craft requests** (as an officer you see all ${reqs.length}${reqs.length === 25 ? '+' : ''}):` : '**Your open craft requests:**';
  return ephemeral([head, ...lines].join('\n').slice(0, 2000), { components: [row([select])] });
}

// ---------------------------------------------------------------- /officer requests (order 18): every open request, paged

export const OFFICER_PAGE_PREFIX = 'rqp:';
const OFFICER_PAGE_SIZE = 10;

export const OFFICER_REQUESTS_COPY = {
  none: 'No open craft requests in this server.',
  head: (from: number, to: number, total: number) => `**Open craft requests** ${from}–${to} of ${total}, oldest first:`,
} as const;

async function officerPage(c: Ctx, page: number): Promise<{ content: string; components: unknown[] } | null> {
  const where = "r.guild_id = ?1 AND r.status = 'open' AND r.thread_id IS NOT NULL";
  const total = (await c.db.prepare(`SELECT count(*) AS n FROM craft_request r WHERE ${where}`).bind(c.guild.id).first<{ n: number }>())?.n ?? 0;
  if (!total) return null;
  const pages = Math.ceil(total / OFFICER_PAGE_SIZE);
  const p = Math.min(Math.max(0, page), pages - 1);
  const { results: reqs } = await c.db
    .prepare(`SELECT ${REQUEST_COLS} FROM craft_request r WHERE ${where} ORDER BY r.id LIMIT ?2 OFFSET ?3`)
    .bind(c.guild.id, OFFICER_PAGE_SIZE, p * OFFICER_PAGE_SIZE)
    .all<RequestRow>();
  const { lines, select } = await requestList(c, reqs, true);
  const head = OFFICER_REQUESTS_COPY.head(p * OFFICER_PAGE_SIZE + 1, p * OFFICER_PAGE_SIZE + reqs.length, total);
  const nav = row([
    button(`${OFFICER_PAGE_PREFIX}${p - 1}`, '◀ Previous', STYLE_SECONDARY, p === 0),
    button(`${OFFICER_PAGE_PREFIX}${p + 1}`, 'Next ▶', STYLE_SECONDARY, p >= pages - 1),
  ]);
  return { content: [head, ...lines].join('\n').slice(0, 2000), components: [row([select]), ...(pages > 1 ? [nav] : [])] };
}

/** /officer requests: page 1 (the route re-checks the officer role). */
export async function officerRequests(c: Ctx): Promise<MessageReply> {
  if (!c.guild.request_channel_id) return ephemeral(NO_REQUEST_CHANNEL);
  const p = await officerPage(c, 0);
  return p ? ephemeral(p.content, { components: p.components }) : ephemeral(OFFICER_REQUESTS_COPY.none);
}

/** rqp:<page>: Previous / Next, edited in place; officers only, re-checked on every press. */
export async function officerRequestsPage(c: Ctx, customId: string): Promise<MessageReply> {
  if (!c.officer) return ephemeral(OFFICER_ONLY);
  if (!c.guild.request_channel_id) return updateMessage({ content: NO_REQUEST_CHANNEL, components: [] });
  const p = await officerPage(c, Number(customId.slice(OFFICER_PAGE_PREFIX.length)) || 0);
  return p ? updateMessage(p) : updateMessage({ content: OFFICER_REQUESTS_COPY.none, components: [] });
}

/** rql: the Cancel select on /craft requests: the requester's own request, or any for an officer. */
export async function cancelFromList(c: Ctx, values: string[]): Promise<MessageReply> {
  const loaded = await loadRequest(c.db, c.guild.id, Number(values[0]));
  if (!loaded || loaded.req.status !== 'open') return updateMessage({ content: 'That request is already closed.', components: [] });
  const { req } = loaded;
  if (req.requester !== c.userId && !c.officer) return updateMessage({ content: 'Only the requester or an officer can cancel a request.', components: [] });
  const res = await c.db.batch(closeStatements(c.db, req, 'cancelled', c.userId, 'request.cancel'));
  if (res[1].meta.changes !== 1) return updateMessage({ content: 'That request is already closed.', components: [] });
  const items = loaded.items.map((i) => (i.status === 'open' || i.status === 'claimed' ? { ...i, status: 'cancelled' as const } : i));
  const after: RequestRow = { ...req, status: 'closed', close_reason: 'cancelled' };
  // The other party: the requester (when an officer cancels) and whoever had taken an item.
  const ping = [...new Set([...(req.requester !== c.userId ? [req.requester] : []), ...loaded.items.filter((i) => i.status === 'claimed' && i.claimer !== c.userId).map((i) => i.claimer!)])];
  const api = apiFor(c);
  let rows = written(res);
  if (api) {
    const names = await namesOf(c.db, c.guild.id, involved(after, items));
    const s = await syncThread(api, after, items, names, { content: `${ping.length ? `${ping.map(mention).join(' ')}: ` : ''}This request was cancelled by ${mention(c.userId)}, so this thread is now closed.`, ping });
    if (syncChanged(after, s)) rows += written(await c.db.batch([syncWrite(c.db, after, s)]));
    logAction('cancel', rows, api, { errors: s.errors });
  } else logAction('cancel', rows, null);
  return updateMessage({ content: `Cancelled request #${req.id}${req.thread_id ? ` (<#${req.thread_id}>)` : ''}.`, components: [] });
}

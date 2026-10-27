// Item screenshots and the vault channel (order 9, ITEM 3; PRD FR-6 layer 2):
//   /item image item: image:  → re-uploaded to the guild's vault channel, pending, with Approve and Reject (officers);
//   Stat image on /craft find → the approved screenshot, with a freshly signed link.
// Order 24 (the owner, 2026-10-27, a named departure from PRD FR-6 layer 2): member screenshots are turned off, to keep
// setup to one step. Nothing is submitted any more and no card offers Stat image. What messages already sent still use
// keeps answering (order 18): Approve and Reject on an old vault message, and Stat image on an old card, which shows a
// screenshot already approved, or says screenshots are off.
//
// Links. Discord's attachment links are signed and expire ("Signed Attachment CDN URLs", docs.discord.com/developers/
// reference: "when your app receives a payload with a signed URL (like when you fetch a message), it will be valid").
// A fresh link comes from reading the vault message back (GET channel message, order 9 override 5). The link is cached
// with its expiry, the URL's `ex` parameter.
import { audit, now } from '../access.ts';
import { botApi, UNKNOWN_MESSAGE } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { ephemeral, md, truncate, updateMessage, type MessageReply } from '../discord.ts';
import { OFFICER_ONLY } from './members.ts';

/** A cached link is reused only while it has this long left. */
const URL_MARGIN_MS = 10 * 60_000;
export const APPROVE_PREFIX = 'ima:';
export const REJECT_PREFIX = 'imr:';

/** Order 24: the answer wherever a screenshot would have been sent or shown. */
export const SCREENSHOTS_OFF = 'Item screenshots are turned off on GuildCraft. Item cards show the wiki\'s own icon.';

/** A signed link's expiry: its `ex` parameter, a hex Unix timestamp in seconds. null when absent. */
export function linkExpiry(url: string): string | null {
  try {
    const ex = new URL(url).searchParams.get('ex');
    return ex && /^[0-9a-f]+$/i.test(ex) ? new Date(parseInt(ex, 16) * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

interface ImageRow {
  id: number;
  item: string;
  status: string;
  vault_channel_id: string | null;
  vault_message_id: string | null;
  attachment_id: string | null;
  cached_url: string | null;
  cached_url_expires_at: string | null;
}

const IMAGE_COLS = 'm.id, i.name AS item, m.status, m.vault_channel_id, m.vault_message_id, m.attachment_id, m.cached_url, m.cached_url_expires_at';

/** ima:<id> / imr:<id> on an old vault message. Approve edits it (who approved, buttons gone); Reject deletes it. */
export async function imageButton(c: Ctx, customId: string): Promise<MessageReply> {
  if (!c.officer) return ephemeral(OFFICER_ONLY);
  const approve = customId.startsWith(APPROVE_PREFIX);
  const id = Number(customId.slice((approve ? APPROVE_PREFIX : REJECT_PREFIX).length));
  const [upd, read] = await c.db.batch([
    c.db.prepare("UPDATE item_image SET status = ?, reviewed_by = ? WHERE id = ? AND guild_id = ? AND status = 'pending'").bind(approve ? 'approved' : 'rejected', c.userId, id, c.guild.id),
    c.db.prepare(`SELECT ${IMAGE_COLS} FROM item_image m JOIN item i ON i.id = m.item_id WHERE m.id = ? AND m.guild_id = ?`).bind(id, c.guild.id),
  ]);
  const img = (read.results as ImageRow[])[0];
  if (!img) return ephemeral('That screenshot is no longer recorded.');
  if (!upd.meta.changes) return ephemeral(`That screenshot was already ${img.status}.`);
  // Audited only when the press changed something (order 9 review).
  await audit(c.db, c.guild.id, c.userId, approve ? 'image.approve' : 'image.reject', `image:${id}`, null, null).run();
  if (approve)
    return updateMessage({ content: `Screenshot of **${md(img.item)}** · approved by <@${c.userId}> · <t:${Math.floor(Date.now() / 1000)}:f>`, components: [] });
  // Rejected images are not kept: the bot deletes its own vault message (no Manage Messages needed for its own).
  if (c.botToken && img.vault_channel_id && img.vault_message_id) {
    const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: 2, deadline: Date.now() + 10_000 });
    const del = await api.call('DELETE', `/channels/${img.vault_channel_id}/messages/${img.vault_message_id}`);
    if (!del.ok && del.code !== UNKNOWN_MESSAGE) return ephemeral("Rejected, but I couldn't delete the vault message; please delete it by hand.");
  }
  return ephemeral(`Rejected the screenshot of **${md(img.item)}** and deleted it from the vault.`);
}

/**
 * img:<item id>, Stat image on a card sent before order 24: the newest approved screenshot, privately. A cached link is
 * reused while it has URL_MARGIN_MS left; otherwise the vault message is read back for a freshly signed one (one GET, one
 * write). A vault message deleted by hand marks the row gone. With none, the reply says screenshots are off.
 */
export async function statImage(c: Ctx, itemId: number): Promise<MessageReply> {
  // The newest two approved images: when the newest's vault message is gone, the one before it is tried (order 9 review).
  const { results: imgs } = await c.db
    .prepare(`SELECT ${IMAGE_COLS} FROM item_image m JOIN item i ON i.id = m.item_id WHERE m.guild_id = ? AND m.item_id = ? AND m.status = 'approved' AND m.gone_at IS NULL ORDER BY m.id DESC LIMIT 2`)
    .bind(c.guild.id, itemId)
    .all<ImageRow>();
  const show = (img: ImageRow, url: string) => ephemeral('', { embeds: [{ title: truncate(img.item, 256), image: { url }, footer: { text: 'Screenshot from a guild member, approved by an officer' } }] });
  const api = c.botToken ? botApi(c.botToken, { d1: () => 0, discord: 0, cap: 2, deadline: Date.now() + 10_000 }) : null;
  for (const img of imgs) {
    if (img.cached_url && img.cached_url_expires_at && Date.parse(img.cached_url_expires_at) - Date.now() > URL_MARGIN_MS) return show(img, img.cached_url);
    if (!api || !img.vault_channel_id || !img.vault_message_id) continue;
    const msg = await api.call<{ attachments?: { id: string; url: string }[] }>('GET', `/channels/${img.vault_channel_id}/messages/${img.vault_message_id}`);
    const a = msg.ok ? msg.body.attachments?.find((x) => x.id === img.attachment_id) : undefined;
    if (msg.ok && a) {
      await c.db.prepare('UPDATE item_image SET cached_url = ?, cached_url_expires_at = ? WHERE id = ?').bind(a.url, linkExpiry(a.url), img.id).run();
      return show(img, a.url);
    }
    if (!msg.ok && msg.code !== UNKNOWN_MESSAGE) return ephemeral("Sorry, I couldn't fetch the screenshot from Discord just now. Please try again in a moment.");
    await c.db.prepare('UPDATE item_image SET gone_at = ? WHERE id = ?').bind(now(), img.id).run();
  }
  return ephemeral(SCREENSHOTS_OFF);
}

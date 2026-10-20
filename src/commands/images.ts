// Item screenshots and the vault channel (order 9, ITEM 3; PRD FR-6 layer 2):
//   /item image item: image:  → re-uploaded to the guild's vault channel, pending, with Approve and Reject (officers);
//   Stat image on /craft find → the approved screenshot, with a freshly signed link.
//
// Links. Discord's attachment links are signed and expire ("Signed Attachment CDN URLs", docs.discord.com/developers/
// reference: "when your app receives a payload with a signed URL (like when you fetch a message), it will be valid").
// So the member's own attachment link is never stored or re-posted: the bytes are uploaded again to the vault (a
// multipart Create Message), and a fresh link comes from reading the vault message back (GET channel message, order 9
// override 5; the refresh-urls endpoint is not used). The link is cached with its expiry, the URL's `ex` parameter.
//
// The file passes through as a Blob: no copy into JavaScript memory except its first 12 bytes, which are checked
// against the PNG, JPEG and WebP signatures (the attachment's content_type is the client's claim, not checked here).
// DRAFT copy throughout: Brian approves it before launch.
import { audit, now } from '../access.ts';
import { botApi, UNKNOWN_MESSAGE } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, optString, row, STYLE_DANGER, truncate, updateMessage, type MessageReply, type Option } from '../discord.ts';
import { DISCORD_API } from '../respond.ts';
import { OFFICER_ONLY } from './members.ts';

/**
 * The largest screenshot accepted: 8 MiB, under Discord's default upload limit of 20 MiB per file ("Uploading Files",
 * docs.discord.com/developers/reference). An item window screenshot is typically well under 2 MB.
 */
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Pending screenshots per member, in all and per item (order 9, ITEM 3). */
export const MAX_PENDING = 5;
export const MAX_PENDING_PER_ITEM = 1;
/** A cached link is reused only while it has this long left. */
const URL_MARGIN_MS = 10 * 60_000;
export const APPROVE_PREFIX = 'ima:';
export const REJECT_PREFIX = 'imr:';

/** The file type from its first bytes (PNG, JPEG, WebP), or null. */
export function imageType(head: Uint8Array): { mime: string; ext: string } | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, j) => head[i + j] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (at(0, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return { mime: 'image/webp', ext: 'webp' };
  return null;
}

/** A signed link's expiry: its `ex` parameter, a hex Unix timestamp in seconds. null when absent. */
export function linkExpiry(url: string): string | null {
  try {
    const ex = new URL(url).searchParams.get('ex');
    return ex && /^[0-9a-f]+$/i.test(ex) ? new Date(parseInt(ex, 16) * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

const vaultButtons = (id: number) => [row([button(`${APPROVE_PREFIX}${id}`, 'Approve', 3), button(`${REJECT_PREFIX}${id}`, 'Reject', STYLE_DANGER)])];

/** Download plus upload stay well inside the deferred work's 30 seconds (order 9 review). */
const DOWNLOAD_TIMEOUT_MS = 8_000;
const UPLOAD_TIMEOUT_MS = 12_000;

const NO_VAULT ='Screenshots need a vault channel first: a server admin runs `/guildcraft setup vault:` with a private channel for officers. Nothing was saved.';

/** One multipart Create Message (docs: "Uploading Files": payload_json plus files[0]). The Blob is passed, not read. */
async function uploadToVault(token: string, channelId: string, payload: unknown, file: Blob, filename: string) {
  const form = new FormData();
  form.append('payload_json', JSON.stringify(payload));
  form.append('files[0]', file, filename);
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'User-Agent': 'DiscordBot (mnm-guildcraft, 1)' },
    body: form,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => null)) as { id?: string; attachments?: { id: string; url: string }[]; code?: number; message?: string } | null;
  return { ok: res.ok, status: res.status, body };
}

/** Whether Discord says the vault message no longer exists (Unknown Message). Any other answer: not gone. */
async function vaultMessageGone(c: Ctx, channelId: string, messageId: string): Promise<boolean> {
  if (!c.botToken) return false;
  const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: 1, deadline: Date.now() + 5_000 });
  const r = await api.call('GET', `/channels/${channelId}/messages/${messageId}`);
  return !r.ok && r.code === UNKNOWN_MESSAGE;
}

export async function itemImage(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const started = Date.now();
  const vault = c.guild.vault_channel_id;
  if (!vault || !c.botToken) return ephemeral(NO_VAULT);
  const typed = (optString(opts, 'item') ?? '').trim();
  const att = c.resolved?.attachments?.[optString(opts, 'image') ?? ''];
  if (!att) return ephemeral('Attach the screenshot in the `image:` box. Nothing was saved.');
  if (att.size > IMAGE_MAX_BYTES) return ephemeral(`That file is ${(att.size / 1048576).toFixed(1)} MB; the limit is ${IMAGE_MAX_BYTES / 1048576} MB. A cropped screenshot of the item window is plenty.`);
  const [itemRes, pendingRes] = await c.db.batch([
    c.db.prepare('SELECT id, name FROM item WHERE name_key = ?').bind(typed.toLowerCase()),
    // Only rows that reached the vault count: a failed upload is marked rejected and never blocks the member.
    c.db
      .prepare("SELECT id, item_id, vault_channel_id, vault_message_id FROM item_image WHERE guild_id = ? AND submitted_by = ? AND status = 'pending' AND gone_at IS NULL AND vault_message_id IS NOT NULL")
      .bind(c.guild.id, c.userId),
  ]);
  const item = (itemRes.results as { id: number; name: string }[])[0];
  if (!item) return ephemeral(`I don't know an item called **${md(typed || '(nothing)')}**. Pick one from the list as you type.`);
  let pending = pendingRes.results as { id: number; item_id: number; vault_channel_id: string; vault_message_id: string }[];
  const same = pending.find((p) => p.item_id === item.id);
  // A pending vault message an officer deleted by hand (instead of Reject) must not block the member for good.
  if (same && (await vaultMessageGone(c, same.vault_channel_id, same.vault_message_id))) {
    await c.db.prepare('UPDATE item_image SET gone_at = ? WHERE id = ?').bind(now(), same.id).run();
    pending = pending.filter((p) => p.id !== same.id);
  }
  if (pending.filter((p) => p.item_id === item.id).length >= MAX_PENDING_PER_ITEM)
    return ephemeral(`Your screenshot of **${md(item.name)}** is still waiting for an officer. You can send another once it is approved or rejected.`);
  if (pending.length >= MAX_PENDING) return ephemeral(`You have ${MAX_PENDING} screenshots waiting for an officer. You can send more once some are reviewed.`);

  const download = await fetch(att.url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) }).catch(() => null);
  if (!download?.ok) return ephemeral("Sorry, I couldn't read that attachment from Discord. Please try again.");
  const blob = await download.blob();
  if (blob.size > IMAGE_MAX_BYTES) return ephemeral(`That file is over the ${IMAGE_MAX_BYTES / 1048576} MB limit.`);
  const type = imageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (!type) return ephemeral('That file is not a PNG, JPEG or WebP image. Nothing was saved.');

  const createdAt = now();
  const inserted = await c.db
    .prepare("INSERT INTO item_image (guild_id, item_id, vault_channel_id, submitted_by, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id")
    .bind(c.guild.id, item.id, vault, c.userId, createdAt)
    .first<{ id: number }>();
  const id = inserted!.id;
  const filename = `item-${item.id}-${id}.${type.ext}`;
  // A throw (timeout, network) counts as a refusal: the row is marked failed, never left pending.
  const sent = await uploadToVault(c.botToken, vault, {
    content: `Screenshot of **${md(item.name)}** from <@${c.userId}> · waiting for an officer`,
    components: vaultButtons(id),
    attachments: [{ id: 0, filename }],
    allowed_mentions: { parse: [] },
  }, blob.slice(0, blob.size, type.mime), filename).catch(() => ({ ok: false, status: 0, body: null }));
  const a = sent.body?.attachments?.[0];
  // Read by Cowork from the logs with the invocation's own cpuTimeMs (Workers Logs), order 10.
  console.log(JSON.stringify({ gc: 'image-upload', bytes: blob.size, type: type.ext, status: sent.status, ms: Date.now() - started }));
  if (!sent.ok || !sent.body?.id || !a) {
    await c.db.prepare("UPDATE item_image SET status = 'rejected', reviewed_by = 'upload-failed' WHERE id = ?").bind(id).run();
    const why = sent.status === 403 ? ' I may have lost a permission in the vault channel: an admin can run `/guildcraft setup vault:` again to check.' : '';
    return ephemeral(`Sorry, I couldn't post that screenshot to the vault.${why} Nothing is waiting for review.`);
  }
  await c.db.batch([
    c.db
      .prepare('UPDATE item_image SET vault_message_id = ?, attachment_id = ?, cached_url = ?, cached_url_expires_at = ? WHERE id = ?')
      .bind(sent.body.id, a.id, a.url, linkExpiry(a.url), id),
    audit(c.db, c.guild.id, c.userId, 'image.submit', `item:${item.id}`, null, { image: id }),
  ]);
  return ephemeral(`Thanks: your screenshot of **${md(item.name)}** is waiting for an officer to approve it. Once approved, it shows under **Stat image** on \`/craft find\`.`);
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

/** ima:<id> / imr:<id> on the vault message. Approve edits it (who approved, buttons gone); Reject deletes it. */
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
    if (!del.ok && del.code !== UNKNOWN_MESSAGE) return ephemeral(`Rejected, but I couldn't delete the vault message (HTTP ${del.status}); you can delete it by hand.`);
  }
  return ephemeral(`Rejected the screenshot of **${md(img.item)}** and deleted it from the vault.`);
}

/**
 * img:<item id>, Stat image on /craft find: the newest approved screenshot, privately. A cached link is reused while
 * it has URL_MARGIN_MS left; otherwise the vault message is read back for a freshly signed one (one GET, one write).
 * A vault message deleted by hand marks the row gone, and the reply says no screenshot exists: never a broken image.
 */
export async function statImage(c: Ctx, itemId: number): Promise<MessageReply> {
  // The newest two approved images: when the newest's vault message is gone, the one before it is tried (order 9 review).
  const { results: imgs } = await c.db
    .prepare(`SELECT ${IMAGE_COLS} FROM item_image m JOIN item i ON i.id = m.item_id WHERE m.guild_id = ? AND m.item_id = ? AND m.status = 'approved' AND m.gone_at IS NULL ORDER BY m.id DESC LIMIT 2`)
    .bind(c.guild.id, itemId)
    .all<ImageRow>();
  const none = async () => {
    const item = await c.db.prepare('SELECT name FROM item WHERE id = ?').bind(itemId).first<{ name: string }>();
    return ephemeral(`No screenshot of **${md(item?.name ?? 'this item')}** yet. Have one? Send it with \`/item image\`: an officer approves it, then it shows here.`);
  };
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
  return none();
}

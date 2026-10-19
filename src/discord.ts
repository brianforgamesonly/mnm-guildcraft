// Discord interaction shapes and reply helpers (the subset this Worker reads and sends).
import { InteractionResponseFlags, InteractionResponseType } from 'discord-interactions';

export interface User {
  id: string;
  username: string;
  global_name?: string | null;
}

export interface GuildMember {
  user: User;
  nick?: string | null;
  roles: string[];
  /** The caller's resolved permissions in the channel, as a string bitfield. */
  permissions: string;
}

export interface Option {
  type: number;
  name: string;
  value?: string | number | boolean;
  focused?: boolean;
  options?: Option[];
}

/** A modal-submit component: a Label wrapping one input, or a legacy action row of inputs. */
export interface ModalComponent {
  type: number;
  custom_id?: string;
  value?: string;
  component?: ModalComponent;
  components?: ModalComponent[];
}

/** A channel in an interaction's resolved data: Discord adds the invoker's and the app's permissions there. */
export interface ResolvedChannel {
  id: string;
  name?: string;
  type: number;
  permissions?: string;
  app_permissions?: string;
}

export interface Resolved {
  channels?: Record<string, ResolvedChannel>;
}

export interface Interaction {
  type: number;
  /** Both present on every interaction Discord sends; the deferred path edits the reply with them. */
  application_id?: string;
  token?: string;
  guild_id?: string;
  member?: GuildMember;
  user?: User;
  data?: {
    name?: string;
    options?: Option[];
    custom_id?: string;
    component_type?: number;
    values?: string[];
    components?: ModalComponent[];
    resolved?: Resolved;
  };
}

export interface EmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface Embed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  thumbnail?: { url: string };
  fields?: EmbedField[];
  footer?: { text: string };
}

// Discord embed limits (https://docs.discord.com/developers/resources/message#embed-object-embed-limits).
export const EMBED_LIMITS = { total: 6000, title: 256, description: 4096, fields: 25, fieldName: 256, fieldValue: 1024, footer: 2048, embeds: 10 } as const;

/** Characters Discord counts toward the 6,000 total across a message's embeds. */
export const embedChars = (embeds: Embed[]): number =>
  embeds.reduce(
    (n, e) => n + (e.title?.length ?? 0) + (e.description?.length ?? 0) + (e.footer?.text.length ?? 0) + (e.fields ?? []).reduce((m, f) => m + f.name.length + f.value.length, 0),
    0,
  );

// Message components (https://docs.discord.com/developers/components/reference).
export const BUTTON = 2;
export const STYLE_PRIMARY = 1;
export const STYLE_SECONDARY = 2;
export const STYLE_LINK = 5;
export const button = (custom_id: string, label: string, style = STYLE_SECONDARY, disabled = false) => ({ type: BUTTON, style, label, custom_id, ...(disabled ? { disabled } : {}) });
export const linkButton = (label: string, url: string) => ({ type: BUTTON, style: STYLE_LINK, label, url });
export const row = (components: unknown[]) => ({ type: 1, components });

export interface MessageData {
  content?: string;
  embeds?: Embed[];
  components?: unknown[];
  flags?: number;
  allowed_mentions?: { parse: string[] };
}

export type InteractionReply =
  | { type: InteractionResponseType.PONG }
  | { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE; data: MessageData }
  | { type: InteractionResponseType.UPDATE_MESSAGE; data: MessageData }
  | { type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT; data: { choices: Choice[] } }
  | { type: InteractionResponseType.MODAL; data: { custom_id: string; title: string; components: unknown[] } };

export interface Choice {
  name: string;
  value: string;
}

/**
 * A reply that is a message: a new one (4) or an edit of the component's message (7). Every handler on
 * the deferred path (src/respond.ts) returns this type, so the type checker keeps modals and
 * autocomplete results, which cannot be deferred, off that path (order 4, ITEM 1.2).
 */
export type MessageReply = Extract<InteractionReply, { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE | InteractionResponseType.UPDATE_MESSAGE }>;

/**
 * Empty content is left out rather than sent as "". Order 4: /roster skill was the only reply that sent "",
 * and the only command reported failing live; that this was the cause is unverified.
 */
const withContent = (content: string | undefined) => (content ? { content } : {});

/** A private reply. Mentions in it never ping anyone. */
export function ephemeral(content: string, extra: Omit<MessageData, 'content' | 'flags'> = {}): MessageReply {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { ...withContent(content), ...extra, flags: InteractionResponseFlags.EPHEMERAL, allowed_mentions: { parse: [] } },
  };
}

/** A message everyone in the channel sees (Post to channel). Mentions in it never ping anyone. */
export function publicReply(data: Omit<MessageData, 'flags'>): MessageReply {
  const { content, ...rest } = data;
  return { type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { ...withContent(content), ...rest, allowed_mentions: { parse: [] } } };
}

/** Edits the message a button or select belongs to (paging). */
export function updateMessage(data: Omit<MessageData, 'flags'>): MessageReply {
  return { type: InteractionResponseType.UPDATE_MESSAGE, data: { ...data, allowed_mentions: { parse: [] } } };
}

export const choices = (list: Choice[]): InteractionReply => ({
  type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT,
  data: { choices: list },
});

/** The subcommand and its options, for a command registered as name → subcommand. */
export function subcommand(i: Interaction): { name: string | undefined; options: Option[] } {
  const sub = i.data?.options?.[0];
  return { name: sub?.name, options: sub?.options ?? [] };
}

export const optString = (opts: Option[], name: string): string | undefined => {
  const v = opts.find((o) => o.name === name)?.value;
  return typeof v === 'string' ? v : v === undefined ? undefined : String(v);
};
export const optInt = (opts: Option[], name: string): number | undefined => {
  const v = opts.find((o) => o.name === name)?.value;
  return typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+$/.test(v) ? Number(v) : undefined;
};
export const optBool = (opts: Option[], name: string): boolean | undefined => {
  const v = opts.find((o) => o.name === name)?.value;
  return typeof v === 'boolean' ? v : undefined;
};
export const focused = (opts: Option[]): Option | undefined => opts.find((o) => o.focused);

// Permission bits (https://docs.discord.com/developers/topics/permissions).
export const ADMINISTRATOR = 1n << 3n;
export const MANAGE_GUILD = 1n << 5n;
export const VIEW_CHANNEL = 1n << 10n;
/** In a forum channel this is "Create Posts" (CREATE_PUBLIC_THREADS is ignored there). */
export const SEND_MESSAGES = 1n << 11n;
export const EMBED_LINKS = 1n << 14n;
export const READ_MESSAGE_HISTORY = 1n << 16n;
export const MANAGE_THREADS = 1n << 34n;
export const SEND_MESSAGES_IN_THREADS = 1n << 38n;
/** Channel type GUILD_FORUM. */
export const GUILD_FORUM = 15;

export function hasPermission(bitfield: string | undefined, bit: bigint): boolean {
  if (!bitfield || !/^\d+$/.test(bitfield)) return false;
  return (BigInt(bitfield) & bit) === bit;
}

/** Escapes Discord markdown in member-typed text shown back in a reply. */
export const md = (s: string): string => s.replace(/([\\*_~`|>\[\]])/g, '\\$1');

/** Up to 25 matches: prefix matches first, then substring matches, each in list order (case-insensitive). */
export function matchChoices(names: string[], typed: string, max = 25): string[] {
  const q = typed.trim().toLowerCase();
  if (!q) return names.slice(0, max);
  const prefix = names.filter((n) => n.toLowerCase().startsWith(q));
  const inner = names.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q));
  return [...prefix, ...inner].slice(0, max);
}

export const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

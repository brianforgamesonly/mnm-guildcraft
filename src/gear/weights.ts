// Order 36, PR B (ITEM 4; docs/PRD.md "Gear upgrades", officer weights): /gear weights. (/gear settings, the window, was
// retired by the owner on 2026-11-06 with the window itself: /gear upgrades has no cap unless max_level: is given.)
//
// - Officers only, checked when the command runs (src/interactions.ts ROUTES access 'officer'); both commands are visible to
//   everyone in Discord's list (no default_member_permissions on /gear).
// - Defaults live in code (src/gear/score.ts). Only a server's differences are stored (migrations/0031): a preset is
//   expanded when applied and only its differences from the default are kept; a stat set back to its default, and a reset,
//   delete rows. Defaults off the 0.05 step (0.03, 0.08) come back only by reset.
// - /gear weights takes exactly four shapes: class: (view), class: preset:, class: stat: value:, class: reset:True. Any other
//   combination is refused.
// - Every change is written with its audit row, then posted in the review channel: who, the class, the old and new values
//   (order 36's override 4 of order 5's rule, as order 7 extended it). The post pings nobody (order 16's memberTag).
import { audit, now } from '../access.ts';
import { botApi } from '../board/api.ts';
import type { Ctx } from '../context.ts';
import { ephemeral, md, memberTag, optBool, optInt, optString, truncate, type Embed, type MessageReply, type Option } from '../discord.ts';
import {
  applyRows, CLASSES, classKey, className, defaultWeights, fmtWeight, PRESETS, presetWeights, WEIGHT_KEYS, WEIGHT_LABEL, WEIGHT_ROWS_SQL,
  type Preset, type WeightKey, type WeightRow, type Weights,
} from './score.ts';

export const VALUE_MAX = 200;
export const VALUE_STEP = 5;

// ---------------------------------------------------------------- copy (order 36; listed for approval in docs/COPY.md)

/** What became of a change's review-channel post (review fix: a refused post is not "no channel set"). */
export type PostResult = 'posted' | 'unset' | 'refused';
const POSTED: Record<PostResult, string> = {
  posted: ' The review channel has the change.',
  unset: ' No review channel is set, so nothing was posted.',
  refused: " The review channel didn't accept the post (check GuildCraft can send messages there); the change is saved.",
};

export const WEIGHTS_COPY = {
  title: (cls: string) => `${cls} weights`,
  about: (preset: Preset, priority: string) => `Default preset: **${preset}** · priority: ${priority || 'none'}. Used by \`/gear upgrades\` in this server.`,
  isDefault: 'default',
  changed: (who: string, at: string) => `changed by ${who}, <t:${Math.floor(Date.parse(at) / 1000)}:d>`,
  defaultWas: (d: string) => `(default ${d})`,
  footer: 'Only changes are stored; reset: True returns the defaults.',
  shapes: 'Use one of: `class:` alone (show), `class: preset:`, `class: stat: value:`, or `class: reset: True`.',
  unknownClass: (code: string) => `**${md(code)}** isn't a class in the data. Pick one from the list.`,
  unknownStat: 'Pick a stat from the list.',
  range: `A weight is from 0 to 2.`,
  step: 'A weight goes in steps of 0.05 (0, 0.05, 0.1 … 2).',
  noChange: (cls: string) => `${cls}'s weights already are that. Nothing changed.`,
  saved: (cls: string, post: PostResult) => `${cls}'s weights changed.${POSTED[post]}`,
  postHead: (who: string, cls: string, what: string) => `**/gear upgrades weights:** ${who} ${what} for **${cls}**.`,
  setWhat: (stat: string) => `set ${stat}`,
  presetWhat: (p: Preset) => `applied the ${p} preset`,
  resetWhat: 'reset to the defaults',
  change: (stat: string, from: string, to: string) => `${stat}: ${from} → ${to}`,
} as const;

const display = (c: Ctx) => c.member.nick ?? c.member.user.global_name ?? c.member.user.username;
const who = (c: Ctx) => memberTag(c.userId, display(c));
/** A setter as a mention with their saved name beside it (order 16), or the mention alone when no name is saved. */
const setter = (id: string, name: string | null) => (name ? memberTag(id, name) : `<@${id}>`);

/** Posts one line in the review channel (pings nobody), after the change is written. */
async function postReview(c: Ctx, content: string): Promise<PostResult> {
  if (!c.guild.review_channel_id || !c.botToken) return 'unset';
  const api = botApi(c.botToken, { d1: () => 0, discord: 0, cap: 2, deadline: Date.now() + 10_000 });
  const sent = await api.call('POST', `/channels/${c.guild.review_channel_id}/messages`, { content: truncate(content, 2000), allowed_mentions: { parse: [] } });
  c.effects.discordCalls = (c.effects.discordCalls ?? 0) + 1;
  if (!sent.ok) console.error('gear weights post refused', JSON.stringify(api.log));
  return sent.ok ? 'posted' : 'refused';
}

// ---------------------------------------------------------------- /gear weights

/** The class the option names: in the table, or a game_class code the data keeps. Null: not a class. */
async function classOf(c: Ctx, typed: string | undefined): Promise<string | null> {
  const code = classKey(typed);
  if (!code) return null;
  if (CLASSES[code]) return code;
  return (await c.db.prepare('SELECT 1 FROM game_class WHERE code = ? AND item_count > 0').bind(code).first()) ? code : null;
}

/** The value as hundredths, or why not: 0 to 2, in steps of 0.05. */
export function hundredths(value: number): number | string {
  const h = Math.round(value * 100);
  if (h < 0 || h > VALUE_MAX) return WEIGHTS_COPY.range;
  if (Math.abs(value * 100 - h) > 1e-6 || h % VALUE_STEP !== 0) return WEIGHTS_COPY.step;
  return h;
}

/** What /gear weights was asked: one of the four shapes, or null (refused). */
export function shapeOf(opts: Option[]): { kind: 'view' } | { kind: 'preset'; preset: Preset } | { kind: 'set'; stat: string; value: number } | { kind: 'reset' } | null {
  const has = (n: string) => opts.some((o) => o.name === n);
  const others = opts.filter((o) => !['class', 'preset', 'stat', 'value', 'reset'].includes(o.name));
  if (others.length) return null;
  const preset = optString(opts, 'preset');
  const stat = optString(opts, 'stat');
  const value = opts.find((o) => o.name === 'value')?.value;
  const reset = optBool(opts, 'reset');
  const n = ['preset', 'stat', 'value', 'reset'].filter(has).length;
  if (n === 0) return { kind: 'view' };
  if (n === 1 && preset !== undefined && (PRESETS as readonly string[]).includes(preset)) return { kind: 'preset', preset: preset as Preset };
  if (n === 2 && stat !== undefined && typeof value === 'number') return { kind: 'set', stat, value };
  if (n === 1 && reset === true) return { kind: 'reset' };
  return null;
}

const rowsFor = async (c: Ctx, code: string) => (await c.db.prepare(WEIGHT_ROWS_SQL).bind(c.guild.id, code).all<WeightRow>()).results;

/** The weights view: one embed, 22 fields (the limit is 25): each value, default or changed (by whom, when). */
export function weightsEmbed(code: string, rows: WeightRow[]): Embed {
  const w = applyRows(code, rows);
  const d = defaultWeights(code);
  const k = CLASSES[code];
  return {
    title: WEIGHTS_COPY.title(className(code)),
    description: WEIGHTS_COPY.about(k?.preset ?? 'Melee', k?.priority ?? ''),
    fields: WEIGHT_KEYS.map((key) => {
      const r = rows.find((x) => x.stat === key);
      return {
        name: WEIGHT_LABEL[key],
        value: r ? `**${fmtWeight(w[key])}** ${WEIGHTS_COPY.defaultWas(fmtWeight(d[key]))} · ${WEIGHTS_COPY.changed(setter(r.set_by, r.by_name), r.set_at)}` : `${fmtWeight(w[key])} · ${WEIGHTS_COPY.isDefault}`,
        inline: true,
      };
    }),
    footer: { text: WEIGHTS_COPY.footer },
  };
}

/** The statements that make the class's stored rows hold exactly `target`'s differences from the default. */
function storeStatements(c: Ctx, code: string, target: Weights, before: Weights, at: string): D1PreparedStatement[] {
  const d = defaultWeights(code);
  const out: D1PreparedStatement[] = [];
  for (const k of WEIGHT_KEYS) {
    if (target[k] === before[k]) continue;
    if (target[k] === d[k]) out.push(c.db.prepare('DELETE FROM gear_weight WHERE guild_id = ? AND class = ? AND stat = ?').bind(c.guild.id, code, k));
    else
      out.push(
        c.db
          .prepare('INSERT INTO gear_weight (guild_id, class, stat, value, set_at, set_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (guild_id, class, stat) DO UPDATE SET value = ?4, set_at = ?5, set_by = ?6')
          .bind(c.guild.id, code, k, target[k], at, c.userId),
      );
  }
  return out;
}

/** A preset or a reset: every row of the class goes, then one row per stat where `target` differs from the default. */
function rewriteStatements(c: Ctx, code: string, target: Weights, at: string): D1PreparedStatement[] {
  const d = defaultWeights(code);
  return [
    c.db.prepare('DELETE FROM gear_weight WHERE guild_id = ? AND class = ?').bind(c.guild.id, code),
    ...WEIGHT_KEYS.filter((k) => target[k] !== d[k]).map((k) =>
      c.db.prepare('INSERT INTO gear_weight (guild_id, class, stat, value, set_at, set_by) VALUES (?, ?, ?, ?, ?, ?)').bind(c.guild.id, code, k, target[k], at, c.userId),
    ),
  ];
}

/** /gear weights class: [preset: | stat: value: | reset: True] (officers). */
export async function gearWeights(c: Ctx, opts: Option[]): Promise<MessageReply> {
  const shape = shapeOf(opts);
  if (!shape) return ephemeral(WEIGHTS_COPY.shapes);
  const typed = optString(opts, 'class');
  const code = await classOf(c, typed);
  if (!code) return ephemeral(WEIGHTS_COPY.unknownClass(typed ?? ''));
  const rows = await rowsFor(c, code);
  if (shape.kind === 'view') return ephemeral('', { embeds: [weightsEmbed(code, rows)] });
  const before = applyRows(code, rows);
  let target: Weights;
  let what: string;
  if (shape.kind === 'preset') {
    // The preset's values with the class's default priorities (the attributes keep their places).
    target = presetWeights(shape.preset, CLASSES[code]?.priority ?? '');
    what = WEIGHTS_COPY.presetWhat(shape.preset);
  } else if (shape.kind === 'reset') {
    target = defaultWeights(code);
    what = WEIGHTS_COPY.resetWhat;
  } else {
    if (!(WEIGHT_KEYS as readonly string[]).includes(shape.stat)) return ephemeral(WEIGHTS_COPY.unknownStat);
    const h = hundredths(shape.value);
    if (typeof h === 'string') return ephemeral(h);
    target = { ...before, [shape.stat]: h };
    what = WEIGHTS_COPY.setWhat(WEIGHT_LABEL[shape.stat as WeightKey]);
  }
  const changes = WEIGHT_KEYS.filter((k) => target[k] !== before[k]);
  const cls = className(code);
  // Review fix: a preset or a reset rewrites the class's rows whole (delete them all, then insert the target's differences
  // from the default), so no row survives that a snapshot missed: one another officer just wrote, one for a stat no longer
  // in WEIGHT_KEYS, or one whose value the code's default has since become.
  const whole = shape.kind !== 'set';
  const d = defaultWeights(code);
  const wanted = WEIGHT_KEYS.filter((k) => target[k] !== d[k]);
  const exact = rows.length === wanted.length && rows.every((r) => wanted.includes(r.stat as WeightKey) && Number(r.value) === target[r.stat as WeightKey]);
  if (!changes.length && (!whole || exact)) return ephemeral(WEIGHTS_COPY.noChange(cls), { embeds: [weightsEmbed(code, rows)] });
  const at = now();
  const diff = Object.fromEntries(changes.map((k) => [k, { from: before[k], to: target[k] }]));
  const writes = whole ? rewriteStatements(c, code, target, at) : storeStatements(c, code, target, before, at);
  await c.db.batch([...writes, audit(c.db, c.guild.id, c.userId, 'gear.weights', `class:${code}`, { kind: shape.kind }, diff)]);
  const lines = changes.map((k) => WEIGHTS_COPY.change(WEIGHT_LABEL[k], fmtWeight(before[k]), fmtWeight(target[k])));
  const posted = await postReview(c, [WEIGHTS_COPY.postHead(who(c), cls, what), ...lines].join('\n'));
  return ephemeral(WEIGHTS_COPY.saved(cls, posted), { embeds: [weightsEmbed(code, await rowsFor(c, code))] });
}

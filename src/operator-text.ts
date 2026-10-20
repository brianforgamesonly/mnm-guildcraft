// Operator-only text, by type (order 12, ITEM 3; ORDER-RULES order 11: copy markers, token and job internals, raw
// errors, dry runs and platform usage never reach a guild's channels or a production reply).
//
// A guild-facing reply or post is built as lines of segments: plain strings (what guilds see) and OperatorText (what
// only the operator sees). render() is the one place either becomes a string: the dev copy shows every segment, any
// other copy (production, GUILDCRAFT_COPY unset included; src/copy.ts isDevCopy decides) drops each OperatorText
// segment, and drops a line that held nothing else.
//
// The guard:
//   compile time: OperatorText is typed as a branded symbol, so `${x}` (TS2731), x + '' (TS2469), assigning it to a
//                 string, passing it where a string is expected and calling string methods on it are all type errors
//                 (test/fixtures/operator-text-misuse.ts, checked by scripts/ci/operator-text.test.ts);
//   run time:     the value is an object whose every string conversion throws, which covers the conversions whose
//                 parameter is `any` and so escape the types (String(x), [x].join(), JSON.stringify(x)).
import { isDevCopy } from './copy.ts';

declare const operatorOnly: unique symbol;
/** Text only the operator sees. Created with operatorText() at its source; read only by render() in the dev copy. */
export type OperatorText = symbol & { readonly [operatorOnly]: true };

/** A piece of a line: guild-facing text, or operator-only text. */
export type Segment = string | OperatorText;
/** One line of a reply: a single segment, or segments joined with nothing between them. */
export type Line = Segment | readonly Segment[];

const LEAK = 'OperatorText turned into a string outside render() (src/operator-text.ts)';
const held = new WeakMap<object, string>();
const refuse = (): never => {
  throw new TypeError(LEAK);
};

export function operatorText(text: string): OperatorText {
  const box = Object.freeze({ [Symbol.toPrimitive]: refuse, toString: refuse, valueOf: refuse, toJSON: refuse });
  held.set(box, text);
  return box as unknown as OperatorText;
}

const isOperatorText = (s: Segment): s is OperatorText => typeof s === 'object' && s !== null && held.has(s);

/** Segments with `sep` between each group (a group of none is skipped), like Array.join for segments. */
export function joinSegments(groups: readonly (readonly Segment[])[], sep: string): Segment[] {
  return groups.filter((g) => g.length).flatMap((g, k) => (k ? [sep, ...g] : [...g]));
}

/** The reply text for this copy: the dev copy shows every segment; any other copy drops the operator's. */
export function render(copy: string | undefined, lines: readonly Line[]): string {
  const dev = isDevCopy(copy);
  const out: string[] = [];
  for (const line of lines) {
    const segments: readonly Segment[] = Array.isArray(line) ? line : [line as Segment];
    const shown = dev ? segments : segments.filter((s) => !isOperatorText(s));
    if (segments.length && !shown.length) continue;
    out.push(shown.map((s) => (isOperatorText(s) ? held.get(s)! : s)).join(''));
  }
  return out.join('\n');
}

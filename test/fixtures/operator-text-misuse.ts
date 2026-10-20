// Order 12 (ITEM 3): deliberate misuse of OperatorText. Every line marked MISUSE must fail to compile;
// scripts/ci/operator-text.test.ts runs tsc on this file and checks that each one does. Not part of the main typecheck.
import { operatorText, render, type OperatorText } from '../../src/operator-text.ts';

const raw: OperatorText = operatorText('D1 HTTP 500: 7500 internal');
declare function guildReply(content: string): void;

export const a = `**Last data update:** failed${raw}`; // MISUSE: template literal (TS2731)
export const b = 'failed: ' + raw; // MISUSE: string concatenation (TS2469)
export const c: string = raw; // MISUSE: assigned to a string (TS2322)
guildReply(raw); // MISUSE: passed where a string is expected (TS2345)
export const d = raw.slice(0, 200); // MISUSE: a string method (TS2339)
export const e = 'failed'.concat(raw); // MISUSE: String.prototype.concat (TS2345)

// The one allowed path: render() with a copy, never a string conversion.
export const ok: string = render('dev', [['**Last data update:** failed', raw]]);

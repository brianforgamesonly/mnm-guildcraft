// Workers Logs completeness check (order 7, ITEM 1.1). Reconciles each kind of logged event against its own
// independent record, like with like, and returns the mismatches. Pure: no network; scripts/bench/timings.mjs
// feeds it, and logs-check.test.mjs tests it.
//
//   writes:       every audit_log row (an independent record kept in D1) must have its interaction in the logs,
//                 within AUDIT_WINDOW_MS of the row. A failed command writes no row and is not expected.
//   reads:        from order 7 on, /craft find, /roster and /guildcraft status write audit rows (craft.find,
//                 roster.view, guildcraft.status) after delivery, and their timing line names the action
//                 (`audit`). Audit rows → logs as for writes; and every line naming an action → its row.
//   autocomplete: no independent record exists; counted, never reconciled.
//   crons:        every 15-minute slot from the schedule's creation to the end of the window must have its run,
//                 except slots within CRON_PROPAGATION_MS after a deploy (Cloudflare: cron changes "may take
//                 several minutes (up to 15 minutes) to propagate"). Cloudflare promises no specific run, so a
//                 missed slot is reported as a mismatch to explain, not proof of log loss on its own.

export const SLOT_MS = 15 * 60_000;
export const CRON_PROPAGATION_MS = 15 * 60_000;
/**
 * How far a request's log events may lie from its audit row. Read back on 2026-10-20: the events are stamped after
 * the row (setup: row 00:29:55.956, event 00:29:56.643), and deferred work runs up to 30 s after the reply.
 */
export const AUDIT_WINDOW_MS = { before: 60_000, after: 35_000 };
/** A slot whose run may still be in flight or not yet ingested is not expected yet. */
export const INGEST_GRACE_MS = 3 * 60_000;

/** Which logged paths may have written each audit action. Unknown actions match any non-autocomplete interaction. */
export const ACTION_PATHS = {
  'skill.set': /^command craft set$/,
  'skill.update': /^(command craft update|component |modal )/,
  'character.add': /^command character add$/,
  'character.restore': /^command character add$/,
  'character.edit': /^command character edit$/,
  'character.remove': /^command character remove$/,
  'guild.setup': /^command guildcraft setup$/,
  'board.rebuild': /^command guildcraft rebuild-board$/,
  'craft.find': /^command craft find$/,
  'roster.view': /^command roster /,
  'guildcraft.status': /^command guildcraft status$/,
  'member.removed': /^(command guildcraft remove-member|component )/,
  'member.keep': /^component /,
};
/** Rows the scheduled run writes (actor 'system'): matched to a cron run, not an interaction. */
export const SYSTEM_ACTOR = 'system';

const slotOf = (ms) => Math.floor(ms / SLOT_MS) * SLOT_MS;
const iso = (ms) => new Date(ms).toISOString();

/**
 * @param {object} a
 * @param {number} a.from  window start, epoch ms
 * @param {number} a.to    window end, epoch ms
 * @param {{at:number, path:string, kind:'interaction'|'cron'|'other', audit?:string|null}[]} a.requests  one per logged request
 * @param {{action:string, actor:string, at:number}[]} a.audit  audit_log rows in [from - window, to]
 * @param {number[]} a.deploys  deployment times, epoch ms
 * @param {number|null} a.cronSince  when the cron schedule was created (null: unknown, so no cron slot is expected)
 * @returns {{ rows: {type:string, expected:number|string, found:number, missing:string[], note?:string}[], ok: boolean }}
 */
export function reconcile({ from, to, requests, audit, deploys, cronSince }) {
  const rows = [];
  const interactions = requests.filter((r) => r.kind === 'interaction');
  const used = new Set();

  // Writes and reads: audit row → its interaction (one-to-one, nearest first).
  const byKind = new Map();
  // Rows and claims in the last INGEST_GRACE_MS are not judged: the other half may not be ingested yet.
  const settled = to - INGEST_GRACE_MS;
  for (const row of audit.filter((x) => x.at >= from && x.at <= settled && x.actor !== SYSTEM_ACTOR)) {
    const re = ACTION_PATHS[row.action] ?? /^(command|component|modal) /;
    const hit = interactions
      .map((r, i) => ({ r, i }))
      .filter(({ r, i }) => !used.has(i) && re.test(r.path) && r.at >= row.at - AUDIT_WINDOW_MS.before && r.at <= row.at + AUDIT_WINDOW_MS.after)
      .sort((a, b) => Math.abs(a.r.at - row.at) - Math.abs(b.r.at - row.at))[0];
    const k = byKind.get(row.action) ?? { expected: 0, found: 0, missing: [] };
    k.expected++;
    if (hit) {
      used.add(hit.i);
      k.found++;
    } else k.missing.push(iso(row.at));
    byKind.set(row.action, k);
  }
  for (const [action, k] of [...byKind].sort()) rows.push({ type: `audit ${action} → log`, ...k });

  // Reads that say they wrote an audit row → the row.
  const claimed = interactions.filter((r) => r.audit && r.at <= settled);
  const rowsLeft = audit.filter((x) => x.actor !== SYSTEM_ACTOR).map((x) => ({ ...x }));
  const claimMissing = [];
  for (const r of claimed) {
    const at = rowsLeft.findIndex((x) => x.action === r.audit && x.at >= r.at - AUDIT_WINDOW_MS.after && x.at <= r.at + AUDIT_WINDOW_MS.before);
    if (at === -1) claimMissing.push(`${iso(r.at)} ${r.audit}`);
    else rowsLeft.splice(at, 1);
  }
  rows.push({ type: 'read log (audit named) → audit row', expected: claimed.length, found: claimed.length - claimMissing.length, missing: claimMissing });

  const unaudited = interactions.filter((r) => /^command (craft find|roster |guildcraft status)/.test(r.path) && !r.audit).length;
  if (unaudited) rows.push({ type: 'reads before read audit', expected: 'no independent record', found: unaudited, missing: [] });
  rows.push({ type: 'autocomplete', expected: 'no independent record', found: interactions.filter((r) => r.path.startsWith('autocomplete')).length, missing: [] });

  // Crons: each slot after the schedule existed, outside the propagation window after each deploy.
  const runs = new Set(requests.filter((r) => r.kind === 'cron').map((r) => slotOf(r.at)));
  const missing = [];
  let expected = 0;
  let optional = 0;
  if (cronSince !== null && cronSince !== undefined) {
    const start = Math.ceil(Math.max(from, cronSince) / SLOT_MS) * SLOT_MS;
    for (let s = start; s <= to - INGEST_GRACE_MS; s += SLOT_MS) {
      const propagating = deploys.some((d) => s >= d && s <= d + CRON_PROPAGATION_MS);
      if (propagating) {
        optional++;
        continue;
      }
      expected++;
      if (!runs.has(s)) missing.push(iso(s));
    }
  }
  rows.push({
    type: 'cron run per 15-minute slot',
    expected: cronSince === null || cronSince === undefined ? 'schedule creation time unknown' : expected,
    found: expected - missing.length,
    missing,
    note: `${optional} slot(s) inside a deploy's propagation window not counted; ${runs.size} run(s) seen`,
  });
  return { rows, ok: rows.every((r) => r.missing.length === 0) };
}

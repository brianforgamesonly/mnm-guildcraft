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

// ---------------------------------------------------------------- order 8, ITEM 3.1: explained and unexplained gaps
//
// A Workers Logs event that is missing, but whose invocation Cloudflare's own analytics (a separate pipeline) counts
// as a success in the same 15-minute slot, is a PLATFORM DROP: counted and tracked, never a failure. A gap the
// analytics does not explain fails. Per slot k (settled slots only):
//   shortfall(k) = analytics(k) − logged(k) − excess logs in k−1 and k+1 (a request at a slot edge lands next door)
//   drops(k)     = min(shortfall(k), analytics successes in k): only a success can be a confirmed drop
//   a non-success shortfall (shortfall − drops) is unexplained.
// Each missing event with an independent record (a cron slot without its run, an audit row without its request) is
// explained by one drop in its slot, or failing that a neighbouring slot; otherwise it is unexplained. Drops that match
// no such record (an autocomplete, say) still count as drops.

/** The drop-rate alarm: the one-sided 95% upper confidence bound on the rate, over a rolling 7 days, above this. */
export const DROP_BOUND_THRESHOLD = 0.15;
export const DROP_BOUND_CONFIDENCE = 0.95;
export const DROP_HISTORY_DAYS = 7;
/**
 * Below this many invocations the bound is not judged: with few samples the upper bound is high by construction
 * (0 drops in 18 invocations is still over 15%). 200 is about two days of the 15-minute cron alone; 0 in 200 bounds at 1.5%.
 */
export const DROP_BOUND_MIN_N = 200;

const near = (k, d) => new Date(Date.parse(`${k}Z`) + d * SLOT_MS).toISOString().slice(0, 16);
export const slotKey = (ms) => new Date(slotOf(ms)).toISOString().slice(0, 16);

/**
 * @param {object} a
 * @param {Map<string,{requests:number, ok:number}>} a.analytics  per slot key (YYYY-MM-DDTHH:MM, UTC): invocations, and those with status success
 * @param {Map<string,number>} a.logged  requests seen in the logs, per slot key
 * @param {{at:number, what:string}[]} a.gaps  missing events that have an independent record
 * @param {number} a.settled  slots ending after this (epoch ms) are not judged
 * @returns {{ drops:number, invocations:number, dropSlots:{slot:string,n:number}[], explained:string[], unexplained:string[] }}
 */
export function explainGaps({ analytics, logged, gaps, settled }) {
  const keys = [...new Set([...analytics.keys(), ...logged.keys()])].sort();
  const excess = (k) => Math.max(0, (logged.get(k) ?? 0) - (analytics.get(k)?.requests ?? 0));
  const budget = new Map();
  const unexplained = [];
  const dropSlots = [];
  let drops = 0;
  for (const k of keys) {
    if (Date.parse(`${k}Z`) + SLOT_MS > settled) continue;
    const a = analytics.get(k) ?? { requests: 0, ok: 0 };
    const shortfall = Math.max(0, a.requests - (logged.get(k) ?? 0) - excess(near(k, -1)) - excess(near(k, 1)));
    if (!shortfall) continue;
    const d = Math.min(shortfall, a.ok);
    if (d) {
      budget.set(k, d);
      dropSlots.push({ slot: `${k}Z`, n: d });
      drops += d;
    }
    if (shortfall > d) unexplained.push(`${k}Z: logs short of analytics by ${shortfall - d} invocation(s) that did not succeed`);
  }
  const explained = [];
  for (const g of gaps) {
    const k = slotKey(g.at);
    const hit = [k, near(k, -1), near(k, 1)].find((s) => (budget.get(s) ?? 0) > 0);
    if (hit) {
      budget.set(hit, budget.get(hit) - 1);
      explained.push(`${g.what} (platform drop: analytics counts a success in ${hit}Z)`);
    } else unexplained.push(`${g.what}: missing, and analytics shows no unlogged success to explain it`);
  }
  let invocations = 0;
  for (const [k, a] of analytics) if (Date.parse(`${k}Z`) + SLOT_MS <= settled) invocations += a.requests;
  return { drops, invocations, dropSlots, explained, unexplained };
}

const logChoose = (() => {
  const lg = [0];
  return (n, k) => {
    for (let i = lg.length; i <= n; i++) lg[i] = lg[i - 1] + Math.log(i);
    return lg[n] - lg[k] - lg[n - k];
  };
})();
/** P(X ≤ k) for X ~ Binomial(n, p). */
function binomCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log1p(-p));
  return Math.min(1, s);
}
/** The exact (Clopper–Pearson) one-sided upper confidence bound on a binomial rate: k drops in n invocations. */
export function upperBound(k, n, confidence = DROP_BOUND_CONFIDENCE) {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  let lo = k / n;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (binomCdf(k, n, mid) > 1 - confidence) lo = mid;
    else hi = mid;
  }
  return hi;
}

/**
 * The rolling history: entries {from, to, drops, invocations, breach}, kept DROP_HISTORY_DAYS back from `now`.
 * The current window replaces an entry whose midpoint it covers (the same window read again); the few minutes two
 * daily windows overlap when GitHub starts a run later one day than the next do not.
 */
export function rollHistory(history, entry, now) {
  const since = now - DROP_HISTORY_DAYS * 86_400_000;
  const mid = (h) => (Date.parse(h.from) + Date.parse(h.to)) / 2;
  const kept = (Array.isArray(history) ? history : []).filter((h) => h && Date.parse(h.to) > since && !(mid(h) >= Date.parse(entry.from) && mid(h) <= Date.parse(entry.to)));
  const all = [...kept, entry].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const drops = all.reduce((s, h) => s + h.drops, 0);
  const invocations = all.reduce((s, h) => s + h.invocations, 0);
  const bound = upperBound(drops, invocations);
  const judged = invocations >= DROP_BOUND_MIN_N;
  return { history: all, drops, invocations, bound, judged, breach: judged && bound > DROP_BOUND_THRESHOLD };
}

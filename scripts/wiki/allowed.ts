// Order 28, ITEM 1 and override 3: what the relay forwards to the wiki. Pure TypeScript, shared by the relay Worker
// (scripts/wiki/relay.ts) and its tests. A request is allowed only if every parameter it sends is one its shape names,
// with a value that shape accepts; the relay then adds format=json, formatversion=2 and maxlag=5 itself (override 1),
// so no caller can leave them out. Everything else is refused (the relay answers 403 and contacts nothing).
//
// The shapes (ITEM 1's allowed actions):
//   siteinfo      action=query&meta=siteinfo
//   list          action=query&list=categorymembers                        (titles of a category's members)
//   content       action=query&generator=categorymembers&prop=revisions    (rvslots=main, content)
//   schema        action=query&prop=revisions&titles=Bucket:Quests|Bucket:Factions (the two buckets' schema pages, read
//                 before the buckets: ITEM 1's "after reading their schema pages")
//   recentchanges action=query&list=recentchanges                          (ITEM 3: edits in the last 24 hours, counted)
//   bucket        action=bucket&query=bucket('quests'|'factions')…run()
// Each follows continuation: the continue parameters the API hands back are allowed in their shape.

export const MAXLAG = '5';
/** The two buckets ITEM 1 reads, and their schema pages. */
export const BUCKETS = ['quests', 'factions'] as const;
export const SCHEMA_PAGES = ['Bucket:Quests', 'Bucket:Factions'] as const;

type Check = (v: string) => boolean;
const any: Check = (v) => v.length > 0 && v.length <= 500;
const is = (...vs: string[]): Check => (v) => vs.includes(v);
const num: Check = (v) => /^(\d{1,3}|max)$/.test(v);
const category: Check = (v) => /^Category:[^|<>[\]{}]{1,200}$/.test(v);
/** A pipe-joined subset of allowed values (rvprop=ids|timestamp|content). */
const subset = (...vs: string[]): Check => (v) => v.split('|').every((p) => vs.includes(p));
const time: Check = (v) => /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(v);
const namespaces: Check = (v) => /^\d{1,3}(\|\d{1,3})*$/.test(v);
// A bucket query: one of the two buckets, then only select/limit/offset with plain quoted names or numbers, then run().
const bucketQuery: Check = (v) =>
  v.length <= 2000 &&
  new RegExp(`^bucket\\('(${BUCKETS.join('|')})'\\)(\\.select\\('[a-z0-9_]+'(,'[a-z0-9_]+')*\\)|\\.limit\\(\\d{1,4}\\)|\\.offset\\(\\d{1,6}\\))*\\.run\\(\\)$`).test(v);

const SHAPES: Record<string, Record<string, Check>> = {
  siteinfo: { action: is('query'), meta: is('siteinfo') },
  list: {
    action: is('query'),
    list: is('categorymembers'),
    cmtitle: category,
    cmlimit: num,
    cmtype: subset('page', 'subcat', 'file'),
    cmprop: subset('ids', 'title', 'type', 'timestamp'),
    cmnamespace: namespaces,
    cmcontinue: any,
    continue: any,
  },
  content: {
    action: is('query'),
    generator: is('categorymembers'),
    gcmtitle: category,
    gcmlimit: num,
    gcmtype: subset('page', 'subcat', 'file'),
    gcmnamespace: namespaces,
    gcmcontinue: any,
    prop: is('revisions'),
    rvprop: subset('ids', 'timestamp', 'content'),
    rvslots: is('main'),
    rvcontinue: any,
    continue: any,
  },
  schema: { action: is('query'), prop: is('revisions'), titles: subset(...SCHEMA_PAGES), rvprop: subset('ids', 'timestamp', 'content'), rvslots: is('main') },
  recentchanges: {
    action: is('query'),
    list: is('recentchanges'),
    rcstart: time,
    rcend: time,
    rcdir: is('older', 'newer'),
    rcnamespace: namespaces,
    rcprop: subset('title', 'timestamp', 'ids'),
    rctype: subset('edit', 'new'),
    rclimit: num,
    rccontinue: any,
    continue: any,
  },
  bucket: { action: is('bucket'), query: bucketQuery },
};
/** The parameter each shape must carry (it tells the shapes apart). */
const REQUIRED: Record<string, string[]> = {
  siteinfo: ['meta'],
  list: ['list', 'cmtitle'],
  content: ['generator', 'gcmtitle', 'prop', 'rvslots'],
  schema: ['prop', 'titles', 'rvslots'],
  recentchanges: ['list'],
  bucket: ['query'],
};
/** The relay sets these itself; a caller may send them only with these values. */
const FIXED: Record<string, string> = { format: 'json', formatversion: '2', maxlag: MAXLAG };

export type Verdict = { ok: true; shape: string; query: string } | { ok: false; reason: string };

/** The wiki query string to send, or why not. One value per parameter. */
export function allowed(params: URLSearchParams): Verdict {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length) return { ok: false, reason: 'a parameter is repeated' };
  const own = new URLSearchParams();
  for (const [k, v] of params) {
    if (k in FIXED) {
      if (v !== FIXED[k]) return { ok: false, reason: `${k} must be ${FIXED[k]}` };
    } else own.set(k, v);
  }
  for (const [shape, checks] of Object.entries(SHAPES)) {
    if (!REQUIRED[shape].every((k) => own.has(k)) || !checks.action(own.get('action') ?? '')) continue;
    // The content shape must ask for the content itself (rvprop includes content).
    if (shape === 'content' && !(own.get('rvprop') ?? '').split('|').includes('content')) continue;
    const bad = [...own].find(([k, v]) => !checks[k] || !checks[k](v));
    if (bad) return { ok: false, reason: `${shape}: parameter ${bad[0]} is not allowed with that value` };
    for (const [k, v] of Object.entries(FIXED)) own.set(k, v);
    return { ok: true, shape, query: own.toString() };
  }
  return { ok: false, reason: 'not one of the allowed requests' };
}

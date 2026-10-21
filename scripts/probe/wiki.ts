// Work order 14, ITEM 1: can GuildCraft read the community wiki without anyone's home computer? The two requests,
// identical on every path: this machine and GitHub's runners (scripts/probe/run.ts), Cloudflare's network
// (scripts/probe/worker.ts). A polite guest: a named User-Agent, never a browser's; one retry, after 10 s, only on a
// network error. A 403, 429 or 503 is an answer, never retried.
export const WIKI = 'https://monstersandmemories.miraheze.org';
export const USER_AGENT = 'GuildCraft/1.0 (Discord guild crafting bot; contact: Joegandomi on the Monsters & Memories Discord)';
export const REQUESTS = [
  { name: 'siteinfo', path: '/w/api.php?action=query&meta=siteinfo&format=json' },
  { name: 'parse', path: '/w/api.php?action=parse&page=Rothold&prop=wikitext&format=json&formatversion=2' },
] as const;
// The order's five, plus cf-mitigated: Cloudflare sets it on a challenge, which tells a CDN block from Miraheze's own.
const HEADERS = ['server', 'cf-ray', 'x-cache', 'retry-after', 'content-type', 'cf-mitigated'] as const;
const RETRY_AFTER_MS = 10_000;

export type ProbeResult = {
  name: string;
  url: string;
  attempts: number;
  status: number | null;
  headers: Record<string, string>;
  bodyBytes: number;
  /** siteinfo: the wiki's name and MediaWiki version, proof the API answered. */
  site?: string;
  /** parse: whether wikitext came back, and its first 120 characters. */
  wikitext?: { present: boolean; first120?: string };
  /** A MediaWiki API error code inside a 200 (for example missingtitle). */
  apiError?: string;
  /** Any non-2xx: the first 300 characters of the body, which often names the reason. */
  refusal?: string;
  /** No response at all (after the one retry). */
  error?: string;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function one(req: (typeof REQUESTS)[number]): Promise<ProbeResult> {
  const url = WIKI + req.path;
  const base = { name: req.name, url, headers: {}, bodyBytes: 0 };
  let res: Response | undefined;
  let attempts = 0;
  let error = '';
  while (!res && attempts < 2) {
    if (attempts) await wait(RETRY_AFTER_MS);
    attempts++;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'manual' });
    } catch (e) {
      error = e instanceof Error ? `${e.name}: ${e.message}${e.cause ? ` (${String(e.cause)})` : ''}` : String(e);
    }
  }
  if (!res) return { ...base, attempts, status: null, error };
  const got = res;
  const bytes = new Uint8Array(await got.arrayBuffer());
  const body = new TextDecoder().decode(bytes);
  const headers = Object.fromEntries(HEADERS.flatMap((h) => (got.headers.has(h) ? [[h, got.headers.get(h) ?? '']] : [])));
  const out: ProbeResult = { ...base, attempts, status: got.status, headers, bodyBytes: bytes.byteLength };
  if (got.status < 200 || got.status > 299) return { ...out, refusal: body.slice(0, 300) };
  let json: { error?: { code?: string }; query?: { general?: { sitename?: string; generator?: string } }; parse?: { wikitext?: unknown } };
  try {
    json = JSON.parse(body);
  } catch {
    return { ...out, refusal: `200 but not JSON: ${body.slice(0, 300)}` };
  }
  if (json.error) out.apiError = json.error.code ?? 'unknown';
  if (req.name === 'siteinfo') out.site = `${json.query?.general?.sitename ?? '?'} · ${json.query?.general?.generator ?? '?'}`;
  if (req.name === 'parse') {
    const text = json.parse?.wikitext;
    out.wikitext = typeof text === 'string' && text.length ? { present: true, first120: text.slice(0, 120) } : { present: false };
  }
  return out;
}

/** The two requests, one after the other. */
export async function probe(): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];
  for (const req of REQUESTS) results.push(await one(req));
  return results;
}

/** One Markdown table row per request (the job summary and the console). */
export function table(path: string, results: ProbeResult[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const rows = results.map((r) => {
    const h = Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`).join('; ');
    const what = r.error ?? r.refusal ?? r.apiError ?? (r.wikitext ? (r.wikitext.present ? `wikitext: ${r.wikitext.first120}` : 'no wikitext') : r.site ?? '');
    return `| ${path} | ${r.name} | ${r.status ?? 'no response'} | ${r.attempts} | ${cell(h)} | ${r.bodyBytes} | ${cell(what)} |`;
  });
  return ['| Path | Request | Status | Attempts | Headers | Body bytes | Result |', '|---|---|---|---|---|---|---|', ...rows].join('\n');
}

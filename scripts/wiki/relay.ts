// Order 28, ITEM 1 and override 3: the temporary relay Worker guildcraft-wiki-relay (scripts/wiki/wrangler.jsonc: no
// bindings, routes or cron). .github/workflows/wiki-snapshot.yml deploys it with a one-time token compiled in
// (wrangler deploy --define), calls it once per wiki request, one call at a time, then deletes it and checks the 404.
//
// It answers only GET /api carrying the token in the x-relay-token header, and only for the requests
// scripts/wiki/allowed.ts allows. Each such call makes exactly one wiki request, with order 14's named User-Agent and
// maxlag=5, and returns the wiki's response unparsed: a refusal or a challenge reaches the runner exactly as the wiki
// sent it (override 7: a block is an answer). Everything else gets a 403 and contacts nothing. One subrequest per call,
// well under the Free plan's 50; waiting on the fetch is not CPU time.
import { WIKI, USER_AGENT } from '../probe/wiki.ts';
import { allowed } from './allowed.ts';

declare const RELAY_TOKEN: string;
export const API = `${WIKI}/w/api.php`;

const refuse = (why: string) => new Response(`relay: refused (${why})`, { status: 403, headers: { 'x-relay-refused': '1' } });

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = typeof RELAY_TOKEN === 'string' ? RELAY_TOKEN : '';
    if (request.method !== 'GET') return refuse('method');
    if (url.pathname !== '/api') return refuse('path');
    if (token.length < 32 || request.headers.get('x-relay-token') !== token) return refuse('token');
    const verdict = allowed(url.searchParams);
    if (!verdict.ok) return refuse(verdict.reason);
    return fetch(`${API}?${verdict.query}`, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, redirect: 'manual' });
  },
};

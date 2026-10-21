// Work order 14, ITEM 1: the temporary Worker guildcraft-wiki-probe (scripts/probe/wrangler.jsonc). No bindings,
// routes or cron. .github/workflows/wiki-probe.yml deploys it, calls it once and deletes it in the same run. It answers
// one request: GET /probe?token=<the run's one-time token, compiled in with wrangler deploy --define>. Everything
// else, including a second call, gets a 404.
import { probe } from './wiki.ts';

declare const PROBE_TOKEN: string;
let answered = false;

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = typeof PROBE_TOKEN === 'string' ? PROBE_TOKEN : '';
    if (answered || request.method !== 'GET' || url.pathname !== '/probe' || token.length < 32 || url.searchParams.get('token') !== token)
      return new Response('Not found', { status: 404 });
    answered = true;
    const colo = (request as Request & { cf?: { colo?: string } }).cf?.colo;
    return Response.json({ path: 'cloudflare', colo, results: await probe() });
  },
};

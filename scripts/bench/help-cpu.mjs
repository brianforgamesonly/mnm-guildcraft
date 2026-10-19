// CPU cost of one /craft help request through the Worker's own code (Hono app + Ed25519 verify).
// A PROXY measured in Node 24, not a Worker measurement: workerd's CPU accounting is not reproduced here.
// Usage: node scripts/bench/help-cpu.mjs [requests]

import app from '../../src/index.ts';

const N = Number(process.argv[2] ?? 500);
const hex = (b) => Buffer.from(b).toString('hex');
const keys = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
const env = { DISCORD_PUBLIC_KEY: hex(await crypto.subtle.exportKey('raw', keys.publicKey)) };
const body = JSON.stringify({ type: 2, data: { name: 'craft', options: [{ type: 1, name: 'help' }] } });

async function signed() {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = hex(await crypto.subtle.sign({ name: 'Ed25519' }, keys.privateKey, new TextEncoder().encode(ts + body)));
  return () => new Request('https://worker.test/', { method: 'POST', headers: { 'X-Signature-Ed25519': sig, 'X-Signature-Timestamp': ts }, body });
}

const makeReq = await signed();
for (let i = 0; i < 50; i++) await app.fetch(makeReq(), env); // warm-up (JIT, key import paths)

// process.cpuUsage() ticks in ~15.6 ms steps on Windows, so a single request reads as 0 or 16 ms.
// Measure the whole loop and divide: mean CPU per request.
const reqs = Array.from({ length: N }, makeReq);
const c0 = process.cpuUsage();
const t0 = performance.now();
for (const req of reqs) {
  const res = await app.fetch(req, env);
  await res.text();
  if (res.status !== 200) throw new Error(`unexpected status ${res.status}`);
}
const c = process.cpuUsage(c0);
const wall = performance.now() - t0;
console.log(JSON.stringify({ requests: N, cpu_ms_per_request: (c.user + c.system) / 1000 / N, wall_ms_per_request: wall / N, node: process.version }));

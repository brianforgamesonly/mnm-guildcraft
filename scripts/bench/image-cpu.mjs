// CPU cost of the /item image upload path's own work for one ~2 MB screenshot: the magic-byte check on the first 12
// bytes, the multipart body (payload_json + files[0] as a Blob), and serialising that body as fetch would.
// A LOCAL ESTIMATE measured in Node, not a Worker measurement: workerd's CPU accounting is not reproduced here, and
// the download and upload waits cost no CPU in either. The production figure is the invocation's cpuTimeMs in
// Workers Logs (the timing line names the path "item image"; scripts/bench/timings.mjs reads it).
// Usage: node scripts/bench/image-cpu.mjs [megabytes=2] [rounds=50]
import { imageType } from '../../src/commands/images.ts';

const mb = Number(process.argv[2] ?? 2);
const rounds = Number(process.argv[3] ?? 50);
const bytes = new Uint8Array(Math.round(mb * 1024 * 1024));
bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (let i = 8; i < bytes.length; i++) bytes[i] = (i * 2654435761) >>> 24;
const blob = new Blob([bytes]);

async function once() {
  const type = imageType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  if (!type) throw new Error('magic check failed');
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: 'Screenshot of **Copper Sword** from <@1> · waiting for an officer', attachments: [{ id: 0, filename: 'item.png' }] }));
  form.append('files[0]', blob.slice(0, blob.size, type.mime), 'item.png');
  // fetch serialises the multipart body; this reads it out fully, an upper bound on that work.
  return (await new Response(form).arrayBuffer()).byteLength;
}

await once(); // warm up
const c0 = process.cpuUsage();
const t0 = performance.now();
let size = 0;
for (let i = 0; i < rounds; i++) size = await once();
const c = process.cpuUsage(c0);
console.log(JSON.stringify({ label: 'LOCAL ESTIMATE (Node, not workerd)', image_mb: mb, body_bytes: size, rounds, cpu_ms_per_upload: +((c.user + c.system) / 1000 / rounds).toFixed(2), wall_ms_per_upload: +((performance.now() - t0) / rounds).toFixed(2), node: process.version }));

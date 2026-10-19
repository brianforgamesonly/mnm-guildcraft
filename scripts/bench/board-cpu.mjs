// CPU cost of rendering and hashing a whole board (every tradeskill post plus the index), the CPU-heavy
// part of a nightly rebuild (order 5, ITEM 1.1). A PROXY measured in Node 24, not a Worker measurement:
// workerd's CPU accounting is not reproduced here, and waits on D1 and Discord cost no CPU in either.
// Usage: node scripts/bench/board-cpu.mjs [skills=15] [charactersPerSkill=40] [rounds=200]
import { contentHash, renderIndex, renderSkillPost } from '../../src/board/render.ts';

const skills = Number(process.argv[2] ?? 15);
const per = Number(process.argv[3] ?? 40);
const rounds = Number(process.argv[4] ?? 200);
const now = Date.now();
const lines = (s) =>
  Array.from({ length: per }, (_, i) => ({ tradeskill_id: s, character: `Character${i}`, owner_user_id: String(i % 25), member: `Member display name ${i % 25}`, level: 300 - i, updated_at: new Date(now - i * 86_400_000).toISOString() }));
const data = Array.from({ length: skills }, (_, s) => ({ name: `Tradeskill ${s}`, lines: lines(s) }));

async function board() {
  let messages = 0;
  for (const d of data) {
    const msgs = renderSkillPost(d.name, d.lines, 60, now);
    messages += msgs.length;
    await contentHash(msgs);
    JSON.stringify(msgs); // the request body
  }
  const idx = renderIndex(data.map((d, i) => ({ skill: d.name, thread_id: String(10n ** 18n + BigInt(i)), lines: d.lines.length })), now);
  await contentHash(idx.hashable);
  return messages;
}

for (let i = 0; i < 20; i++) await board(); // warm-up
const c0 = process.cpuUsage();
let messages = 0;
for (let i = 0; i < rounds; i++) messages = await board();
const c = process.cpuUsage(c0);
console.log(JSON.stringify({ skills, characters_per_skill: per, messages_per_board: messages, cpu_ms_per_board: (c.user + c.system) / 1000 / rounds, node: process.version }));

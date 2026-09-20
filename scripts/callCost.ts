import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Where does a game's money actually go, call by call? A run once cost 18x another
// with identical prompt content and nothing recorded could explain it. cacheRead high
// = the prompt cache is working; cacheCreate high = it is being rebuilt every call,
// which at a 150K-token context is the difference between cents and dollars.
const run = process.argv[2];
const dir = `tournament/runs/${run}/games`;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.trace.jsonl'))) {
  const rows = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const asked = rows.filter((r) => r.asked && r.usage);
  if (!asked.length) { console.log(`${f}: no per-call usage recorded (run predates the instrumentation)`); continue; }
  const sum = (k: string) => asked.reduce((n, r) => n + (r.usage[k] ?? 0), 0);
  const cost = asked.reduce((n, r) => n + (r.cost ?? 0), 0);
  console.log(`${f}: ${asked.length} calls, $${cost.toFixed(2)} ($${(cost / asked.length).toFixed(3)}/call)`);
  console.log(`  cache READ    ${(sum('cacheRead') / 1000).toFixed(0)}K tokens  (cheap — the prompt cache working)`);
  console.log(`  cache CREATE  ${(sum('cacheCreate') / 1000).toFixed(0)}K tokens  (dear — the cache being rebuilt)`);
  console.log(`  fresh input   ${(sum('input') / 1000).toFixed(0)}K   output ${(sum('output') / 1000).toFixed(0)}K`);
  const ratio = sum('cacheCreate') / Math.max(1, sum('cacheRead'));
  console.log(`  create:read ratio ${ratio.toFixed(2)} — ${ratio > 0.5 ? '⚠ the cache is NOT holding between calls' : 'healthy'}`);
}

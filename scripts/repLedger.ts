import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { pricePerLb } from '../src/engine/market';
import type { Action } from '../src/actions';
import type { Config, GameState } from '../src/types';

// WHY IS REPUTATION ALWAYS THE WEAK LINK? Four candidate answers that need different
// fixes: it is hard to GAIN, it is easy to LOSE, its SCALE is wrong, or its CEILING is
// low. Replay a recorded game, diff every captain's reputation after every action, and
// attribute each change to the log line that caused it.
//   npx tsx scripts/repLedger.ts <run> [game]

const run = process.argv[2];
const game = process.argv[3] ?? 'r1g1';
const dir = `tournament/runs/${run}/games`;
const res = JSON.parse(readFileSync(`${dir}/${game}.result.json`, 'utf8').toString());
const names: string[] = res.seats.map((s: { captainName: string }) => s.captainName);
const agents: Record<string, string> = {};
res.seats.forEach((s: { captainName: string; agent: string }) => { agents[s.captainName] = s.agent; });

const cfg: Config = { ...defaultConfig, players: res.seats.length };
let state = createInitialState(cfg, res.seed, names);
const lines = readFileSync(`${dir}/${game}.actions.jsonl`, 'utf8').split('\n').filter((l) => l.trim());

// cause -> player -> total
const ledger: Record<string, Record<string, number>> = {};
const add = (cause: string, who: string, d: number) => {
  (ledger[cause] ??= {})[who] = ((ledger[cause] ??= {})[who] ?? 0) + d;
};
// Attribute PER CAPTAIN: a single day-rollover emits several rep lines at once (one
// captain takes the pole while another takes the last berth), so the batch as a whole
// cannot be labelled — only the lines naming this captain can.
const classify = (logs: string[], actionType: string, name: string): string => {
  const mine = logs.filter((l) => l.startsWith(name + ' ') || l.includes(`from ${name}`));
  const j = mine.join(' | ');
  if (/takes the pole/.test(j)) return 'took the pole (slot 1)';
  if (/after you/.test(j)) return 'last berth ("after you")';
  if (/lands at the co-op/.test(j)) return 'landed at the co-op';
  if (/is towed in/.test(j)) return 'towed in';
  if (/without a licence/.test(j)) return 'poached (unlicensed)';
  if (/STEALS/.test(j)) return 'stole a rival pot';
  if (/reports/.test(j)) return 'reported a theft';
  if (/bribes the harbourmaster|bribes the harbormaster/.test(j)) return 'bribed the harbourmaster';
  if (actionType === 'HAUL' || actionType === 'STEAL') return 'kept illegal lobsters (high-grading)';
  if (actionType === 'BRIBE') return 'bribed the harbourmaster';
  return `other (${actionType})`;
};

const repOf = (s: GameState) => Object.fromEntries(Object.values(s.players).map((p) => [p.name, p.tracks.reputation]));
let prev = repOf(state);
let prevLog = state.log.length;
// co-op opportunity: every SELL that was NOT at the co-op but could have qualified
let sellsElsewhere = 0; let sellsCoop = 0; let missedLbs = 0;

for (const l of lines) {
  const a = JSON.parse(l) as Action;
  const before = state;
  const seller = a.type === 'SELL' ? state.players[a.playerId] : undefined;
  const heldLb = seller ? seller.hold.reduce((n, t) => n + t.weightLb, 0) : 0;
  const soldAt = seller?.node;
  state = reduce(state, a);
  const now = repOf(state);
  const newLogs = state.log.slice(prevLog);
  prevLog = state.log.length;
  for (const [who, v] of Object.entries(now)) {
    const d = v - (prev[who] ?? 0);
    if (Math.abs(d) > 1e-9) add(classify(newLogs, a.type, who), who, d);
  }
  prev = now;
  if (seller && soldAt) {
    const coopNode = Object.keys(cfg.map.nodes).find((n) => cfg.map.nodes[n].port?.market?.coopRep);
    const minLb = cfg.map.nodes[coopNode!]?.port?.market?.coopMinLb ?? 0;
    if (soldAt === coopNode) sellsCoop++;
    else if (heldLb >= minLb) { sellsElsewhere++; missedLbs += heldLb; }
  }
  void before;
}

const who = names.slice();
const causes = Object.keys(ledger).sort((x, y) => {
  const sum = (c: string) => Object.values(ledger[c]).reduce((a, b) => a + b, 0);
  return sum(y) - sum(x);
});
const pad = (s: string, n: number) => s.padEnd(n);
console.log(`\n=== REPUTATION LEDGER — ${run}/${game} ===`);
console.log(pad('cause', 36) + who.map((n) => pad(n.slice(0, 11), 12)).join('') + 'total');
for (const c of causes) {
  const row = who.map((n) => pad((ledger[c][n] ?? 0).toFixed(1), 12)).join('');
  const tot = Object.values(ledger[c]).reduce((a, b) => a + b, 0);
  console.log(pad(c, 36) + row + tot.toFixed(1));
}
console.log(pad('— start —', 36) + who.map(() => pad(cfg.startReputation.toFixed(1), 12)).join(''));
console.log(pad('FINAL', 36) + who.map((n) => pad((prev[n] ?? 0).toFixed(1), 12)).join(''));
console.log(pad('FINAL as VP (×' + cfg.scoring.repToVP + ')', 36) + who.map((n) => pad(((prev[n] ?? 0) * cfg.scoring.repToVP).toFixed(0), 12)).join(''));

const gains = causes.filter((c) => Object.values(ledger[c]).reduce((a, b) => a + b, 0) > 0);
const losses = causes.filter((c) => Object.values(ledger[c]).reduce((a, b) => a + b, 0) < 0);
const sumOf = (cs: string[]) => cs.reduce((n, c) => n + Object.values(ledger[c]).reduce((a, b) => a + b, 0), 0);
console.log(`\ntotal GAINED across the table: +${sumOf(gains).toFixed(1)}   total LOST: ${sumOf(losses).toFixed(1)}`);
console.log(`co-op landings taken: ${sellsCoop}   |   qualifying landings sold ELSEWHERE instead: ${sellsElsewhere} (${missedLbs} lb)`);
console.log(`  -> those ${sellsElsewhere} sales were each worth +${cfg.map.nodes.ROCKLAND.port!.market!.coopRep} reputation, i.e. +${(sellsElsewhere * (cfg.map.nodes.ROCKLAND.port!.market!.coopRep ?? 0)).toFixed(1)} left on the table (${((sellsElsewhere * (cfg.map.nodes.ROCKLAND.port!.market!.coopRep ?? 0)) * cfg.scoring.repToVP).toFixed(0)} VP)`);

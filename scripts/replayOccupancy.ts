import { readFileSync, existsSync } from 'node:fs';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import type { Action, } from '../src/actions';
import type { Config } from '../src/types';

// Replay a recorded game's action transcript through the real engine and report how
// crowded the grounds actually got. The log alone cannot answer this (haul lines
// don't name the node), and cumulative drop counts measure TRAFFIC, not CROWDING.
// usage: npx tsx scripts/replayOccupancy.ts <run> [game] [maxPotsPerSpace] [players]
const run = process.argv[2];
const game = process.argv[3] ?? 'r1g1';
const capOverride = process.argv[4] ? Number(process.argv[4]) : undefined;
const dir = `tournament/runs/${run}/games`;
const res = JSON.parse(readFileSync(`${dir}/${game}.result.json`, 'utf8').toString());
const players: number = res.seats.length;
const seed: number = res.seed;
const names: string[] = res.seats.map((s: { captainName: string }) => s.captainName);

const cfg: Config = { ...defaultConfig, players, ...(capOverride !== undefined ? { maxPotsPerSpace: capOverride } : {}) };
let state = createInitialState(cfg, seed, names);
const lines = readFileSync(`${dir}/${game}.actions.jsonl`, 'utf8').split('\n').filter((l) => l.trim());

const peakBySeason: Record<number, Record<string, number>> = {};
const distinctBySeason: Record<number, Set<string>> = {};
const sample = () => {
  const occ: Record<string, number> = {};
  for (const p of Object.values(state.players)) for (const b of p.deployed) occ[b.node] = (occ[b.node] ?? 0) + 1;
  const s = state.season;
  peakBySeason[s] ??= {}; distinctBySeason[s] ??= new Set();
  for (const [n, k] of Object.entries(occ)) {
    peakBySeason[s][n] = Math.max(peakBySeason[s][n] ?? 0, k);
    distinctBySeason[s].add(n);
  }
};
for (const l of lines) { state = reduce(state, JSON.parse(l) as Action); sample(); }

const eff = cfg.maxPotsPerSpace ? Math.max(1, Math.round(cfg.maxPotsPerSpace * (players / cfg.referencePlayers))) : Infinity;
console.log(`${run}/${game}: ${players} players, cap ${cfg.maxPotsPerSpace || 'none'} -> ${eff === Infinity ? 'uncapped' : eff} pots per space`);
const totalPots = players * cfg.buoysPerPlayer;
for (const s of Object.keys(peakBySeason).map(Number).sort()) {
  const row = Object.entries(peakBySeason[s]).sort((a, b) => b[1] - a[1]);
  const [node, k] = row[0];
  const share = (k / totalPots) * 100;
  console.log(`  S${s}: busiest ground ${node} held ${k} pots at once (${share.toFixed(0)}% of the fleet's ${totalPots}) | ${distinctBySeason[s].size} grounds used | next busiest: ${row.slice(1, 4).map(([n, v]) => `${n} ${v}`).join(', ')}`);
}

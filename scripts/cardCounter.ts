import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { runTournament } from '../src/bots/tournament';
import { BOTS } from '../src/bots';
import type { GameState, Ground } from '../src/types';

// Chunk B instrument. Two questions the multi-season arc must answer, read off
// the strong public-info baseline (an all-card-counter table):
//   1. Does the fleet ratchet OUTWARD season by season as the near commons thins?
//   2. Does stewardship pay — i.e. is the card-counter actually a strong bot?
// The card-counter reads only public info (bag composition, geometry), so a table
// of them is a fair, self-interested fleet fishing the best odds each season.

const cfg = defaultConfig;
const grounds = Object.keys(cfg.bags) as Ground[];
const SEASONS = cfg.seasons;
const N = Number(process.argv[2] ?? 40);

const keeperCount = (s: GameState, g: Ground) => s.bags[g].filter((t) => t.kind === 'KEEPER').length;
const keeperLb = (s: GameState, g: Ground) =>
  s.bags[g].filter((t) => t.kind === 'KEEPER').reduce((a, t) => a + t.weightLb, 0);

// [season-1][ground] accumulators, meaned over seeds
const startKeepers: Record<Ground, number>[] = Array.from({ length: SEASONS }, () => ({} as Record<Ground, number>));
const startDensity: Record<Ground, number>[] = Array.from({ length: SEASONS }, () => ({} as Record<Ground, number>));
const drops: Record<Ground, number>[] = Array.from({ length: SEASONS }, () => ({} as Record<Ground, number>));
for (let i = 0; i < SEASONS; i++) for (const g of grounds) { startKeepers[i][g] = 0; startDensity[i][g] = 0; drops[i][g] = 0; }

// keeper density signal = keeper lbs per bag tile (what the card-counter reads)
const snapDensity = (season: number, s: GameState) => {
  for (const g of grounds) {
    startKeepers[season - 1][g] += keeperCount(s, g);
    startDensity[season - 1][g] += s.bags[g].length ? keeperLb(s, g) / s.bags[g].length : 0;
  }
};

for (let i = 0; i < N; i++) {
  let s = createInitialState(cfg, 1000 + i);
  let seenSeason = 1;
  snapDensity(1, s); // season 1 opening stock
  let guard = 0;
  while (s.phase === 'PLAYING' && guard++ < 200000) {
    const pid = activePlayerId(s);
    const from = s.players[pid].node;
    const action = BOTS.cardcounter(s, pid, legalActions(s, pid));
    if (action.type === 'DROP') drops[s.season - 1][cfg.map.nodes[from].ground!]++;
    s = reduce(s, action);
    if (s.phase === 'PLAYING' && s.season !== seenSeason) { seenSeason = s.season; snapDensity(seenSeason, s); }
  }
}

const f1 = (x: number) => (x / N).toFixed(1);
const f2 = (x: number) => (x / N).toFixed(2);

console.log(`=== Card-counter fleet: migration instrument (${N} seeds, homogeneous 3-boat table) ===\n`);

console.log('Keeper COUNT in each ground at the START of each season (post-recruitment; the depletion/recovery trajectory):');
console.table(Object.fromEntries(grounds.map((g) => [g, Object.fromEntries(
  Array.from({ length: SEASONS }, (_, s) => [`S${s + 1}`, f1(startKeepers[s][g])]),
)])));

console.log('Keeper DENSITY (keeper lbs / bag tile) — the signal the card-counter actually reads:');
console.table(Object.fromEntries(grounds.map((g) => [g, Object.fromEntries(
  Array.from({ length: SEASONS }, (_, s) => [`S${s + 1}`, f2(startDensity[s][g])]),
)])));

console.log('DROPS placed on each ground TYPE per season (where the fleet chose to fish → migration):');
console.table(Object.fromEntries(grounds.map((g) => [g, Object.fromEntries(
  Array.from({ length: SEASONS }, (_, s) => [`S${s + 1}`, f1(drops[s][g])]),
)])));

// Is it a strong baseline? Head-to-head win% against each archetype (seats rotated).
console.log(`\n=== Strong-baseline check: card-counter vs the archetypes (${N} seeds each, ${cfg.scoring.combineMode}) ===`);
for (const rival of ['steward', 'greedy', 'highliner', 'grinder', 'gambler', 'hustler', 'monk', 'nomad']) {
  const fleet = ['cardcounter', rival, rival];
  const { byArch, games } = runTournament(cfg, N, fleet);
  const cc = byArch.cardcounter;
  const rv = byArch[rival];
  console.log(
    `  cardcounter vs 2×${rival.padEnd(10)}  win% ${((cc.wins / cc.games) * 100).toFixed(0).padStart(3)}` +
    `  |  avgTotal cc ${(cc.total / cc.games).toFixed(1).padStart(5)} vs ${rival} ${(rv.total / rv.games).toFixed(1).padStart(5)}` +
    `  (${games} games)`,
  );
}

console.log(
  '\nReads:\n' +
  '  • Drops should shift outward across seasons (inshore→mid→offshore/deep) if the near commons thins faster than it recruits back.\n' +
  '  • If keeper density stays flat/high on the near grounds, they recover too fast — thin the near bags / cut recruitment (Chunk C).\n' +
  '  • Card-counter should win most head-to-heads; where it does not, that archetype has found a real edge worth keeping.',
);

import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { ROSTER, makeCardCounter } from '../src/bots';

// How big is a landing, really? The co-op's minimum-poundage dial is only sane if it
// sits where a real day's catch sits — too high and reputation's only income dies
// exactly when the bags strip and captains need it most.
const SEEDS = Number(process.argv[2] ?? 12);
const PLAYERS = Number(process.argv[3] ?? 4);
const lbs: number[] = [];
const bySeason: Record<number, number[]> = {};
const perPort: Record<string, number> = {};

for (let s = 0; s < SEEDS; s++) {
  const cfg = { ...defaultConfig, players: PLAYERS };
  let state = createInitialState(cfg, 2000 + s);
  const pol = ROSTER.slice(0, PLAYERS).map((a) => makeCardCounter(a));
  const ids = state.turnOrder.slice();
  let guard = 0;
  while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
    const pid = activePlayerId(state);
    const a = pol[ids.indexOf(pid)](state, pid, legalActions(state, pid));
    if (a.type === 'SELL') {
      const lb = state.players[pid].hold.reduce((n, t) => n + t.weightLb, 0);
      lbs.push(lb);
      (bySeason[state.season] ??= []).push(lb);
      perPort[state.players[pid].node] = (perPort[state.players[pid].node] ?? 0) + 1;
    }
    state = reduce(state, a);
  }
}
lbs.sort((a, b) => a - b);
const pct = (p: number) => lbs[Math.floor(lbs.length * p)];
console.log(`${lbs.length} landings over ${SEEDS} games (${PLAYERS}p)`);
console.log(`  median ${pct(0.5)} lb | 25th ${pct(0.25)} | 75th ${pct(0.75)} | mean ${(lbs.reduce((a, b) => a + b, 0) / lbs.length).toFixed(1)}`);
for (const th of [3, 4, 5, 6, 8]) {
  const share = lbs.filter((l) => l >= th).length / lbs.length;
  console.log(`  a ${th} lb co-op minimum would qualify ${(share * 100).toFixed(0)}% of landings`);
}
console.log('  by season (median lb):', Object.keys(bySeason).map((k) => {
  const v = bySeason[+k].slice().sort((a, b) => a - b);
  return `S${k}=${v[Math.floor(v.length / 2)]}`;
}).join(' '));
console.log('  landings per port:', perPort);

import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { ROSTER, makeCardCounter } from '../src/bots';

// How much money does a captain actually HAVE when the licence falls due? If the
// answer is "plenty, but they'd already spent it", the licence is a budgeting test
// and bots cannot take it — the same blind spot that made them useless for
// staggering and for concentration.
const SEEDS = Number(process.argv[2] ?? 8);
const PLAYERS = Number(process.argv[3] ?? 4);
const cash: Record<number, number[]> = {};
const cfg = { ...defaultConfig, players: PLAYERS, licensePerSeason: [0, 0, 0, 0, 0] }; // measure WITHOUT the fee
for (let s = 0; s < SEEDS; s++) {
  for (let rot = 0; rot < ROSTER.length; rot++) {
    const seat = Array.from({ length: PLAYERS }, (_, i) => ROSTER[(i + rot) % ROSTER.length]);
    const pol = seat.map((a) => makeCardCounter(a));
    let state = createInitialState(cfg, 6000 + s);
    const ids = state.turnOrder.slice();
    let season = 1; let guard = 0;
    while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
      if (state.season !== season) {
        season = state.season;
        for (const id of ids) (cash[season] ??= []).push(state.players[id].money);
      }
      const pid = activePlayerId(state);
      state = reduce(state, pol[ids.indexOf(pid)](state, pid, legalActions(state, pid)));
    }
  }
}
console.log(`money in hand at each season rollover (${PLAYERS}p, no licence charged)`);
for (const s of Object.keys(cash).map(Number).sort()) {
  const a = cash[s].slice().sort((x, y) => x - y);
  const q = (p: number) => a[Math.floor(a.length * p)].toFixed(0);
  const broke = (t: number) => ((a.filter((m) => m < t).length / a.length) * 100).toFixed(0);
  console.log(`  S${s}: median ${q(0.5).padStart(4)}  10th ${q(0.1).padStart(4)}  25th ${q(0.25).padStart(4)}  | under 6: ${broke(6).padStart(3)}%  under 12: ${broke(12).padStart(3)}%`);
}

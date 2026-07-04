import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { makeCardCounter, CARD_COUNTER } from '../src/bots';
import type { CardCounter } from '../src/bots';
import { report, tournament, type Named } from './tuneArchetypes';

const SEEDS = Number(process.argv[2] ?? 40);
const cc = (o: Partial<CardCounter> & { name: string }): Named => ({ name: o.name, policy: makeCardCounter({ ...CARD_COUNTER, ...o }) });

// Does theft even FIRE? Count STEAL actions per game for a given thief in the fleet.
function stealStats(thief: Named) {
  const fleet = [cc({ name: 'steward' }), cc({ name: 'greedy', haulPolicy: 'highgrade', repFloor: 5, minKeep: 1 }), thief, cc({ name: 'highliner', farBias: 1.3 })];
  let steals = 0, games = 0;
  const K = fleet.length;
  for (let s = 0; s < SEEDS; s++) for (let rot = 0; rot < K; rot++) {
    const seat = [0, 1, 2].map((i) => fleet[(i + rot) % K]);
    if (!seat.some((f) => f.name === thief.name)) continue;
    let state = createInitialState(defaultConfig, 1000 + s);
    const ids = state.turnOrder.slice();
    let g = 0;
    while (state.phase !== 'GAME_OVER' && g++ < 200000) {
      const pid = activePlayerId(state); const idx = ids.indexOf(pid);
      const a = seat[idx].policy(state, pid, legalActions(state, pid));
      if (a.type === 'STEAL' && seat[idx].name === thief.name) steals++;
      state = reduce(state, a);
    }
    games++;
  }
  return { stealsPerGame: steals / Math.max(1, games) };
}

const thiefVariants: Named[] = [
  cc({ name: 'thief', steals: true, stealPolicy: 'highgrade', repFloor: 6, minKeep: 1 }),                     // clean home + steal
  cc({ name: 'thief', steals: true, stealPolicy: 'highgrade', haulPolicy: 'highgrade', repFloor: 4, minKeep: 1 }), // raider: highgrade + steal
];
for (const t of thiefVariants) console.log(`${t.name}: steals/game = ${stealStats(t).stealsPerGame.toFixed(2)}`);

// Full-fleet balance with the aggressive raider thief.
const fleet = (thief: Named): Named[] => [
  cc({ name: 'steward' }),
  cc({ name: 'greedy', haulPolicy: 'highgrade', repFloor: 5, minKeep: 1 }),
  thief,
  cc({ name: 'highliner', farBias: 1.3 }),
];
report('thief = clean+steal (floor6)', defaultConfig, SEEDS, fleet(thiefVariants[0]));
report('thief = highgrade+steal (floor4)', defaultConfig, SEEDS, fleet(thiefVariants[1]));
report('thief = highgrade+steal (floor2)', defaultConfig, SEEDS, fleet(cc({ name: 'thief', steals: true, stealPolicy: 'highgrade', haulPolicy: 'highgrade', repFloor: 2, minKeep: 1 })));

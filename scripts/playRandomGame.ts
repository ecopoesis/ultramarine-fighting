import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import type { Action } from '../src/actions';
import type { GameState } from '../src/types';

// Weighted random policy: a crude "captain" that fishes, sells, and eventually
// berths. NOT smart play — just enough to exercise the systems and surface
// economy behavior. Replace with real strategies to study balance.
function pickAction(state: GameState, legal: Action[]): Action {
  const weight = (a: Action): number => {
    switch (a.type) {
      case 'HAUL': return 8;
      case 'SELL': return state.day === state.config.daysPerSeason ? 10 : 6;
      case 'DROP': return 5;
      case 'STEAL': return 1;
      case 'REPORT': return 6;
      case 'REFUEL': return 2;
      case 'STEAM': return 4;
      case 'BERTH': return state.hour >= state.config.hoursPerDay - 1 ? 7 : 1;
      case 'BRIBE': return 0.2;
      case 'PASS': return 0.5;
    }
  };
  const total = legal.reduce((s, a) => s + weight(a), 0);
  let r = Math.random() * total;
  for (const a of legal) { r -= weight(a); if (r <= 0) return a; }
  return legal[legal.length - 1];
}

function playOne(seed: number): { winner: string; rows: ReturnType<typeof score>; health: number; days: number } {
  let state = createInitialState(defaultConfig, seed);
  let guard = 0;
  while (state.phase === 'PLAYING' && guard++ < 100000) {
    const pid = activePlayerId(state);
    const legal = legalActions(state, pid);
    state = reduce(state, pickAction(state, legal));
  }
  const rows = score(state);
  return { winner: rows[0].name, rows, health: avgBagHealth(state), days: state.day - 1 };
}

const N = Number(process.argv[2] ?? 1);
if (N === 1) {
  const r = playOne(12345);
  console.log('=== Single game (seed 12345) ===');
  console.table(r.rows);
  console.log(`Avg bag health at end: ${(r.health * 100).toFixed(0)}%`);
} else {
  const wins: Record<string, number> = {};
  let healthSum = 0;
  for (let i = 0; i < N; i++) {
    const r = playOne(1000 + i);
    wins[r.winner] = (wins[r.winner] ?? 0) + 1;
    healthSum += r.health;
  }
  console.log(`=== ${N} games ===`);
  console.log('Wins by seat:', wins);
  console.log(`Mean bag health at end: ${((healthSum / N) * 100).toFixed(1)}%`);
  console.log('(If one seat dominates, turn-order/initiative is mis-tuned. If health ~100%, nobody is fishing enough / depletion too weak.)');
}

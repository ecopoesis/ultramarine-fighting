import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score } from '../src/engine/scoring';
import { BOTS } from '../src/bots';
import type { Config, GameState } from '../src/types';

// Dial #3 — market-close harshness (holdDecayLbPerDay). §12.3 wants missing the
// sale to be a "tense wound, not a random wipeout." Two questions:
//   (a) Does the penalty even fire? (disciplined captains sell before rollover.)
//   (b) When catch IS held over, how much value does it lose — proportionate?
// We instrument real tournament games: lbs lost to decay vs lbs sold, and how
// often a hold rides over a rollover at all.

const ARCHES = ['steward', 'greedy', 'thief'] as const;
const DECAYS = [0, 1, 2, 3];

const holdTiles = (s: GameState) => Object.values(s.players).reduce((n, p) => n + p.hold.length, 0);
// tiles decay can actually bite: KEEPER/JUMBO above the 1lb floor
const decayableTiles = (s: GameState) =>
  Object.values(s.players).reduce(
    (n, p) => n + p.hold.filter((t) => (t.kind === 'KEEPER' || t.kind === 'JUMBO') && t.weightLb > 1).length, 0);
const totalMoney = (s: GameState) => Object.values(s.players).reduce((m, p) => m + p.money, 0);

function build(holdDecayLbPerDay: number): Config {
  return { ...defaultConfig, holdDecayLbPerDay };
}

function instrumentedGame(config: Config, seed: number, seatArch: string[]) {
  const policies = seatArch.map((a) => BOTS[a]);
  let state = createInitialState(config, seed);
  const ids = state.turnOrder.slice();
  let heldOverTiles = 0, decayable = 0;
  let guard = 0;
  while (state.phase === 'PLAYING' && guard++ < 200000) {
    const pid = activePlayerId(state);
    const seat = ids.indexOf(pid);
    const action = policies[seat](state, pid, legalActions(state, pid));
    const prevDay = state.day;
    const beforeTiles = holdTiles(state);
    const beforeDecayable = decayableTiles(state);
    state = reduce(state, action);
    if (state.day > prevDay && state.phase === 'PLAYING') { // a rollover happened: this catch rode over
      heldOverTiles += beforeTiles;
      decayable += beforeDecayable;
    }
  }
  const rows = score(state);
  return { winnerId: rows[0].playerId, ids, heldOverTiles, decayable, money: totalMoney(state) };
}

const seeds = Number(process.argv[2] ?? 100);
const rows: any[] = [];
for (const decay of DECAYS) {
  const config = build(decay);
  const wins: Record<string, number> = { steward: 0, greedy: 0, thief: 0 };
  let heldOverTiles = 0, decayable = 0, money = 0, games = 0;
  for (let s = 0; s < seeds; s++) {
    for (let rot = 0; rot < 3; rot++) {
      const seatArch = [0, 1, 2].map((i) => ARCHES[(i + rot) % 3]);
      const r = instrumentedGame(config, 1000 + s, seatArch);
      games++;
      heldOverTiles += r.heldOverTiles; decayable += r.decayable; money += r.money;
      wins[seatArch[r.ids.indexOf(r.winnerId)]]++;
    }
  }
  rows.push({
    holdDecay: decay,
    'tiles held over/game': (heldOverTiles / games).toFixed(2),
    'decayable held/game': (decayable / games).toFixed(2), // KEEPER/JUMBO above 1lb floor
    'total money/game': (money / games).toFixed(1),        // invariance ⇒ the knob doesn't bind
    'S/G/T win%': `${((wins.steward / games) * 100).toFixed(0)}/${((wins.greedy / games) * 100).toFixed(0)}/${((wins.thief / games) * 100).toFixed(0)}`,
  });
}

console.log(`Market-close harshness (dial #3) — ${seeds} seeds × 3 rotations, geometricMean`);
console.log('Does catch actually get held over, and how much value does decay bite?\n');
console.table(rows);

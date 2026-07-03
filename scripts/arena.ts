import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import { BOTS } from '../src/bots';
import type { Policy } from '../src/bots';
import type { Config, GameState } from '../src/types';

// Archetype tournament. The three captains play each other; we rotate them
// through every seat so the seat-order confound (later seats winning) is
// averaged out and any remaining win-skew is strategy, not position.

const ARCHES = ['steward', 'greedy', 'thief'] as const;
type Arch = (typeof ARCHES)[number];

interface Agg {
  wins: number;
  games: number;
  total: number;
  moneyVP: number;
  conservationVP: number;
  reputationVP: number;
  berthSlotSum: number; // sum of voluntary-berth slot indices (0 = pole)
  berthCount: number;
}
const blank = (): Agg => ({ wins: 0, games: 0, total: 0, moneyVP: 0, conservationVP: 0, reputationVP: 0, berthSlotSum: 0, berthCount: 0 });

function playOne(config: Config, seed: number, seatArch: Arch[]) {
  const policies: Policy[] = seatArch.map((a) => BOTS[a]);
  let state = createInitialState(config, seed);
  const ids = state.turnOrder.slice(); // p1,p2,p3 in seat order

  let guard = 0;
  const berthSlot: Record<string, number> = {};
  while (state.phase === 'PLAYING' && guard++ < 200000) {
    const pid = activePlayerId(state);
    const seat = ids.indexOf(pid);
    const legal = legalActions(state, pid);
    const action = policies[seat](state, pid, legal);
    const wasBerthed = state.players[pid].berthed;
    state = reduce(state, action);
    // record the slot a captain CHOSE to berth into (voluntary initiative signal)
    if (!wasBerthed && state.players[pid].berthed && (action.type === 'BERTH' || action.type === 'BRIBE')) {
      berthSlot[pid] = (berthSlot[pid] ?? 0) + state.pendingNextOrder.indexOf(pid);
    }
  }

  const rows = score(state);
  const winner = rows[0];
  const health = avgBagHealth(state);
  return { rows, winnerId: winner.playerId, health, ids, berthSlot };
}

function runTournament(config: Config, seeds: number): { byArch: Record<Arch, Agg>; healthSum: number; games: number } {
  const byArch: Record<Arch, Agg> = { steward: blank(), greedy: blank(), thief: blank() };
  let healthSum = 0;
  let games = 0;

  for (let s = 0; s < seeds; s++) {
    // rotate all three archetypes through all three seats
    for (let rot = 0; rot < ARCHES.length; rot++) {
      const seatArch: Arch[] = [0, 1, 2].map((i) => ARCHES[(i + rot) % ARCHES.length]);
      const r = playOne(config, 1000 + s, seatArch);
      games++;
      healthSum += r.health;

      for (let seat = 0; seat < seatArch.length; seat++) {
        const arch = seatArch[seat];
        const pid = r.ids[seat];
        const row = r.rows.find((x) => x.playerId === pid)!;
        const a = byArch[arch];
        a.games++;
        a.total += row.total;
        a.moneyVP += row.moneyVP;
        a.conservationVP += row.conservationVP;
        a.reputationVP += row.reputationVP;
        if (r.winnerId === pid) a.wins++;
        if (pid in r.berthSlot) { a.berthSlotSum += r.berthSlot[pid]; a.berthCount++; }
      }
    }
  }
  return { byArch, healthSum, games };
}

function report(mode: 'sum' | 'weakLinkMultiplier', seeds: number) {
  const config: Config = { ...defaultConfig, scoring: { ...defaultConfig.scoring, combineMode: mode } };
  const { byArch, healthSum, games } = runTournament(config, seeds);

  console.log(`\n=== combineMode: ${mode}  (${games} games, seats rotated) ===`);
  const table = ARCHES.map((arch) => {
    const a = byArch[arch];
    const n = Math.max(1, a.games);
    return {
      archetype: arch,
      'win%': ((a.wins / n) * 100).toFixed(0),
      avgTotal: (a.total / n).toFixed(2),
      money: (a.moneyVP / n).toFixed(1),
      conserv: (a.conservationVP / n).toFixed(1),
      rep: (a.reputationVP / n).toFixed(1),
      avgBerthSlot: a.berthCount ? (a.berthSlotSum / a.berthCount).toFixed(2) : '—',
    };
  });
  console.table(table);
  console.log(`Mean bag health at end: ${((healthSum / games) * 100).toFixed(1)}%`);
}

const seeds = Number(process.argv[2] ?? 100);
console.log(`Lobsters archetype arena — ${seeds} seeds × ${ARCHES.length} seat-rotations per mode`);
report('weakLinkMultiplier', seeds);
report('sum', seeds);
console.log(
  '\nReads:\n' +
  '  • Bag health well under 100% under skilled play ⇒ the commons actually depletes (dial #2).\n' +
  '  • weakLinkMultiplier should punish rep-dumping (thief/greedy) vs sum (dial #5).\n' +
  '  • avgBerthSlot vs win% ⇒ is racing for the pole worth it? (dial #1, initiative).',
);

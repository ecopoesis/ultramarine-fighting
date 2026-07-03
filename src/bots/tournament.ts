import { createInitialState } from '../state';
import { reduce } from '../reducer';
import { legalActions } from '../actions';
import { activePlayerId } from '../selectors';
import { score, avgBagHealth } from '../engine/scoring';
import { BOTS } from './index';
import type { Policy } from './index';
import type { Config } from '../types';

// The archetypes played against each other. Default set is the settled three;
// the arena passes a wider list (adds 'highliner') via the arches argument.
export const ARCHES = ['steward', 'greedy', 'thief'] as const;
export type Arch = string;

export interface Agg {
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

export interface TournamentResult {
  byArch: Record<string, Agg>;
  healthSum: number;
  games: number;
}

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
  return { rows, winnerId: rows[0].playerId, health: avgBagHealth(state), ids, berthSlot };
}

// Rotate the archetypes through the three seats to average out the seat-order
// confound. With more than 3 archetypes, each rotation seats a sliding window of
// 3, so every archetype plays the same number of games and each seat equally.
export function runTournament(config: Config, seeds: number, arches: readonly string[] = ARCHES): TournamentResult {
  const byArch: Record<string, Agg> = {};
  for (const a of arches) byArch[a] = blank();
  let healthSum = 0;
  let games = 0;

  for (let s = 0; s < seeds; s++) {
    for (let rot = 0; rot < arches.length; rot++) {
      const seatArch: Arch[] = [0, 1, 2].map((i) => arches[(i + rot) % arches.length]);
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

import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import type { Policy } from '../src/bots';
import type { Config } from '../src/types';

// Chunk C step 4: re-differentiate the archetypes on the strong card-counter core.
// A flexible seat-rotated tournament over INJECTED policies (not the global BOTS),
// so archetype variants can be swept without touching the registry. Same N-over-3
// rotation as runTournament: every captain plays each seat equally.
export interface Named { name: string; policy: Policy }

export function tournament(config: Config, seeds: number, fleet: Named[]) {
  const agg: Record<string, { wins: number; games: number; total: number; money: number; cons: number; rep: number }> = {};
  for (const f of fleet) agg[f.name] = { wins: 0, games: 0, total: 0, money: 0, cons: 0, rep: 0 };
  let health = 0, games = 0;
  const K = fleet.length;
  for (let s = 0; s < seeds; s++) {
    for (let rot = 0; rot < K; rot++) {
      const seat = [0, 1, 2].map((i) => fleet[(i + rot) % K]);
      let state = createInitialState(config, 1000 + s);
      const ids = state.turnOrder.slice();
      let g = 0;
      while (state.phase === 'PLAYING' && g++ < 200000) {
        const pid = activePlayerId(state);
        const idx = ids.indexOf(pid);
        state = reduce(state, seat[idx].policy(state, pid, legalActions(state, pid)));
      }
      const rows = score(state);
      games++; health += avgBagHealth(state);
      for (let i = 0; i < 3; i++) {
        const a = agg[seat[i].name];
        const pid = ids[i];
        const row = rows.find((r) => r.playerId === pid)!;
        a.games++; a.total += row.total; a.money += row.moneyVP; a.cons += row.conservationVP; a.rep += row.reputationVP;
        if (rows[0].playerId === pid) a.wins++;
      }
    }
  }
  return { agg, health, games };
}

export function report(label: string, config: Config, seeds: number, fleet: Named[]) {
  const { agg, health, games } = tournament(config, seeds, fleet);
  console.log(`\n=== ${label}  (${games} games, ${config.scoring.combineMode}) ===`);
  console.table(fleet.map((f) => {
    const a = agg[f.name];
    const n = Math.max(1, a.games);
    return {
      archetype: f.name,
      'win%': ((a.wins / n) * 100).toFixed(0),
      avgTotal: (a.total / n).toFixed(2),
      money: (a.money / n).toFixed(1),
      conserv: (a.cons / n).toFixed(1),
      rep: (a.rep / n).toFixed(1),
    };
  }));
  console.log(`Mean bag health: ${((health / games) * 100).toFixed(0)}%`);
}

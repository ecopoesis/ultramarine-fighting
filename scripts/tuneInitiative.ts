import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score } from '../src/engine/scoring';
import { makePolicy, STEWARD } from '../src/bots';
import type { Config, GameState } from '../src/types';

// DIAL #1 — "Initiative ≈ marginal haul?" Isolate turn-order value by running a
// HOMOGENEOUS table of stewards, identical except for quitHour: the treatment
// captain stops fishing early to grab a front slot; the other two fish to the
// end (quitHour 99). If quitting early wins > 1/3, the pole is worth the haul
// it costs. Sweep poleRepCost to find where that trade breaks even.

const BASELINE_QUIT = 99; // the two control captains fish to the end
const QUITS = [2, 3, 4, 5, 99]; // treatment captain's quit hour (99 = same as controls)
const POLE_COSTS = [0, 1, 2, 3];

function stewardWithQuit(quitHour: number) {
  return makePolicy({ ...STEWARD, quitHour });
}

// One game; the treatment captain sits at `treatmentSeat`, the other two are
// controls that fish to the end.
function playProbe(config: Config, seed: number, treatmentQuit: number, treatmentSeat: number) {
  const quits = [BASELINE_QUIT, BASELINE_QUIT, BASELINE_QUIT];
  quits[treatmentSeat] = treatmentQuit;
  const policies = quits.map(stewardWithQuit);
  let state: GameState = createInitialState(config, seed);
  const ids = state.turnOrder.slice();

  const slotSum: Record<string, number> = {};
  const slotCount: Record<string, number> = {};
  let guard = 0;
  while (state.phase === 'PLAYING' && guard++ < 200000) {
    const pid = activePlayerId(state);
    const seat = ids.indexOf(pid);
    const action = policies[seat](state, pid, legalActions(state, pid));
    const wasBerthed = state.players[pid].berthed;
    state = reduce(state, action);
    if (!wasBerthed && state.players[pid].berthed && (action.type === 'BERTH' || action.type === 'BRIBE')) {
      slotSum[pid] = (slotSum[pid] ?? 0) + state.pendingNextOrder.indexOf(pid);
      slotCount[pid] = (slotCount[pid] ?? 0) + 1;
    }
  }

  const rows = score(state);
  const treatmentId = ids[treatmentSeat];
  const row = rows.find((r) => r.playerId === treatmentId)!;
  return {
    treatmentId,
    win: rows[0].playerId === treatmentId ? 1 : 0,
    slot: slotCount[treatmentId] ? slotSum[treatmentId] / slotCount[treatmentId] : NaN,
    money: row.moneyVP,
    total: row.total,
  };
}

const seeds = Number(process.argv[2] ?? 150);
const rows: any[] = [];
for (const poleRepCost of POLE_COSTS) {
  for (const quit of QUITS) {
    const config: Config = { ...defaultConfig, poleRepCost };
    let win = 0, slot = 0, slotN = 0, money = 0, total = 0, n = 0;
    for (let s = 0; s < seeds; s++) {
      // same board, treatment rotated through all three seats to remove seat bias
      for (let seat = 0; seat < 3; seat++) {
        const r = playProbe(config, 1000 + s, quit, seat);
        win += r.win; money += r.money; total += r.total; n++;
        if (!Number.isNaN(r.slot)) { slot += r.slot; slotN++; }
      }
    }
    rows.push({
      poleRepCost,
      quitHour: quit === 99 ? 'end' : quit,
      'win%': ((win / n) * 100).toFixed(0), // vs 33% fair share
      avgSlot: slotN ? (slot / slotN).toFixed(2) : '—',
      money: (money / n).toFixed(1),
      total: (total / n).toFixed(2),
    });
  }
}

console.log(`Initiative probe (dial #1) — homogeneous stewards, treatment quits early — ${seeds} seeds × 3 seats`);
console.log('One captain quits at quitHour to grab a slot; the other two fish to the end (quitHour "end").');
console.log('win% > 33 ⇒ quitting early to claim position beats fishing longer. avgSlot 0 = pole.\n');
console.table(rows);

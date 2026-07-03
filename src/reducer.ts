import type { GameState } from './types';
import type { Action } from './actions';
import { actionCost } from './actions';
import { steam } from './engine/movement';
import { dropBuoy, haulBuoy, stealBuoy } from './engine/buoys';
import { sell, reportTheft } from './engine/market';
import { berth, bribe } from './engine/turnorder';
import { advanceSoak } from './engine/soak';
import { restock } from './engine/restock';
import { fuelPriceAt } from './engine/ports';

// Pure: returns a new state; never mutates the input. We clone once and mutate
// the draft (engine fns operate on the draft), which keeps rule code readable.
export function reduce(state: GameState, action: Action): GameState {
  if (state.phase !== 'PLAYING') return state;
  const d: GameState = structuredClone(state);
  const p = d.players[action.playerId];
  if (!p) throw new Error('Unknown player');

  const endsTurn = applyAction(d, action);
  // spend action points
  p.actionsLeft -= actionCost(d, action);

  if (endsTurn || p.actionsLeft <= 0) {
    advanceTurn(d);
  }
  return d;
}

// returns true if this action ends the player's turn immediately
function applyAction(d: GameState, a: Action): boolean {
  switch (a.type) {
    case 'STEAM': steam(d, a.playerId, a.to); return false;
    case 'DROP': dropBuoy(d, a.playerId); return false;
    case 'HAUL': haulBuoy(d, a.playerId, a.buoyId, a.policy ?? 'clean', a.useToken ?? false); return false;
    case 'STEAL': stealBuoy(d, a.playerId, a.ownerId, a.buoyId, a.policy ?? 'clean', a.useToken ?? false); return false;
    case 'SELL': sell(d, a.playerId); return false;
    case 'REFUEL': {
      const p = d.players[a.playerId];
      const price = fuelPriceAt(d, p.node); // dear at island ports, dearer at shelters
      const units = Math.min(a.units, d.config.fuelTankMax - p.fuel, Math.floor(p.money / price));
      p.fuel += units; p.money -= units * price;
      d.log.push(`${p.name} refuels ${units} at ${p.node} (fuel ${p.fuel}, money ${p.money.toFixed(1)})`);
      return false;
    }
    case 'REPORT': reportTheft(d, a.playerId); return false;
    case 'BERTH': berth(d, a.playerId); return true;
    case 'BRIBE': bribe(d, a.playerId); return true;
    case 'PASS': return true;
  }
}

function activeCount(d: GameState): number {
  return d.turnOrder.filter((id) => !d.players[id].berthed).length;
}

function advanceTurn(d: GameState): void {
  if (activeCount(d) === 0) { dayRollover(d); return; }
  // find the next unberthed player, advancing hours/days as needed
  for (let guard = 0; guard < 10000; guard++) {
    d.activePlayerIndex++;
    if (d.activePlayerIndex >= d.turnOrder.length) {
      d.activePlayerIndex = 0;
      d.hour++;
      if (d.hour > d.config.hoursPerDay) { dayRollover(d); return; }
    }
    const id = d.turnOrder[d.activePlayerIndex];
    if (!d.players[id].berthed) {
      d.players[id].actionsLeft = d.config.actionsPerTurn;
      return;
    }
  }
  throw new Error('advanceTurn stuck');
}

function dayRollover(d: GameState): void {
  // auto-berth anyone still out, into the remaining (worst) slots
  for (const id of d.turnOrder) {
    const p = d.players[id];
    if (!p.berthed) {
      d.pendingNextOrder.push(id);
      p.berthed = true;
      d.nextSlot++;
    }
  }
  // last-slot sweetener
  const lastId = d.pendingNextOrder[d.pendingNextOrder.length - 1];
  if (lastId) {
    const lp = d.players[lastId];
    lp.fuel = Math.min(d.config.fuelTankMax, lp.fuel + d.config.lastSlotSweetenerFuel);
  }

  // tomorrow's order
  d.turnOrder = d.pendingNextOrder.length === Object.keys(d.players).length
    ? d.pendingNextOrder
    : d.turnOrder;
  d.pendingNextOrder = [];
  d.nextSlot = 0;

  // mature all buoys
  advanceSoak(d);

  // hold decay + reset day flags + recover prices
  for (const p of Object.values(d.players)) {
    p.hold = p.hold
      .map((t) => (t.kind === 'KEEPER' || t.kind === 'JUMBO'
        ? { ...t, weightLb: Math.max(1, t.weightLb - d.config.holdDecayLbPerDay) }
        : t));
    p.soldToday = false;
    p.berthed = false;
    p.actionsLeft = 0;
  }
  for (const m of Object.keys(d.markets)) d.markets[m].lbsSoldToday = 0; // prices recover overnight

  d.day++;
  if (d.day > d.config.daysPerSeason) { seasonRollover(d); return; }
  d.hour = 1;
  d.activePlayerIndex = 0;
  d.players[d.turnOrder[0]].actionsLeft = d.config.actionsPerTurn;
  d.log.push(`--- Season ${d.season} Day ${d.day} begins. Order: ${d.turnOrder.join(', ')} ---`);
}

// End of a season: the fleet ratchets outward across the arc. Recruitment breeds
// the near commons partly back (tied to the breeding stock left behind), all gear
// is pulled, and every captain returns to the start port for a fresh season.
function seasonRollover(d: GameState): void {
  if (d.season >= d.config.seasons) {
    // The final season just ended — no recovery, no reset; the game is done.
    d.phase = 'GAME_OVER';
    d.log.push('Final season over. Game over.');
    return;
  }

  // Recruitment — but NOT before the final season ("screw everyone": the
  // steward's investment is stranded, the endgame is a scramble over the scraps).
  if (d.season < d.config.seasons - 1) restock(d);

  // Pull all gear (recovers buoys, clears soak — gear holds no tiles, so this is
  // tile-neutral) and send every captain home. Hold CARRIES (already decayed by
  // the daily rollover) so accounting stays closed: end == start + recruited − sold.
  const ids = Object.keys(d.players);
  for (const id of ids) {
    const p = d.players[id];
    p.deployed = [];
    p.soak = {};
    p.buoysAvailable = d.config.buoysPerPlayer;
    p.node = d.config.map.startPort;
    p.berthNode = undefined;
    p.berthed = false;
    p.soldToday = false;
    p.actionsLeft = 0;
  }

  d.season++;
  d.turnOrder = ids;         // fresh season starts in base seat order
  d.pendingNextOrder = [];
  d.nextSlot = 0;
  d.day = 1;
  d.hour = 1;
  d.activePlayerIndex = 0;
  d.players[d.turnOrder[0]].actionsLeft = d.config.actionsPerTurn;
  d.log.push(`=== Season ${d.season} begins at ${d.config.map.startPort}. Order: ${ids.join(', ')} ===`);
}

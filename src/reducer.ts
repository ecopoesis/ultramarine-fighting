import type { GameState } from './types';
import type { Action } from './actions';
import { actionCost } from './actions';
import { steam } from './engine/movement';
import { dropBuoy, haulBuoy, stealBuoy } from './engine/buoys';
import { sell, reportTheft } from './engine/market';
import { berth, bribe } from './engine/turnorder';
import { advanceSoak } from './engine/soak';
import { finishSeasonRollover } from './engine/season';
import { applyAuctionAction } from './engine/auction';
import { fuelPriceAt, isPort, nearestPort, allPorts } from './engine/ports';
import { distance } from './engine/movement';
import { stormWhittle } from './engine/weather';
import { buyUpgrade, fuelCap } from './engine/upgrades';
import { daysThisSeason } from './selectors';
import { alignmentOn, portClosedTo, coolStars, payDividend } from './engine/alignment';

// Pure: returns a new state; never mutates the input. We clone once and mutate
// the draft (engine fns operate on the draft), which keeps rule code readable.
export function reduce(state: GameState, action: Action): GameState {
  if (state.phase === 'GAME_OVER') return state;
  const d: GameState = structuredClone(state);

  // The licence auction is its own action-driven phase.
  if (d.phase === 'AUCTION') { applyAuctionAction(d, action); return d; }

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
    case 'HAUL': haulBuoy(d, a.playerId, a.buoyId, a.policy ?? 'clean', a.eggers); return false;
    case 'STEAL': stealBuoy(d, a.playerId, a.ownerId, a.buoyId, a.policy ?? 'clean', a.eggers); return false;
    case 'SELL': sell(d, a.playerId, a.bribeDice ?? 0); return false;
    case 'REFUEL': {
      const p = d.players[a.playerId];
      const price = fuelPriceAt(d, p.node); // dear at island ports, dearer at shelters
      const units = Math.min(a.units, fuelCap(d, p) - p.fuel, Math.floor(p.money / price));
      p.fuel += units; p.money -= units * price;
      d.log.push(`${p.name} refuels ${units} at ${p.node} (fuel ${p.fuel}, money ${p.money.toFixed(1)})`);
      return false;
    }
    case 'REPORT': reportTheft(d, a.playerId); return false;
    case 'BERTH': berth(d, a.playerId); return true;
    case 'BRIBE': bribe(d, a.playerId); return true;
    case 'BUY_UPGRADE': buyUpgrade(d, a.playerId, a.upgradeId); return false;
    case 'PASS': return true;
    case 'LICENSE_BID':
    case 'LICENSE_BUY':
      throw new Error('licence actions are only legal during the AUCTION phase');
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
    const pl = d.players[d.turnOrder[d.activePlayerIndex]];
    if (!pl.berthed) {
      if ((pl.towCooldown ?? 0) > 0) { pl.towCooldown!--; continue; } // still recovering from the tow — lose this turn
      pl.actionsLeft = d.config.actionsPerTurn;
      return;
    }
  }
  throw new Error('advanceTurn stuck');
}

function dayRollover(d: GameState): void {
  // auto-berth anyone still out, into the remaining (worst) slots. A boat caught
  // AT SEA (not at a port) is towed in to the nearest port — never stranded for the
  // season — but pays for it (money + rep) and gets a little emergency fuel. This
  // also prices "camping at sea" overnight instead of returning to harbor.
  // Anyone who didn't claim a berth is seated in REVERSE of today's order: today's
  // first mover goes to the back. Without this the queue is STICKY — nobody berths
  // voluntarily, auto-berth reseats everyone in the same order, and the same captain
  // holds the pole (and pays for it) every single day while another collects the tail
  // every single day. Reversing rotates the queue, makes a deliberate BERTH a real
  // claim on a slot rather than a formality, and hands tomorrow's first pick to
  // whoever was stuck going last today.
  for (const id of [...d.turnOrder].reverse()) {
    const p = d.players[id];
    if (!p.berthed) {
      // A dock that's shut to you (you ran from it, or you're an outlaw at a refuge)
      // is no harbour tonight: you're towed on to the next one.
      const shut = portClosedTo(d, p, p.node);
      if (isPort(d, p.node) && !shut) p.madeHarbour = true; // got home on their own, just didn't formally berth
      if (!isPort(d, p.node) || shut) {
        const port = shut ? nearestOpenPort(d, p.id) : nearestPort(d, p.node);
        if (port) { p.node = port; p.berthNode = port; }
        const fee = Math.min(p.money, d.config.tow.fee);
        p.money -= fee;
        p.fuel = Math.max(p.fuel, d.config.tow.emergencyFuel);
        p.towCooldown = d.config.tow.lostTurns; // lose the next morning to the rescue
        p.tracks.reputation += d.config.tow.rep; // the harbour talks
        d.log.push(`${p.name} is towed in to ${p.node} — caught at sea (-${fee.toFixed(0)} money, ${d.config.tow.rep} reputation, loses ${d.config.tow.lostTurns} turn(s))`);
      }
      d.pendingNextOrder.push(id);
      p.berthed = true;
      d.nextSlot++;
    }
  }
  // last-slot sweetener: fuel AND standing. Whoever ends up at the back of tomorrow's
  // order let everyone else in ahead of them; the harbour notices.
  // THE POLE: first slot in tomorrow's order costs standing — to whoever ends up with
  // it, whether they berthed for it, bribed for it, or simply got seated there. You
  // cannot dodge the front of the queue by refusing to make a decision.
  // Under the switchboard the berth order is simply arrival order: get back early for
  // a good slot, or (if you're dark) pay the harbourmaster. No charge, no courtesy.
  const poleId = d.pendingNextOrder[0];
  if (!alignmentOn(d) && poleId && d.config.poleRepCost && d.pendingNextOrder.length > 1) {
    const pp = d.players[poleId];
    pp.tracks.reputation -= d.config.poleRepCost;
    d.log.push(`${pp.name} takes the pole (slot 0) — -${d.config.poleRepCost} reputation, now ${pp.tracks.reputation}`);
  }
  const lastId = d.pendingNextOrder[d.pendingNextOrder.length - 1];
  if (!alignmentOn(d) && lastId && d.pendingNextOrder.length > 1) {
    const lp = d.players[lastId];
    lp.fuel = Math.min(d.config.fuelTankMax, lp.fuel + d.config.lastSlotSweetenerFuel);
    // The courtesy is only earned by a captain who CHOSE to come in and take the back
    // of the line. A boat that simply never returned — and was auto-berthed or towed
    // in — gets the fuel but no standing: otherwise "never go home" farms the very
    // track the tow is meant to cost it.
    if (d.config.lastSlotRep && lp.madeHarbour) {
      lp.tracks.reputation += d.config.lastSlotRep;
      d.log.push(`${lp.name} takes the last berth ("after you") (+${d.config.lastSlotRep} reputation, now ${lp.tracks.reputation})`);
    }
  }

  // tomorrow's order
  d.turnOrder = d.pendingNextOrder.length === Object.keys(d.players).length
    ? d.pendingNextOrder
    : d.turnOrder;
  d.pendingNextOrder = [];
  d.nextSlot = 0;

  // mature all buoys
  advanceSoak(d);
  // the storm's daily turn: part pots left out in the blow (before they can be hauled)
  stormWhittle(d);

  // Crew wages: every captain pays for the day just worked, whatever it landed.
  if (d.config.wagePerDay > 0) {
    for (const p of Object.values(d.players)) {
      const paid = Math.min(p.money, d.config.wagePerDay); // never below zero
      p.money -= paid;
      if (paid < d.config.wagePerDay) d.log.push(`${p.name} cannot make the full crew wage (paid ${paid.toFixed(1)} of ${d.config.wagePerDay})`);
    }
  }

  // Lying low: a day away from the counter cools you off. The warden watches sales.
  for (const p of Object.values(d.players)) {
    if (!p.soldToday) coolStars(d, p, d.config.heat.coolPerDayUnsold, 'a day away from the counter');
    p.barredPorts = undefined;
  }

  // hold decay + reset day flags + recover prices
  for (const p of Object.values(d.players)) {
    p.hold = p.hold
      .map((t) => (t.kind === 'KEEPER' || t.kind === 'JUMBO'
        ? { ...t, weightLb: Math.max(1, t.weightLb - d.config.holdDecayLbPerDay) }
        : t));
    p.soldToday = false;
    p.berthed = false;
    p.madeHarbour = false;
    p.actionsLeft = 0;
  }
  for (const m of Object.keys(d.markets)) d.markets[m].lbsSoldToday = 0; // prices recover overnight

  d.day++;
  if (d.day > daysThisSeason(d)) { seasonRollover(d); return; }
  d.hour = 1;
  d.activePlayerIndex = 0;
  // grant the first turn, skipping any boat still recovering from a tow (it loses
  // the morning). With small lostTurns vs hoursPerDay, someone is always eligible.
  for (let guard = 0; guard < 10000; guard++) {
    const pl = d.players[d.turnOrder[d.activePlayerIndex]];
    if ((pl.towCooldown ?? 0) > 0) {
      pl.towCooldown!--;
      d.activePlayerIndex++;
      if (d.activePlayerIndex >= d.turnOrder.length) { d.activePlayerIndex = 0; d.hour++; if (d.hour > d.config.hoursPerDay) break; }
      continue;
    }
    pl.actionsLeft = d.config.actionsPerTurn;
    break;
  }
  d.log.push(`--- Season ${d.season} Day ${d.day} begins. Order: ${d.turnOrder.join(', ')} ---`);
}

// End of a season. The final season just ended → game over. Otherwise open the
// restock DRAFT (an interactive phase; finishSeasonRollover closes it out and
// advances the season) — except the transition INTO the final season, which gets
// no draft ("screw everyone": the commons is a stranded scramble) and rolls over
// directly.
function seasonRollover(d: GameState): void {
  payDividend(d); // the co-op shares out at every season's end (switchboard only)
  if (d.season >= d.config.seasons) {
    d.phase = 'GAME_OVER';
    d.log.push('Final season over. Game over.');
    return;
  }
  finishSeasonRollover(d);
}

// The nearest dock this captain may actually tie up at tonight.
function nearestOpenPort(d: GameState, pid: string): string | null {
  const p = d.players[pid];
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of allPorts(d).sort()) {
    if (portClosedTo(d, p, n)) continue;
    const dist = distance(d, p.node, n);
    if (dist < bestD) { bestD = dist; best = n; }
  }
  return best ?? nearestPort(d, p.node);
}

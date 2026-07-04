import type { GameState, Ground } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy } from '../engine/buoys';
import { distance } from '../engine/movement';
import { distanceToNearestPort, marketPorts, portOf } from '../engine/ports';
import {
  Policy, stepToward, myBuoys, isLastDayOfSeason, hoursLeftToday, groundNodesOfType,
  nearest, ofType, firstOfType, reachability,
  isPort, nearestPort, nearestMarketPort,
} from './helpers';

// The CARD-COUNTER: a public-information optimizer, and the fleet's strong
// baseline / instrument. It reads each ground's CURRENT bag (public info) — never
// a rival's hidden soak — computes the expected keeper-value of a prime haul,
// discounts it by how long gear must soak to prime (throughput) and by the
// round-trip reach, and fishes the best-scoring ground. As near keeper-DENSITY
// falls it migrates outward on its own, so it answers the arc's core questions:
// does the fleet ratchet out season by season, and does stewardship pay?
//
// It reads only public state (bag composition, its own gear, port geometry), so
// it is a FAIR bot — no peeking at rivals' hidden ripeness. It plays clean.
export interface CardCounter {
  name: string;
  reachCostPerStep: number; // money-equivalent penalty per round-trip step when scoring a ground
  minKeep: number;          // haul a buoy now only if drawByStage[stage].keep >= this (PRIME keep = 2)
  refuelBelow: number;      // top up at a port when fuel at/under this
  dropSlack: number;        // only drop gear that primes with this many days to SPARE (so it can be hauled, not abandoned)
  haulPolicy: HaulPolicy;   // 'clean' = lawful (v-notch/throwback, the fair default); 'greedy' = keep illegal (for stewardship probes)
}

export const CARD_COUNTER: CardCounter = {
  name: 'cardcounter', reachCostPerStep: 0.5, minKeep: 2, refuelBelow: 3, dropSlack: 1, haulPolicy: 'clean',
};

// Best market base around — a stable reference for valuing a landed pound (the
// catch sells into the same markets wherever it was fished).
function refPrice(state: GameState): number {
  const bases = marketPorts(state).map((n) => portOf(state, n)!.market!.base);
  return bases.length ? Math.max(...bases) : 1;
}

// Nights a freshly-dropped buoy must soak before its FIRST prime — gear tied up
// this long is the throughput cost of a ground. Infinity if it never primes.
function daysToPrime(state: GameState, g: Ground): number {
  const i = state.config.soakCurves[g].indexOf('PRIME');
  return i < 0 ? Infinity : i;
}

// Expected keeper POUNDS landed per prime haul from a ground's current bag:
// (keeper lbs / bag size) × prime keep-limit. This falls as keepers are stripped
// even while junk throwbacks refill the bag — it is keeper DENSITY, the true
// signal that tile-count "health" hides.
function evLbPerHaul(state: GameState, g: Ground): number {
  const bag = state.bags[g];
  if (bag.length === 0) return 0;
  let keeperLb = 0;
  for (const t of bag) if (t.kind === 'KEEPER') keeperLb += t.weightLb;
  return (keeperLb / bag.length) * state.config.drawByStage.PRIME.keep;
}

// Money-per-soak-day score for dropping a pot on `zone`, net of the round-trip
// reach cost from where we stand. Higher = better place to fish right now.
function scoreZone(state: GameState, from: string, zone: string, g: Ground, cc: CardCounter): number {
  const perDay = evLbPerHaul(state, g) / daysToPrime(state, g); // throughput-adjusted EV
  const money = perDay * refPrice(state);
  const steps = distance(state, from, zone) + distanceToNearestPort(state, zone);
  return money - cc.reachCostPerStep * steps;
}

function chooseTarget(
  state: GameState, pid: string, cc: CardCounter,
  buoys: ReturnType<typeof myBuoys>,
  reach: ReturnType<typeof reachability>,
  last: boolean,
): string {
  const p = state.players[pid];
  const sellPort = nearestMarketPort(state, p.node) ?? nearestPort(state, p.node)!;
  const anyPort = nearestPort(state, p.node)!;
  const home = () => (p.hold.length > 0 ? sellPort : anyPort);

  // Holding catch and the day is winding down — cash it in.
  if (p.hold.length > 0 && (last || hoursLeftToday(state) <= 1)) return sellPort;

  // Harvest ripe, safely-reachable gear (nearest first).
  const ripe = buoys.filter((b) => (last || b.keep >= cc.minKeep) && reach[b.node]?.safe);
  if (ripe.length) return nearest(state, p.node, ripe.map((b) => b.node)) ?? anyPort;

  // Deploy an idle pot on the best-scoring ground we can fish: over every empty,
  // safe, reachable zone whose gear can still reach prime before the season ends,
  // pick the highest money-per-soak-day net of reach. Migration is emergent — as
  // near density drops, a farther-but-richer ground wins the score.
  if (p.buoysAvailable > 0 && state.day < state.config.daysPerSeason) {
    const daysLeft = state.config.daysPerSeason - state.day;
    let best: string | null = null;
    let bestScore = 0; // require a positive net score to commit gear
    for (const g of Object.keys(state.bags) as Ground[]) {
      if (daysToPrime(state, g) > daysLeft - cc.dropSlack) continue; // must prime with time to spare to HAUL it, not abandon it
      for (const zone of groundNodesOfType(state, g)) {
        if (!reach[zone]?.safe || buoys.some((b) => b.node === zone)) continue;
        const s = scoreZone(state, p.node, zone, g, cc);
        if (s > bestScore) { bestScore = s; best = zone; }
      }
    }
    if (best) return best;
  }
  return home();
}

export function makeCardCounter(cc: CardCounter): Policy {
  return (state: GameState, pid: string, legal: Action[]): Action => {
    const cfg = state.config;
    const p = state.players[pid];
    const atPort = isPort(state, p.node);
    const last = isLastDayOfSeason(state);
    const reach = reachability(state, pid);
    const buoys = myBuoys(state, pid);
    const pass = firstOfType(legal, 'PASS')!;

    // 1) HAUL ripe own buoys (best keep first). Clean play: v-notch, throwback.
    const hauls = ofType(legal, 'HAUL');
    if (hauls.length) {
      const ranked = hauls
        .map((h) => ({ h, keep: buoys.find((b) => b.buoyId === h.buoyId)?.keep ?? 0 }))
        .filter((x) => last || x.keep >= cc.minKeep)
        .sort((a, b) => b.keep - a.keep);
      if (ranked.length) return { ...ranked[0].h, policy: cc.haulPolicy, useToken: true };
    }

    const target = chooseTarget(state, pid, cc, buoys, reach, last);
    const targetIsGround = cfg.map.nodes[target]?.type === 'ground';

    // 2) AT A PORT: report, sell, refuel, then fish again or berth.
    if (atPort) {
      const report = firstOfType(legal, 'REPORT');
      if (report) return report;
      const sell = firstOfType(legal, 'SELL');
      if (sell && p.hold.length > 0) return sell;
      const refuel = firstOfType(legal, 'REFUEL');
      if (refuel && !last && p.fuel <= cc.refuelBelow) return refuel;

      if (!last && targetIsGround && reach[target]?.safe) {
        const step = stepToward(state, p.node, target);
        const steam = step ? ofType(legal, 'STEAM').find((s) => s.to === step) : undefined;
        if (steam) return steam;
      }
      // Done for the day — but don't pay the pole (slot-0) rep cost. If we'd be
      // first into the berths, idle instead: a rival can take the front slot, or
      // the end-of-day auto-berth seats us for free. Rep is too weak to spend here.
      const berthAction = firstOfType(legal, 'BERTH');
      if (berthAction && state.nextSlot > 0) return berthAction;
      return pass;
    }

    // 3) AT SEA: drop a pot if we're standing on our empty target zone.
    if (p.node === target) {
      const drop = firstOfType(legal, 'DROP');
      if (drop && p.buoysAvailable > 0 && !buoys.some((b) => b.node === p.node)) return drop;
    }

    // Steam toward the target (grounds only while a port is still reachable after).
    const step = stepToward(state, p.node, target);
    if (step) {
      const steam = ofType(legal, 'STEAM').find((s) => s.to === step);
      if (steam && (!targetIsGround || reach[target]?.safe)) return steam;
    }
    // Otherwise limp toward the nearest port.
    const homePort = nearestPort(state, p.node);
    const homeStep = homePort ? stepToward(state, p.node, homePort) : null;
    const homeSteam = homeStep ? ofType(legal, 'STEAM').find((s) => s.to === homeStep) : undefined;
    if (homeSteam) return homeSteam;

    return pass;
  };
}

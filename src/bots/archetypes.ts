import type { GameState, Ground } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy } from '../engine/buoys';
import {
  Policy, stepToward, myBuoys, isLastDayOfSeason, hoursLeftToday, groundNodesOfType,
  nearest, ofType, firstOfType, reachability,
  isPort, nearestPort, nearestMarketPort,
} from './helpers';

// An archetype is DATA; makePolicy() turns it into a deterministic captain.
export interface Archetype {
  name: string;
  haulPolicy: HaulPolicy;      // policy on OWN catch: 'clean' = lawful (v-notch/throwback), 'greedy' = keep illegal
  stealPolicy: HaulPolicy;     // policy on STOLEN catch (a thief can be lawful at home but keep the loot it takes)
  targetGrounds: Ground[];     // ground TYPES this captain will fish, in priority order
  minKeep: number;             // haul a buoy now only if drawByStage[stage].keep >= this (else soak). PRIME keep=2.
  sellThreshold: number;       // sell once hold reaches this many tiles (always sells before leaving a port)
  steals: boolean;             // pursue and steal rival buoys when adjacent
  refuelBelow: number;         // top up fuel at a port when at/under this
  repFloor: number;            // ration rep-burning actions (theft AND high-grading): stop once rep sinks to here
  quitHour: number;            // stop fishing at/after this hour and head to port to berth (initiative dial #1)
}

export const STEWARD: Archetype = {
  name: 'steward', haulPolicy: 'clean', stealPolicy: 'clean', targetGrounds: ['inshore', 'mid'],
  minKeep: 2, sellThreshold: 3, steals: false, refuelBelow: 3, repFloor: -Infinity, quitHour: 99,
};

// The high-grader: keeps everything it hauls (illegal tiles included), and eats
// the reputation cost — until rep sinks to repFloor, when it plays clean.
export const GREEDY: Archetype = {
  name: 'greedy', haulPolicy: 'greedy', stealPolicy: 'greedy', targetGrounds: ['mid', 'inshore'],
  minKeep: 1, sellThreshold: 2, steals: false, refuelBelow: 2, repFloor: 2, quitHour: 99,
};

// A measured thief: lawful on its OWN catch, keeps what it steals, and steals
// only while it can still absorb the reputation hit.
export const THIEF: Archetype = {
  name: 'thief', haulPolicy: 'clean', stealPolicy: 'greedy', targetGrounds: ['inshore', 'mid'],
  minKeep: 1, sellThreshold: 2, steals: true, refuelBelow: 2, repFloor: 6, quitHour: 99,
};

// The highliner: works the outer water — the deep edge, then offshore — for the
// heavy/rare catch. Commits to the long run (only far grounds in its lane), keeps
// a fuller tank for the round trips, hauls whatever's ready given the narrow prime.
export const HIGHLINER: Archetype = {
  name: 'highliner', haulPolicy: 'clean', stealPolicy: 'clean', targetGrounds: ['deep', 'offshore'],
  minKeep: 2, sellThreshold: 3, steals: false, refuelBelow: 5, repFloor: -Infinity, quitHour: 99,
};

export function makePolicy(arch: Archetype): Policy {
  return (state: GameState, pid: string, legal: Action[]): Action => {
    if (state.phase === 'RESTOCK') return legal[0]; // legalActions supplies a sensible default claim/pass
    const cfg = state.config;
    const p = state.players[pid];
    const atPort = isPort(state, p.node);
    const last = isLastDayOfSeason(state);
    const reach = reachability(state, pid);
    const buoys = myBuoys(state, pid);
    const pass = firstOfType(legal, 'PASS')!; // always present

    // 1) THIEF: a rival buoy under us is a chance we can't price — take it, but
    //    only while we can still absorb the reputation hit (ration theft).
    if (arch.steals && p.tracks.reputation > arch.repFloor) {
      const steals = ofType(legal, 'STEAL');
      if (steals.length) return { ...steals[0], policy: arch.stealPolicy, useToken: true };
    }

    // 2) HAUL our own buoys worth pulling now. A measured high-grader keeps
    //    illegal tiles only while rep allows; once at repFloor it hauls clean.
    const hauls = ofType(legal, 'HAUL');
    if (hauls.length) {
      const effHaul: HaulPolicy =
        arch.haulPolicy === 'greedy' && p.tracks.reputation <= arch.repFloor ? 'clean' : arch.haulPolicy;
      const ranked = hauls
        .map((h) => ({ h, keep: buoys.find((b) => b.buoyId === h.buoyId)?.keep ?? 0 }))
        .filter((x) => last || x.keep >= arch.minKeep)
        .sort((a, b) => b.keep - a.keep);
      if (ranked.length) return { ...ranked[0].h, policy: effHaul, useToken: true };
    }

    const target = chooseTarget(state, pid, arch, buoys, reach, last);
    const targetIsGround = cfg.map.nodes[target]?.type === 'ground';

    // 3) AT A PORT: report, sell, refuel, then fish again or berth.
    if (atPort) {
      const report = firstOfType(legal, 'REPORT');
      if (report) return report; // bounty + rep, no downside

      // SELL only ever appears at a market port with a hold — never carry catch out.
      const sell = firstOfType(legal, 'SELL');
      if (sell && p.hold.length > 0) return sell;

      const refuel = firstOfType(legal, 'REFUEL');
      if (refuel && !last && p.fuel <= arch.refuelBelow) return refuel;

      // Another run, or call it a night?
      if (!last && targetIsGround && reach[target]?.safe) {
        const step = stepToward(state, p.node, target);
        const steam = step ? ofType(legal, 'STEAM').find((s) => s.to === step) : undefined;
        if (steam) return steam;
      }
      // Don't pay the pole (slot-0) rep cost just for finishing early: if we'd be
      // first into the berths, idle instead and let a rival take the front slot or
      // the end-of-day auto-berth seat us for free. (Rep is a weak track; the pole
      // is only worth its cost as a deliberate human initiative play, dial #1.)
      const berthAction = firstOfType(legal, 'BERTH');
      if (berthAction && state.nextSlot > 0) return berthAction;
      return pass;
    }

    // 4) AT SEA. Drop a pot if we're standing on a zone we came to seed.
    if (p.node === target) {
      const drop = firstOfType(legal, 'DROP');
      if (drop && p.buoysAvailable > 0 && !buoys.some((b) => b.node === p.node)) return drop;
    }

    // Steam toward the target (grounds only if we can still reach a port after).
    const step = stepToward(state, p.node, target);
    if (step) {
      const steam = ofType(legal, 'STEAM').find((s) => s.to === step);
      if (steam && (!targetIsGround || reach[target]?.safe)) return steam;
    }
    // Otherwise limp toward the nearest port.
    const home = nearestPort(state, p.node);
    const homeStep = home ? stepToward(state, p.node, home) : null;
    const homeSteam = homeStep ? ofType(legal, 'STEAM').find((s) => s.to === homeStep) : undefined;
    if (homeSteam) return homeSteam;

    return pass;
  };
}

function chooseTarget(
  state: GameState, pid: string, arch: Archetype,
  buoys: ReturnType<typeof myBuoys>,
  reach: ReturnType<typeof reachability>,
  last: boolean,
): string {
  const cfg = state.config;
  const p = state.players[pid];
  const sellPort = nearestMarketPort(state, p.node) ?? nearestPort(state, p.node)!;
  const anyPort = nearestPort(state, p.node)!;
  const home = () => (p.hold.length > 0 ? sellPort : anyPort);

  // Initiative (dial #1): past our quit hour, stop fishing and go claim a slot.
  if (!last && state.hour >= arch.quitHour) return home();

  // Holding catch and the day is winding down — go cash it in.
  if (p.hold.length > 0 && (last || hoursLeftToday(state) <= 1)) return sellPort;

  // Harvest ripe, safely-reachable gear (nearest first).
  const ripe = buoys.filter((b) => (last || b.keep >= arch.minKeep) && reach[b.node]?.safe);
  if (ripe.length) return nearest(state, p.node, ripe.map((b) => b.node)) ?? anyPort;

  // Deploy an idle pot, honoring targetGrounds PRIORITY: the first ground type we
  // fish that has a safe, empty zone we can reach — nearest such zone of that type.
  if (p.buoysAvailable > 0 && state.day < cfg.daysPerSeason) {
    for (const g of arch.targetGrounds) {
      const zones = groundNodesOfType(state, g).filter(
        (node) => reach[node]?.safe && !buoys.some((b) => b.node === node),
      );
      const pick = nearest(state, p.node, zones);
      if (pick) return pick;
    }
  }
  return home();
}

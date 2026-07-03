import type { GameState, Ground } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy } from '../engine/buoys';
import {
  Policy, stepToward, myBuoys, isLastDay, hoursLeftToday, chooseBuyer,
  groundNode, nearest, ofType, firstOfType, reachability,
} from './helpers';

// An archetype is DATA; makePolicy() turns it into a deterministic captain.
export interface Archetype {
  name: string;
  haulPolicy: HaulPolicy;      // 'clean' = lawful (v-notch/throwback), 'greedy' = keep illegal tiles
  targetGrounds: Ground[];     // preferred grounds, in priority order
  minKeep: number;             // haul a buoy now only if drawByStage[stage].keep >= this (else soak). PRIME keep=2.
  sellThreshold: number;       // sell once hold reaches this many tiles (always sells before leaving harbor)
  steals: boolean;             // pursue and steal rival buoys when adjacent
  refuelBelow: number;         // top up fuel at harbor when at/under this
}

export const STEWARD: Archetype = {
  name: 'steward', haulPolicy: 'clean', targetGrounds: ['inshore', 'mid'],
  minKeep: 2, sellThreshold: 3, steals: false, refuelBelow: 3,
};

export const GREEDY: Archetype = {
  name: 'greedy', haulPolicy: 'greedy', targetGrounds: ['mid', 'offshore', 'inshore'],
  minKeep: 1, sellThreshold: 2, steals: false, refuelBelow: 2,
};

export const THIEF: Archetype = {
  name: 'thief', haulPolicy: 'greedy', targetGrounds: ['inshore', 'mid'],
  minKeep: 1, sellThreshold: 2, steals: true, refuelBelow: 2,
};

export function makePolicy(arch: Archetype): Policy {
  return (state: GameState, pid: string, legal: Action[]): Action => {
    const cfg = state.config;
    const p = state.players[pid];
    const harbor = cfg.map.harbor;
    const atHarbor = p.node === harbor;
    const last = isLastDay(state);
    const reach = reachability(state, pid);
    const buoys = myBuoys(state, pid);
    const pass = firstOfType(legal, 'PASS')!; // always present

    // 1) THIEF: a rival buoy under us is a chance we can't price — take it.
    if (arch.steals) {
      const steals = ofType(legal, 'STEAL');
      if (steals.length) return { ...steals[0], policy: arch.haulPolicy };
    }

    // 2) HAUL our own buoys that are worth pulling now (patience = archetype.minKeep).
    const hauls = ofType(legal, 'HAUL');
    if (hauls.length) {
      const ranked = hauls
        .map((h) => ({ h, keep: buoys.find((b) => b.buoyId === h.buoyId)?.keep ?? 0 }))
        .filter((x) => last || x.keep >= arch.minKeep)
        .sort((a, b) => b.keep - a.keep);
      if (ranked.length) return { ...ranked[0].h, policy: arch.haulPolicy };
    }

    // Where do we want to be? Harvest ripe gear first, else deploy, else go home.
    const target = chooseTarget(state, pid, arch, buoys, reach, last);

    // 3) HARBOR business.
    if (atHarbor) {
      const report = firstOfType(legal, 'REPORT');
      if (report) return report; // bounty + rep, no downside

      // Never carry catch back out: sell before any outbound trip.
      const sells = ofType(legal, 'SELL');
      const leavingToFish = target !== harbor && !last;
      if (sells.length && p.hold.length > 0 && (last || p.hold.length >= arch.sellThreshold || leavingToFish || target === harbor)) {
        const buyer = chooseBuyer(state, p);
        return sells.find((s) => s.buyerId === buyer) ?? sells[0];
      }

      const refuel = firstOfType(legal, 'REFUEL');
      if (refuel && !last && p.fuel <= arch.refuelBelow) return refuel;

      // Another run, or call it a night?
      if (leavingToFish) {
        const step = stepToward(state, p.node, target);
        const steam = step ? ofType(legal, 'STEAM').find((s) => s.to === step) : undefined;
        if (steam && reach[target]?.safe) return steam;
      }
      return firstOfType(legal, 'BERTH') ?? pass;
    }

    // 4) AT SEA. If we're standing on a ground we came to seed, drop a pot.
    if (p.node === target) {
      const drop = firstOfType(legal, 'DROP');
      if (drop && p.buoysAvailable > 0 && !buoys.some((b) => b.node === p.node)) return drop;
    }

    // Steam toward the target (only outbound if we can still get home safely).
    const step = stepToward(state, p.node, target);
    if (step) {
      const steam = ofType(legal, 'STEAM').find((s) => s.to === step);
      if (steam && (target === harbor || reach[target]?.safe)) return steam;
    }
    // Otherwise head home (sell/berth next turn).
    const homeStep = stepToward(state, p.node, harbor);
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
  const harbor = cfg.map.harbor;

  // If we're holding catch and the day is winding down, go cash it in.
  if (p.hold.length > 0 && (last || hoursLeftToday(state) <= 1)) return harbor;

  // Harvest ripe, safely-reachable gear.
  const ripe = buoys.filter((b) => (last || b.keep >= arch.minKeep) && reach[b.node]?.safe);
  if (ripe.length) return nearest(state, p.node, ripe.map((b) => b.node)) ?? harbor;

  // Deploy idle pots early enough that they can actually soak (needs a rollover).
  if (p.buoysAvailable > 0 && state.day < cfg.days) {
    for (const g of arch.targetGrounds) {
      const node = groundNode(state, g);
      if (node && reach[node]?.safe && !buoys.some((b) => b.node === node)) return node;
    }
  }
  return harbor;
}

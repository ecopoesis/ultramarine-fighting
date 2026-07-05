import type { GameState, Ground, Stage } from '../types';
import type { Action } from '../actions';
import { neighbors, distance } from '../engine/movement';
import { reachability, daysThisSeason } from '../selectors';
import { stageFor, isRipe } from '../engine/soak';
export { isPort, isMarketPort, nearestPort, nearestMarketPort } from '../engine/ports';
export { daysThisSeason } from '../selectors';

// A policy decides ONE action given the current legal set. Turn-level behavior
// emerges from per-action decisions (same contract as the random runner).
// IMPORTANT: a fair bot reads only ITS OWN soak records (rival ripeness is
// hidden by design). These helpers never expose another player's SoakRecord.
export type Policy = (state: GameState, playerId: string, legal: Action[]) => Action;

export { reachability };

// Next hop from `from` that reduces graph distance to `target` (null if already there).
export function stepToward(state: GameState, from: string, target: string): string | null {
  if (from === target) return null;
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of neighbors(state, from)) {
    const d = distance(state, n, target);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// The node up to `maxHops` toward `target` — a bigger engine steams several nodes
// per action, so bots aim at the farthest reachable node on the path (null if
// already there). maxHops 1 == stepToward.
export function hopToward(state: GameState, from: string, target: string, maxHops: number): string | null {
  let cur = from;
  for (let i = 0; i < Math.max(1, maxHops); i++) {
    const nxt = stepToward(state, cur, target);
    if (!nxt) break;
    cur = nxt;
  }
  return cur === from ? null : cur;
}

export interface MyBuoy {
  buoyId: string;
  node: string;
  ground: Ground;
  stage: Stage;
  keep: number; // drawByStage[stage].keep — a proxy for "how ripe / how much it yields now"
  ripe: boolean; // haulable now? (PRIME+ when requirePrimeToHaul)
}

export function myBuoys(state: GameState, pid: string): MyBuoy[] {
  const p = state.players[pid];
  return p.deployed.map((b) => {
    const rec = p.soak[b.buoyId];
    const stage = stageFor(state, rec.ground, rec.daysSoaked);
    return {
      buoyId: b.buoyId, node: b.node, ground: rec.ground, stage,
      keep: state.config.drawByStage[stage].keep,
      ripe: isRipe(state, rec.ground, rec.daysSoaked),
    };
  });
}

export const isLastDayOfSeason = (s: GameState) => s.day === daysThisSeason(s);
export const hoursLeftToday = (s: GameState) => s.config.hoursPerDay - s.hour;

// All zone nodes of a given ground type (there can be several — e.g. two offshore).
export function groundNodesOfType(state: GameState, g: Ground): string[] {
  return Object.keys(state.config.map.nodes).filter(
    (n) => state.config.map.nodes[n].ground === g,
  );
}

export function ofType<T extends Action['type']>(legal: Action[], type: T): Extract<Action, { type: T }>[] {
  const out: Extract<Action, { type: T }>[] = [];
  for (const a of legal) if (a.type === type) out.push(a as Extract<Action, { type: T }>);
  return out;
}

export function firstOfType<T extends Action['type']>(legal: Action[], type: T): Extract<Action, { type: T }> | undefined {
  return ofType(legal, type)[0];
}

// nearest of a set of nodes to `from` (stable tie-break by name)
export function nearest(state: GameState, from: string, nodes: string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of [...nodes].sort()) {
    const d = distance(state, from, n);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

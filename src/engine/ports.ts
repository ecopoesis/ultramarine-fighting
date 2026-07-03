import type { GameState, PortConfig } from '../types';
import { distance } from './movement';

// Port helpers — the multi-port replacement for the old single `map.harbor`.
// A node is a port if it has a `port` config; it's a MARKET port if that port
// also has a `market` (shelters like Matinicus don't).

export function portOf(state: GameState, node: string): PortConfig | undefined {
  return state.config.map.nodes[node]?.port;
}

export function isPort(state: GameState, node: string): boolean {
  return !!portOf(state, node);
}

export function isMarketPort(state: GameState, node: string): boolean {
  return !!portOf(state, node)?.market;
}

export function fuelPriceAt(state: GameState, node: string): number {
  return portOf(state, node)?.fuelCostPerUnit ?? Infinity; // can't buy fuel where there's no dock
}

export function allPorts(state: GameState): string[] {
  return Object.keys(state.config.map.nodes).filter((n) => isPort(state, n));
}

export function marketPorts(state: GameState): string[] {
  return Object.keys(state.config.map.nodes).filter((n) => isMarketPort(state, n));
}

// Nearest node in a set, by graph distance from `from` (stable tie-break by name).
function nearestOf(state: GameState, from: string, nodes: string[]): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const n of [...nodes].sort()) {
    const d = distance(state, from, n);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// Any port (incl. shelters) — used for "can I get home safely?" reach checks.
export function nearestPort(state: GameState, from: string): string | null {
  return nearestOf(state, from, allPorts(state));
}

// Only ports that buy — used when a captain needs to sell.
export function nearestMarketPort(state: GameState, from: string): string | null {
  return nearestOf(state, from, marketPorts(state));
}

export function distanceToNearestPort(state: GameState, from: string): number {
  const p = nearestPort(state, from);
  return p ? distance(state, from, p) : Infinity;
}

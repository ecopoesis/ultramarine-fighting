import type { GameState } from './types';
import { distance, neighbors } from './engine/movement';

export function activePlayerId(state: GameState): string {
  return state.turnOrder[state.activePlayerIndex];
}

// Nodes the player can step to and still return to harbor, vs one-way reach.
export function reachability(state: GameState, playerId: string) {
  const p = state.players[playerId];
  const harbor = state.config.map.harbor;
  const step = state.config.map.fuelPerStep;
  const result: Record<string, { reachable: boolean; safe: boolean }> = {};
  for (const node of Object.keys(state.config.map.nodes)) {
    const toThere = distance(state, p.node, node) * step;
    const backHome = distance(state, node, harbor) * step;
    result[node] = {
      reachable: toThere <= p.fuel,
      safe: toThere + backHome <= p.fuel,
    };
  }
  return result;
}

export function neighborsOf(state: GameState, node: string) {
  return neighbors(state, node);
}

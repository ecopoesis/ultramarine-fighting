import type { GameState } from './types';
import { neighbors } from './engine/movement';
import { isPort, isMarketPort, fuelPriceAt } from './engine/ports';
import type { HaulPolicy } from './engine/buoys';

export type Action =
  | { type: 'STEAM'; playerId: string; to: string }
  | { type: 'DROP'; playerId: string }
  | { type: 'HAUL'; playerId: string; buoyId: string; policy?: HaulPolicy; useToken?: boolean }
  | { type: 'STEAL'; playerId: string; ownerId: string; buoyId: string; policy?: HaulPolicy; useToken?: boolean }
  | { type: 'SELL'; playerId: string }
  | { type: 'REFUEL'; playerId: string; units: number }
  | { type: 'REPORT'; playerId: string }
  | { type: 'BERTH'; playerId: string }
  | { type: 'BRIBE'; playerId: string }
  | { type: 'PASS'; playerId: string };

export function actionCost(state: GameState, a: Action): number {
  return state.config.actionCost[a.type] ?? 0;
}

// Enumerate legal actions for a player right now. Always includes PASS so the
// game can never deadlock. Powers both the UI buttons and the runner.
export function legalActions(state: GameState, playerId: string): Action[] {
  const p = state.players[playerId];
  const out: Action[] = [{ type: 'PASS', playerId }];
  if (p.berthed || state.phase !== 'PLAYING') return out;

  const cfg = state.config;
  const atPort = isPort(state, p.node);
  const node = cfg.map.nodes[p.node];
  const canAfford = (t: Action) => p.actionsLeft >= actionCost(state, t);

  // steam
  if (p.fuel >= cfg.map.fuelPerStep) {
    for (const to of neighbors(state, p.node)) {
      const t: Action = { type: 'STEAM', playerId, to };
      if (canAfford(t)) out.push(t);
    }
  }
  // drop
  if (node?.type === 'ground' && p.buoysAvailable > 0) {
    const t: Action = { type: 'DROP', playerId };
    if (canAfford(t)) out.push(t);
  }
  // haul own buoys here
  for (const b of p.deployed) {
    if (b.node === p.node) {
      const t: Action = { type: 'HAUL', playerId, buoyId: b.buoyId };
      if (canAfford(t)) out.push(t);
    }
  }
  // steal rival buoys here
  for (const other of Object.values(state.players)) {
    if (other.id === playerId) continue;
    for (const b of other.deployed) {
      if (b.node === p.node) {
        const t: Action = { type: 'STEAL', playerId, ownerId: other.id, buoyId: b.buoyId };
        if (canAfford(t)) out.push(t);
      }
    }
  }
  // port actions (any dock; only market ports buy)
  if (atPort) {
    if (isMarketPort(state, p.node) && !p.soldToday && p.hold.length > 0) {
      const t: Action = { type: 'SELL', playerId };
      if (canAfford(t)) out.push(t);
    }
    const price = fuelPriceAt(state, p.node);
    if (p.fuel < cfg.fuelTankMax && p.money >= price) {
      const units = Math.min(cfg.fuelTankMax - p.fuel, Math.floor(p.money / price));
      const t: Action = { type: 'REFUEL', playerId, units };
      if (units > 0 && canAfford(t)) out.push(t);
    }
    if (state.thefts.some((x) => x.victimId === playerId)) {
      const t: Action = { type: 'REPORT', playerId };
      if (canAfford(t)) out.push(t);
    }
    out.push({ type: 'BERTH', playerId });
    if (p.money >= cfg.bribeMoneyCost) out.push({ type: 'BRIBE', playerId });
  }
  return out;
}

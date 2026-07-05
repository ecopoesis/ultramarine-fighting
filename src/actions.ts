import type { GameState, Ground } from './types';
import { neighbors, distance } from './engine/movement';
import { isPort, isMarketPort, fuelPriceAt } from './engine/ports';
import { isRipe } from './engine/soak';
import { upgradesOn, upgradeDisplay, canBuyUpgrade, freesAction, fuelCap, stepsPerSteam } from './engine/upgrades';
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
  | { type: 'BUY_UPGRADE'; playerId: string; upgradeId: string } // refit at a market port's chandlery
  | { type: 'PASS'; playerId: string }
  // restock draft (phase === 'RESTOCK')
  | { type: 'RESTOCK_CLAIM'; playerId: string; ground: Ground; tileIds: string[] }        // claim a bag, return these pile tiles
  | { type: 'RESTOCK_CONTRIBUTE'; playerId: string; tileIds: string[] };                   // spend v-notch: return these (empty = pass)

export function actionCost(state: GameState, a: Action): number {
  const base = state.config.actionCost[a.type] ?? 0;
  // a refit can make its action free (crane→HAUL, tender→SELL, pot rack→DROP, …)
  if (base > 0) {
    const p = state.players[a.playerId];
    if (p && freesAction(state, p, a.type)) return 0;
  }
  return base;
}

// Enumerate legal actions for a player right now. Always includes PASS so the
// game can never deadlock. Powers both the UI buttons and the runner.
export function legalActions(state: GameState, playerId: string): Action[] {
  if (state.phase === 'RESTOCK') return legalRestock(state, playerId);

  const p = state.players[playerId];
  const out: Action[] = [{ type: 'PASS', playerId }];
  if (p.berthed || state.phase !== 'PLAYING') return out;

  const cfg = state.config;
  const atPort = isPort(state, p.node);
  const node = cfg.map.nodes[p.node];
  const canAfford = (t: Action) => p.actionsLeft >= actionCost(state, t);

  // steam — to any node within the ship's reach per action (base 1 hop; a bigger
  // engine reaches farther), if there's fuel for the hops
  if (p.fuel >= cfg.map.fuelPerStep) {
    const reach = stepsPerSteam(state, p);
    const targets = reach <= 1
      ? neighbors(state, p.node)
      : Object.keys(cfg.map.nodes).filter((n) => { const h = distance(state, p.node, n); return h >= 1 && h <= reach; });
    for (const to of targets) {
      const t: Action = { type: 'STEAM', playerId, to };
      if (p.fuel >= distance(state, p.node, to) * cfg.map.fuelPerStep && canAfford(t)) out.push(t);
    }
  }
  // drop
  if (node?.type === 'ground' && p.buoysAvailable > 0) {
    const t: Action = { type: 'DROP', playerId };
    if (canAfford(t)) out.push(t);
  }
  // haul own buoys here — only once they've ripened to PRIME
  for (const b of p.deployed) {
    if (b.node === p.node && isRipe(state, p.soak[b.buoyId].ground, p.soak[b.buoyId].daysSoaked)) {
      const t: Action = { type: 'HAUL', playerId, buoyId: b.buoyId };
      if (canAfford(t)) out.push(t);
    }
  }
  // steal rival buoys here (also only if ripe — nothing worth taking from a fresh pot)
  for (const other of Object.values(state.players)) {
    if (other.id === playerId) continue;
    for (const b of other.deployed) {
      if (b.node === p.node && isRipe(state, other.soak[b.buoyId].ground, other.soak[b.buoyId].daysSoaked)) {
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
    if (p.fuel < fuelCap(state, p) && p.money >= price) {
      const units = Math.min(fuelCap(state, p) - p.fuel, Math.floor(p.money / price));
      const t: Action = { type: 'REFUEL', playerId, units };
      if (units > 0 && canAfford(t)) out.push(t);
    }
    if (state.thefts.some((x) => x.victimId === playerId)) {
      const t: Action = { type: 'REPORT', playerId };
      if (canAfford(t)) out.push(t);
    }
    out.push({ type: 'BERTH', playerId });
    if (p.money >= cfg.bribeMoneyCost) out.push({ type: 'BRIBE', playerId });
    // refit at the chandlery: any face-up upgrade you can afford with a free slot
    if (upgradesOn(state)) {
      for (const id of upgradeDisplay(state, p.node)) {
        const t: Action = { type: 'BUY_UPGRADE', playerId, upgradeId: id };
        if (canBuyUpgrade(state, p, id) && canAfford(t)) out.push(t);
      }
    }
  }
  return out;
}

// Legal moves for the active restocker. The full choice (WHICH lobsters) is
// combinatorial, so instead of enumerating it we return sensible DEFAULTS: on a
// claim turn, one CLAIM per remaining bag pre-filled with the heaviest keepers the
// roll allows; on a contribute turn, a single "pass" (spend nothing). A generic
// runner picking the first option restocks reasonably; smart bots build their own.
function legalRestock(state: GameState, playerId: string): Action[] {
  const r = state.restock!;
  const grounds = Object.keys(state.bags) as Ground[];
  if (r.step === 'contribute') return [{ type: 'RESTOCK_CONTRIBUTE', playerId, tileIds: [] }];
  return grounds
    .filter((g) => !r.claimed.includes(g))
    .map((g) => {
      const heaviest = [...state.piles[g]].sort((a, b) => b.weightLb - a.weightLb);
      const tileIds = heaviest.slice(0, Math.min(r.roll, heaviest.length)).map((t) => t.id);
      return { type: 'RESTOCK_CLAIM', playerId, ground: g, tileIds } as Action;
    });
}

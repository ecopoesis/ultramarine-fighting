import type { GameState, Action } from './engine';

export function nodeLabel(state: GameState, node: string): string {
  return state.config.map.nodes[node]?.label ?? node;
}

// A short human label for a legal action button.
export function actionLabel(state: GameState, a: Action): string {
  switch (a.type) {
    case 'STEAM': return `Steam → ${nodeLabel(state, a.to)}`;
    case 'DROP': return 'Drop a pot';
    case 'HAUL': return `Haul pot ${a.buoyId}`;
    case 'STEAL': return `Steal ${state.players[a.ownerId]?.name ?? a.ownerId}'s pot`;
    case 'SELL': {
      const p = state.players[a.playerId];
      const lb = p.hold.reduce((s, t) => s + t.weightLb, 0);
      return `Sell hold (${p.hold.length} tiles, ${lb}lb)`;
    }
    case 'REFUEL': return `Refuel +${a.units}`;
    case 'REPORT': return 'Report the theft';
    case 'BERTH': return 'Berth — end day here';
    case 'BRIBE': return 'Bribe for the pole';
    case 'PASS': return 'Pass / end turn';
    case 'RESTOCK_CLAIM': return `Claim ${a.ground} (+${a.tileIds.length})`;
    case 'RESTOCK_CONTRIBUTE':
      return a.tileIds.length ? `Contribute ${a.tileIds.length} v-notch` : 'Contribute nothing';
    case 'BUY_UPGRADE': {
      const def = state.config.upgrades.catalog.find((u) => u.id === a.upgradeId);
      return `Refit: ${def?.label ?? a.upgradeId} (−${def?.cost ?? '?'})`;
    }
  }
}

// Group actions for tidy button rows.
export function actionGroup(a: Action): 'move' | 'gear' | 'port' | 'end' {
  switch (a.type) {
    case 'STEAM': return 'move';
    case 'DROP': case 'HAUL': case 'STEAL': return 'gear';
    case 'SELL': case 'REFUEL': case 'REPORT': case 'BRIBE': case 'BUY_UPGRADE': return 'port';
    default: return 'end';
  }
}

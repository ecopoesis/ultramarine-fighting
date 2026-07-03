import type { GameState } from '../types';

// Berth = done for the day. The order players berth IS tomorrow's turn order.
// Claiming the FRONT slot (slot 0) costs reputation, however you got there.
export function berth(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (p.node !== d.config.map.harbor) throw new Error('Must be at harbor to berth');
  if (p.berthed) return;
  const slot = d.nextSlot++;
  d.pendingNextOrder.push(playerId);
  p.berthed = true;
  if (slot === 0) p.tracks.reputation += d.config.poleRepCost * -1 < 0 ? 0 : 0; // see below
  // poleRepCost is a positive magnitude; front slot loses that much rep:
  if (slot === 0) p.tracks.reputation -= d.config.poleRepCost;
  d.log.push(`${p.name} berths into slot ${slot}${slot === 0 ? ' (pole, -rep)' : ''}`);
}

// Bribe to jump to the front of tomorrow's order if you didn't berth early enough.
// Pays money + rep; still incurs the front-slot rep cost implicitly via reordering.
export function bribe(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (p.node !== d.config.map.harbor) throw new Error('Bribe at harbor');
  if (p.money < d.config.bribeMoneyCost) throw new Error('Cannot afford bribe');
  p.money -= d.config.bribeMoneyCost;
  p.tracks.reputation += d.config.rep.bribe;
  // move (or insert) this player to the front of pending order
  const existing = d.pendingNextOrder.indexOf(playerId);
  if (existing >= 0) d.pendingNextOrder.splice(existing, 1);
  d.pendingNextOrder.unshift(playerId);
  if (!p.berthed) { p.berthed = true; d.nextSlot++; }
  d.log.push(`${p.name} bribes the harbormaster to take the front slot`);
}

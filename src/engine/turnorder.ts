import type { GameState } from '../types';
import { isPort } from './ports';

// Berth = done for the day, at whatever port you sailed to. The order players
// berth IS tomorrow's turn order; the port you berth in is where you start
// tomorrow (the daily home-port choice). Claiming slot 0 (the pole) costs rep.
export function berth(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (!isPort(d, p.node)) throw new Error('Must be at a port to berth');
  if (p.berthed) return;
  const slot = d.nextSlot++;
  d.pendingNextOrder.push(playerId);
  p.berthed = true;
  p.berthNode = p.node;
  if (slot === 0) p.tracks.reputation -= d.config.poleRepCost; // front slot: the pole costs rep
  d.log.push(`${p.name} berths at ${p.node} into slot ${slot}${slot === 0 ? ' (pole, -rep)' : ''}`);
}

// Bribe to jump to the front of tomorrow's order if you didn't berth early enough.
// Pays money + rep; you still berth in whatever port you're standing in.
export function bribe(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (!isPort(d, p.node)) throw new Error('Bribe at a port');
  if (p.money < d.config.bribeMoneyCost) throw new Error('Cannot afford bribe');
  p.money -= d.config.bribeMoneyCost;
  p.tracks.reputation += d.config.rep.bribe;
  const existing = d.pendingNextOrder.indexOf(playerId);
  if (existing >= 0) d.pendingNextOrder.splice(existing, 1);
  d.pendingNextOrder.unshift(playerId);
  if (!p.berthed) { p.berthed = true; p.berthNode = p.node; d.nextSlot++; }
  d.log.push(`${p.name} bribes the harbormaster to take the front slot at ${p.node}`);
}

import type { GameState } from '../types';
import { nextRandom } from '../rng';
import { weatherOn, isStormed } from './weather';
import { stepsPerSteam, isStormImmune } from './upgrades';

export function neighbors(state: GameState, node: string): string[] {
  const out: string[] = [];
  for (const [a, b] of state.config.map.edges) {
    if (a === node) out.push(b);
    if (b === node) out.push(a);
  }
  return out;
}

// BFS distance in steps between two nodes
export function distance(state: GameState, from: string, to: string): number {
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: string[] = [];
    for (const n of frontier) {
      for (const m of neighbors(state, n)) {
        if (m === to) return d;
        if (!seen.has(m)) { seen.add(m); next.push(m); }
      }
    }
    frontier = next;
  }
  return Infinity;
}

export function steam(d: GameState, playerId: string, to: string): void {
  const p = d.players[playerId];
  // A bigger engine moves several nodes per STEAM action; base ships hop one.
  const hops = distance(d, p.node, to);
  if (hops < 1 || hops > stepsPerSteam(d, p)) throw new Error(`Cannot steam ${p.node}->${to} in one action`);
  const cost = hops * d.config.map.fuelPerStep;
  if (p.fuel < cost) throw new Error('Out of fuel');
  p.fuel -= cost;
  p.node = to;
  d.log.push(`${p.name} steams to ${to} (${hops} hop${hops > 1 ? 's' : ''}, fuel ${p.fuel})`);

  // Storm entry hazard: pushing INTO a stormed node risks a beating (lost fuel).
  // Chancy, not a wall. Shelters are never stormed; RADAR makes you immune.
  if (weatherOn(d) && isStormed(d, to) && !isStormImmune(d, p) && nextRandom(d) < d.config.weather.hazardChance) {
    const loss = Math.min(p.fuel, d.config.weather.hazardFuel);
    p.fuel -= loss;
    d.log.push(`${p.name} takes a beating in the storm at ${to} (-${loss} fuel, now ${p.fuel})`);
  }
}

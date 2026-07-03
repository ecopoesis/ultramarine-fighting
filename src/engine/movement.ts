import type { GameState } from '../types';

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
  const cost = d.config.map.fuelPerStep;
  if (!neighbors(d, p.node).includes(to)) throw new Error(`No edge ${p.node}->${to}`);
  if (p.fuel < cost) throw new Error('Out of fuel');
  p.fuel -= cost;
  p.node = to;
  d.log.push(`${p.name} steams to ${to} (fuel ${p.fuel})`);
}

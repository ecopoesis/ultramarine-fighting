import type { GameState, Tile } from '../types';

// Seeded lobsters: a generic keeper is dropped on every fishing SPACE at the start
// of each season, and they ACCUMULATE on unfished spaces (state.seeded is a per-node
// count). A haul pulls the space's pile first, then the bag — so a neglected corner
// becomes a growing jackpot that lures the fleet to work the whole map. Generic
// means OPEN economy: these lobsters are minted here and, when sold, leave the world
// (market.sell keeps them off the restock piles). Inert while flags.seeded is off:
// no seeding, no pulls, so the closed bag/pile census is untouched.

export function seededOn(d: GameState): boolean {
  return d.config.flags.seeded;
}

// Every zone node of the map (a fishing space). Ports/shelters are not spaces.
function spaceNodes(d: GameState): string[] {
  return Object.keys(d.config.map.nodes).filter((n) => d.config.map.nodes[n].type === 'ground');
}

// Start-of-season drop: +perSeason on every space. Called at game start and every
// season rollover, so unfished spaces pile up across the game. No RNG.
export function seedSpaces(d: GameState): void {
  if (!seededOn(d)) return;
  const per = d.config.seeded.perSeason;
  for (const n of spaceNodes(d)) d.seeded[n] = (d.seeded[n] ?? 0) + per;
}

// Pull the seeded pile off a space into `holder`'s hold as generic keepers (up to
// haulCap), clearing what was taken. Called at the START of a haul/steal, before the
// bag draw. Returns how many were pulled. The minted tiles carry seeded:true so the
// sale routes them out of the world instead of onto a restock pile.
export function pullSeeded(d: GameState, holderId: string, node: string): number {
  if (!seededOn(d)) return 0;
  const have = d.seeded[node] ?? 0;
  if (have <= 0) return 0;
  const take = Math.min(have, d.config.seeded.haulCap);
  const holder = d.players[holderId];
  const g = d.config.map.nodes[node].ground!;
  for (let i = 0; i < take; i++) {
    const t: Tile = { id: `seed-${node}-${d.buoyCounter}-${i}`, kind: 'KEEPER', weightLb: d.config.seeded.weightLb, color: 'common', ground: g, seeded: true };
    holder.hold.push(t);
  }
  d.seeded[node] = have - take;
  d.log.push(`${holder.name} pulls ${take} seeded lobster(s) off ${node} (pile ${d.seeded[node]} left)`);
  return take;
}

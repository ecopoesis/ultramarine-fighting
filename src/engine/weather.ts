import type { GameState, Ground } from '../types';
import { nextRandom, randInt } from '../rng';

// Every zone node of a given ground type (a tier can have several — e.g. six mid).
function nodesOfTier(d: GameState, g: Ground): string[] {
  return Object.keys(d.config.map.nodes).filter((n) => d.config.map.nodes[n].ground === g);
}

// Weather engine (Chunk D). Storms live on NODES (state.stormed). They are placed
// fresh at each season rollover from the season's storm track — old tokens clear,
// the storm die re-rolls which nodes in each tier get hit — then intensify inward
// over the game. Three effects live in other engine files (they need the action
// context): the ENTRY hazard in movement.steam, the FISHING bonus in buoys.haul,
// and the daily WHITTLE below in reducer.dayRollover. Shelters are never stormed
// (only `ground` nodes are eligible), so they stay a true refuge.

// True only while weather is switched on. Every effect is gated on this, so with
// the flag off the whole subsystem is inert and consumes no RNG (existing tuning
// is byte-identical until the flag flips).
export function weatherOn(d: GameState): boolean {
  return d.config.flags.weather;
}

export function isStormed(d: GameState, node: string): boolean {
  return d.stormed.includes(node);
}

// Pick k distinct nodes from a list, using the game RNG (the "storm die"). If k
// covers the whole tier, all of it storms (the deep's single node → always).
function pickDistinct(d: GameState, nodes: string[], k: number): string[] {
  const pool = nodes.slice();
  const out: string[] = [];
  for (let i = 0; i < k && pool.length > 0; i++) {
    out.push(pool.splice(randInt(d, pool.length), 1)[0]);
  }
  return out;
}

// Clear and re-roll the storm map for the current season. Called at every season
// rollover (INCLUDING the no-restock 4→5: weather worsens even as the ocean stops
// recovering) and once at game start. With the flag off it just clears the set —
// no RNG consumed, so seeds are stable. S1's track is calm, so a fresh game also
// consumes no RNG here.
export function placeStorms(d: GameState): void {
  d.stormed = [];
  if (!weatherOn(d)) return;
  const track = d.config.weather.track;
  const counts = track[Math.min(d.season - 1, track.length - 1)];
  for (const g of Object.keys(counts) as Ground[]) {
    const k = counts[g];
    if (k > 0) d.stormed.push(...pickDistinct(d, nodesOfTier(d, g), k));
  }
  if (d.stormed.length) d.log.push(`Storm map (S${d.season}): ${d.stormed.join(', ')}`);
}

// The storm's daily turn: every pot left in a stormed node may be PARTED overnight
// (the trap is lost for the season — buoysAvailable is NOT returned; it resets at
// the season rollover). This is the cost of leaving gear out in the blow; a
// captain who hauls and retreats to a shelter keeps their string. No tiles move
// (a soaking pot holds none), so the census stays closed.
export function stormWhittle(d: GameState): void {
  if (!weatherOn(d) || d.stormed.length === 0) return;
  const chance = d.config.weather.whittleChance;
  for (const p of Object.values(d.players)) {
    for (const b of p.deployed.slice()) {
      if (!isStormed(d, b.node)) continue;
      if (nextRandom(d) < chance) {
        p.deployed = p.deployed.filter((x) => x.buoyId !== b.buoyId);
        delete p.soak[b.buoyId];
        d.log.push(`Storm parts ${p.name}'s pot at ${b.node} (lost)`);
      }
    }
  }
}

import type { GameState, Ground, Tile, Stage } from '../types';
import { takeRandom } from '../rng';
import { stageFor } from './soak';
import { isKeeper, isIllegal, isEgger } from '../tiles';

function groundAt(d: GameState, node: string): Ground {
  const n = d.config.map.nodes[node];
  if (n?.type !== 'ground' || !n.ground) throw new Error(`${node} is not a fishing ground`);
  return n.ground;
}

export function dropBuoy(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (p.buoysAvailable <= 0) throw new Error('No buoys available');
  const ground = groundAt(d, p.node);
  const buoyId = `b${d.buoyCounter++}`;
  p.buoysAvailable -= 1;
  p.deployed.push({ buoyId, node: p.node, ownerId: playerId });
  p.soak[buoyId] = { ground, daysSoaked: 0 };
  d.log.push(`${p.name} drops buoy ${buoyId} at ${p.node}`);
}

// Decision policy for what to do with drawn tiles.
// `clean` = lawful: keep best legal keepers up to limit, throw shorts/jumbos back, v-notch eggers.
// Humans in the UI would choose per-tile; the runner uses 'clean'.
export type HaulPolicy = 'clean' | 'greedy';

function resolveDraw(
  d: GameState, playerId: string, ground: Ground, stage: Stage, policy: HaulPolicy,
): void {
  const p = d.players[playerId];
  const rule = d.config.drawByStage[stage];
  const drawn: Tile[] = [];
  for (let i = 0; i < rule.draw; i++) {
    const t = takeRandom(d, d.bags[ground]);
    if (t) drawn.push(t);
  }

  const keepers = drawn.filter(isKeeper).sort((a, b) => b.weightLb - a.weightLb);
  let kept = 0;

  for (const t of drawn) {
    if (isKeeper(t)) {
      if (keepers.indexOf(t) < rule.keep && kept < rule.keep) {
        p.hold.push(t); kept++;
      } else {
        d.bags[ground].push(t); // over the keep limit, back it goes
      }
    } else if (isEgger(t)) {
      if (policy === 'greedy') {
        p.hold.push(t); // illegal keep of a berried female
        p.tracks.reputation += d.config.rep.illegalKeep;
      } else {
        d.bags[ground].push(t); // v-notch: returns to the bag (refills the commons)
        p.vTokens += 1;
        p.tracks.conservation += d.config.rep.vNotch;
      }
    } else if (isIllegal(t)) {
      if (policy === 'greedy') {
        p.hold.push(t);
        p.tracks.reputation += d.config.rep.illegalKeep;
      } else {
        d.bags[ground].push(t); // legal throwback, free
      }
    }
  }
  d.log.push(`${p.name} hauls (${ground}/${stage}): kept ${kept}, vTokens ${p.vTokens}`);
}

export function haulBuoy(d: GameState, playerId: string, buoyId: string, policy: HaulPolicy = 'clean'): void {
  const p = d.players[playerId];
  const idx = p.deployed.findIndex((b) => b.buoyId === buoyId);
  if (idx < 0) throw new Error('Not your buoy / not deployed');
  const buoy = p.deployed[idx];
  if (buoy.node !== p.node) throw new Error('Buoy is elsewhere');
  const rec = p.soak[buoyId];
  const stage = stageFor(d, rec.ground, rec.daysSoaked);
  resolveDraw(d, playerId, rec.ground, stage, policy);
  // recover the gear
  p.deployed.splice(idx, 1);
  delete p.soak[buoyId];
  p.buoysAvailable += 1;
}

export function stealBuoy(d: GameState, thiefId: string, ownerId: string, buoyId: string, policy: HaulPolicy = 'clean'): void {
  const thief = d.players[thiefId];
  const owner = d.players[ownerId];
  const idx = owner.deployed.findIndex((b) => b.buoyId === buoyId);
  if (idx < 0) throw new Error('No such rival buoy');
  const buoy = owner.deployed[idx];
  if (buoy.node !== thief.node) throw new Error('Rival buoy is elsewhere');
  const rec = owner.soak[buoyId];
  const stage = stageFor(d, rec.ground, rec.daysSoaked); // thief gambles on OWNER's hidden ripeness

  const holdBefore = thief.hold.length;
  resolveDraw(d, thiefId, rec.ground, stage, policy);
  const stolen = thief.hold.slice(holdBefore);
  const value = stolen.reduce((s, t) => s + t.weightLb, 0) * d.config.buyers.coop.base;

  // gear and rep
  owner.deployed.splice(idx, 1);
  delete owner.soak[buoyId];
  owner.buoysAvailable += 1; // owner recovers the gear, loses the catch
  thief.tracks.reputation += d.config.rep.steal;
  d.thefts.push({ victimId: ownerId, thiefId, value });
  d.log.push(`${thief.name} STEALS buoy ${buoyId} from ${owner.name} (value ~${value})`);
}

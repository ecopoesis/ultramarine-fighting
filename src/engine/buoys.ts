import type { GameState, Ground, Tile, Stage } from '../types';
import { takeRandom } from '../rng';
import { stageFor, isRipe } from './soak';
import { isKeeper, isIllegal, isEgger, isVnotched, tileTemplate } from '../tiles';
import { marketPorts, portOf } from './ports';
import { weatherOn } from './weather';
import { pullSeeded } from './seeded';

// A reference "book price" for valuing stolen catch (report bounty), independent
// of which port the loot might eventually sell at: the best market base around.
function refPrice(d: GameState): number {
  const bases = marketPorts(d).map((n) => portOf(d, n)!.market!.base);
  return bases.length ? Math.max(...bases) : 1;
}

function groundAt(d: GameState, node: string): Ground {
  const n = d.config.map.nodes[node];
  if (n?.type !== 'ground' || !n.ground) throw new Error(`${node} is not a fishing ground`);
  return n.ground;
}

// How many pots this space can hold, all captains counted, scaled to the table size.
export function potCapacity(d: GameState): number {
  const cfg = d.config;
  if (!cfg.maxPotsPerSpace) return Infinity;
  return Math.max(1, Math.round(cfg.maxPotsPerSpace * (cfg.players / cfg.referencePlayers)));
}

// Pots currently on a space, across the whole fleet (public information — buoys float).
export function potsOnNode(d: GameState, node: string): number {
  let n = 0;
  for (const p of Object.values(d.players)) for (const b of p.deployed) if (b.node === node) n++;
  return n;
}

export function spaceHasRoom(d: GameState, node: string): boolean {
  return potsOnNode(d, node) < potCapacity(d);
}

export function dropBuoy(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (p.buoysAvailable <= 0) throw new Error('No buoys available');
  const ground = groundAt(d, p.node);
  if (!spaceHasRoom(d, p.node)) throw new Error(`${p.node} is full — ${potCapacity(d)} pots is all that ground will take`);
  const buoyId = `b${d.buoyCounter++}`;
  p.buoysAvailable -= 1;
  p.deployed.push({ buoyId, node: p.node, ownerId: playerId });
  p.soak[buoyId] = { ground, daysSoaked: 0 };
  d.log.push(`${p.name} drops buoy ${buoyId} at ${p.node}`);
}

// Decision policy for what to do with drawn tiles. Humans choose per-tile; bots pick one.
// `clean`     = lawful: keep legal keepers, throw shorts/jumbos back, v-notch eggers.
// `greedy`    = keep EVERYTHING illegal (shorts, jumbos, eggers) — indiscriminate.
// `highgrade` = keep only the VALUABLE illegal (heavy jumbos); still throws shorts
//               back and v-notches eggers. The smart high-grader: takes the illegal
//               tiles that actually pay, without burning rep on worthless ones.
export type HaulPolicy = 'clean' | 'greedy' | 'highgrade';

function resolveDraw(
  d: GameState, playerId: string, ground: Ground, stage: Stage, policy: HaulPolicy, useToken: boolean,
  stormy = false,
): void {
  const p = d.players[playerId];
  const rule = d.config.drawByStage[stage];
  // A stormed node churns up bonus lobster: extra draws and a raised keep limit.
  // This is the REWARD half of the gamble — priced against the entry hazard and
  // the overnight whittle to a near-wash, so the far grounds are a bet, not a wall.
  const bonus = stormy && weatherOn(d);
  const drawN = rule.draw + (bonus ? d.config.weather.bonusDraws : 0);
  const keepN = rule.keep + (bonus ? d.config.weather.bonusKeep : 0);
  const drawn: Tile[] = [];
  for (let i = 0; i < drawN; i++) {
    const t = takeRandom(d, d.bags[ground]);
    if (t) drawn.push(t);
  }

  const keepers = drawn.filter(isKeeper).sort((a, b) => b.weightLb - a.weightLb);
  let kept = 0;

  for (const t of drawn) {
    if (isKeeper(t)) {
      if (keepers.indexOf(t) < keepN && kept < keepN) {
        p.hold.push(t); kept++;
      } else {
        d.bags[ground].push(t); // over the keep limit, back it goes
      }
    } else if (isVnotched(t)) {
      // Already notched: she is released, always, whatever your policy. No score —
      // you only ever get paid for notching a lobster once.
      d.bags[ground].push(t);
      d.log.push(`${p.name} draws an already-notched breeder at ${ground} — released`);
    } else if (isEgger(t)) {
      if (policy === 'greedy') {
        p.hold.push(t); // illegal keep of a berried female (indiscriminate greed)
        p.tracks.reputation += d.config.rep.illegalKeep;
      } else {
        // V-NOTCH: you TAKE the egger (she leaves the world as your scoring proof)
        // and put a v-notch MEEPLE in her place in the bag. Bag size is unchanged —
        // the closed census still balances — but that lobster can never score again.
        // Eggers are therefore FINITE: stewardship is front-loaded, and the meeples
        // you leave behind dilute every later haul.
        d.bags[ground].push({ id: `vn-${t.id}`, ground, ...tileTemplate('VNOTCH') });
        d.notches[ground] = (d.notches[ground] ?? 0) + 1; // the ground's breeding stock grows
        p.vTokens += 1;
        p.tracks.conservation += d.config.rep.vNotch;
      }
    } else if (isIllegal(t)) {
      // highgrade keeps only the heavy, valuable illegal (jumbos), not worthless shorts.
      const keepIt = policy === 'greedy' || (policy === 'highgrade' && t.kind === 'JUMBO');
      if (keepIt) {
        p.hold.push(t);
        p.tracks.reputation += d.config.rep.illegalKeep;
      } else {
        d.bags[ground].push(t); // legal throwback, free
      }
    }
  }

  // v-token draw insurance: a lean haul (drew no keeper) can be rescued by
  // spending one token to draw extra tiles and keep the best keeper found.
  // The extra draws are random, so it's insurance with a little regret — the
  // token (worth end-VP) is spent whether or not a keeper turns up.
  if (useToken && kept === 0 && p.vTokens > 0 && d.config.vToken.insuranceDraws > 0) {
    p.vTokens -= 1;
    const extra: Tile[] = [];
    for (let i = 0; i < d.config.vToken.insuranceDraws; i++) {
      const t = takeRandom(d, d.bags[ground]);
      if (t) extra.push(t);
    }
    const extraKeepers = extra.filter(isKeeper).sort((a, b) => b.weightLb - a.weightLb);
    for (const t of extraKeepers) {
      if (kept < keepN) { p.hold.push(t); kept++; } else d.bags[ground].push(t);
    }
    for (const t of extra) if (!isKeeper(t)) d.bags[ground].push(t); // non-keepers go back
    d.log.push(`${p.name} spends a v-token (insurance): rescued ${kept} keeper(s)`);
  }

  d.log.push(`${p.name} hauls (${ground}/${stage}): kept ${kept}, vTokens ${p.vTokens}`);
}

export function haulBuoy(d: GameState, playerId: string, buoyId: string, policy: HaulPolicy = 'clean', useToken = false): void {
  const p = d.players[playerId];
  const idx = p.deployed.findIndex((b) => b.buoyId === buoyId);
  if (idx < 0) throw new Error('Not your buoy / not deployed');
  const buoy = p.deployed[idx];
  if (buoy.node !== p.node) throw new Error('Buoy is elsewhere');
  const rec = p.soak[buoyId];
  if (!isRipe(d, rec.ground, rec.daysSoaked)) throw new Error('Pot is not ripe yet (must reach PRIME)');
  const stage = stageFor(d, rec.ground, rec.daysSoaked);
  if (p.licensed === false) { // poaching: every trap you pull is illegal
    p.tracks.reputation += d.config.unlicensed.repPerHaul;
    d.log.push(`${p.name} hauls without a licence (${d.config.unlicensed.repPerHaul} reputation)`);
  }
  pullSeeded(d, playerId, buoy.node); // the space's seeded pile comes up first, then the bag
  resolveDraw(d, playerId, rec.ground, stage, policy, useToken, d.stormed.includes(buoy.node));
  // recover the gear
  p.deployed.splice(idx, 1);
  delete p.soak[buoyId];
  p.buoysAvailable += 1;
}

export function stealBuoy(d: GameState, thiefId: string, ownerId: string, buoyId: string, policy: HaulPolicy = 'clean', useToken = false): void {
  const thief = d.players[thiefId];
  const owner = d.players[ownerId];
  const idx = owner.deployed.findIndex((b) => b.buoyId === buoyId);
  if (idx < 0) throw new Error('No such rival buoy');
  const buoy = owner.deployed[idx];
  if (buoy.node !== thief.node) throw new Error('Rival buoy is elsewhere');
  const rec = owner.soak[buoyId];
  if (!isRipe(d, rec.ground, rec.daysSoaked)) throw new Error('Rival pot is not ripe yet');
  const stage = stageFor(d, rec.ground, rec.daysSoaked); // thief gambles on OWNER's hidden ripeness

  const holdBefore = thief.hold.length;
  pullSeeded(d, thiefId, buoy.node); // the thief also grabs the space's seeded pile
  resolveDraw(d, thiefId, rec.ground, stage, policy, useToken, d.stormed.includes(buoy.node));
  const stolen = thief.hold.slice(holdBefore);
  const value = stolen.reduce((s, t) => s + t.weightLb, 0) * refPrice(d);

  // gear and rep
  owner.deployed.splice(idx, 1);
  delete owner.soak[buoyId];
  owner.buoysAvailable += 1; // owner recovers the gear, loses the catch
  thief.tracks.reputation += d.config.rep.steal;
  d.thefts.push({ victimId: ownerId, thiefId, value });
  d.log.push(`${thief.name} STEALS buoy ${buoyId} from ${owner.name} (value ~${value})`);
}

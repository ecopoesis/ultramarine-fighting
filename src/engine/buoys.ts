import type { GameState, Ground, Tile, Stage } from '../types';
import { takeRandom } from '../rng';
import { stageFor, isRipe } from './soak';
import { isKeeper, isIllegal, isEgger, isVnotched, tileTemplate } from '../tiles';
import { marketPorts, portOf } from './ports';
import { weatherOn } from './weather';
import { pullSeeded } from './seeded';
import { alignmentOn, stepAlignment, commitCrimes, addStars, groundClosedTo } from './alignment';
import { bonusDraws, pollute } from './upgrades';

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

// What to do with a berried female, chosen independently of the policy above, so a
// captain can land her 4 lb without also taking every short and jumbo. Without this
// the only way to keep an egger was `greedy`, nobody ever chose it, and conservation
// measured who happened to draw eggers rather than who resisted keeping them. Omitted,
// greedy keeps her and everything else notches — the old behaviour, so old logs replay.
export type EggerChoice = 'notch' | 'keep';

function resolveDraw(
  d: GameState, playerId: string, ground: Ground, stage: Stage, policy: HaulPolicy,
  stormy = false, eggers?: EggerChoice,
): { illegalKept: number; notched: number } {
  const p = d.players[playerId];
  const rule = d.config.drawByStage[stage];
  // A stormed node churns up bonus lobster: extra draws and a raised keep limit.
  // This is the REWARD half of the gamble — priced against the entry hazard and
  // the overnight whittle to a near-wash, so the far grounds are a bet, not a wall.
  const bonus = stormy && weatherOn(d);
  const net = bonusDraws(d, p); // the illegal net: more tiles up, and more kept
  const drawN = rule.draw + (bonus ? d.config.weather.bonusDraws : 0) + net;
  const keepN = rule.keep + (bonus ? d.config.weather.bonusKeep : 0) + net;
  const drawn: Tile[] = [];
  for (let i = 0; i < drawN; i++) {
    const t = takeRandom(d, d.bags[ground]);
    if (t) drawn.push(t);
  }

  const keepers = drawn.filter(isKeeper).sort((a, b) => b.weightLb - a.weightLb);
  let kept = 0;
  let illegalKept = 0;
  let notched = 0;

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
      if ((eggers ?? (policy === 'greedy' ? 'keep' : 'notch')) === 'keep') {
        p.hold.push(t); // illegal keep of a berried female: no log line — the public rep track is the only tell
        p.tracks.reputation += d.config.rep.illegalKeep;
        illegalKept++;
      } else {
        // V-NOTCH: you TAKE the egger (she leaves the world as your scoring proof)
        // and put a v-notch MEEPLE in her place in the bag. Bag size is unchanged —
        // the closed census still balances — but that lobster can never score again.
        // Eggers are therefore FINITE: stewardship is front-loaded, and the meeples
        // you leave behind dilute every later haul.
        d.bags[ground].push({ id: `vn-${t.id}`, ground, ...tileTemplate('VNOTCH') });
        d.notches[ground] = (d.notches[ground] ?? 0) + 1; // the ground's breeding stock grows
        p.tracks.conservation += d.config.rep.vNotch;
        notched++;
      }
    } else if (isIllegal(t)) {
      // highgrade keeps only the heavy, valuable illegal (jumbos), not worthless shorts.
      const keepIt = policy === 'greedy' || (policy === 'highgrade' && t.kind === 'JUMBO');
      if (keepIt) {
        p.hold.push(t);
        p.tracks.reputation += d.config.rep.illegalKeep;
        illegalKept++;
      } else {
        d.bags[ground].push(t); // legal throwback, free
      }
    }
  }

  d.log.push(`${p.name} hauls (${ground}/${stage}): kept ${kept}`);
  return { illegalKept, notched };
}

// The switchboard's reading of one haul (flags.alignment): notches step you lighter,
// every illegal tile kept steps you darker AND is a crime the warden hears about.
// The log names steps and stars, never the tiles — the tracks are public, the hold
// is not.
function settleHaul(d: GameState, playerId: string, r: { illegalKept: number; notched: number }): void {
  if (!alignmentOn(d)) return;
  const p = d.players[playerId];
  const st = d.config.alignment.step;
  stepAlignment(d, p, r.notched * st.notch, `notched ${r.notched}`);
  if (r.illegalKept > 0) {
    stepAlignment(d, p, r.illegalKept * st.illegalKeep, 'kept illegal catch');
    commitCrimes(d, p, r.illegalKept, 'illegal catch aboard');
  }
}

export function haulBuoy(d: GameState, playerId: string, buoyId: string, policy: HaulPolicy = 'clean', eggers?: EggerChoice): void {
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
    stepAlignment(d, p, d.config.alignment.step.poachHaul, 'poaching');
    if (d.config.heat.poachHaulIsCrime) commitCrimes(d, p, 1, 'poaching');
  }
  // Closed water is still fishable — at a price in stars per pot pulled.
  if (groundClosedTo(d, rec.ground, p)) addStars(d, p, d.config.closure.starsPerHaul, `hauled closed ${rec.ground} water`);
  pullSeeded(d, playerId, buoy.node); // the space's seeded pile comes up first, then the bag
  settleHaul(d, playerId, resolveDraw(d, playerId, rec.ground, stage, policy, d.stormed.includes(buoy.node), eggers));
  if (bonusDraws(d, p) > 0 && d.config.heat.netIsCrime) commitCrimes(d, p, 1, 'hauled with an illegal net');
  pollute(d, p, rec.ground);
  // recover the gear
  p.deployed.splice(idx, 1);
  delete p.soak[buoyId];
  p.buoysAvailable += 1;
}

export function stealBuoy(d: GameState, thiefId: string, ownerId: string, buoyId: string, policy: HaulPolicy = 'clean', eggers?: EggerChoice): void {
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
  settleHaul(d, thiefId, resolveDraw(d, thiefId, rec.ground, stage, policy, d.stormed.includes(buoy.node), eggers));
  const stolen = thief.hold.slice(holdBefore);
  const value = stolen.reduce((s, t) => s + t.weightLb, 0) * refPrice(d);

  // gear and rep
  owner.deployed.splice(idx, 1);
  delete owner.soak[buoyId];
  owner.buoysAvailable += 1; // owner recovers the gear, loses the catch
  thief.tracks.reputation += d.config.rep.steal;
  stepAlignment(d, thief, d.config.alignment.step.steal, 'theft');
  commitCrimes(d, thief, 1, 'theft');
  d.thefts.push({ victimId: ownerId, thiefId, value });
  d.log.push(`${thief.name} STEALS buoy ${buoyId} from ${owner.name} (value ~${value})`);
}

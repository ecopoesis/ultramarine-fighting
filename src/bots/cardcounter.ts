import type { GameState, Ground } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy } from '../engine/buoys';
import { distance } from '../engine/movement';
import { distanceToNearestPort, marketPorts, portOf } from '../engine/ports';
import { weatherOn, isStormed } from '../engine/weather';
import {
  Policy, stepToward, hopToward, myBuoys, isLastDayOfSeason, hoursLeftToday, groundNodesOfType,
  nearest, ofType, firstOfType, reachability, daysThisSeason,
  isPort, nearestPort, nearestMarketPort,
} from './helpers';
import { upgradesOn, upgradeDef, stepsPerSteam } from '../engine/upgrades';

const UPGRADE_RESERVE = 10; // money a bot keeps in hand rather than sinking into a refit

// The CARD-COUNTER: a public-information optimizer, and the fleet's strong
// baseline / instrument. It reads each ground's CURRENT bag (public info) — never
// a rival's hidden soak — computes the expected keeper-value of a prime haul,
// discounts it by how long gear must soak to prime (throughput) and by the
// round-trip reach, and fishes the best-scoring ground. As near keeper-DENSITY
// falls it migrates outward on its own, so it answers the arc's core questions:
// does the fleet ratchet out season by season, and does stewardship pay?
//
// It reads only public state (bag composition, its own gear, port geometry), so
// it is a FAIR bot — no peeking at rivals' hidden ripeness. It plays clean.
export interface CardCounter {
  name: string;
  reachCostPerStep: number; // money-equivalent penalty per round-trip step when scoring a ground
  minKeep: number;          // haul a buoy now only if drawByStage[stage].keep >= this (PRIME keep = 2)
  refuelBelow: number;      // top up at a port when fuel at/under this
  dropSlack: number;        // only drop gear that primes with this many days to SPARE (so it can be hauled, not abandoned)
  haulPolicy: HaulPolicy;   // 'clean' = lawful (v-notch/throwback, the fair default); 'greedy' = keep illegal (high-grade)
  // Personality knobs — the archetypes are this rational core plus a twist. All
  // default to "off" so a plain card-counter is the neutral, fair optimizer.
  steals?: boolean;         // steal a rival buoy sitting under us (while rep allows)
  stealPolicy?: HaulPolicy; // policy applied to STOLEN catch (a raider can be lawful at home, greedy on loot)
  repFloor?: number;        // ration rep-burning (theft AND high-grading): stop once rep sinks to here
  farBias?: number;         // multiply offshore/deep EV by this when picking a ground (>1 = works the edge sooner)
  stormBias?: number;       // multiply a STORMED zone's (already risk/reward-adjusted) score by this — >1 chases the gamble, <1 gives storms a wide berth (default 1 = price it honestly)
  seedBias?: number;        // weight on a space's accumulated SEEDED pile when scoring it — >1 chases neglected jackpots (a would-be "sniper"), <1 ignores them (default 1 = price it in)
  guzzle?: boolean;         // the GAS-GUZZLER: fish one-way-reachable zones, never reserve return fuel, never refuel — deliberately run dry and lean on the tow. The tow must be priced to KILL this (else "run dry, take the cheap tow" beats honest fuel management).
  upgradeWishlist?: string[]; // refit priority (buys the first affordable one early, keeping a reserve); undefined = a generic order
  // Restock draft:
  restockReturn?: 'heavy' | 'light'; // which pile tiles to put back — heaviest keepers (rebuild) or lightest (stock it thin)
  vnotchContribute?: number;         // how many v-notch tokens to SPEND per bag to add more lobsters (0 = hoard for VP)
}

// The neutral fair optimizer / measuring stick. Clean, no theft — the baseline
// the archetypes are compared against.
export const CARD_COUNTER: CardCounter = {
  name: 'cardcounter', reachCostPerStep: 0.5, minKeep: 2, refuelBelow: 3, dropSlack: 1, haulPolicy: 'clean',
};

// Every PLAYER archetype is the rational core plus a personality twist. They all
// target by live EV, so they all migrate and contest the whole map — no bot gets
// a lane to itself. Theft is a SITUATIONAL tactic shared by ALL of them: grab a
// rival buoy that happens to sit under you while your reputation can absorb it
// (rationed by repFloor). It rarely fires against efficient play (gear is hauled
// promptly) — a punish for sloppy rivals, not a strategy. Tuned on the bay; see
// scripts/tuneArchetypes.ts + scripts/sweepArch.ts.
const ARCH_BASE: CardCounter = {
  ...CARD_COUNTER, steals: true, stealPolicy: 'highgrade', repFloor: 5,
  restockReturn: 'heavy', vnotchContribute: 1,
};

// stormBias is the weather personality: the gambler and hustler chase the storm
// churn (>1), the patient steward/monk give storms a wide berth (<1), the rest
// price the gamble honestly (1). It layers on top of farBias — where you fish AND
// whether you bet on the blow are separate identities.
export const CC_STEWARD: CardCounter = { ...ARCH_BASE, name: 'steward', vnotchContribute: 3, stormBias: 0.8 };    // clean, balanced — rebuilds the commons, gives storms a berth
export const CC_GREEDY: CardCounter = { ...ARCH_BASE, name: 'greedy', haulPolicy: 'highgrade', minKeep: 1, vnotchContribute: 0 }; // selective high-grader: money leader, hoards v-notch for VP
export const CC_HIGHLINER: CardCounter = { ...ARCH_BASE, name: 'highliner', farBias: 1.4, stormBias: 1.4 };       // works the far edge for the heavy catch — and rides the churn out there (else it eats the storm tax without the reward)
export const CC_GRINDER: CardCounter = { ...ARCH_BASE, name: 'grinder', farBias: 0.7, minKeep: 1, reachCostPerStep: 0.8, vnotchContribute: 2 }; // near-water workhorse: high volume, short runs, rebuilds its own grounds
export const CC_GAMBLER: CardCounter = { ...ARCH_BASE, name: 'gambler', farBias: 2.0, minKeep: 2, stormBias: 1.8 }; // deep-edge risk-taker: bets on the far gear AND the blow — but a COMPETENT one (base dropSlack/refuel: don't strand gear or over-fuel at dear far ports)
export const CC_HUSTLER: CardCounter = { ...ARCH_BASE, name: 'hustler', haulPolicy: 'highgrade', farBias: 1.3, minKeep: 1, repFloor: 4, vnotchContribute: 0, stormBias: 1.3 }; // dirty money anywhere, rides the storm
export const CC_MONK: CardCounter = { ...ARCH_BASE, name: 'monk', farBias: 0.8, minKeep: 2, vnotchContribute: 3, stormBias: 0.6 };  // patient: only prime hauls (keep 2) — max conservation, avoids the blow
export const CC_NOMAD: CardCounter = { ...ARCH_BASE, name: 'nomad', reachCostPerStep: 0.25, stormBias: 1.2 };     // ranges the whole map for the best EV anywhere — including the churn (else it wanders into storms untaxed-for-nothing)
export const CC_GUZZLER: CardCounter = { ...ARCH_BASE, name: 'guzzler', guzzle: true, minKeep: 1, farBias: 1.3, refuelBelow: 0 }; // fishes hard & far, never reserves return fuel, never refuels — runs dry and takes the tow. A CANARY for the tow price: if it's viable, the tow is too cheap.

// The full roster (index builds BOTS from this; the arena seats N of them).
export const ROSTER: CardCounter[] = [
  CC_STEWARD, CC_GREEDY, CC_HIGHLINER, CC_GRINDER, CC_GAMBLER, CC_HUSTLER, CC_MONK, CC_NOMAD, CC_GUZZLER,
];

// Best market base around — a stable reference for valuing a landed pound (the
// catch sells into the same markets wherever it was fished).
function refPrice(state: GameState): number {
  const bases = marketPorts(state).map((n) => portOf(state, n)!.market!.base);
  return bases.length ? Math.max(...bases) : 1;
}

// Nights a freshly-dropped buoy must soak before its FIRST prime — gear tied up
// this long is the throughput cost of a ground. Infinity if it never primes.
function daysToPrime(state: GameState, g: Ground): number {
  const i = state.config.soakCurves[g].indexOf('PRIME');
  return i < 0 ? Infinity : i;
}

// Expected keeper POUNDS landed per prime haul from a ground's current bag:
// (keeper lbs / bag size) × prime keep-limit. This falls as keepers are stripped
// even while junk throwbacks refill the bag — it is keeper DENSITY, the true
// signal that tile-count "health" hides.
function evLbPerHaul(state: GameState, g: Ground): number {
  const bag = state.bags[g];
  if (bag.length === 0) return 0;
  let keeperLb = 0;
  for (const t of bag) if (t.kind === 'KEEPER') keeperLb += t.weightLb;
  return (keeperLb / bag.length) * state.config.drawByStage.PRIME.keep;
}

// Money-per-soak-day score for dropping a pot on `zone`, net of the round-trip
// reach cost from where we stand. Higher = better place to fish right now.
function scoreZone(state: GameState, from: string, zone: string, g: Ground, cc: CardCounter): number {
  const perDay = evLbPerHaul(state, g) / daysToPrime(state, g); // throughput-adjusted EV
  const bias = (cc.farBias ?? 1) !== 1 && (g === 'offshore' || g === 'deep') ? cc.farBias! : 1;
  let money = perDay * refPrice(state) * bias;
  // Weather: a stormed zone is a gamble. REWARD = a fatter haul (bonus keepers);
  // RISK = the pot may be parted before it primes (survival discount) and the
  // entry beating costs fuel. Priced honestly here; the stormBias personality knob
  // then decides whether to chase it (gambler) or avoid it (the cautious).
  if (weatherOn(state) && isStormed(state, zone)) {
    const w = state.config.weather;
    const keep = state.config.drawByStage.PRIME.keep;
    const rewardMult = (keep + w.bonusKeep) / keep;
    const survive = Math.pow(1 - w.whittleChance, Math.max(1, daysToPrime(state, g))); // nights exposed before we can haul
    const hazardCost = w.hazardChance * w.hazardFuel * cc.reachCostPerStep;
    money = (money * rewardMult * survive - hazardCost) * (cc.stormBias ?? 1);
  }
  // Seeded lobsters: the space's accumulated generic pile is a one-time bonus taken on
  // the haul. Amortize it over the soak (per-day, like the bag EV) and add it — a
  // neglected space with a fat pile scores higher, which is the whole-map lure.
  if (state.config.flags.seeded) {
    const pile = state.seeded[zone] ?? 0;
    if (pile > 0) {
      const perDay = (pile * state.config.seeded.weightLb * refPrice(state)) / daysToPrime(state, g);
      money += perDay * (cc.seedBias ?? 1);
    }
  }
  const steps = distance(state, from, zone) + distanceToNearestPort(state, zone);
  return money - cc.reachCostPerStep * steps;
}

function chooseTarget(
  state: GameState, pid: string, cc: CardCounter,
  buoys: ReturnType<typeof myBuoys>,
  reach: ReturnType<typeof reachability>,
  last: boolean,
): string {
  const p = state.players[pid];
  const sellPort = nearestMarketPort(state, p.node) ?? nearestPort(state, p.node)!;
  const anyPort = nearestPort(state, p.node)!;
  const home = () => (p.hold.length > 0 ? sellPort : anyPort);
  // Guzzlers fish anything one-way REACHABLE (no return reserve); everyone else
  // sticks to round-trip-SAFE zones so they can make harbor.
  const okReach = (node: string) => (cc.guzzle ? reach[node]?.reachable : reach[node]?.safe);

  // Make harbor in time: if we can't reach a port before the day ends, head in NOW
  // rather than get caught at sea and towed. The gas-guzzler skips this on purpose.
  if (!cc.guzzle && !isPort(state, p.node) && distanceToNearestPort(state, p.node) >= hoursLeftToday(state)) {
    return home();
  }

  // Holding catch and the day is winding down — cash it in. The gas-guzzler skips
  // this too: it never heads in on its own, fishing until it strands and gets towed.
  if (!cc.guzzle && p.hold.length > 0 && (last || hoursLeftToday(state) <= 1)) return sellPort;

  // Harvest ripe (haulable), reachable gear (nearest first).
  const ripe = buoys.filter((b) => b.ripe && (last || b.keep >= cc.minKeep) && okReach(b.node));
  if (ripe.length) return nearest(state, p.node, ripe.map((b) => b.node)) ?? anyPort;

  // Deploy an idle pot on the best-scoring ground we can fish: over every empty,
  // safe, reachable zone whose gear can still reach prime before the season ends,
  // pick the highest money-per-soak-day net of reach. Migration is emergent — as
  // near density drops, a farther-but-richer ground wins the score.
  if (p.buoysAvailable > 0 && state.day < daysThisSeason(state)) {
    const daysLeft = daysThisSeason(state) - state.day;
    let best: string | null = null;
    let bestScore = 0; // require a positive net score to commit gear
    for (const g of Object.keys(state.bags) as Ground[]) {
      if (daysToPrime(state, g) > daysLeft - cc.dropSlack) continue; // must prime with time to spare to HAUL it, not abandon it
      for (const zone of groundNodesOfType(state, g)) {
        if (!okReach(zone) || buoys.some((b) => b.node === zone)) continue;
        const s = scoreZone(state, p.node, zone, g, cc);
        if (s > bestScore) { bestScore = s; best = zone; }
      }
    }
    if (best) return best;
  }
  return home();
}

// Restock-draft decision: which bag to claim + which lobsters to return, or how
// much v-notch to spend contributing. WHICH-bag = the fullest pile (most value to
// rebuild); WHICH-lobsters = heaviest keepers (rebuild) or lightest ('light' style).
function restockDecision(state: GameState, pid: string, cc: CardCounter): Action {
  const r = state.restock!;
  const grounds = Object.keys(state.bags) as Ground[];
  const pileVal = (g: Ground) => state.piles[g].reduce((a, t) => a + t.weightLb, 0);

  if (r.step === 'claim') {
    const remaining = grounds.filter((g) => !r.claimed.includes(g));
    const withStock = remaining.filter((g) => state.piles[g].length > 0);
    const pool = withStock.length ? withStock : remaining;
    // A real roll → claim the fullest pile (most to rebuild). A blank (0) still
    // LOCKS a bag, so dump it on the least valuable one rather than a rich bag.
    const ground = pool.slice().sort((a, b) => (r.roll === 0 ? pileVal(a) - pileVal(b) : pileVal(b) - pileVal(a)))[0];
    const asc = cc.restockReturn === 'light';
    const pile = [...state.piles[ground]].sort((a, b) => (asc ? a.weightLb - b.weightLb : b.weightLb - a.weightLb));
    const tileIds = pile.slice(0, Math.min(r.roll, pile.length)).map((t) => t.id);
    return { type: 'RESTOCK_CLAIM', playerId: pid, ground, tileIds };
  }

  const p = state.players[pid];
  const g = r.contribGround!;
  const spend = Math.min(cc.vnotchContribute ?? 0, p.vTokens, state.piles[g].length);
  const pile = [...state.piles[g]].sort((a, b) => b.weightLb - a.weightLb); // add the best lobsters we can
  return { type: 'RESTOCK_CONTRIBUTE', playerId: pid, tileIds: pile.slice(0, spend).map((t) => t.id) };
}

export function makeCardCounter(cc: CardCounter): Policy {
  return (state: GameState, pid: string, legal: Action[]): Action => {
    if (state.phase === 'RESTOCK') return restockDecision(state, pid, cc);
    const cfg = state.config;
    const p = state.players[pid];
    const atPort = isPort(state, p.node);
    const last = isLastDayOfSeason(state);
    const reach = reachability(state, pid);
    const hopReach = stepsPerSteam(state, p); // nodes we can steam per action (a bigger engine reaches farther)
    const buoys = myBuoys(state, pid);
    const pass = firstOfType(legal, 'PASS')!;
    const repFloor = cc.repFloor ?? -Infinity;

    // 1) STEAL a rival buoy under us (a raider only), while we can still absorb the
    //    reputation hit — a chance we can't price, so we take it.
    if (cc.steals && p.tracks.reputation > repFloor) {
      const steals = ofType(legal, 'STEAL');
      if (steals.length) return { ...steals[0], policy: cc.stealPolicy ?? 'greedy', useToken: true };
    }

    // 2) HAUL ripe own buoys (best keep first). A measured high-grader keeps illegal
    //    tiles only while rep allows; once at repFloor it reverts to clean play.
    const hauls = ofType(legal, 'HAUL');
    if (hauls.length) {
      const dirty = cc.haulPolicy === 'greedy' || cc.haulPolicy === 'highgrade';
      const effHaul: HaulPolicy = dirty && p.tracks.reputation <= repFloor ? 'clean' : cc.haulPolicy;
      const ranked = hauls
        .map((h) => ({ h, keep: buoys.find((b) => b.buoyId === h.buoyId)?.keep ?? 0 }))
        .filter((x) => last || x.keep >= cc.minKeep)
        .sort((a, b) => b.keep - a.keep);
      if (ranked.length) return { ...ranked[0].h, policy: effHaul, useToken: true };
    }

    const target = chooseTarget(state, pid, cc, buoys, reach, last);
    const targetIsGround = cfg.map.nodes[target]?.type === 'ground';
    const targetOk = cc.guzzle ? reach[target]?.reachable : reach[target]?.safe; // guzzlers steam to one-way-reachable grounds

    // 2) AT A PORT: report, sell, refuel, then fish again or berth.
    if (atPort) {
      const report = firstOfType(legal, 'REPORT');
      if (report) return report;
      const sell = firstOfType(legal, 'SELL');
      if (sell && p.hold.length > 0) return sell;
      const refuel = firstOfType(legal, 'REFUEL');
      if (refuel && !last && !cc.guzzle && p.fuel <= cc.refuelBelow) return refuel;

      // Refit at the chandlery: buy the highest-priority wanted upgrade we can afford
      // while keeping a money reserve. Only early enough to recoup the investment.
      if (upgradesOn(state) && !last && state.season <= cfg.seasons - 1) {
        const buys = ofType(legal, 'BUY_UPGRADE');
        const wish = cc.upgradeWishlist ?? ['engine', 'crane', 'potrack', 'tender', 'cargo', 'radar', 'fuelline', 'tank', 'grapple', 'flares'];
        for (const id of wish) {
          const b = buys.find((x) => x.upgradeId === id);
          if (b && p.money - (upgradeDef(state, id)?.cost ?? Infinity) >= UPGRADE_RESERVE) return b;
        }
      }

      if (!last && targetIsGround && targetOk) {
        const step = hopToward(state, p.node, target, hopReach);
        const steam = step ? ofType(legal, 'STEAM').find((s) => s.to === step) : undefined;
        if (steam) return steam;
      }
      // Done for the day — but don't pay the pole (slot-0) rep cost. If we'd be
      // first into the berths, idle instead: a rival can take the front slot, or
      // the end-of-day auto-berth seats us for free. Rep is too weak to spend here.
      const berthAction = firstOfType(legal, 'BERTH');
      if (berthAction && state.nextSlot > 0) return berthAction;
      return pass;
    }

    // 3) AT SEA: drop a pot if we're standing on our empty target zone.
    if (p.node === target) {
      const drop = firstOfType(legal, 'DROP');
      if (drop && p.buoysAvailable > 0 && !buoys.some((b) => b.node === p.node)) return drop;
    }

    // Steam toward the target (grounds only while a port is still reachable after).
    const step = hopToward(state, p.node, target, hopReach);
    if (step) {
      const steam = ofType(legal, 'STEAM').find((s) => s.to === step);
      if (steam && (!targetIsGround || targetOk)) return steam;
    }
    // Otherwise limp toward the nearest port.
    const homePort = nearestPort(state, p.node);
    const homeStep = homePort ? hopToward(state, p.node, homePort, hopReach) : null;
    const homeSteam = homeStep ? ofType(legal, 'STEAM').find((s) => s.to === homeStep) : undefined;
    if (homeSteam) return homeSteam;

    return pass;
  };
}

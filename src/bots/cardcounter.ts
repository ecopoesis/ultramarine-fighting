import type { GameState, Ground } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy } from '../engine/buoys';
import { distance } from '../engine/movement';
import { distanceToNearestPort, marketPorts, portOf, fuelPriceAt } from '../engine/ports';
import { weatherOn, isStormed } from '../engine/weather';
import {
  Policy, stepToward, hopToward, myBuoys, isLastDayOfSeason, hoursLeftToday, groundNodesOfType,
  nearest, ofType, firstOfType, reachability, daysThisSeason,
  isPort, nearestPort, nearestMarketPort,
} from './helpers';
import { upgradesOn, upgradeDef, stepsPerSteam, fuelCap } from '../engine/upgrades';
import { spaceHasRoom } from '../engine/buoys';
import { auctionMinBid } from '../engine/auction';
import { alignmentOn, portClosedTo, groundClosedTo, bribeCost, bribeableDice } from '../engine/alignment';
import { pricePerLb } from '../engine/market';
import { isWarden } from '../engine/patrol';

// Only 3+ stars can bust (two heat dice top out at 4), so that is when a warden boat is
// worth steering around.
const wardenShy = (state: GameState, pid: string): boolean =>
  (state.wardens?.length ?? 0) > 0 && state.players[pid].tracks.heat >= 3;

// If this steam lands on a warden while we're hot, bribe the check down toward a safe
// roll on our band's scale (the bribe is only spent if the boat actually stops us).
function withSeaBribe(state: GameState, pid: string, cc: CardCounter, a: Extract<Action, { type: 'STEAM' }>): Action {
  if (!wardenShy(state, pid) || !isWarden(state, a.to)) return a;
  const p = state.players[pid];
  let buy = Math.min(bribeableDice(state, p), Math.max(0, p.tracks.heat - (cc.safeDice ?? 2)));
  while (buy > 0 && bribeCost(state, p, buy) > p.money) buy--;
  return buy > 0 ? { ...a, bribeDice: buy } : a;
}

// The next hop toward `target`, steering around warden boats when they matter: prefer a
// step that gets as close (or goes one sideways) over one that lands on a warden.
function steerToward(state: GameState, pid: string, target: string, reach: number): string | null {
  const direct = hopToward(state, state.players[pid].node, target, reach);
  if (!direct || !wardenShy(state, pid) || !isWarden(state, direct)) return direct;
  const here = state.players[pid].node;
  const now = distance(state, here, target);
  const options = Object.keys(state.config.map.nodes)
    .filter((n) => { const h = distance(state, here, n); return h >= 1 && h <= reach && !isWarden(state, n); })
    .filter((n) => distance(state, n, target) <= now); // no further off than we are
  options.sort((a, b) => distance(state, a, target) - distance(state, b, target) || a.localeCompare(b));
  return options[0] ?? direct;
}

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
  // Licence auction: what fraction of money on hand to put behind a bid, over the
  // reserve. Second-price, so bidding your true valuation is safe — you pay what your
  // closest rival thought it was worth, not what you did.
  bidFraction?: number;
  // THE SWITCHBOARD (flags.alignment). 'light' fishes clean and buys its licence;
  // 'dark' keeps eggers and jumbos, poaches, and manages its heat; 'switch' plays light
  // until it ends up without a licence, then embraces it and plays dark.
  side?: 'light' | 'dark' | 'switch';
  heatCeiling?: number;  // dark: stop committing crimes at this many stars
  safeDice?: number;     // dark: bribe the check down to this many dice when it can
  maxDiceToSell?: number; // dark: if even after bribing more dice than this remain, lie low instead of selling
}

// Which side is this bot playing right now?
function sideOf(state: GameState, pid: string, cc: CardCounter): 'light' | 'dark' | undefined {
  if (!alignmentOn(state) || !cc.side) return undefined;
  if (cc.side === 'switch') return state.players[pid].licensed === false ? 'dark' : 'light';
  return cc.side;
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
};

// stormBias is the weather personality: the gambler and hustler chase the storm
// churn (>1), the patient steward/monk give storms a wide berth (<1), the rest
// price the gamble honestly (1). It layers on top of farBias — where you fish AND
// whether you bet on the blow are separate identities.
export const CC_STEWARD: CardCounter = { ...ARCH_BASE, name: 'steward', stormBias: 0.8 };    // clean, balanced — rebuilds the commons, gives storms a berth
export const CC_GREEDY: CardCounter = { ...ARCH_BASE, name: 'greedy', haulPolicy: 'highgrade', minKeep: 1 }; // selective high-grader: money leader, hoards v-notch for VP
export const CC_HIGHLINER: CardCounter = { ...ARCH_BASE, name: 'highliner', farBias: 1.4, stormBias: 1.4 };       // works the far edge for the heavy catch — and rides the churn out there (else it eats the storm tax without the reward)
export const CC_GRINDER: CardCounter = { ...ARCH_BASE, name: 'grinder', farBias: 0.7, minKeep: 1, reachCostPerStep: 0.8 }; // near-water workhorse: high volume, short runs, rebuilds its own grounds
export const CC_GAMBLER: CardCounter = { ...ARCH_BASE, name: 'gambler', farBias: 2.0, minKeep: 2, stormBias: 1.8 }; // deep-edge risk-taker: bets on the far gear AND the blow — but a COMPETENT one (base dropSlack/refuel: don't strand gear or over-fuel at dear far ports)
export const CC_HUSTLER: CardCounter = { ...ARCH_BASE, name: 'hustler', haulPolicy: 'highgrade', farBias: 1.3, minKeep: 1, repFloor: 4, stormBias: 1.3 }; // dirty money anywhere, rides the storm
export const CC_MONK: CardCounter = { ...ARCH_BASE, name: 'monk', farBias: 0.8, minKeep: 2, stormBias: 0.6 };  // patient: only prime hauls (keep 2) — max conservation, avoids the blow
export const CC_NOMAD: CardCounter = { ...ARCH_BASE, name: 'nomad', reachCostPerStep: 0.25, stormBias: 1.2 };     // ranges the whole map for the best EV anywhere — including the churn (else it wanders into storms untaxed-for-nothing)
export const CC_GUZZLER: CardCounter = { ...ARCH_BASE, name: 'guzzler', guzzle: true, minKeep: 1, farBias: 1.3, refuelBelow: 0 }; // fishes hard & far, never reserves return fuel, never refuels — runs dry and takes the tow. A CANARY for the tow price: if it's viable, the tow is too cheap.

// THE SWITCHBOARD bots (flags.alignment) — the arena's light/dark instruments. All
// share the same fishing core, so any gap between them is the switchboard's doing.
export const CC_LIGHT: CardCounter = { ...ARCH_BASE, name: 'light', side: 'light' };
const DARK_WISH = ['net', 'smoker', 'engine', 'crane', 'potrack', 'tender', 'cargo', 'fuelline', 'tank', 'grapple', 'flares'];
export const CC_DARK: CardCounter = { ...ARCH_BASE, name: 'dark', side: 'dark', heatCeiling: 3, safeDice: 2, maxDiceToSell: 3, upgradeWishlist: DARK_WISH };
export const CC_SWITCH: CardCounter = { ...ARCH_BASE, name: 'switch', side: 'switch', heatCeiling: 3, safeDice: 2, maxDiceToSell: 3, upgradeWishlist: DARK_WISH };

// The full roster (index builds BOTS from this; the arena seats N of them).
export const ROSTER: CardCounter[] = [
  CC_STEWARD, CC_GREEDY, CC_HIGHLINER, CC_GRINDER, CC_GAMBLER, CC_HUSTLER, CC_MONK, CC_NOMAD, CC_GUZZLER,
  CC_LIGHT, CC_DARK, CC_SWITCH,
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
  // Only docks that will have us (a port we ran from today, or a refuge an outlaw has lost).
  const open = (nodes: string[]) => nodes.filter((n) => !portClosedTo(state, p, n));
  const sellPort = nearest(state, p.node, open(marketPorts(state))) ?? nearestMarketPort(state, p.node) ?? nearestPort(state, p.node)!;
  const anyPort = nearest(state, p.node, open(Object.keys(state.config.map.nodes).filter((n) => isPort(state, n)))) ?? nearestPort(state, p.node)!;
  const side = sideOf(state, pid, cc);
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
        if (!spaceHasRoom(state, zone)) continue; // that ground is already full of gear
        if (wardenShy(state, pid) && isWarden(state, zone)) continue; // don't set gear under a warden while hot
        // Closed water: the light side never needs it barred; a dark bot works it only while cool.
        if (side === 'dark' && groundClosedTo(state, g, p) && p.tracks.heat + state.config.closure.starsPerHaul > (cc.heatCeiling ?? 3)) continue;
        const s = scoreZone(state, p.node, zone, g, cc);
        if (s > bestScore) { bestScore = s; best = zone; }
      }
    }
    if (best) return best;
  }
  return home();
}

export function makeCardCounter(cc: CardCounter): Policy {
  return (state: GameState, pid: string, legal: Action[]): Action => {
    if (state.phase === 'AUCTION') {
      const a = state.auction!;
      const me = state.players[pid];
      if (!a.revealed) {
        const reserve = auctionMinBid(state);
        if (sideOf(state, pid, cc) === 'dark' && cc.side === 'dark') return { type: 'LICENSE_BID', playerId: pid, amount: 0 }; // a poacher keeps the fee
        // Bid the reserve plus a slice of what's in hand: the season's turn order is
        // worth more to a rich boat that can act on going first.
        const bid = Math.min(Math.floor(me.money), reserve + Math.floor(me.money * (cc.bidFraction ?? 0.08)));
        return { type: 'LICENSE_BID', playerId: pid, amount: me.money >= reserve ? Math.max(reserve, bid) : 0 };
      }
      if (cc.side === 'dark' && alignmentOn(state)) return { type: 'LICENSE_BUY', playerId: pid, take: false };
      return { type: 'LICENSE_BUY', playerId: pid, take: me.money >= a.price };
    }
    const cfg = state.config;
    const p = state.players[pid];
    const atPort = isPort(state, p.node);
    const last = isLastDayOfSeason(state);
    const reach = reachability(state, pid);
    const hopReach = stepsPerSteam(state, p); // nodes we can steam per action (a bigger engine reaches farther)
    const buoys = myBuoys(state, pid);
    const pass = firstOfType(legal, 'PASS')!;
    const repFloor = cc.repFloor ?? -Infinity;
    const side = sideOf(state, pid, cc);
    // Under the switchboard, heat (not reputation) is what rations crime.
    const hot = side === 'dark' && p.tracks.heat >= (cc.heatCeiling ?? 3);
    const mayCrime = side ? side === 'dark' && !hot : p.tracks.reputation > repFloor;

    // 1) STEAL a rival buoy under us (a raider only), while we can still absorb the
    //    reputation hit — a chance we can't price, so we take it.
    if (cc.steals && mayCrime) {
      const steals = ofType(legal, 'STEAL');
      if (steals.length) return { ...steals[0], policy: cc.stealPolicy ?? 'greedy' };
    }

    // 2) HAUL ripe own buoys (best keep first). A measured high-grader keeps illegal
    //    tiles only while rep allows; once at repFloor it reverts to clean play.
    const hauls = ofType(legal, 'HAUL');
    if (hauls.length) {
      const dirty = cc.haulPolicy === 'greedy' || cc.haulPolicy === 'highgrade';
      let effHaul: HaulPolicy = dirty && p.tracks.reputation <= repFloor ? 'clean' : cc.haulPolicy;
      let eggers: 'keep' | 'notch' | undefined;
      if (side === 'light') effHaul = 'clean';
      if (side === 'dark') { effHaul = mayCrime ? 'highgrade' : 'clean'; eggers = mayCrime ? 'keep' : 'notch'; }
      const ranked = hauls
        .map((h) => ({ h, keep: buoys.find((b) => b.buoyId === h.buoyId)?.keep ?? 0 }))
        .filter((x) => last || x.keep >= cc.minKeep)
        .sort((a, b) => b.keep - a.keep);
      if (ranked.length) return { ...ranked[0].h, policy: effHaul, ...(eggers ? { eggers } : {}) };
    }

    const target = chooseTarget(state, pid, cc, buoys, reach, last);
    const targetIsGround = cfg.map.nodes[target]?.type === 'ground';
    const targetOk = cc.guzzle ? reach[target]?.reachable : reach[target]?.safe; // guzzlers steam to one-way-reachable grounds

    // 2) AT A PORT: report, sell, refuel, then fish again or berth.
    if (atPort) {
      const report = firstOfType(legal, 'REPORT');
      if (report) return report;
      const sell = firstOfType(legal, 'SELL');
      if (sell && p.hold.length > 0) {
        if (!side || p.tracks.heat <= 0) return sell;
        // The warden's check: buy dice off down to a safe roll while the bribe is
        // worth less than the hold; if the roll is still too hot, lie low instead
        // (a day away from the counter cools a star) — unless the season is ending.
        const holdValue = p.hold.reduce((v, t) => v + t.weightLb * pricePerLb(state, p.node, t.color === 'rare'), 0);
        const safe = cc.safeDice ?? 2;
        let buy = Math.min(bribeableDice(state, p), Math.max(0, p.tracks.heat - safe));
        while (buy > 0 && (bribeCost(state, p, buy) > p.money || bribeCost(state, p, buy) > holdValue / 2)) buy--;
        const dice = p.tracks.heat - buy;
        if (dice > (cc.maxDiceToSell ?? 3) && !last) {
          const berthAction = firstOfType(legal, 'BERTH');
          if (berthAction) return berthAction;
          return pass;
        }
        return { ...sell, bribeDice: buy };
      }
      const refuel = firstOfType(legal, 'REFUEL');
      if (refuel && !last && !cc.guzzle && p.fuel <= cc.refuelBelow) return refuel;

      // Refit at the chandlery: buy the highest-priority wanted upgrade we can afford
      // while keeping a money reserve. Only early enough to recoup the investment.
      if (upgradesOn(state) && !last && state.season <= cfg.seasons - 1) {
        const buys = ofType(legal, 'BUY_UPGRADE');
        const wish = cc.upgradeWishlist ?? ['engine', 'crane', 'potrack', 'tender', 'cargo', 'radar', 'fuelline', 'tank', 'grapple', 'flares'];
        for (const id of wish) {
          const b = buys.find((x) => x.upgradeId === id);
          // Keep enough behind to fill the tank here after paying: a bot that refitted down
          // to its last coin ran dry, could not buy fuel, and sat in port for whole seasons.
          const tankMoney = fuelCap(state, p) * fuelPriceAt(state, p.node);
          if (b && p.money - (upgradeDef(state, id)?.cost ?? Infinity) >= Math.max(UPGRADE_RESERVE, tankMoney)) return b;
        }
      }

      // Only put out if there's daylight for the whole round trip. Without this a bot
      // in port late in the day steamed out, was turned back by the make-harbour rule
      // the next hour, steamed out again, and so on until it was towed — then sat
      // stranded and broke while its pots fouled (zero hauls in season 1, measured).
      const hops = (n: number) => Math.ceil(n / Math.max(1, hopReach));
      const tripActions = hops(distance(state, p.node, target)) + 1 + hops(distanceToNearestPort(state, target));
      const daylight = Math.ceil(tripActions / cfg.actionsPerTurn) <= hoursLeftToday(state);
      if (!last && targetIsGround && targetOk && daylight) {
        const step = steerToward(state, pid, target, hopReach);
        const steam = step ? ofType(legal, 'STEAM').find((s) => s.to === step) : undefined;
        if (steam) return withSeaBribe(state, pid, cc, steam);
      }
      // Done for the day — but don't pay the pole (slot-0) rep cost. If we'd be
      // first into the berths, idle instead: a rival can take the front slot, or
      // the end-of-day auto-berth seats us for free. Rep is too weak to spend here.
      const berthAction = firstOfType(legal, 'BERTH');
      if (berthAction && (state.nextSlot > 0 || alignmentOn(state))) return berthAction; // the switchboard's front berth is free
      return pass;
    }

    // 3) AT SEA: drop a pot if we're standing on our empty target zone.
    if (p.node === target) {
      const drop = firstOfType(legal, 'DROP');
      if (drop && p.buoysAvailable > 0 && !buoys.some((b) => b.node === p.node)) return drop;
    }

    // Steam toward the target (grounds only while a port is still reachable after).
    const step = steerToward(state, pid, target, hopReach);
    if (step) {
      const steam = ofType(legal, 'STEAM').find((s) => s.to === step);
      if (steam && (!targetIsGround || targetOk)) return withSeaBribe(state, pid, cc, steam);
    }
    // Otherwise limp toward the nearest port.
    const homePort = nearestPort(state, p.node);
    const homeStep = homePort ? steerToward(state, pid, homePort, hopReach) : null;
    const homeSteam = homeStep ? ofType(legal, 'STEAM').find((s) => s.to === homeStep) : undefined;
    if (homeSteam) return withSeaBribe(state, pid, cc, homeSteam);

    return pass;
  };
}

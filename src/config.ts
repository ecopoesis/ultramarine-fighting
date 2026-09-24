import type { Config } from './types';
import { bayV4 } from './maps';

// THE TUNING SURFACE. Every number that balances the game lives here.
// Change these to rebalance; never hardcode numbers in /engine.
export const defaultConfig: Config = {
  players: 3,
  seasons: 5,          // the historical-fishing arc: near commons collapses, the fleet ratchets outward
  daysPerSeason: 5,    // fallback if daysSchedule is unset (a far round-trip must fit inside a season)
  daysSchedule: [4, 5, 5, 6, 6], // seasons LENGTHEN then plateau: a short S1 learning round (gates the deep), the far grounds open as the years drag on. CAPPED at 6 — full escalation ([4,5,6,7,8]) supercharges the volume high-graders (long late seasons) into a hustler runaway; the cap keeps the lengthening-seasons feel with healthy balance. See scripts/tuneSeededDays.ts.

  referencePlayers: 3, // bags + recruitment scale off this so depletion-per-boat holds across 3–6 players
  hoursPerDay: 6,
  actionsPerTurn: 2,
  buoysPerPlayer: 4,
  maxPotsPerSpace: 4, // at referencePlayers; scales with the table. Swept in scripts/tuneSpace.ts
  startMoney: 10,
  // The reputation track runs on a DOUBLED scale (start 16, not 8) purely so every
  // change is a whole number — half-points were the single biggest source of fractions
  // in the game. repToVP is halved to match, so scoring is unchanged.
  startReputation: 16,
  fuelTankMax: 10,
  startFuel: 8,

  // Penobscot Bay (v3 — reshaped for weather: concentric depth rings sized so a
  // storm die can pick which node in a tier gets hit). North (up-bay) is
  // shallow/safe; the water deepens and richens south into the open Gulf. Three
  // market ports with distinct appetites, two outer shelters, and a four-tier
  // depth gradient reached by steaming out through the island belt. Tier sizes:
  // inshore 4 (safe, never storms) · mid 6 · offshore 6 · deep 1 — the 6-node
  // rings map cleanly onto a d6 for storm placement.
  map: bayV4, // the real Penobscot Bay; bayV3 (the abstract ring map) is kept in maps.ts
  // tile-template name -> count in the bag at season start
  bags: {
    // Near grounds are a THIN, RICH opening seam: few keepers, high density, strips
    // fast. One season of even NICE (v-notching) play collapses them for the next
    // season (see scripts/tuneNearCollapse.ts). Recovery is stewardship-gated —
    // low base recruitment (dice 1 below), so v-notched eggers are what bring near
    // back in the mid-game; a greedy table that keeps eggers gets none of it.
    inshore: { KEEPER_1lb: 8, KEEPER_2lb: 4, SHORT: 4, JUMBO: 1, EGGER: 3 }, // 20 — thin & rich, collapses fast
    mid: { KEEPER_2lb: 7, KEEPER_3lb: 3, RARE_2lb: 1, SHORT: 4, JUMBO: 2, EGGER: 3 }, // 20
    offshore: { KEEPER_3lb: 9, RARE_3lb: 3, SHORT: 6, JUMBO: 5, EGGER: 7 }, // 30 — heavy, some rare (leaner: far shouldn't dominate pre-weather)
    deep: { KEEPER_4lb: 4, RARE_4lb: 2, SHORT: 7, JUMBO: 5, EGGER: 12 }, // 30 — a few big lobsters buried in junk & breeders: a real gamble
  },

  // Weather / storms (Chunk D) — active only when flags.weather is on. Storms grow
  // from the deep INWARD, intensifying season by season; the deep is always worst
  // and never clears, offshore ramps 1→3, mid arrives late, inshore stays a safe
  // refuge (0). S1 is calm (a learning round). Counts are the storm-die placement
  // per tier per season; all values are starting guesses to tune in sim.
  weather: {
    track: [
      { inshore: 0, mid: 0, offshore: 0, deep: 0 }, // S1 — calm
      { inshore: 0, mid: 0, offshore: 1, deep: 1 }, // S2 — the deep turns, offshore begins
      { inshore: 0, mid: 1, offshore: 2, deep: 1 }, // S3 — it reaches the island belt
      { inshore: 0, mid: 2, offshore: 3, deep: 1 }, // S4
      { inshore: 0, mid: 2, offshore: 3, deep: 1 }, // S5 — full blow: a third of the mid grounds and most of the outer water (the near-water haven shrinks late)
    ],
    hazardInTen: 4,  // d10: a beating on 4 or less when you push into a storm
    whittleInTen: 1, // d10: gear left in a storm parts on a 1
    hazardChance: 0.4, // (legacy, unused — the d10 above is what the engine rolls)
    hazardFuel: 1,     // a light beating — kept gentle so the fuel bleed at dear far ports doesn't bankrupt the far gamble; the whittle (lost gear) is the real teeth
    whittleChance: 0.12, // a pot left out overnight parts. Gentle: a far pot (3-night soak) survives
                         // ~2/3 of the time (0.88^3), so the churn bonus makes a stormed far ground a
                         // net-lucrative gamble (worth the long reach) rather than a coin-flip wash.
    bonusDraws: 4,       // a stormed prime haul: draw 3+4=7, keep 2+4=6 — a fat churn haul (the lure out to the edge)
    bonusKeep: 4,
  },

  // Seeded lobsters (whole-map lure) — active only when flags.seeded is on. One
  // generic keeper is dropped on every fishing space each season; they ACCUMULATE on
  // unfished spaces, so a neglected corner is a growing jackpot. A haul pulls the
  // space's pile (up to haulCap) BEFORE the bag draw. Generic ⇒ OPEN economy: sold
  // seeded lobsters leave the world (never join a restock pile). perSeason/weightLb
  // are the economy dials; pair with restock.dieFaces to hold commons health.
  seeded: { perSeason: 1, weightLb: 2, haulCap: 99 },

  trapStarters: 2, // of each sellable tile, in each ground's trap at setup
  // The lobster die, reimagined for breeding: mostly ones, a chance of nothing, a
  // chance of two. Mean 5/6 a die, so a well-tended ground still needs several.
  breeding: {
    mode: 'breeders', // the track starts at each ground's egger count and dwindles as eggers are KEPT (was: started at 0, rose with notches)
    emptyTrapGeneric: true, // an empty trap's shortfall comes back as generic lobsters (else recovery is capped by what's been landed). Counterfactual opus16-18: +3 points final health, no dry traps
    dieFaces: [0, 1, 1, 2, 2, 3], // averages 1.5: a blank means a bad year, a 3 a big one. Counterfactual opus16-18 (breeders + generic): final health 40% vs 33% on the old 0-0-1-1-1-2 die, and the narrowest light/dark money gap measured (180/196)
    diceByStock: [
      { atLeast: 15, dice: 5 },
      { atLeast: 10, dice: 4 },
      { atLeast: 6, dice: 3 },
      { atLeast: 3, dice: 2 },
      { atLeast: 1, dice: 1 },
      { atLeast: 0, dice: 0 },
    ],
  },

  eggerWeightLb: 4, // a berried female is big; releasing her now costs you a real landing
  requirePrimeToHaul: true, // no drop-and-grab: a pot must ripen to PRIME before it can be hauled (worker-placement rhythm)
  // stage indexed by daysSoaked; time+place => different curve shapes per ground
  soakCurves: {
    inshore: ['SET', 'PRIME', 'PRIME', 'PRIME', 'FOULED'],                    // wide prime, forgiving
    mid: ['SET', 'SOAKING', 'PRIME', 'PRIME', 'OVERRIPE', 'FOULED'],
    offshore: ['SET', 'SOAKING', 'PRIME', 'PRIME', 'OVERRIPE', 'FOULED'],     // primes day 2 (sped up: the far grounds' travel is the cost, not an endless soak wait)
    deep: ['SET', 'SOAKING', 'PRIME', 'PRIME', 'FOULED'],                     // primes day 2, then fouls — the far gamble without the double time-tax
  },

  drawByStage: {
    SET: { draw: 1, keep: 1 },
    SOAKING: { draw: 2, keep: 1 },
    PRIME: { draw: 3, keep: 2 },
    OVERRIPE: { draw: 2, keep: 1 },
    FOULED: { draw: 1, keep: 1 },
  },

  actionCost: {
    STEAM: 1, DROP: 1, HAUL: 1, STEAL: 2, SELL: 1, REFUEL: 1, REPORT: 1, BERTH: 0, BRIBE: 0, BUY_UPGRADE: 1, PASS: 0,
  },

  // Ship upgrades (engine-building layer). Money buys CAPABILITY, not just VP — a
  // real investment (pricey + an action + you must be at a market chandlery), scarce
  // (a face-up race per port), and slot-limited (max 3: engine + radar + one second-
  // middle). Costs/counts are starting guesses; tune the cadence to ~2-3/player/game.
  upgrades: {
    // Ideal: every costed action has a refit that makes it free; balance them by
    // COST (freeing a frequent action is worth more). Three slots, so you pick one
    // per slot — the catalog is wide, the ship is narrow.
    catalog: [
      // stern — propulsion & fuel
      { id: 'engine', label: 'Bigger engine', slot: 'stern', cost: 18, stepsPerSteam: 2 },        // STEAM moves 2 nodes/action
      { id: 'fuelline', label: 'Fuel line', slot: 'stern', cost: 10, freeAction: 'REFUEL' },       // REFUEL free (still pays for the fuel)
      // midPrimary — bridge / trade
      { id: 'gps', label: 'GPS plotter', slot: 'midPrimary', cost: 14, stormImmune: true, whittleRecover: true }, // no storm entry hazard, AND a parted pot comes back to your hand instead of being lost for the season
      { id: 'tender', label: 'Tender', slot: 'midPrimary', cost: 16, freeAction: 'SELL' },          // free docking: SELL costs 0
      { id: 'grapple', label: 'Grappling gear', slot: 'midPrimary', cost: 8, freeAction: 'STEAL' }, // STEAL free (niche → cheap)
      { id: 'flares', label: 'Signal flares', slot: 'midPrimary', cost: 5, freeAction: 'REPORT' },  // REPORT free — near-junk (report is rare); intentional chaff that clogs the display
      // midSecondary — deck gear
      { id: 'crane', label: 'Hauling crane', slot: 'midSecondary', cost: 16, freeAction: 'HAUL' },  // HAUL free
      { id: 'potrack', label: 'Pot rack', slot: 'midSecondary', cost: 14, freeAction: 'DROP' },     // DROP free
      { id: 'cargo', label: 'Cargo hold', slot: 'midSecondary', cost: 14, buoyBonus: 1 },           // + one buoy
      { id: 'tank', label: 'Bigger tanks', slot: 'midSecondary', cost: 10, fuelBonus: 6 },          // + fuel capacity
      // BLACK MARKET (flags.alignment) — never at a chandlery; a small stack for Shady and darker.
      { id: 'net', label: 'Illegal net', slot: 'midSecondary', cost: 12, dark: true, bonusDraws: 3 },     // +3 tiles drawn (and kept) per haul; every haul with it is a crime
      { id: 'smoker', label: 'Cheap engine', slot: 'stern', cost: 9, dark: true, stepsPerSteam: 2, pollutes: 1 }, // the big engine's reach for half the price — and every haul you make strips another tile off that ground
    ],
    perPortStock: 6, // each of the 3 market ports stocks this many refit tokens (drawn from the catalog)
    display: 3,      // face-up at once
  },

  // MATCHED to lastSlotRep: the berth queue is zero-sum (somebody is always first and
  // somebody always last), so an unavoidable charge at the front must be balanced by
  // the reward at the back or the whole table's standing just drains away — at 1 vs
  // 0.5 it bled half a point per table per day and reputation went NEGATIVE. Matched,
  // the queue REDISTRIBUTES standing instead of destroying it: push to the front and
  // lose it, yield and gain it.
  poleRepCost: 1,
  bribeMoneyCost: 4,
  lastSlotSweetenerFuel: 2,
  lastSlotRep: 1, // the tail of the berth order earns standing ("after you") — makes the order a gradient, not a pole-trap
  tow: { fee: 5, emergencyFuel: 2, lostTurns: 4, rep: -1 }, // end-of-day rescue for a boat caught at sea: towed to nearest port, a money fee, a splash of emergency fuel, and — the real teeth — 4 lost turns next morning. The lost time negates the guzzler's edge (never-returning = more fishing = more conservation), which a money fee alone can't reach. Honest bots make harbor in time (cardcounter time-bail), so this falls almost only on the guzzler.
  // theft/dirty play burns rep, but priced to be survivable if rationed:
  //   steal      -1  (was -2)  — cost of stealing a rival buoy
  //   illegalKeep -0.5 (was -1) — cost per illegal tile kept (high-grading)
  //   reported   -0.5 (own dial; was a 2nd full steal penalty) — extra heat when a theft is reported
  rep: { steal: -2, illegalKeep: -1, report: 2, vNotch: 2, bribe: -2, reported: -1 }, // vNotch is the CONSERVATION gain per egger (not on the doubled rep scale) // vNotch is the CONSERVATION track gain per egger notched (scaled to money with vNotchTokenValue)

  // You inherit season 1's licence with the boat; after that the fishery is limited
  // entry and the price climbs as the stock falls — the cost of staying in rises just
  // as the catch gets harder. Swept in scripts/tuneLicense.ts.
  licensePerSeason: [0, 6, 8, 10, 12],
  // Poaching: you can still fish, but every haul is illegal and the co-op is shut to you.
  // Set mayFish:false for a hard "no licence, no fishing" gate (measured as a death spiral).
  unlicensed: { mayFish: true, repPerHaul: -1, mayUseCoop: false },
  wagePerDay: 0, // tested (opus3) and abandoned — see types.ts
  holdDecayLbPerDay: 1,
  reportBountyDivisor: 2, // the reporter takes half the confiscated value, rounded down

  scoring: {
    moneyPerVP: 5,
    conservationBagHealthVP: 10, // shared end-game health bonus; floors conservation so specialists aren't zeroed
    repToVP: 2, // halved because the track itself is doubled — the VP are identical, the fractions are gone
    // sumWeakLink: the PEN-AND-PAPER combine (geometricMean is a cube root, unscoreable
    // by hand). Total = (sum of the three tracks) × the multiplier for your LOWEST
    // track, from the printed card below. Add three numbers, find the smallest, read
    // the row. Rewards balance, craters a dumped track — like geomean, by hand.
    combineMode: 'sumMinusPenalty',
    // Clean halve/quarter multipliers — easy to apply to a two-digit sum by hand.
    // Rescaled to the money band (~20-45 VP) and SOFTENED at the top: the old card
    // stepped 1 → 0.75 at a single threshold, so half a reputation point could cost a
    // quarter of the score. Near the top the steps are now gentle; the cliff only
    // appears where a track really has been dumped.
    // THE SCORING CARD. Add the three tracks, find your smallest, subtract the penalty
    // on its row. Every number is a whole one — the old card asked you to multiply a
    // three-digit sum by 0.75, which is exactly the arithmetic this game must not have.
    // Thresholds raised so the card actually DISCRIMINATES. At the old 30 line, four
    // captains in five paid nothing and the weak link was decorative — the same
    // complaint as the multiplier it replaced. Against the last full game's lowest
    // tracks (18 / 30 / 36 / 42 / 54) this charges three of the five, across three
    // different bands.
    weakLinkPenalty: [
      { atLeast: 40, penalty: 0 },    // genuinely balanced across all three
      { atLeast: 30, penalty: 10 },
      { atLeast: 20, penalty: 30 },
      { atLeast: 12, penalty: 60 },
      { atLeast: 6, penalty: 100 },
      { atLeast: -Infinity, penalty: 150 }, // a dumped track is close to fatal
    ],
    // Commons-health depletion track → VP (one end-game read, no ratio math).
    // whole percent, read off the depletion track
    healthBuckets: [
      { atLeast: 80, vp: 12 },
      { atLeast: 60, vp: 9 },
      { atLeast: 40, vp: 6 },
      { atLeast: 20, vp: 3 },
      { atLeast: 0, vp: 0 },
    ],
  },

  // ---- THE LIGHT/DARK SWITCHBOARD (SPEC §14), live only under flags.alignment ----
  // Money is the only score; ALIGNMENT switches what you can do, HEAT is what the
  // warden reads at the counter. Every value here is an arena-tuned starting point.
  alignment: {
    min: -10, max: 10,
    // THE BAND CARD, high → low. The lighter you are, the harder a crime lands and the
    // more you must pay your dues; the darker, the worse the market pays and the more
    // doors close — but the more of the catch you keep.
    bands: [
      { name: 'paragon', atLeast: 7, priceCut: 0, starsPerCrime: 5, mustLicense: true, coop: true, refuge: true, harbourBribe: false, dividend: true, blackMarket: false, bribeFloor: 1, bribeCosts: [4, 6, 8, 10] },
      { name: 'honest', atLeast: 3, priceCut: 0, starsPerCrime: 3, mustLicense: true, coop: true, refuge: true, harbourBribe: false, dividend: true, blackMarket: false, bribeFloor: 1, bribeCosts: [4, 6, 8, 10] },
      { name: 'neutral', atLeast: -2, priceCut: 0, starsPerCrime: 2, mustLicense: false, coop: true, refuge: true, harbourBribe: false, dividend: true, blackMarket: false, bribeFloor: 1, bribeCosts: [4, 6, 8, 10] },
      { name: 'shady', atLeast: -6, priceCut: 0, starsPerCrime: 1, mustLicense: false, coop: false, refuge: true, harbourBribe: true, dividend: false, blackMarket: true, bribeFloor: 2, bribeCosts: [6, 9, 12, 15] },
      { name: 'outlaw', atLeast: -Infinity, priceCut: 0, starsPerCrime: 1, mustLicense: false, coop: false, refuge: false, harbourBribe: true, dividend: false, blackMarket: true, bribeFloor: 3, bribeCosts: [8, 12, 16, 20] },
    ],
    step: {
      notch: 1, licence: 1, coopLanding: 1, report: 1,
      illegalKeep: -1, poachHaul: -1, steal: -2, bribe: -1, caught: -2, darkRefit: -2,
    },
    paragonFallTo: -3, // top of Shady: a good name is a long way to fall
    floorStarsPerCrime: 1, // an outlaw pinned at -10 pays for further crimes in stars
    darkSlotsByPlayers: [0, 0, 1, 1, 1, 2, 2], // index = player count; about a third, rounded to nearest
    squeezeSeason: 2,
    darkRefits: ['net', 'smoker'],
  },
  heat: {
    max: 5,
    dieFaces: [0, 1, 1, 1, 2, 2], // averages just over 1, tops out at 2: the total climbs, never spikes
    failAt: 5,                    // 1–2 dice never bust; 3 dice 20%, 4 dice 56%, 5 dice 81%
    takePerPoint: 1,              // under the line, the warden's take: money per point rolled
    coolPerDayUnsold: 1,          // stay away from the counter for a day: one star cools
    poachHaulIsCrime: false,      // an unlicensed haul costs alignment; the warden cares what's in the hold
    reportedStars: 1,
    netIsCrime: true,             // the net is the crime: every haul with it adds stars
    capCheck: true,               // at 5★ a crime can't add a star, so it is checked on the spot instead: "heat is capped, so extra crimes cost nothing" (opus16-18)
  },
  closure: {
    // Per-ground health (bag fullness, %). Below the line the ground closes to these
    // bands — still fishable, at +starsPerHaul a pot.
    levels: [
      { belowPct: 35, closedTo: ['neutral', 'shady', 'outlaw'] },
      { belowPct: 60, closedTo: ['shady', 'outlaw'] },
    ],
    starsPerHaul: 2,  // was 1: in opus15 outlaws hauled closed water 17 times and the ocean fell to 9%
  },
  // The co-op's season-end dividend to licensed members Neutral or lighter, read off the
  // ocean's health (whole %). The light side's steady income depends on live water.
  dividend: {
    byHealth: [
      { atLeast: 80, money: 8, paragon: 16 },
      { atLeast: 60, money: 6, paragon: 12 },
      { atLeast: 40, money: 4, paragon: 8 },
      { atLeast: 20, money: 2, paragon: 4 },
      { atLeast: 0, money: 0, paragon: 0 },
    ],
  },

  // Every kind of chance on its own random sequence (rng.ts). Games recorded before this
  // was switched on replay with it off.
  rngStreams: true,

  // Warden patrols (flags.patrols, needs flags.alignment): boats drawn onto ocean spaces
  // every morning. A captain with stars who enters one takes a heat check at sea.
  patrol: { base: 1, perDarkCaptain: 1, max: 3 },

  flags: { weather: true, seeded: true, upgrades: true, eras: false, multiShip: false, inspections: false, alignment: true, patrols: true },
};

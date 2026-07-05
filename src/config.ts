import type { Config } from './types';

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
  startMoney: 10,
  startReputation: 8, // buffer so dirty play (theft/high-grading) is a priced risk, not instant death under weak-link
  fuelTankMax: 10,
  startFuel: 8,

  // Penobscot Bay (v3 — reshaped for weather: concentric depth rings sized so a
  // storm die can pick which node in a tier gets hit). North (up-bay) is
  // shallow/safe; the water deepens and richens south into the open Gulf. Three
  // market ports with distinct appetites, two outer shelters, and a four-tier
  // depth gradient reached by steaming out through the island belt. Tier sizes:
  // inshore 4 (safe, never storms) · mid 6 · offshore 6 · deep 1 — the 6-node
  // rings map cleanly onto a d6 for storm placement.
  map: {
    nodes: {
      // --- market ports (dock: refuel/berth AND sell) ---
      ROCKLAND:   { type: 'port', label: 'Rockland', port: {
        fuelCostPerUnit: 1, market: { base: 4.5, elasticity: 0.6, floor: 2, rareBonus: 0 } } },   // SW mainland: cheap fuel but its price now CRASHES when everyone dumps inshore catch here — pushes selling (and fishing) outward
      VINALHAVEN: { type: 'port', label: 'Vinalhaven', port: {
        fuelCostPerUnit: 2, market: { base: 7, elasticity: 1.0, floor: 3, rareBonus: 0.5 } } },     // island: high price, floods fast, dear fuel, the offshore springboard
      STONINGTON: { type: 'port', label: 'Stonington', port: {
        fuelCostPerUnit: 1.5, market: { base: 6, elasticity: 0.5, floor: 3, rareBonus: 0.4 } } },   // eastern premium, near the mid grounds

      // --- shelters (refuge + emergency fuel, NO market) — stage the outer run ---
      MONHEGAN:   { type: 'port', label: 'Monhegan', port: { fuelCostPerUnit: 4, shelter: true } },  // SW lighthouse, by the outer-west water
      MATINICUS:  { type: 'port', label: 'Matinicus', port: { fuelCostPerUnit: 4, shelter: true } },  // outermost, a stone's throw from the deep edge

      // --- fishing zones (share their ground TYPE's bag) ---
      // inshore ring (4) — up-bay, safe, off Rockland
      INSHORE_W:  { type: 'ground', ground: 'inshore', label: 'Muscle Ridge' },
      INSHORE_N:  { type: 'ground', ground: 'inshore', label: 'Upper Bay' },
      INSHORE_E:  { type: 'ground', ground: 'inshore', label: 'Owls Head' },
      INSHORE_S:  { type: 'ground', ground: 'inshore', label: 'Mussel Shoals' },
      // mid ring (6) — the island belt
      MID_W:      { type: 'ground', ground: 'mid', label: 'West Bay' },
      MID_NW:     { type: 'ground', ground: 'mid', label: 'Hurricane Sound' },
      MID_N:      { type: 'ground', ground: 'mid', label: 'Fox Islands' },
      MID_C:      { type: 'ground', ground: 'mid', label: 'Seal Bay' },
      MID_E:      { type: 'ground', ground: 'mid', label: 'Eggemoggin Reach' },
      MID_SE:     { type: 'ground', ground: 'mid', label: 'Isle au Haut' },
      // offshore ring (6) — the outer water
      OFF_W:      { type: 'ground', ground: 'offshore', label: 'Outer West' },
      OFF_NW:     { type: 'ground', ground: 'offshore', label: 'Two Bush' },
      OFF_N:      { type: 'ground', ground: 'offshore', label: 'Large Green' },
      OFF_C:      { type: 'ground', ground: 'offshore', label: 'Seal Ledge' },
      OFF_E:      { type: 'ground', ground: 'offshore', label: 'Outer East' },
      OFF_SE:     { type: 'ground', ground: 'offshore', label: 'Saddleback' },
      // the deep edge (1) — richest, farthest, fouls fast
      DEEP_EDGE:  { type: 'ground', ground: 'deep', label: 'The Edge' },
    },
    edges: [
      // inshore ring (W–N–E–S) off Rockland
      ['ROCKLAND', 'INSHORE_W'],
      ['ROCKLAND', 'INSHORE_N'],
      ['INSHORE_W', 'INSHORE_N'],
      ['INSHORE_N', 'INSHORE_E'],
      ['INSHORE_E', 'INSHORE_S'],
      ['INSHORE_S', 'INSHORE_W'],
      // inshore → mid radials
      ['INSHORE_W', 'MID_W'],
      ['INSHORE_N', 'MID_N'],
      ['INSHORE_E', 'MID_E'],
      ['INSHORE_S', 'MID_SE'],
      // mid ring (6-cycle) + its ports
      ['MID_W', 'MID_NW'],
      ['MID_NW', 'MID_N'],
      ['MID_N', 'MID_C'],
      ['MID_C', 'MID_E'],
      ['MID_E', 'MID_SE'],
      ['MID_SE', 'MID_W'],
      ['VINALHAVEN', 'MID_C'],
      ['STONINGTON', 'MID_E'],
      ['STONINGTON', 'MID_SE'],
      // mid → offshore radials (+ the island morning run)
      ['MID_W', 'OFF_W'],
      ['MID_N', 'OFF_N'],
      ['MID_C', 'OFF_C'],
      ['MID_E', 'OFF_E'],
      ['VINALHAVEN', 'OFF_SE'],   // the morning run — 1 step off the island
      // offshore ring (6-cycle) + its shelter
      ['OFF_W', 'OFF_NW'],
      ['OFF_NW', 'OFF_N'],
      ['OFF_N', 'OFF_C'],
      ['OFF_C', 'OFF_E'],
      ['OFF_E', 'OFF_SE'],
      ['OFF_SE', 'OFF_W'],
      ['MONHEGAN', 'OFF_W'],
      ['MONHEGAN', 'OFF_NW'],
      // the deep edge (only through the offshore water) + outer shelter
      ['OFF_C', 'DEEP_EDGE'],
      ['OFF_SE', 'DEEP_EDGE'],
      ['MATINICUS', 'DEEP_EDGE'],
      ['MATINICUS', 'OFF_SE'],
    ],
    fuelPerStep: 1,
    startPort: 'ROCKLAND',
    // decorative — flavor only, no gameplay (a future UI can scatter these)
    landmarks: [
      { name: 'Saddleback Ledge', near: 'OFF_SE' },
      { name: 'Goose Rocks', near: 'MID_C' },
      { name: 'Eagle Island', near: 'MID_E' },
      { name: 'Heron Neck Light', near: 'VINALHAVEN' },
    ],
  },

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
    hazardChance: 0.4, // entering a storm: a chance of a beating (chancy, not a wall)
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

  // Inter-season restock draft (the custom lobster d6 — its faces are the main
  // recovery knob; a 0 is a blank that wastes the claim). Piles start pre-seeded
  // with a few of each sellable template for early agency.
  restock: { dieFaces: [0, 1, 2, 3, 4, 5], preSeedPerBag: 2 },

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
      { id: 'radar', label: 'Radar', slot: 'midPrimary', cost: 14, stormImmune: true },            // no storm entry hazard
      { id: 'tender', label: 'Tender', slot: 'midPrimary', cost: 16, freeAction: 'SELL' },          // free docking: SELL costs 0
      { id: 'grapple', label: 'Grappling gear', slot: 'midPrimary', cost: 8, freeAction: 'STEAL' }, // STEAL free (niche → cheap)
      { id: 'flares', label: 'Signal flares', slot: 'midPrimary', cost: 5, freeAction: 'REPORT' },  // REPORT free — near-junk (report is rare); intentional chaff that clogs the display
      // midSecondary — deck gear
      { id: 'crane', label: 'Hauling crane', slot: 'midSecondary', cost: 16, freeAction: 'HAUL' },  // HAUL free
      { id: 'potrack', label: 'Pot rack', slot: 'midSecondary', cost: 14, freeAction: 'DROP' },     // DROP free
      { id: 'cargo', label: 'Cargo hold', slot: 'midSecondary', cost: 14, buoyBonus: 1 },           // + one buoy
      { id: 'tank', label: 'Bigger tanks', slot: 'midSecondary', cost: 10, fuelBonus: 6 },          // + fuel capacity
    ],
    perPortStock: 6, // each of the 3 market ports stocks this many refit tokens (drawn from the catalog)
    display: 3,      // face-up at once
  },

  poleRepCost: 1,
  bribeMoneyCost: 4,
  lastSlotSweetenerFuel: 2,
  tow: { fee: 5, emergencyFuel: 2, lostTurns: 4 }, // end-of-day rescue for a boat caught at sea: towed to nearest port, a money fee, a splash of emergency fuel, and — the real teeth — 4 lost turns next morning. The lost time negates the guzzler's edge (never-returning = more fishing = more conservation), which a money fee alone can't reach. Honest bots make harbor in time (cardcounter time-bail), so this falls almost only on the guzzler.
  // theft/dirty play burns rep, but priced to be survivable if rationed:
  //   steal      -1  (was -2)  — cost of stealing a rival buoy
  //   illegalKeep -0.5 (was -1) — cost per illegal tile kept (high-grading)
  //   reported   -0.5 (own dial; was a 2nd full steal penalty) — extra heat when a theft is reported
  rep: { steal: -1, illegalKeep: -0.5, report: 1, vNotch: 1, bribe: -1, reported: -0.5 },

  holdDecayLbPerDay: 1,
  reportBountyShare: 0.5,

  vToken: { insuranceDraws: 1 }, // spend a token on a lean haul → draw 1 extra, keep best keeper (dial #4)

  scoring: {
    moneyPerVP: 5,
    vNotchTokenValue: 1,
    conservationBagHealthVP: 10, // shared end-game health bonus; floors conservation so specialists aren't zeroed
    repToVP: 4, // rescaled so reputation lands on the same ~0-25 scale as money/conservation — the weak-link's "lowest track" is only fair if the tracks are comparable
    // sumWeakLink: the PEN-AND-PAPER combine (geometricMean is a cube root, unscoreable
    // by hand). Total = (sum of the three tracks) × the multiplier for your LOWEST
    // track, from the printed card below. Add three numbers, find the smallest, read
    // the row. Rewards balance, craters a dumped track — like geomean, by hand.
    combineMode: 'sumWeakLink',
    // Clean halve/quarter multipliers — easy to apply to a two-digit sum by hand.
    weakLink: [
      { atLeast: 22, mult: 1 },      // balanced across all three → full score
      { atLeast: 16, mult: 0.75 },
      { atLeast: 10, mult: 0.5 },
      { atLeast: 4, mult: 0.25 },
      { atLeast: -Infinity, mult: 0 }, // a dumped track (below 4) zeroes you
    ],
    // Commons-health depletion track → VP (one end-game read, no ratio math).
    healthBuckets: [
      { atLeast: 0.8, vp: 10 },
      { atLeast: 0.6, vp: 7 },
      { atLeast: 0.4, vp: 4 },
      { atLeast: 0.2, vp: 2 },
      { atLeast: 0, vp: 0 },
    ],
  },

  flags: { weather: true, seeded: true, upgrades: true, eras: false, multiShip: false, inspections: false },
};

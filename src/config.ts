import type { Config } from './types';

// THE TUNING SURFACE. Every number that balances the game lives here.
// Change these to rebalance; never hardcode numbers in /engine.
export const defaultConfig: Config = {
  players: 3,
  seasons: 5,          // the historical-fishing arc: near commons collapses, the fleet ratchets outward
  daysPerSeason: 5,    // a far round-trip must fit inside a season, else offshore/deep are unfishable and the arc is inert (Chunk C: 4→5 opened the migration window; speeding far prime instead front-loaded far fishing into S1)
  referencePlayers: 3, // bags + recruitment scale off this so depletion-per-boat holds across 3–6 players
  hoursPerDay: 6,
  actionsPerTurn: 2,
  buoysPerPlayer: 4,
  startMoney: 10,
  startReputation: 8, // buffer so dirty play (theft/high-grading) is a priced risk, not instant death under weak-link
  fuelTankMax: 10,
  startFuel: 8,

  // Penobscot Bay (v2 — geometry still to be backfit to the real chart).
  // North (up-bay) is shallow/safe; the water deepens and richens south into the
  // open Gulf. Three market ports with distinct appetites, two outer shelters,
  // and a four-tier depth gradient (inshore → mid → offshore → the deep edge)
  // reached by steaming out through the island belt.
  map: {
    nodes: {
      // --- market ports (dock: refuel/berth AND sell) ---
      ROCKLAND:   { type: 'port', label: 'Rockland', port: {
        fuelCostPerUnit: 1, market: { base: 4.5, elasticity: 0.15, floor: 2, rareBonus: 0 } } },   // SW mainland: deep appetite, cheap fuel, far from the edge
      VINALHAVEN: { type: 'port', label: 'Vinalhaven', port: {
        fuelCostPerUnit: 2, market: { base: 7, elasticity: 1.0, floor: 3, rareBonus: 0.5 } } },     // island: high price, floods fast, dear fuel, near the edge
      STONINGTON: { type: 'port', label: 'Stonington', port: {
        fuelCostPerUnit: 1.5, market: { base: 6, elasticity: 0.5, floor: 3, rareBonus: 0.4 } } },   // eastern premium, near the mid grounds

      // --- shelters (refuge + emergency fuel, NO market) — stage the outer run ---
      MONHEGAN:   { type: 'port', label: 'Monhegan', port: { fuelCostPerUnit: 4, shelter: true } },  // SW lighthouse, by the outer-west water
      MATINICUS:  { type: 'port', label: 'Matinicus', port: { fuelCostPerUnit: 4, shelter: true } },  // outermost, a stone's throw from the deep edge

      // --- fishing zones (share their ground TYPE's bag) ---
      INSHORE_W:  { type: 'ground', ground: 'inshore', label: 'Muscle Ridge' },
      INSHORE_N:  { type: 'ground', ground: 'inshore', label: 'Upper Bay' },
      MID_W:      { type: 'ground', ground: 'mid', label: 'West Bay' },
      MID_C:      { type: 'ground', ground: 'mid', label: 'Fox Islands' },
      MID_E:      { type: 'ground', ground: 'mid', label: 'Eggemoggin Reach' },
      OFFSHORE_W: { type: 'ground', ground: 'offshore', label: 'Outer West' },
      OFFSHORE_E: { type: 'ground', ground: 'offshore', label: 'Outer East' },
      DEEP_EDGE:  { type: 'ground', ground: 'deep', label: 'The Edge' },      // richest, farthest, fouls fast
    },
    edges: [
      // west shore & up-bay
      ['ROCKLAND', 'INSHORE_W'],
      ['ROCKLAND', 'MID_W'],
      ['INSHORE_W', 'INSHORE_N'],
      ['INSHORE_W', 'MID_W'],
      ['INSHORE_N', 'MID_C'],
      // the island belt (mid)
      ['MID_W', 'MID_C'],
      ['MID_C', 'MID_E'],
      ['MID_C', 'VINALHAVEN'],
      ['MID_E', 'STONINGTON'],
      // out to the offshore grounds
      ['MID_W', 'OFFSHORE_W'],
      ['MID_E', 'OFFSHORE_E'],
      ['VINALHAVEN', 'OFFSHORE_E'],   // the morning run — 1 step off the island
      ['OFFSHORE_W', 'OFFSHORE_E'],
      // the deep edge (only through the offshore water) + outer shelters
      ['OFFSHORE_W', 'DEEP_EDGE'],
      ['OFFSHORE_E', 'DEEP_EDGE'],
      ['OFFSHORE_W', 'MONHEGAN'],
      ['OFFSHORE_E', 'MATINICUS'],
      ['DEEP_EDGE', 'MATINICUS'],
    ],
    fuelPerStep: 1,
    startPort: 'ROCKLAND',
    // decorative — flavor only, no gameplay (a future UI can scatter these)
    landmarks: [
      { name: 'Saddleback Ledge', near: 'OFFSHORE_E' },
      { name: 'Goose Rocks', near: 'MID_C' },
      { name: 'Eagle Island', near: 'MID_E' },
      { name: 'Heron Neck Light', near: 'VINALHAVEN' },
    ],
  },

  // tile-template name -> count in the bag at season start
  bags: {
    inshore: { KEEPER_1lb: 14, KEEPER_2lb: 6, SHORT: 14, JUMBO: 2, EGGER: 4 }, // 40 — light, forgiving
    mid: { KEEPER_2lb: 12, KEEPER_3lb: 6, RARE_2lb: 2, SHORT: 8, JUMBO: 3, EGGER: 4 }, // 35
    offshore: { KEEPER_3lb: 12, RARE_3lb: 4, SHORT: 4, JUMBO: 5, EGGER: 5 }, // 30 — heavy, some rare
    deep: { KEEPER_4lb: 6, RARE_4lb: 3, SHORT: 6, JUMBO: 6, EGGER: 9 }, // 30 — big lobsters but you mostly pull junk & breeders: a gamble, and v-notch matters
  },

  // Inter-season recruitment (starting guesses — tune in sim). Inner grounds
  // breed back fast, the deep barely at all; every v-notched egger left in the
  // bag adds recruitment dice (one die per `eggerPerDie` breeders).
  restock: { baseDice: { inshore: 3, mid: 2, offshore: 1, deep: 1 }, eggerPerDie: 2, diceSides: 6 },

  // stage indexed by daysSoaked; time+place => different curve shapes per ground
  soakCurves: {
    inshore: ['SET', 'PRIME', 'PRIME', 'PRIME', 'FOULED'],                    // wide prime, forgiving
    mid: ['SET', 'SOAKING', 'PRIME', 'PRIME', 'OVERRIPE', 'FOULED'],
    offshore: ['SET', 'SOAKING', 'SOAKING', 'PRIME', 'OVERRIPE', 'FOULED'],   // narrow prime
    deep: ['SET', 'SOAKING', 'SOAKING', 'PRIME', 'FOULED'],                   // prime day 3 only, then fouls fast — a real commitment
  },

  drawByStage: {
    SET: { draw: 1, keep: 1 },
    SOAKING: { draw: 2, keep: 1 },
    PRIME: { draw: 3, keep: 2 },
    OVERRIPE: { draw: 2, keep: 1 },
    FOULED: { draw: 1, keep: 1 },
  },

  actionCost: {
    STEAM: 1, DROP: 1, HAUL: 1, STEAL: 2, SELL: 1, REFUEL: 1, REPORT: 1, BERTH: 0, BRIBE: 0, PASS: 0,
  },

  poleRepCost: 1,
  bribeMoneyCost: 4,
  lastSlotSweetenerFuel: 2,
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
    repToVP: 1,
    // geometricMean: dumping any track (→0) still craters you, but a merely-weak
    // track isn't annihilated the way min/max does — the only mode that yields
    // three viable archetypes (steward/greedy/thief all win a fair share). See
    // scripts/tuneScoring.ts. weakLinkMultiplier handed the steward ~92%.
    combineMode: 'geometricMean',
  },

  flags: { weather: false, eras: false, multiShip: false, inspections: false },
};

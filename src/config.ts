import type { Config } from './types';

// THE TUNING SURFACE. Every number that balances the game lives here.
// Change these to rebalance; never hardcode numbers in /engine.
export const defaultConfig: Config = {
  players: 3,
  days: 5,
  hoursPerDay: 6,
  actionsPerTurn: 2,
  buoysPerPlayer: 4,
  startMoney: 10,
  startReputation: 8, // buffer so dirty play (theft/high-grading) is a priced risk, not instant death under weak-link
  fuelTankMax: 10,
  startFuel: 8,
  fuelCostPerUnit: 1,

  map: {
    nodes: {
      PORT: { type: 'harbor' },
      INSHORE: { type: 'ground', ground: 'inshore' },
      MID: { type: 'ground', ground: 'mid' },
      OFFSHORE: { type: 'ground', ground: 'offshore' },
    },
    edges: [
      ['PORT', 'INSHORE'],
      ['INSHORE', 'MID'],
      ['MID', 'OFFSHORE'],
    ],
    fuelPerStep: 1,
    harbor: 'PORT',
  },

  // tile-template name -> count in the bag at season start
  bags: {
    inshore: { KEEPER_1lb: 14, KEEPER_2lb: 6, SHORT: 14, JUMBO: 2, EGGER: 4 }, // 40
    mid: { KEEPER_2lb: 12, KEEPER_3lb: 6, RARE_2lb: 2, SHORT: 8, JUMBO: 3, EGGER: 4 }, // 35
    offshore: { KEEPER_3lb: 12, RARE_3lb: 4, SHORT: 4, JUMBO: 5, EGGER: 5 }, // 30
  },

  // stage indexed by daysSoaked; time+place => different curve shapes per ground
  soakCurves: {
    inshore: ['SET', 'PRIME', 'PRIME', 'PRIME', 'FOULED'],
    mid: ['SET', 'SOAKING', 'PRIME', 'PRIME', 'OVERRIPE', 'FOULED'],
    offshore: ['SET', 'SOAKING', 'SOAKING', 'PRIME', 'OVERRIPE', 'FOULED'], // narrow prime
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

  buyers: {
    coop: { base: 4, elasticity: 0.2, floor: 2, rareBonus: 0 },
    tourist: { base: 7, elasticity: 1.0, floor: 3, rareBonus: 0.5 },
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

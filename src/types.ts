// All shared types live here to avoid circular imports.

export type TileKind = 'KEEPER' | 'SHORT' | 'JUMBO' | 'EGGER';
export type Color = 'common' | 'rare';
export type Ground = 'inshore' | 'mid' | 'offshore' | 'deep';
export type Stage = 'SET' | 'SOAKING' | 'PRIME' | 'OVERRIPE' | 'FOULED';
export type Phase = 'PLAYING' | 'RESTOCK' | 'GAME_OVER';

export interface Tile {
  id: string;
  kind: TileKind;     // marker: type (keeper / short / jumbo / egger)
  weightLb: number;   // marker: size
  color: Color;       // marker: rarity (common / rare)
  ground: Ground;     // marker: bag — which ground-type bag it belongs to (routes sold tiles to the right pile)
  seeded?: boolean;   // a GENERIC seeded lobster (dropped on a space, not from a bag): OPEN economy —
                      // when sold it leaves the world instead of landing on a restock pile.
}

export interface DeployedBuoy {
  buoyId: string;
  node: string;
  ownerId: string;
}

export interface SoakRecord {
  ground: Ground;
  daysSoaked: number; // stage is derived from this via the ground curve
}

export interface PlayerState {
  id: string;
  name: string;
  node: string;
  fuel: number;
  money: number;        // single money figure: spendable resource AND money-score at end
  actionsLeft: number;
  buoysAvailable: number;
  deployed: DeployedBuoy[];           // PUBLIC
  soak: Record<string, SoakRecord>;   // PRIVATE, keyed by buoyId
  hold: Tile[];
  soldToday: boolean;
  berthed: boolean;
  berthNode?: string;   // the port a captain berthed in — where they start tomorrow (daily home-port choice)
  vTokens: number;
  tracks: { conservation: number; reputation: number };
}

export interface TheftRecord {
  victimId: string;
  thiefId: string;
  value: number; // proxy value of stolen catch, for the report bounty
}

// The inter-season restock draft, live only while phase === 'RESTOCK'. Captains
// CLAIM bags in berth order; after each claim, players to the claimer's left may
// CONTRIBUTE v-notch tokens (each token = one extra lobster returned). See
// engine/restock.ts for the state machine.
export interface RestockState {
  claimOrder: string[];   // berth order — who claims, in turn
  claimTurn: number;      // index into claimOrder of the current claimer
  claimed: Ground[];      // bags already restocked this draft
  roll: number;           // current claimer's lobster-die roll (how many they return)
  step: 'claim' | 'contribute';
  contribGround?: Ground; // the bag just claimed, now open for v-notch contributions
  contribOrder?: string[]; // players eligible to contribute, from the claimer's left
  contribTurn?: number;   // index into contribOrder
}

export interface GameState {
  config: Config;
  rngSeed: number;
  phase: Phase;
  restock?: RestockState; // present only during the RESTOCK phase
  season: number;         // 1-based; game ends after config.seasons
  day: number;            // 1-based day WITHIN the current season
  hour: number;
  turnOrder: string[];
  activePlayerIndex: number;
  players: Record<string, PlayerState>;
  bags: Record<Ground, Tile[]>;
  bagStart: Record<Ground, number>;
  // Generic "seeded" lobsters sitting on each fishing space (by node). One is dropped
  // on every space at the start of each season and they ACCUMULATE on unfished spaces,
  // so neglected corners build up a pile — the lure to work the whole map. A haul pulls
  // the space's pile first, then the bag. Empty when flags.seeded is off.
  seeded: Record<string, number>;
  // Nodes currently under storm (weather). Placed at each season rollover from the
  // season's storm track; empty when flags.weather is off (or the calm first season).
  // ENTERING one risks a hazard, gear left in one gets whittled overnight, but
  // FISHING one churns up bonus lobster — pure gamble. Shelters are never stormed.
  stormed: string[];
  // Extraction piles: sold/fished lobsters, sorted by their home bag. Tiles removed
  // from the commons land here (never destroyed); the inter-season restock draft
  // returns some of them to the bags. Depletion = bag→pile drift, not tiles leaving
  // the world, so the whole census (bags + holds + piles) is conserved.
  piles: Record<Ground, Tile[]>;
  markets: Record<string, { lbsSoldToday: number }>; // per market-port: lbs sold today (flood), recovers overnight
  nextSlot: number;
  pendingNextOrder: string[];
  thefts: TheftRecord[];
  log: string[];
  buoyCounter: number; // for unique buoy ids
}

// ---- Config ----

// A port's market. Sell where you dock — price = max(floor, base - elasticity*lbsSoldToday_here).
// Low elasticity = deep appetite / slow flood (Rockland); high = small appetite / floods fast.
export interface BuyerConfig {
  base: number;
  elasticity: number;
  floor: number;
  rareBonus: number;
}

// A dock. Every port lets you refuel/berth; only ports with a `market` buy lobster.
// A `shelter` (Matinicus, Monhegan) is storm refuge + emergency fuel — no market.
export interface PortConfig {
  fuelCostPerUnit: number;   // money per fuel unit here (islands/shelters are dear)
  market?: BuyerConfig;      // present => you can SELL here
  shelter?: boolean;         // lighthouse/refuge: no market, emergency fuel only
}

export interface DrawRule { draw: number; keep: number }

// Weather / storms (Chunk D). The danger half of the forced-outward arc and the
// brake on far-commit dominance. Storms grow from the deep inward, intensifying
// season by season; the deep is always worst and never clears. Three effects:
// entering a stormed node risks a hazard (fuel), gear left in one gets parted
// overnight, and FISHING one churns up bonus lobster — risk vs reward tuned to a
// near-wash so the far grounds become a gamble, not a wall or a free lunch.
export interface WeatherConfig {
  // Per-season storm counts per tier: how many nodes of that tier are stormed.
  // Index 0 = season 1 (keep all-zero: S1 is the calm learning round). The storm
  // die picks WHICH nodes. Keep inshore 0 (the safe refuge tier); deep has one
  // node, so any count >= 1 means it always storms ('*'). Grows deep→inward.
  track: Record<Ground, number>[];
  hazardChance: number; // prob of a hazard when ENTERING a stormed node
  hazardFuel: number;   // fuel lost on a hazard hit
  whittleChance: number; // prob per night that a pot left in a stormed node is parted (lost for the season)
  bonusDraws: number;   // extra tiles drawn when hauling a stormed node (the churn)
  bonusKeep: number;    // extra keep-limit on a stormed haul (land more of the churn)
}

export interface Config {
  players: number;
  seasons: number;        // number of seasons; the game ends after the last one
  daysPerSeason: number;  // fishing days within each season (fallback when daysSchedule is absent)
  // Optional per-season day count (index 0 = season 1). Seasons LENGTHEN through the
  // game — the fishery works longer as the years pass, the ocean recovers less. A
  // short S1 is a low-stakes learning round and gates the deep (its 3-day prime
  // barely fits); later seasons open the far grounds. Read via daysThisSeason().
  daysSchedule?: number[];
  referencePlayers: number; // bags AND recruitment scale by players/referencePlayers (constant pressure-per-boat)
  hoursPerDay: number;
  actionsPerTurn: number;
  buoysPerPlayer: number;
  startMoney: number;
  startReputation: number;
  fuelTankMax: number;
  startFuel: number;

  map: {
    // A node is a port (dock: refuel/berth, maybe a market) or a ground (a fishing
    // zone of some ground type). Several zones can share a ground type — they draw
    // from that type's shared bag. `label` is display-only flavor.
    nodes: Record<string, { type: 'port' | 'ground'; ground?: Ground; port?: PortConfig; label?: string }>;
    edges: [string, string][];
    fuelPerStep: number;
    startPort: string; // where every boat begins day 1
    // Decorative islands/ledges — pure flavor for the map, no gameplay. `near`
    // is the node they sit beside so a future UI can place them.
    landmarks?: { name: string; near: string }[];
  };

  bags: Record<Ground, Record<string, number>>; // per ground TYPE: tileTemplateName -> count
  weather: WeatherConfig;                        // storms (Chunk D); active only when flags.weather is on
  // Seeded lobsters: generic keepers dropped on every fishing space each season that
  // accumulate on unfished spaces (the whole-map lure). Active only when flags.seeded is on.
  seeded: { perSeason: number; weightLb: number; haulCap: number };
  // Inter-season restock DRAFT: in berth order, each captain claims one remaining
  // bag, rolls the custom lobster die, and returns that many lobsters from the
  // bag's pile. `dieFaces` are the SIX faces of a physical d6 — the values (and
  // blanks: a 0-face wastes the claim yet still locks the bag) are the tuning
  // knob. Only ~4 bags, so with more players than bags some don't get to restock —
  // the pole is worth fighting for. Piles are pre-seeded with `preSeedPerBag` of
  // each sellable template for early agency. No restock before the final season.
  restock: { dieFaces: number[]; preSeedPerBag: number };
  soakCurves: Record<Ground, Stage[]>;
  drawByStage: Record<Stage, DrawRule>;
  actionCost: Record<string, number>;

  poleRepCost: number;
  bribeMoneyCost: number;
  lastSlotSweetenerFuel: number;
  rep: { steal: number; illegalKeep: number; report: number; vNotch: number; bribe: number; reported: number };

  holdDecayLbPerDay: number;
  reportBountyShare: number;

  // v-token draw insurance (§7.4): on a lean haul (no keeper drawn) a player may
  // spend one v-token to draw `insuranceDraws` extra tiles and keep the best
  // keeper among them. Strength dial #4 — higher = more reliable rescue.
  vToken: { insuranceDraws: number };

  scoring: {
    moneyPerVP: number;
    vNotchTokenValue: number;
    conservationBagHealthVP: number;
    repToVP: number;
    combineMode: 'sum' | 'weakLinkMultiplier' | 'geometricMean' | 'weakestLink';
  };

  flags: { weather: boolean; seeded: boolean; eras: boolean; multiShip: boolean; inspections: boolean };
}

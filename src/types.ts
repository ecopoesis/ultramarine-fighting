// All shared types live here to avoid circular imports.

export type TileKind = 'KEEPER' | 'SHORT' | 'JUMBO' | 'EGGER';
export type Color = 'common' | 'rare';
export type Ground = 'inshore' | 'mid' | 'offshore' | 'deep';
export type Stage = 'SET' | 'SOAKING' | 'PRIME' | 'OVERRIPE' | 'FOULED';
export type Phase = 'PLAYING' | 'GAME_OVER';

export interface Tile {
  id: string;
  kind: TileKind;     // marker: type (keeper / short / jumbo / egger)
  weightLb: number;   // marker: size
  color: Color;       // marker: rarity (common / rare)
  ground: Ground;     // marker: bag — which ground-type bag it belongs to (routes sold tiles to the right pile)
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

export interface GameState {
  config: Config;
  rngSeed: number;
  phase: Phase;
  season: number;         // 1-based; game ends after config.seasons
  day: number;            // 1-based day WITHIN the current season
  hour: number;
  turnOrder: string[];
  activePlayerIndex: number;
  players: Record<string, PlayerState>;
  bags: Record<Ground, Tile[]>;
  bagStart: Record<Ground, number>;
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

export interface Config {
  players: number;
  seasons: number;        // number of seasons; the game ends after the last one
  daysPerSeason: number;  // fishing days within each season (day resets to 1 each season)
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
  // Inter-season restock DRAFT: in berth order, each captain claims one remaining
  // bag, rolls the lobster die for how many (1..dieFaces), and secretly returns
  // that many lobsters from that bag's extraction pile. Only ~4 bags, so with more
  // players than bags some don't get to restock — the pole is worth fighting for.
  // Piles are pre-seeded with `preSeedPerBag` of each sellable template for early
  // agency. No restock before the final season.
  restock: { dieFaces: number; preSeedPerBag: number };
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

  flags: { weather: boolean; eras: boolean; multiShip: boolean; inspections: boolean };
}

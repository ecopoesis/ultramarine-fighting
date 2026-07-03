// All shared types live here to avoid circular imports.

export type TileKind = 'KEEPER' | 'SHORT' | 'JUMBO' | 'EGGER';
export type Color = 'common' | 'rare';
export type Ground = 'inshore' | 'mid' | 'offshore';
export type Stage = 'SET' | 'SOAKING' | 'PRIME' | 'OVERRIPE' | 'FOULED';
export type BuyerId = 'coop' | 'tourist';
export type Phase = 'PLAYING' | 'GAME_OVER';

export interface Tile {
  id: string;
  kind: TileKind;
  weightLb: number;
  color: Color;
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
  day: number;
  hour: number;
  turnOrder: string[];
  activePlayerIndex: number;
  players: Record<string, PlayerState>;
  bags: Record<Ground, Tile[]>;
  bagStart: Record<Ground, number>;
  buyers: Record<BuyerId, { lbsSoldToday: number }>;
  nextSlot: number;
  pendingNextOrder: string[];
  thefts: TheftRecord[];
  log: string[];
  buoyCounter: number; // for unique buoy ids
}

// ---- Config ----

export interface BuyerConfig {
  base: number;
  elasticity: number;
  floor: number;
  rareBonus: number;
}

export interface DrawRule { draw: number; keep: number }

export interface Config {
  players: number;
  days: number;
  hoursPerDay: number;
  actionsPerTurn: number;
  buoysPerPlayer: number;
  startMoney: number;
  startReputation: number;
  fuelTankMax: number;
  startFuel: number;
  fuelCostPerUnit: number;

  map: {
    nodes: Record<string, { type: 'harbor' | 'ground'; ground?: Ground }>;
    edges: [string, string][];
    fuelPerStep: number;
    harbor: string;
  };

  bags: Record<Ground, Record<string, number>>; // tileTemplateName -> count
  soakCurves: Record<Ground, Stage[]>;
  drawByStage: Record<Stage, DrawRule>;
  actionCost: Record<string, number>;
  buyers: Record<BuyerId, BuyerConfig>;

  poleRepCost: number;
  bribeMoneyCost: number;
  lastSlotSweetenerFuel: number;
  rep: { steal: number; illegalKeep: number; report: number; vNotch: number; bribe: number; reported: number };

  holdDecayLbPerDay: number;
  reportBountyShare: number;

  scoring: {
    moneyPerVP: number;
    vNotchTokenValue: number;
    conservationBagHealthVP: number;
    repToVP: number;
    combineMode: 'sum' | 'weakLinkMultiplier' | 'geometricMean' | 'weakestLink';
  };

  flags: { weather: boolean; eras: boolean; multiShip: boolean; inspections: boolean };
}

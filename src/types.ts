// All shared types live here to avoid circular imports.

// VNOTCHED: a berried female who has been v-notched and released. Physically she is
// a v-notch lobster MEEPLE that takes the egger's place in the bag — the egger tile
// leaves the world, the meeple stays in the sea. She can never be scored again and
// she dilutes every future draw: the standing cost of having protected her.
export type TileKind = 'KEEPER' | 'SHORT' | 'JUMBO' | 'EGGER' | 'VNOTCHED';
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
  licensed?: boolean;     // paid this season's fishing licence — may set and haul gear. Unlicensed captains can only steal.

  madeHarbour?: boolean;  // ended the day at a dock under their own power (not towed in). Only these captains earn the last-slot courtesy — otherwise "never go home" farms the standing the tow is meant to cost.
  berthNode?: string;   // the port a captain berthed in — where they start tomorrow (daily home-port choice)
  vTokens: number;
  towCooldown?: number; // turns still to skip after an end-of-day tow (the rescue costs you the next morning)
  // Installed ship upgrades, one per slot (the physical ship: bow/amidships/stern
  // tiles you swap or insert). stern = engine, midPrimary = radar (replaces the
  // base amidships), midSecondary = the ONE second-middle you may add (crane / tank
  // / cargo). Max three upgrades. See engine/upgrades.ts for the derived effects.
  upgrades: Partial<Record<UpgradeSlot, string>>;
  tracks: { conservation: number; reputation: number };
}

export type UpgradeSlot = 'stern' | 'midPrimary' | 'midSecondary';

// A refit you can buy at a market port's chandlery. Occupies one ship slot; its
// optional effect fields are read by the capability queries in engine/upgrades.ts.
export interface UpgradeDef {
  id: string;
  label: string;
  slot: UpgradeSlot;
  cost: number;             // money to install (also costs an action, at a market port)
  stepsPerSteam?: number;   // engine: nodes moved per STEAM action (base 1)
  stormImmune?: boolean;    // no storm entry hazard
  whittleMult?: number;     // GPS: multiplies the chance a pot left in a storm is parted. Radar guarded against the ENTRY hazard (1 fuel) but not the WHITTLE (82 pots lost across 5 games) — it protected against the wrong half of the weather, and two captains called it worthless by name. A plotter that lets you find your gear in a blow is the half that matters.
  freeAction?: string;      // makes this ACTION type cost 0 (crane→HAUL, tender→SELL, pot rack→DROP, …)
  fuelBonus?: number;       // tank: + fuel-tank capacity
  buoyBonus?: number;       // cargo: + buoy capacity
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
  // Upgrade supply per market port: the remaining refit tokens (upgrade ids). The
  // face-up DISPLAY is the first `config.upgrades.display` of these — buying pulls
  // one out and the next slides up; empty = that chandlery is picked clean. Present
  // only when flags.upgrades is on.
  upgradeStock: Record<string, string[]>;
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
  // THE CO-OP: the working harbour's own buyer pays less per pound but landing your
  // catch with your own community earns STANDING. This is reputation's repeatable,
  // player-chosen income — without it reputation only ever decays from its start
  // value and is structurally always your weakest track. It also gives the home port
  // a reason to exist once the island buyers out-price it.
  coopRep?: number;
  // ...but only for a REAL landing. Without a floor, one token lobster a day buys the
  // same standing as a full day's catch, and reputation stops being earned and starts
  // being printed. With it, bringing a big load to the lowest-paying buyer is a
  // deliberate trade of money for standing.
  coopMinLb?: number;
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
  // GEAR CONGESTION: how many pots may sit on ONE fishing space, counting every
  // captain's. The bottom is finite — you cannot pile the whole fleet's string onto
  // one ledge — and measurement said the fleet was doing exactly that: The Edge took
  // 45-61% of a season's pots in game after game, on a 22-node map. Scaled by player
  // count the same way bags are, so crowding-per-boat holds across 2-6 players.
  maxPotsPerSpace: number;
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
  requirePrimeToHaul: boolean; // a pot can't be hauled until it ripens to PRIME — forces the place→soak→retrieve loop (else bots drop-and-grab at SET)
  // Ship upgrades (engine-building layer) — active only when flags.upgrades is on.
  // A scarce, per-port, face-up race: money buys capability, not just VP.
  upgrades: {
    catalog: UpgradeDef[];  // the refits available in the game
    perPortStock: number;   // refit tokens each market port starts with (drawn from the catalog)
    display: number;        // how many are face-up at once (the rest are the deck behind them)
  };
  soakCurves: Record<Ground, Stage[]>;
  drawByStage: Record<Stage, DrawRule>;
  actionCost: Record<string, number>;

  poleRepCost: number;
  bribeMoneyCost: number;
  lastSlotSweetenerFuel: number;
  // "After you." The tail of the berth order gains STANDING as well as fuel. With the
  // pole costing rep and the last slot paying it, the berth order is a GRADIENT rather
  // than a single square every informed captain learns to dodge — and reputation gets
  // a second income, priced in tempo: fish latest, berth last, gain standing, lose
  // tomorrow's initiative.
  lastSlotRep: number;
  // End-of-day rescue: a boat that ends the day NOT at a port is towed to the
  // nearest one — you never get stranded at sea for the season, but it costs you.
  // The decisive cost is TIME: `lostTurns` turns are burned the next morning (you
  // spend it getting sorted after the rescue), which is what negates the whole point
  // of "never returning" — the reason a money-only fee can't kill the gas-guzzler
  // (it wins on fishing VOLUME → conservation, not money). Plus a money `fee` and
  // only a splash of `emergencyFuel` (no free tank).
  // `rep`: needing the lifeboat is embarrassing in a small harbour. This was removed
  // when reputation was a one-way budget and any rep cost was ruinous; now that the
  // co-op gives reputation a real income, a standing cost is affordable again — and
  // it is what stops a clean captain from farming standing while never coming home.
  tow: { fee: number; emergencyFuel: number; lostTurns: number; rep: number };
  rep: { steal: number; illegalKeep: number; report: number; vNotch: number; bribe: number; reported: number };

  // FISHING LICENCE: the price of being allowed to fish at all, paid at the start of
  // each season. Lumpy rather than daily — five payments a game instead of 130 — and
  // it lands as a cash-flow decision (licence AND a refit this season, or one of
  // them?) rather than a rounding error. An unlicensed captain may not set or haul
  // gear of their own. They may still STEAL: you are not out of the game, you are
  // just a pirate.
  licensePerSeason: number[];
  // What being unlicensed actually costs. A HARD gate (mayFish false) is an absorbing
  // state: no fishing means no income means you cannot pay next season either, and
  // piracy cannot carry you because theft fires ~3 times a game. Measured, ANY
  // non-zero fee then cost a third of all player-seasons. The soft gate keeps the
  // fiction — you are poaching, the co-op will not touch your catch and the harbour
  // knows — while leaving you a way back in.
  unlicensed: { mayFish: boolean; repPerHaul: number; mayUseCoop: boolean };
  // CREW WAGES (kept at 0): tested and abandoned. A per-day charge did not reduce
  // idle days at all — captains never mentioned it and never replanned around it,
  // because 2/day is noise against a morning that can land 210. Gear congestion is
  // what fixed idling. Left in place as a dial, set to zero.
  // The point is not the drain — it is that a day is the unit you pay for, so a day
  // that lands nothing is a day you paid for nothing. Staggering your pots (two waves
  // of two rather than all four at once) yields the SAME hauls per day and eliminates
  // the waiting days entirely; what it costs you is mobility, since you must work the
  // ground daily instead of having every other day free to steam elsewhere. The wage
  // is what makes that trade bite. Capped at what you have — a bad season must not
  // spiral into a negative track, which the weak link would turn into a zero.
  wagePerDay: number;
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
    combineMode: 'sum' | 'weakLinkMultiplier' | 'geometricMean' | 'weakestLink' | 'sumWeakLink';
    // For sumWeakLink (the pen-and-paper combine): total = sum(tracks) × the mult of
    // the FIRST row whose `atLeast` your lowest track meets (rows high→low). A printed
    // lookup card: add the three tracks, find the smallest, read the multiplier.
    weakLink?: { atLeast: number; mult: number }[];
    // Commons-health VP as a STEPPED read (a depletion track), not the raw ratio —
    // hand-computable at the table. VP of the first row your end-game health meets.
    // Falls back to conservationBagHealthVP × health if absent.
    healthBuckets?: { atLeast: number; vp: number }[];
  };

  flags: { weather: boolean; seeded: boolean; upgrades: boolean; eras: boolean; multiShip: boolean; inspections: boolean };
}

// All shared types live here to avoid circular imports.

// VNOTCHED: a berried female who has been v-notched and released. Physically she is
// a v-notch lobster MEEPLE that takes the egger's place in the bag — the egger tile
// leaves the world, the meeple stays in the sea. She can never be scored again and
// she dilutes every future draw: the standing cost of having protected her.
export type TileKind = 'KEEPER' | 'SHORT' | 'JUMBO' | 'EGGER' | 'VNOTCHED';
export type Color = 'common' | 'rare';
export type Ground = 'inshore' | 'mid' | 'offshore' | 'deep';
export type Stage = 'SET' | 'SOAKING' | 'PRIME' | 'OVERRIPE' | 'FOULED';
export type Phase = 'PLAYING' | 'AUCTION' | 'GAME_OVER';

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
  licensedSeason?: number; // the season whose licence they hold (the squeeze counts licences sold this season)

  madeHarbour?: boolean;  // ended the day at a dock under their own power (not towed in). Only these captains earn the last-slot courtesy — otherwise "never go home" farms the standing the tow is meant to cost.
  berthNode?: string;   // the port a captain berthed in — where they start tomorrow (daily home-port choice)
  towCooldown?: number; // turns still to skip after an end-of-day tow (the rescue costs you the next morning)
  // Installed ship upgrades, one per slot (the physical ship: bow/amidships/stern
  // tiles you swap or insert). stern = engine, midPrimary = radar (replaces the
  // base amidships), midSecondary = the ONE second-middle you may add (crane / tank
  // / cargo). Max three upgrades. See engine/upgrades.ts for the derived effects.
  upgrades: Partial<Record<UpgradeSlot, string>>;
  // alignment/heat are live only under flags.alignment (SPEC §14). ALIGNMENT is the
  // switchboard, light (+) to dark (−), and scores nothing; HEAT is the 0–5 star
  // wanted level the warden reads at every sale.
  tracks: { conservation: number; reputation: number; alignment: number; heat: number };
  // Ports shut to this captain for the rest of the day — you dropped your catch and
  // ran from here. Cleared at the day rollover.
  barredPorts?: string[];
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
  // A plotter marks your gear: a pot the storm parts is RECOVERED to your hand instead
  // of being lost for the rest of the season. (Was a halved chance — a fraction of a
  // die roll nobody can execute at a table.)
  whittleRecover?: boolean;
  whittleMult?: number;     // GPS: multiplies the chance a pot left in a storm is parted. Radar guarded against the ENTRY hazard (1 fuel) but not the WHITTLE (82 pots lost across 5 games) — it protected against the wrong half of the weather, and two captains called it worthless by name. A plotter that lets you find your gear in a blow is the half that matters.
  freeAction?: string;      // makes this ACTION type cost 0 (crane→HAUL, tender→SELL, pot rack→DROP, …)
  // BLACK-MARKET refits (flags.alignment): a separate small stack, dark captains only.
  dark?: boolean;
  bonusDraws?: number;      // illegal net: extra tiles drawn per haul — and using it is a crime
  pollutes?: number;        // cheap engine: each haul you make strips this many more tiles off that ground
  fuelBonus?: number;       // tank: + fuel-tank capacity
  buoyBonus?: number;       // cargo: + buoy capacity
}

export interface TheftRecord {
  victimId: string;
  thiefId: string;
  value: number; // proxy value of stolen catch, for the report bounty
}

import type { AuctionState } from './engine/auction';

export interface GameState {
  config: Config;
  rngSeed: number;
  phase: Phase;
  auction?: AuctionState; // present only during the AUCTION phase (the licence sale)
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
  // Breeding-stock track per ground: how many berried females have been notched and
  // released there. PUBLIC — it sits on the board, and it is what spawns each season.
  notches: Record<Ground, number>;
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
  // The black-market refit stack (flags.alignment): not at any chandlery, sized to the
  // dark slots, open to Shady and darker at any market port.
  darkStock?: string[];
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
  base: number;         // money per lb before any flooding
  // The price drops ONE for every this-many pounds already landed here today. Stated
  // as a step rather than a rate so the arithmetic is a division you can do in your
  // head at the table, and the price is always a whole number.
  dropPerLbs: number;
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
  // Both weather rolls are a d10, quoted as "this number or less". Integers so the
  // table rolls a die instead of consulting a probability.
  hazardInTen: number;  // entering a stormed node: a beating on this or less
  whittleInTen: number; // each night, gear left in a storm parts on this or less
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
  // How many of each sellable tile starts in a ground's TRAP, so the first spawn has
  // something to give back.
  trapStarters: number;
  // BREEDING STOCK (engine/breeding.ts) — the replacement for the restock draft.
  // Notches on a ground's public track buy DICE, not a flat divisor: stewardship
  // should feel like tending something alive rather than doing arithmetic, and a thin
  // track can roll nothing at all. Bands widen, so the first notches on a ground are
  // worth the most and no one ground runs away with the recovery.
  breeding: { dieFaces: number[]; diceByNotches: { atLeast: number; dice: number }[] };
  // What a berried female is WORTH if you keep her illegally. At 0 she was worthless,
  // so notching was strictly dominant — measured, captains notched 41.8 of the 42
  // eggers in the ocean, every game. That made conservation a measure of how much you
  // HAULED rather than of any restraint, and left the v-notch with no decision in it.
  // Giving her meat puts a price on throwing her back.
  eggerWeightLb: number;
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

  // FISHING LICENCE: sold at a sealed-bid, SECOND-PRICE auction at the start of every
  // season after the first — these values are the reserve (minimum bid), not the price.
  // The price the table pays is the second-highest bid, so it scales with how rich the
  // fleet actually is instead of being a number I guessed. See engine/auction.ts for
  // why the bid order is the season's turn order.
  // The price of being allowed to fish at all, paid at the start of
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
  reportBountyDivisor: number; // the reporter takes the confiscated catch's value divided by this (whole money)

  scoring: {
    moneyPerVP: number;
    conservationBagHealthVP: number;
    repToVP: number;
    combineMode: 'sum' | 'weakLinkMultiplier' | 'geometricMean' | 'weakestLink' | 'sumWeakLink' | 'sumMinusPenalty';
    // For sumWeakLink (the pen-and-paper combine): total = sum(tracks) × the mult of
    // the FIRST row whose `atLeast` your lowest track meets (rows high→low). A printed
    // lookup card: add the three tracks, find the smallest, read the multiplier.
    weakLink?: { atLeast: number; mult: number }[];
    // THE PEN-AND-PAPER COMBINE. Add the three tracks, find the smallest, read one
    // PENALTY off a printed card and subtract it. All integers: no multiplying a
    // three-digit sum by 0.75 in your head, which is what the old card asked for.
    weakLinkPenalty?: { atLeast: number; penalty: number }[];
    // Commons-health VP as a STEPPED read (a depletion track), not the raw ratio —
    // hand-computable at the table. VP of the first row your end-game health meets.
    // Falls back to conservationBagHealthVP × health if absent.
    // Commons health as whole PERCENT (80, 60, …), read off the depletion track.
    healthBuckets?: { atLeast: number; vp: number }[];
  };

  // ---- THE LIGHT/DARK SWITCHBOARD (SPEC §14), live only under flags.alignment ----
  alignment: AlignmentConfig;
  heat: HeatConfig;
  closure: ClosureConfig;
  dividend: { byHealth: { atLeast: number; money: number }[] };

  flags: { weather: boolean; seeded: boolean; upgrades: boolean; eras: boolean; multiShip: boolean; inspections: boolean; alignment: boolean };
}

export type BandName = 'paragon' | 'honest' | 'neutral' | 'shady' | 'outlaw';

// One row of the printed BAND CARD: everything your alignment switches on or off.
export interface AlignmentBand {
  name: BandName;
  atLeast: number;        // the band starts at this alignment (rows high → low)
  priceCut: number;       // whole money off every lb you sell: the market buys under the table
  starsPerCrime: number;  // heat gained per crime — the lighter you are, the harder it lands
  mustLicense: boolean;   // the good pay their dues: may not pass on the licence
  coop: boolean;          // co-op landings (and its alignment step) are open to you
  refuge: boolean;        // the outer shelters will take you in
  harbourBribe: boolean;  // may bribe the harbourmaster for the front berth
  dividend: boolean;      // shares the co-op's season dividend (if licensed)
  blackMarket: boolean;   // may buy from the black-market refit stack
  // THE WARDEN'S PRICE, printed on the band's row. A bribe buys dice off one heat check,
  // down to this floor and no further: the darker you are, the fewer dice you can shed
  // (an outlaw always rolls at least three, so a hot outlaw always risks a bust).
  bribeFloor: number;
  bribeCosts: number[];   // the 1st, 2nd, … die bought off, added up: each costs more than the last
}

export interface AlignmentConfig {
  min: number; max: number;          // the printed track's ends
  bands: AlignmentBand[];            // high → low
  step: {                            // whole steps along the track
    notch: number; licence: number; coopLanding: number; report: number;
    illegalKeep: number; poachHaul: number; steal: number; bribe: number; caught: number; darkRefit: number;
  };
  paragonFallTo: number;             // a Paragon who fails a heat check drops straight here
  // Season-2 licences are players − this (index = player count). From season 3 on
  // there is one for everyone: a single squeeze that forces the issue.
  darkSlotsByPlayers: number[];
  squeezeSeason: number;
  // The black-market stack: one of each of these refits per dark slot, and no more.
  darkRefits: string[];
}

export interface HeatConfig {
  max: number;                // five stars
  dieFaces: number[];         // the heat die: 0,1,1,1,2,2
  failAt: number;             // a total at or over this: drop your catch and run. Keep it above the die's top face, so one star can never bust
  takePerPoint: number;       // under the line: the warden's take, money per point rolled
  coolPerDayUnsold: number;   // stars shed for a day you stay away from the counter
  poachHaulIsCrime: boolean;  // does an unlicensed haul add stars, or only alignment?
  reportedStars: number;      // stars on a thief a victim reports (flat: the harbour now knows)
  netIsCrime: boolean;        // is every haul with the illegal net a crime?
}

export interface ClosureConfig {
  // Per-ground health (bag fullness, whole %) under which the ground closes to these
  // bands. Rows high → low; the first row whose line the ground has fallen below applies.
  levels: { belowPct: number; closedTo: BandName[] }[];
  starsPerHaul: number;       // a closed-to-you ground is still fishable: +stars per pot hauled
}

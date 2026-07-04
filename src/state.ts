import type { Config, GameState, PlayerState, Ground, Tile } from './types';
import { buildBag, tileTemplate } from './tiles';
import { placeStorms } from './engine/weather';
import { seedSpaces } from './engine/seeded';

export function createInitialState(config: Config, seed = 12345, names?: string[]): GameState {
  const players: Record<string, PlayerState> = {};
  const ids: string[] = [];
  for (let i = 0; i < config.players; i++) {
    const id = `p${i + 1}`;
    ids.push(id);
    players[id] = {
      id,
      name: names?.[i] ?? `Captain ${i + 1}`,
      node: config.map.startPort,   // everyone begins day 1 at the start port
      fuel: config.startFuel,
      money: config.startMoney,
      actionsLeft: 0,
      buoysAvailable: config.buoysPerPlayer,
      deployed: [],
      soak: {},
      hold: [],
      soldToday: false,
      berthed: false,
      vTokens: 0,
      tracks: { conservation: 0, reputation: config.startReputation },
    };
  }

  const grounds = Object.keys(config.bags) as Ground[]; // whatever ground types the config defines
  const scale = config.players / config.referencePlayers; // constant depletion-pressure-per-boat across counts
  const bags = {} as GameState['bags'];
  const bagStart = {} as GameState['bagStart'];
  // Extraction piles, pre-seeded with a few of each SELLABLE template (keepers +
  // jumbos — the tiles that can end up sold and thus draftable) so early restocks
  // have something to choose from before much has been landed.
  const piles = {} as GameState['piles'];
  for (const g of grounds) {
    const spec: Record<string, number> = {};
    for (const [name, count] of Object.entries(config.bags[g])) spec[name] = Math.round(count * scale);
    bags[g] = buildBag(spec, g);
    bagStart[g] = bags[g].length;

    const seed: Tile[] = [];
    let s = 0;
    for (const name of Object.keys(config.bags[g])) {
      const bp = tileTemplate(name);
      if (bp.kind !== 'KEEPER' && bp.kind !== 'JUMBO') continue; // shorts/eggers never get sold
      for (let c = 0; c < config.restock.preSeedPerBag; c++) seed.push({ id: `${g}-seed-${s++}`, ground: g, ...bp });
    }
    piles[g] = seed;
  }

  // one flood ledger per market port
  const markets: GameState['markets'] = {};
  for (const [node, def] of Object.entries(config.map.nodes)) {
    if (def.port?.market) markets[node] = { lbsSoldToday: 0 };
  }

  const state: GameState = {
    config,
    rngSeed: seed,
    phase: 'PLAYING',
    season: 1,
    day: 1,
    hour: 1,
    turnOrder: ids,
    activePlayerIndex: 0,
    players,
    bags,
    bagStart,
    piles,
    markets,
    stormed: [],
    seeded: {},
    nextSlot: 0,
    pendingNextOrder: [],
    thefts: [],
    log: [],
    buoyCounter: 0,
  };

  players[ids[0]].actionsLeft = config.actionsPerTurn;
  placeStorms(state); // season 1 is calm by design → a no-op (no RNG), but honors a nonzero S1 track
  seedSpaces(state);  // season 1's generic lobsters onto every fishing space
  state.log.push(`Season 1, Day 1 begins at ${config.map.startPort}. Order: ${ids.join(', ')}`);
  return state;
}

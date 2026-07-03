import type { Config, GameState, PlayerState, Ground } from './types';
import { buildBag } from './tiles';

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
  const bags = {} as GameState['bags'];
  const bagStart = {} as GameState['bagStart'];
  for (const g of grounds) {
    bags[g] = buildBag(config.bags[g], g);
    bagStart[g] = bags[g].length;
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
    day: 1,
    hour: 1,
    turnOrder: ids,
    activePlayerIndex: 0,
    players,
    bags,
    bagStart,
    markets,
    nextSlot: 0,
    pendingNextOrder: [],
    thefts: [],
    log: [],
    buoyCounter: 0,
  };

  players[ids[0]].actionsLeft = config.actionsPerTurn;
  state.log.push(`Day 1 begins at ${config.map.startPort}. Order: ${ids.join(', ')}`);
  return state;
}

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
      node: config.map.harbor,
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

  const grounds: Ground[] = ['inshore', 'mid', 'offshore'];
  const bags = {} as GameState['bags'];
  const bagStart = {} as GameState['bagStart'];
  for (const g of grounds) {
    bags[g] = buildBag(config.bags[g], g);
    bagStart[g] = bags[g].length;
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
    buyers: { coop: { lbsSoldToday: 0 }, tourist: { lbsSoldToday: 0 } },
    nextSlot: 0,
    pendingNextOrder: [],
    thefts: [],
    log: [],
    buoyCounter: 0,
  };

  // first active player gets their action budget
  players[ids[0]].actionsLeft = config.actionsPerTurn;
  state.log.push(`Day 1 begins. Order: ${ids.join(', ')}`);
  return state;
}

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import type { GameState } from '../src/types';

function totalTilesInWorld(s: GameState): number {
  let n = 0;
  for (const g of ['inshore', 'mid', 'offshore'] as const) n += s.bags[g].length;
  for (const p of Object.values(s.players)) n += p.hold.length;
  return n;
}

function playToEnd(seed: number): GameState[] {
  let state = createInitialState(defaultConfig, seed);
  const history = [state];
  let guard = 0;
  while (state.phase === 'PLAYING' && guard++ < 100000) {
    const pid = activePlayerId(state);
    const legal = legalActions(state, pid);
    // deterministic policy for the test: prefer HAUL/SELL/DROP/STEAM/BERTH/PASS in that order
    const order = ['HAUL', 'SELL', 'DROP', 'REFUEL', 'STEAM', 'BERTH', 'PASS'];
    const pick = legal.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
    state = reduce(state, pick);
    history.push(state);
  }
  return history;
}

describe('depletion accounting', () => {
  it('tiles only leave the world via sales (greed is the only leak)', () => {
    let state = createInitialState(defaultConfig, 777);
    const startTotal = totalTilesInWorld(state);
    let soldTiles = 0;
    let guard = 0;
    while (state.phase === 'PLAYING' && guard++ < 100000) {
      const pid = activePlayerId(state);
      const legal = legalActions(state, pid);
      const order = ['HAUL', 'SELL', 'DROP', 'REFUEL', 'STEAM', 'BERTH', 'PASS'];
      const pick = legal.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
      const before = state.players[pid].hold.length;
      const willSell = pick.type === 'SELL';
      state = reduce(state, pick);
      if (willSell) soldTiles += before; // whole hold sold => those tiles leave the world
    }
    const endTotal = totalTilesInWorld(state);
    // Tiles in bags + holds never grow; the only permanent removal is a sale.
    expect(endTotal).toBeLessThanOrEqual(startTotal);
    expect(startTotal - endTotal).toBe(soldTiles);
  });

  it('is deterministic for a fixed seed', () => {
    const a = playToEnd(42);
    const b = playToEnd(42);
    expect(JSON.stringify(a[a.length - 1].players)).toBe(JSON.stringify(b[b.length - 1].players));
  });

  it('terminates and reaches GAME_OVER', () => {
    const h = playToEnd(99);
    expect(h[h.length - 1].phase).toBe('GAME_OVER');
  });
});

describe('v-token draw insurance keeps accounting honest', () => {
  it('tiles still only leave via sales when insurance is spent (all-steward table)', () => {
    let insuranceFired = 0;
    for (const seed of [7, 42, 101, 2024, 55555]) {
      let state = createInitialState(defaultConfig, seed);
      const startTotal = totalTilesInWorld(state);
      let soldTiles = 0;
      let guard = 0;
      while (state.phase === 'PLAYING' && guard++ < 200000) {
        const pid = activePlayerId(state);
        // stewards v-notch eggers (earning tokens) then spend them on lean hauls
        const action = BOTS.steward(state, pid, legalActions(state, pid));
        const before = state.players[pid].hold.length;
        const willSell = action.type === 'SELL';
        state = reduce(state, action);
        if (willSell) soldTiles += before;
      }
      insuranceFired += state.log.filter((l) => l.includes('v-token')).length;
      const endTotal = totalTilesInWorld(state);
      // spending a token draws from + returns to the bag; nothing is minted or lost
      expect(endTotal).toBeLessThanOrEqual(startTotal);
      expect(startTotal - endTotal).toBe(soldTiles);
    }
    // guard against a vacuous test: the insurance path must actually execute
    expect(insuranceFired).toBeGreaterThan(0);
  });
});

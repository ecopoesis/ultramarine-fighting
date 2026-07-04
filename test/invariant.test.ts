import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import type { GameState } from '../src/types';

// The full lobster census: bags (in the commons) + holds (caught, unsold) + piles
// (sold/fished, awaiting restock). Tiles only ever move between these — none are
// minted or destroyed after setup — so this total is conserved for the whole game.
function totalTilesInWorld(s: GameState): number {
  let n = 0;
  for (const g of Object.values(s.bags)) n += g.length;
  for (const p of Object.values(s.players)) n += p.hold.length;
  for (const g of Object.values(s.piles)) n += g.length;
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
  it('closed system: the lobster census is conserved (bags + holds + piles)', () => {
    let state = createInitialState(defaultConfig, 777);
    const startTotal = totalTilesInWorld(state);
    let sales = 0;
    let guard = 0;
    while (state.phase === 'PLAYING' && guard++ < 100000) {
      const pid = activePlayerId(state);
      const legal = legalActions(state, pid);
      const order = ['HAUL', 'SELL', 'DROP', 'REFUEL', 'STEAM', 'BERTH', 'PASS'];
      const pick = legal.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type))[0];
      if (pick.type === 'SELL') sales++;
      state = reduce(state, pick);
    }
    // Nothing is minted or destroyed after setup — sold lobsters move to the piles,
    // the restock draft moves some back — so the total never changes.
    expect(totalTilesInWorld(state)).toBe(startTotal);
    // guard against a vacuous game: selling (bag -> pile) must actually have happened,
    // and the piles must hold the fished-out lobsters at the end.
    expect(sales).toBeGreaterThan(0);
    const pileTotal = Object.values(state.piles).reduce((a, g) => a + g.length, 0);
    expect(pileTotal).toBeGreaterThan(0);
  });

  it('is deterministic for a fixed seed', () => {
    const a = playToEnd(42);
    const b = playToEnd(42);
    expect(JSON.stringify(a[a.length - 1].players)).toBe(JSON.stringify(b[b.length - 1].players));
  });

  it('terminates at GAME_OVER after the final season', () => {
    const h = playToEnd(99);
    const end = h[h.length - 1];
    expect(end.phase).toBe('GAME_OVER');
    expect(end.season).toBe(defaultConfig.seasons); // played all the way through the last season
  });
});

describe('v-token draw insurance keeps accounting honest', () => {
  it('census stays conserved even when insurance is spent (all-steward table)', () => {
    let insuranceFired = 0;
    for (const seed of [7, 42, 101, 2024, 55555]) {
      let state = createInitialState(defaultConfig, seed);
      const startTotal = totalTilesInWorld(state);
      let guard = 0;
      while (state.phase === 'PLAYING' && guard++ < 200000) {
        const pid = activePlayerId(state);
        // stewards v-notch eggers (earning tokens) then spend them on lean hauls
        state = reduce(state, BOTS.steward(state, pid, legalActions(state, pid)));
      }
      insuranceFired += state.log.filter((l) => l.includes('v-token')).length;
      // spending a token draws from + returns to the bag; nothing is minted or lost.
      expect(totalTilesInWorld(state)).toBe(startTotal);
    }
    // guard against a vacuous test: the insurance path must actually execute
    expect(insuranceFired).toBeGreaterThan(0);
  });
});

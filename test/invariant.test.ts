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
  // seeded (generic) lobsters are an OPEN injection (minted onto spaces, they leave
  // the world on sale) — they never touch bags/piles, so exclude them from the CLOSED
  // bag+hold+pile census.
  for (const p of Object.values(s.players)) n += p.hold.filter((t) => !t.seeded).length;
  for (const g of Object.values(s.piles)) n += g.length;
  return n;
}

function playToEnd(seed: number): GameState[] {
  let state = createInitialState(defaultConfig, seed);
  const history = [state];
  let guard = 0;
  while (state.phase !== 'GAME_OVER' && guard++ < 100000) {
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
    while (state.phase !== 'GAME_OVER' && guard++ < 100000) {
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

describe('weather keeps the census closed', () => {
  const wet = { ...defaultConfig, flags: { ...defaultConfig.flags, weather: true } };

  it('conserved + deterministic with storms on; whittle/hazard actually fire', () => {
    let parted = 0, hazards = 0, everStormed = false;
    const finals: string[] = [];
    for (const seed of [3, 17, 99, 2024, 8123]) {
      let state = createInitialState(wet, seed);
      const startTotal = totalTilesInWorld(state);
      let guard = 0;
      while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
        const pid = activePlayerId(state);
        // roster of card-counters: they migrate outward into the stormed grounds
        state = reduce(state, BOTS.gambler(state, pid, legalActions(state, pid)));
        if (state.stormed.length) everStormed = true;
      }
      // parting a pot removes gear, not tiles — the census must still balance
      expect(totalTilesInWorld(state)).toBe(startTotal);
      parted += state.log.filter((l) => l.includes('parts')).length;
      hazards += state.log.filter((l) => l.includes('takes a beating')).length;
      finals.push(JSON.stringify(state.players));
    }
    // guard against a vacuous test: storms must be placed and their effects must fire
    expect(everStormed).toBe(true);
    expect(parted + hazards).toBeGreaterThan(0);

    // determinism holds with weather on (storm rolls come off the same seeded RNG)
    let state = createInitialState(wet, 3);
    let guard = 0;
    while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
      const pid = activePlayerId(state);
      state = reduce(state, BOTS.gambler(state, pid, legalActions(state, pid)));
    }
    expect(JSON.stringify(state.players)).toBe(finals[0]);
  });
});

describe('seeded lobsters are an open economy on top of the closed census', () => {
  const seeded = { ...defaultConfig, flags: { ...defaultConfig.flags, seeded: true } };

  it('accumulate + pull-first, never touch the piles, and leave the closed census intact', () => {
    let pulls = 0, maxPile = 0, pileHadSeeded = 0;
    const finals: string[] = [];
    for (const seed of [5, 40, 123, 2024, 9001]) {
      let state = createInitialState(seeded, seed);
      const startClosed = totalTilesInWorld(state);
      let guard = 0;
      while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
        const pid = activePlayerId(state);
        // grinder stays near, so far spaces go unfished and pile up
        state = reduce(state, BOTS.grinder(state, pid, legalActions(state, pid)));
        maxPile = Math.max(maxPile, ...Object.values(state.seeded));
      }
      // the CLOSED census (bags + non-seeded holds + piles) is untouched by the open injection
      expect(totalTilesInWorld(state)).toBe(startClosed);
      pulls += state.log.filter((l) => l.includes('seeded lobster')).length;
      // generic lobsters must never land on a restock pile
      pileHadSeeded += Object.values(state.piles).flat().filter((t) => t.seeded).length;
      finals.push(JSON.stringify(state.players));
    }
    expect(pulls).toBeGreaterThan(0);       // the mechanic actually fires
    expect(maxPile).toBeGreaterThan(1);     // an unfished space accumulated past one season
    expect(pileHadSeeded).toBe(0);          // open economy: never routed to a pile

    // determinism holds with seeding on
    let state = createInitialState(seeded, 5);
    let guard = 0;
    while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
      const pid = activePlayerId(state);
      state = reduce(state, BOTS.grinder(state, pid, legalActions(state, pid)));
    }
    expect(JSON.stringify(state.players)).toBe(finals[0]);
  });
});

describe('v-token draw insurance keeps accounting honest', () => {
  it('census stays conserved even when insurance is spent (all-steward table)', () => {
    let insuranceFired = 0;
    for (const seed of [7, 42, 101, 2024, 55555]) {
      let state = createInitialState(defaultConfig, seed);
      const startTotal = totalTilesInWorld(state);
      let guard = 0;
      while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
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

import type { GameState } from './types';

// Deterministic mulberry32. We advance and persist the seed on the state draft,
// so any game is fully reproducible from its initial rngSeed. No Math.random anywhere.
export function nextRandom(d: GameState): number {
  d.rngSeed = (d.rngSeed + 0x6d2b79f5) | 0;
  let t = d.rngSeed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(d: GameState, n: number): number {
  return Math.floor(nextRandom(d) * n);
}

// pick + remove a random element, mutating the array (operates on the draft)
export function takeRandom<T>(d: GameState, arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const i = randInt(d, arr.length);
  return arr.splice(i, 1)[0];
}

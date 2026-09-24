import type { GameState } from './types';

// Deterministic mulberry32. We advance and persist the seed on the state draft,
// so any game is fully reproducible from its initial rngSeed. No Math.random anywhere.
//
// NAMED STREAMS (config.rngStreams): each kind of chance runs on its own sequence —
// bag draws on 'main', and breeding, heat checks, weather, patrols, setup and pollution
// on their own. At the table every roll is independent anyway; in the engine it means a
// change to one rule (how much the breeding stock returns, say) no longer shifts every
// later storm, patrol and draw along with it, which is what lets a recorded game be
// replayed under different rules (scripts/counterfactual.ts). With the flag off every
// stream is 'main' — the single sequence games before it were played on.
export type Stream = 'main' | 'breeding' | 'heat' | 'weather' | 'patrol' | 'setup' | 'pollution';
export const STREAMS: Stream[] = ['breeding', 'heat', 'weather', 'patrol', 'setup', 'pollution'];

function mulberry(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [next, ((t ^ (t >>> 14)) >>> 0) / 4294967296];
}

// Each stream's starting seed, derived from the game seed (a fixed odd multiplier per name).
export function streamSeeds(seed: number): Record<string, number> {
  const out: Record<string, number> = {};
  STREAMS.forEach((s, i) => { out[s] = (seed ^ Math.imul(i + 1, 0x9e3779b1)) | 0; });
  return out;
}

// TOOLING ONLY (scripts/counterfactual.ts): an outside source of chance. A recorder sees
// every value drawn, labelled by its kind; a source may SUPPLY a value for a kind (the
// recorded one) instead of drawing it. The engine itself never sets either, so games
// are unaffected; both are module-level so game state stays plain data.
type Recorder = (stream: Stream, value: number) => void;
type Source = (stream: Stream) => number | undefined;
let recorder: Recorder | null = null;
let source: Source | null = null;
export function setChanceHooks(r: Recorder | null, s: Source | null): void { recorder = r; source = s; }

export function nextRandom(d: GameState, stream: Stream = 'main'): number {
  const supplied = source?.(stream);
  if (supplied !== undefined) { recorder?.(stream, supplied); return supplied; }
  let r: number;
  if (stream !== 'main' && d.config.rngStreams && d.rngStreams) {
    const [next, v] = mulberry(d.rngStreams[stream]);
    d.rngStreams[stream] = next;
    r = v;
  } else {
    const [next, v] = mulberry(d.rngSeed);
    d.rngSeed = next;
    r = v;
  }
  recorder?.(stream, r);
  return r;
}

export function randInt(d: GameState, n: number, stream: Stream = 'main'): number {
  return Math.floor(nextRandom(d, stream) * n);
}

// pick + remove a random element, mutating the array (operates on the draft)
export function takeRandom<T>(d: GameState, arr: T[], stream: Stream = 'main'): T | undefined {
  if (arr.length === 0) return undefined;
  const i = randInt(d, arr.length, stream);
  return arr.splice(i, 1)[0];
}

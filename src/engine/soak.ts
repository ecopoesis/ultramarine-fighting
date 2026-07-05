import type { GameState, Stage, Ground } from '../types';

export function stageFor(state: GameState, ground: Ground, daysSoaked: number): Stage {
  const curve = state.config.soakCurves[ground];
  const i = Math.min(daysSoaked, curve.length - 1);
  return curve[i];
}

// A pot is haulable only once it has RIPENED to PRIME (or beyond). Before that
// (SET / SOAKING) it's locked — you placed a worker, you must let it work. This is
// what makes the whole thing a worker-placement loop instead of drop-and-grab; the
// data showed bots pulling at SET 50-77% of the time without it.
export function isRipe(state: GameState, ground: Ground, daysSoaked: number): boolean {
  if (!state.config.requirePrimeToHaul) return true;
  const curve = state.config.soakCurves[ground];
  const primeIdx = curve.indexOf('PRIME');
  return primeIdx >= 0 && Math.min(daysSoaked, curve.length - 1) >= primeIdx;
}

// advance every deployed buoy's soak by one day (called at rollover)
export function advanceSoak(d: GameState): void {
  for (const p of Object.values(d.players)) {
    for (const rec of Object.values(p.soak)) {
      rec.daysSoaked += 1;
    }
  }
}

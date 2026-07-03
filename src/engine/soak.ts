import type { GameState, Stage, Ground } from '../types';

export function stageFor(state: GameState, ground: Ground, daysSoaked: number): Stage {
  const curve = state.config.soakCurves[ground];
  const i = Math.min(daysSoaked, curve.length - 1);
  return curve[i];
}

// advance every deployed buoy's soak by one day (called at rollover)
export function advanceSoak(d: GameState): void {
  for (const p of Object.values(d.players)) {
    for (const rec of Object.values(p.soak)) {
      rec.daysSoaked += 1;
    }
  }
}

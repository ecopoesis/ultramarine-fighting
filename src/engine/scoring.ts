import type { GameState, Ground } from '../types';

export function avgBagHealth(state: GameState): number {
  const grounds: Ground[] = ['inshore', 'mid', 'offshore'];
  const ratios = grounds.map((g) => state.bags[g].length / Math.max(1, state.bagStart[g]));
  return ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

export interface ScoreBreakdown {
  playerId: string;
  name: string;
  moneyVP: number;
  conservationVP: number;
  reputationVP: number;
  total: number;
}

export function score(state: GameState): ScoreBreakdown[] {
  const s = state.config.scoring;
  const health = avgBagHealth(state);
  const rows: ScoreBreakdown[] = [];

  for (const p of Object.values(state.players)) {
    const moneyVP = p.money / s.moneyPerVP;
    const conservationVP =
      p.vTokens * s.vNotchTokenValue +
      p.tracks.conservation +
      s.conservationBagHealthVP * health; // a stripped commons devalues everyone's stewardship
    const reputationVP = p.tracks.reputation * s.repToVP;

    const total = combine(s.combineMode, [moneyVP, conservationVP, reputationVP]);
    rows.push({
      playerId: p.id, name: p.name,
      moneyVP: round(moneyVP), conservationVP: round(conservationVP),
      reputationVP: round(reputationVP), total: round(total),
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

// How the three tracks combine into one score. All "weak-link" variants share
// one idea — you cannot dump a track — but differ in HOW harshly they punish
// mere imbalance (vs a true zero):
//   sum                — no interaction; specialization always pays (extraction wins).
//   weakLinkMultiplier — sum * (min/max); brutal on any single dominant track.
//   geometricMean      — (∏ tracks)^(1/n); a dumped track (→0) still craters you,
//                        but a merely-weak track is not annihilated. Balanced.
//   weakestLink        — min(tracks); the score IS your worst track. Purest weak-link.
// Negative tracks clamp to 0 for every multiplicative mode (dumping = cratering).
export type CombineMode = 'sum' | 'weakLinkMultiplier' | 'geometricMean' | 'weakestLink';

export function combine(mode: CombineMode, tracks: number[]): number {
  const sum = tracks.reduce((a, b) => a + b, 0);
  const clamped = tracks.map((v) => Math.max(0, v));
  switch (mode) {
    case 'sum':
      return sum;
    case 'weakLinkMultiplier': {
      const max = Math.max(...clamped, 1e-9);
      const min = Math.min(...clamped);
      return sum * (min / max);
    }
    case 'geometricMean': {
      const prod = clamped.reduce((a, b) => a * b, 1);
      return Math.pow(prod, 1 / clamped.length);
    }
    case 'weakestLink':
      return Math.min(...clamped);
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

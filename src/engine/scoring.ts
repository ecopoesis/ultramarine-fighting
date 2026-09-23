import type { GameState, Ground } from '../types';

export function avgBagHealth(state: GameState): number {
  const grounds = Object.keys(state.bags) as Ground[];
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
    // THE SWITCHBOARD (SPEC §14): money is the only score. Alignment and heat decided
    // how you could earn it; they are worth nothing at the end.
    if (state.config.flags.alignment) {
      rows.push({ playerId: p.id, name: p.name, moneyVP: p.money, conservationVP: 0, reputationVP: 0, total: p.money });
      continue;
    }
    // A money TRACK on the board, marked every `moneyPerVP`: you stand on the last
    // mark you have passed, so this floors rather than dividing. Keeps every score a
    // whole number, which is the point of the whole scoring card.
    const moneyVP = Math.floor(p.money / s.moneyPerVP);
    // a stripped commons devalues everyone's stewardship — read as a stepped
    // depletion track (hand-computable) when buckets are configured
    const healthVP = s.healthBuckets
      ? (s.healthBuckets.find((b) => health * 100 >= b.atLeast)?.vp ?? 0)
      : s.conservationBagHealthVP * health;
    const conservationVP = p.tracks.conservation + healthVP;
    const reputationVP = p.tracks.reputation * s.repToVP;

    const total = combine(s.combineMode, [moneyVP, conservationVP, reputationVP], s.weakLink, s.weakLinkPenalty);
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
//                        but a merely-weak track is not annihilated. Balanced. NOT
//                        hand-computable (a cube root).
//   weakestLink        — min(tracks); the score IS your worst track. Purest weak-link.
//   sumWeakLink        — sum × a MULTIPLIER looked up from your lowest track (a
//                        printed card). The pen-and-paper stand-in for geometricMean:
//                        rewards balance, craters a dumped track, no roots.
// Negative tracks clamp to 0 for every multiplicative mode (dumping = cratering).
export type CombineMode = 'sum' | 'weakLinkMultiplier' | 'geometricMean' | 'weakestLink' | 'sumWeakLink' | 'sumMinusPenalty';

export function combine(
  mode: CombineMode,
  tracks: number[],
  weakLink?: { atLeast: number; mult: number }[],
  weakLinkPenalty?: { atLeast: number; penalty: number }[],
): number {
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
    case 'sumMinusPenalty': {
      // Add the three, find the smallest, subtract the penalty its band carries.
      const min = Math.min(...tracks);
      const row = (weakLinkPenalty ?? []).find((r) => min >= r.atLeast);
      return Math.max(0, sum - (row?.penalty ?? 0));
    }
    case 'sumWeakLink': {
      const min = Math.min(...tracks);
      const table = weakLink ?? [{ atLeast: -Infinity, mult: 1 }];
      const row = table.find((r) => min >= r.atLeast);
      return Math.max(0, sum) * (row?.mult ?? 1);
    }
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

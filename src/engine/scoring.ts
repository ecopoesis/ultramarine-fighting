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

    let total: number;
    if (s.combineMode === 'sum') {
      total = moneyVP + conservationVP + reputationVP;
    } else {
      // weakLinkMultiplier: dumping any track craters the multiplier
      const vps = [moneyVP, conservationVP, reputationVP].map((v) => Math.max(0, v));
      const max = Math.max(...vps, 1e-9);
      const min = Math.min(...vps);
      const mult = min / max; // 0..1
      total = (moneyVP + conservationVP + reputationVP) * mult;
    }
    rows.push({
      playerId: p.id, name: p.name,
      moneyVP: round(moneyVP), conservationVP: round(conservationVP),
      reputationVP: round(reputationVP), total: round(total),
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

const round = (n: number) => Math.round(n * 100) / 100;

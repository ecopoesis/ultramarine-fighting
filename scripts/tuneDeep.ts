import { defaultConfig } from '../src/config';
import { runTournament } from '../src/bots/tournament';
import type { Config, Stage } from '../src/types';

// The deep edge is currently a private goldmine — the highliner wins ~98%.
// Sweep its richness (bag) and how punishing its prime is (soak) to land the
// deep run as a viable CHOICE, not a dominant one (target highliner ~20-30%,
// others still alive, commons still depletes).
const FLEET = ['steward', 'greedy', 'thief', 'highliner'];

const BAGS: Record<string, Record<string, number>> = {
  rich4: { KEEPER_4lb: 10, RARE_4lb: 6, SHORT: 2, JUMBO: 6, EGGER: 6 },   // current — too rich
  mid4:  { KEEPER_4lb: 6, RARE_4lb: 3, SHORT: 6, JUMBO: 6, EGGER: 9 },     // fewer/heavier keepers, more shorts+breeders
  lean3: { KEEPER_3lb: 8, RARE_3lb: 3, SHORT: 8, JUMBO: 5, EGGER: 6 },     // lighter, diluted with junk
};
const CURVES: Record<string, Stage[]> = {
  d3: ['SET', 'SOAKING', 'SOAKING', 'PRIME', 'FOULED'],                    // current — prime day 3
  d4: ['SET', 'SOAKING', 'SOAKING', 'SOAKING', 'PRIME', 'FOULED'],         // prime day 4 only — barely reachable in a 5-day season
};

function build(bag: string, curve: string): Config {
  return {
    ...defaultConfig,
    bags: { ...defaultConfig.bags, deep: BAGS[bag] },
    soakCurves: { ...defaultConfig.soakCurves, deep: CURVES[curve] },
  };
}

const seeds = Number(process.argv[2] ?? 80);
const pct = (r: ReturnType<typeof runTournament>, a: string) =>
  ((r.byArch[a].wins / Math.max(1, r.byArch[a].games)) * 100).toFixed(0);

const rows: any[] = [];
for (const bag of Object.keys(BAGS)) {
  for (const curve of Object.keys(CURVES)) {
    const r = runTournament(build(bag, curve), seeds, FLEET);
    rows.push({
      'deep bag': bag, soak: curve,
      'stew%': pct(r, 'steward'), 'greed%': pct(r, 'greedy'), 'thief%': pct(r, 'thief'), 'HIGH%': pct(r, 'highliner'),
      'HIGH money': (r.byArch.highliner.moneyVP / r.byArch.highliner.games).toFixed(1),
      'health%': ((r.healthSum / r.games) * 100).toFixed(0),
    });
  }
}
console.log(`Deep-edge economics sweep — 4 archetypes over 3 seats — ${seeds} seeds, geometricMean\n`);
console.log('Goal: highliner (HIGH%) viable ~20-30%, not dominant; others stay alive.\n');
console.table(rows);

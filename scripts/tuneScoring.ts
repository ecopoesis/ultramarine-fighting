import { defaultConfig } from '../src/config';
import { runTournament, ARCHES } from '../src/bots/tournament';
import type { Config } from '../src/types';

// Explore the two scoring levers behind steward-dominance under weak-link:
//   • combineMode — how the three tracks fuse (harshness on imbalance).
//   • conservationBagHealthVP — the SHARED end-game health bonus. It adds the
//     same constant to everyone's conservation, so it floors every player's
//     conservation track (helps specialists whose conservation is otherwise 0,
//     but is invisible under `sum` where a shared constant can't change ranks).
// Goal: a mode+magnitude where all three archetypes are genuinely viable.

const MODES = ['sum', 'weakLinkMultiplier', 'geometricMean', 'weakestLink'] as const;
const HEALTH_VP = [0, 5, 10, 15];

function build(mode: (typeof MODES)[number], healthVP: number): Config {
  return {
    ...defaultConfig,
    scoring: { ...defaultConfig.scoring, combineMode: mode, conservationBagHealthVP: healthVP },
  };
}

const seeds = Number(process.argv[2] ?? 100);
const rows: any[] = [];
for (const mode of MODES) {
  for (const healthVP of HEALTH_VP) {
    const { byArch, healthSum, games } = runTournament(build(mode, healthVP), seeds);
    const pct = (a: (typeof ARCHES)[number]) => (byArch[a].wins / Math.max(1, byArch[a].games)) * 100;
    const wins = { S: pct('steward'), G: pct('greedy'), T: pct('thief') };
    rows.push({
      combineMode: mode,
      consVP: healthVP,
      'S%': wins.S.toFixed(0), 'G%': wins.G.toFixed(0), 'T%': wins.T.toFixed(0),
      'min%': Math.min(wins.S, wins.G, wins.T).toFixed(0), // maximize ⇒ three viable
      'health%': ((healthSum / games) * 100).toFixed(0),
    });
  }
}

console.log(`Scoring sweep — combineMode × conservationBagHealthVP — ${seeds} seeds × ${ARCHES.length} rotations`);
console.log('(min% = win rate of the WORST archetype; higher = three viable archetypes)\n');
console.table(rows);

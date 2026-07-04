import { defaultConfig } from '../src/config';
import { ROSTER, makeCardCounter } from '../src/bots';
import { tournament, type Named } from './tuneArchetypes';
import type { Config } from '../src/types';

// Re-tune lever #1: the custom lobster d6. Six faces (blanks allowed) are the
// recovery knob. Sweep face distributions and read balance (win% spread across the
// roster — lower is better) + commons health, at the target table size.
const SEEDS = Number(process.argv[2] ?? 20);
const PLAYERS = Number(process.argv[3] ?? 6);
const fleet: Named[] = ROSTER.map((a) => ({ name: a.name, policy: makeCardCounter(a) }));

const dice: [string, number[]][] = [
  ['current  [0,1,2,3,4,5]', [0, 1, 2, 3, 4, 5]],
  ['generous [2,3,3,4,4,5]', [2, 3, 3, 4, 4, 5]],
  ['stingy   [0,0,1,1,2,3]', [0, 0, 1, 1, 2, 3]],
  ['blanky   [0,0,0,2,4,6]', [0, 0, 0, 2, 4, 6]],
  ['flatlow  [1,1,2,2,3,3]', [1, 1, 2, 2, 3, 3]],
  ['flat2    [2,2,2,2,2,2]', [2, 2, 2, 2, 2, 2]],
  ['tiny     [0,0,0,1,1,2]', [0, 0, 0, 1, 1, 2]],
];

console.log(`=== Lobster-die sweep (${SEEDS} seeds, ${PLAYERS}-player roster) — spread = max-min win%, want it LOW ===\n`);
for (const [name, faces] of dice) {
  const cfg: Config = { ...defaultConfig, restock: { ...defaultConfig.restock, dieFaces: faces } };
  const { agg, health, games } = tournament(cfg, SEEDS, fleet, PLAYERS);
  const wins = ROSTER.map((a) => (agg[a.name].wins / Math.max(1, agg[a.name].games)) * 100);
  const spread = Math.max(...wins) - Math.min(...wins);
  const avg = faces.reduce((x, y) => x + y, 0) / faces.length;
  const perArch = ROSTER.map((a, i) => `${a.name.slice(0, 4)} ${wins[i].toFixed(0).padStart(2)}`).join('  ');
  console.log(`${name}  avg ${avg.toFixed(1)}  health ${((health / games) * 100).toFixed(0)}%  spread ${spread.toFixed(0).padStart(2)}\n    ${perArch}`);
}

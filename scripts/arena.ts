import { defaultConfig } from '../src/config';
import { runTournament, ARCHES } from '../src/bots/tournament';
import type { Config } from '../src/types';

// Archetype tournament. The three captains play each other; seats are rotated
// so the seat-order confound (later seats winning) is averaged out and any
// remaining win-skew is strategy, not position.

function report(mode: 'sum' | 'weakLinkMultiplier', seeds: number) {
  const config: Config = { ...defaultConfig, scoring: { ...defaultConfig.scoring, combineMode: mode } };
  const { byArch, healthSum, games } = runTournament(config, seeds);

  console.log(`\n=== combineMode: ${mode}  (${games} games, seats rotated) ===`);
  const table = ARCHES.map((arch) => {
    const a = byArch[arch];
    const n = Math.max(1, a.games);
    return {
      archetype: arch,
      'win%': ((a.wins / n) * 100).toFixed(0),
      avgTotal: (a.total / n).toFixed(2),
      money: (a.moneyVP / n).toFixed(1),
      conserv: (a.conservationVP / n).toFixed(1),
      rep: (a.reputationVP / n).toFixed(1),
      avgBerthSlot: a.berthCount ? (a.berthSlotSum / a.berthCount).toFixed(2) : '—',
    };
  });
  console.table(table);
  console.log(`Mean bag health at end: ${((healthSum / games) * 100).toFixed(1)}%`);
}

const seeds = Number(process.argv[2] ?? 100);
console.log(`Lobsters archetype arena — ${seeds} seeds × ${ARCHES.length} seat-rotations per mode`);
report('weakLinkMultiplier', seeds);
report('sum', seeds);
console.log(
  '\nReads:\n' +
  '  • Bag health well under 100% under skilled play ⇒ the commons actually depletes (dial #2).\n' +
  '  • weakLinkMultiplier should punish rep-dumping (thief/greedy) vs sum (dial #5).\n' +
  '  • avgBerthSlot vs win% ⇒ is racing for the pole worth it? (dial #1, initiative).',
);

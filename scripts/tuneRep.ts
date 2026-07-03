import { defaultConfig } from '../src/config';
import { runTournament, ARCHES } from '../src/bots/tournament';
import { THIEF } from '../src/bots';
import type { Config } from '../src/types';

// Grid over the two decisive levers for making the thief viable under
// weakLinkMultiplier (where any track <= 0 craters the total):
//   • rep.reported  — the EXTRA rep hit when a theft is reported (its own dial
//                     now, no longer a second full rep.steal penalty).
//   • THIEF.repFloor — how much rep the thief keeps in reserve for the reports
//                     it can't prevent (a bot-behavior lever, swept here too).
// Base economy holds the rest of the rep track on a sane, survivable scale.

const BASE = {
  startReputation: 8,
  rep: { ...defaultConfig.rep, steal: -1, illegalKeep: -0.5 },
  repToVP: 1,
};

function build(reported: number): Config {
  return {
    ...defaultConfig,
    startReputation: BASE.startReputation,
    rep: { ...BASE.rep, reported },
    scoring: { ...defaultConfig.scoring, combineMode: 'weakLinkMultiplier', repToVP: BASE.repToVP },
  };
}

const REPORTED = [0, -0.5, -1, -1.5];
const REP_FLOORS = [3, 4, 5, 6];
const seeds = Number(process.argv[2] ?? 60);
const savedFloor = THIEF.repFloor;

const rows: any[] = [];
for (const reported of REPORTED) {
  for (const floor of REP_FLOORS) {
    THIEF.repFloor = floor; // makePolicy reads arch.repFloor at call time
    const { byArch } = runTournament(build(reported), seeds);
    const pct = (a: (typeof ARCHES)[number]) => (byArch[a].wins / Math.max(1, byArch[a].games)) * 100;
    const repVP = byArch.thief.reputationVP / Math.max(1, byArch.thief.games);
    const wins = { S: pct('steward'), G: pct('greedy'), T: pct('thief') };
    rows.push({
      reported, repFloor: floor,
      'S%': wins.S.toFixed(0), 'G%': wins.G.toFixed(0), 'T%': wins.T.toFixed(0),
      'min%': Math.min(wins.S, wins.G, wins.T).toFixed(0),
      'T rep': repVP.toFixed(1),
    });
  }
}
THIEF.repFloor = savedFloor;

rows.sort((a, b) => Number(b['min%']) - Number(a['min%']));
console.log(`Rep-economy grid (base: startRep 8, steal -1, illegalKeep -0.5) — ${seeds} seeds, weakLinkMultiplier`);
console.log('(maximize min% = the worst archetype still wins a fair share ⇒ three viable archetypes)\n');
console.table(rows);

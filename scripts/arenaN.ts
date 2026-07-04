import { defaultConfig } from '../src/config';
import { ROSTER, makeCardCounter } from '../src/bots';
import { report, type Named } from './tuneArchetypes';

// N-player roster arena. Seats `players` archetypes per game from the full roster,
// rotating so each plays every seat. Default: a 6-player table. Usage:
//   npx tsx scripts/arenaN.ts [seeds] [players]
const SEEDS = Number(process.argv[2] ?? 30);
const PLAYERS = Number(process.argv[3] ?? 6);

const fleet: Named[] = ROSTER.map((a) => ({ name: a.name, policy: makeCardCounter(a) }));
console.log(`Roster: ${ROSTER.map((a) => a.name).join(', ')}  (${ROSTER.length} archetypes)`);
report(`Roster arena — ${PLAYERS}-player table`, defaultConfig, SEEDS, fleet, PLAYERS);
console.log(
  '\nRead: want no archetype dominating and none dead (~1/players share is even). ' +
  'Distinct money/conserv/rep columns = distinct playstyles, not reskins.',
);

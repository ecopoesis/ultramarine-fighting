import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import { ROSTER, makeCardCounter } from '../src/bots';

// Sweep the licence schedule. The question is whether it is a clean money sink that
// compresses the money track (which no other track could reach) WITHOUT bankrupting
// captains into the unlicensed state, which would be a death spiral rather than a
// choice. Watch "seasons lost" above all.
const SEEDS = Number(process.argv[2] ?? 10);
const PLAYERS = Number(process.argv[3] ?? 4);
const SCHEDULES: Record<string, number[]> = {
  none: [0, 0, 0, 0, 0],
  tiny: [0, 2, 3, 4, 5],
  small: [0, 4, 5, 6, 7],
  gentle: [0, 6, 8, 10, 12],
  default: [0, 10, 13, 16, 19],
  steep: [0, 14, 18, 22, 26],
  flat15: [0, 15, 15, 15, 15],
};
const only = process.argv[4];
console.log(`licence sweep — ${SEEDS} seeds x ${PLAYERS}p x roster of ${ROSTER.length}\n`);
console.log('schedule | total fee | money VP    | consVP | repVP | mean VP | health | win% spread | seasons lost');
console.log('---------+-----------+-------------+--------+-------+---------+--------+-------------+-------------');
for (const [name, sched] of Object.entries(SCHEDULES)) {
  if (only && name !== only) continue;
  const cfg = { ...defaultConfig, players: PLAYERS, licensePerSeason: sched };
  const wins: Record<string, number> = {}; const totals: number[] = [];
  const tr = { m: [] as number[], c: [] as number[], r: [] as number[] };
  let healthSum = 0; let games = 0; let lost = 0; let playerSeasons = 0;
  for (let s = 0; s < SEEDS; s++) {
    for (let rot = 0; rot < ROSTER.length; rot++) {
      const seat = Array.from({ length: PLAYERS }, (_, i) => ROSTER[(i + rot) % ROSTER.length]);
      const pol = seat.map((a) => makeCardCounter(a));
      let state = createInitialState(cfg, 5000 + s);
      const ids = state.turnOrder.slice();
      let season = 1; let guard = 0;
      while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
        if (state.season !== season) { // a new season just started: count who lost it
          season = state.season;
          for (const id of ids) { playerSeasons++; if (state.players[id].licensed === false) lost++; }
        }
        const pid = activePlayerId(state);
        state = reduce(state, pol[ids.indexOf(pid)](state, pid, legalActions(state, pid)));
      }
      healthSum += avgBagHealth(state); games++;
      const rows = score(state);
      rows.forEach((r) => { totals.push(r.total); tr.m.push(r.moneyVP); tr.c.push(r.conservationVP); tr.r.push(r.reputationVP); });
      const w = seat[ids.indexOf(rows[0].playerId)].name;
      wins[w] = (wins[w] ?? 0) + 1;
    }
  }
  const seated = (games * PLAYERS) / ROSTER.length;
  const wp = ROSTER.map((a) => ((wins[a.name] ?? 0) / seated) * 100);
  const rng = (a: number[]) => `${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}`;
  console.log(
    `${name.padEnd(8)} | ${String(sched.reduce((a, b) => a + b, 0)).padStart(9)} | ${rng(tr.m).padEnd(11)} | ${rng(tr.c).padEnd(6)} | ${rng(tr.r).padEnd(5)} | ` +
    `${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1).padStart(7)} | ${((healthSum / games) * 100).toFixed(0).padStart(5)}% | ` +
    `${`${Math.min(...wp).toFixed(0)}-${Math.max(...wp).toFixed(0)}%`.padEnd(11)} | ${((lost / Math.max(1, playerSeasons)) * 100).toFixed(1)}%`,
  );
}
console.log('\n"seasons lost" = share of player-seasons spent UNLICENSED. Above a few % this is a death spiral, not a choice.');

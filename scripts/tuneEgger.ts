import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import { ROSTER, makeCardCounter, type CardCounter } from '../src/bots';

// Sweep what a berried female is worth. NOTE the arena cannot answer the real
// question — whether notching becomes an interesting CHOICE — because every bot's
// haul policy is fixed: no archetype in the roster even uses the 'greedy' policy that
// keeps eggers. What it CAN answer is the balance question that follows: if keeping
// them is worth it, does a captain who keeps them run away with the game? So the
// roster here is seeded with a POACHER using the greedy policy, as a canary.
const SEEDS = Number(process.argv[2] ?? 10);
const PLAYERS = Number(process.argv[3] ?? 4);
const WEIGHTS = (process.argv[4] ?? '0,2,4,6').split(',').map(Number);

const POACHER: CardCounter = { ...ROSTER[1], name: 'poacher', haulPolicy: 'greedy', minKeep: 1 };
const roster = [...ROSTER, POACHER];

console.log(`egger weight sweep — ${SEEDS} seeds x ${PLAYERS}p, roster of ${roster.length} incl. a greedy POACHER\n`);
console.log('egger lb | poacher win% | best other | mean VP | money range | cons range | health');
console.log('---------+--------------+------------+---------+-------------+------------+-------');
for (const w of WEIGHTS) {
  const cfg = { ...defaultConfig, players: PLAYERS, eggerWeightLb: w };
  const wins: Record<string, number> = {}; const totals: number[] = [];
  const money: number[] = []; const cons: number[] = []; let health = 0; let games = 0;
  for (let s = 0; s < SEEDS; s++) {
    for (let rot = 0; rot < roster.length; rot++) {
      const seat = Array.from({ length: PLAYERS }, (_, i) => roster[(i + rot) % roster.length]);
      const pol = seat.map((a) => makeCardCounter(a));
      let st = createInitialState(cfg, 9000 + s);
      const ids = st.turnOrder.slice();
      let guard = 0;
      while (st.phase !== 'GAME_OVER' && guard++ < 200000) {
        const pid = activePlayerId(st);
        st = reduce(st, pol[ids.indexOf(pid)](st, pid, legalActions(st, pid)));
      }
      health += avgBagHealth(st); games++;
      const rows = score(st);
      rows.forEach((r) => { totals.push(r.total); money.push(r.moneyVP); cons.push(r.conservationVP); });
      wins[seat[ids.indexOf(rows[0].playerId)].name] = (wins[seat[ids.indexOf(rows[0].playerId)].name] ?? 0) + 1;
    }
  }
  const seated = (games * PLAYERS) / roster.length;
  const wp = (n: string) => ((wins[n] ?? 0) / seated) * 100;
  const others = roster.filter((a) => a.name !== 'poacher').map((a) => wp(a.name));
  const rng = (a: number[]) => `${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}`;
  console.log(
    `${String(w).padStart(8)} | ${wp('poacher').toFixed(0).padStart(11)}% | ${Math.max(...others).toFixed(0).padStart(9)}% | ` +
    `${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1).padStart(7)} | ${rng(money).padEnd(11)} | ${rng(cons).padEnd(10)} | ${((health / games) * 100).toFixed(0)}%`,
  );
}
console.log('\nA poacher well above the field means keeping berried females is simply correct — the notch is not a dilemma, it is a trap.');

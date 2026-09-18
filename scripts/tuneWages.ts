import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import { ROSTER, makeCardCounter } from '../src/bots';
import type { Ground } from '../src/types';

// Sweep the crew wage. The arena can tell us whether a wage BREAKS anything —
// balance, the far grounds, where the money track lands. It CANNOT tell us whether
// dead days fall, because the card-counter's policy is fixed: it will never learn to
// stagger its pots in response. That half of the question needs an LLM game.
const SEEDS = Number(process.argv[2] ?? 10);
const PLAYERS = Number(process.argv[3] ?? 4);
const WAGES = (process.argv[4] ?? '0,1,2,3,4').split(',').map(Number);
const EARN = new Set(['HAUL', 'STEAL', 'SELL', 'DROP']);

console.log(`wage sweep — ${SEEDS} seeds x ${PLAYERS}p, roster of ${ROSTER.length}\n`);
console.log('wage | dead% | money VP     | consVP | repVP | total VP | health | win% spread        | far drops');
console.log('-----+-------+--------------+--------+-------+----------+--------+--------------------+----------');

for (const wage of WAGES) {
  const cfg = { ...defaultConfig, players: PLAYERS, wagePerDay: wage };
  let dead = 0; let dayCount = 0; let healthSum = 0;
  const wins: Record<string, number> = {}; const totals: Record<string, number[]> = {};
  const tracks = { m: [] as number[], c: [] as number[], r: [] as number[] };
  const tierDrops: Record<string, number> = { inshore: 0, mid: 0, offshore: 0, deep: 0 };

  for (let s = 0; s < SEEDS; s++) {
    for (let rot = 0; rot < ROSTER.length; rot++) {
      const seatArch = Array.from({ length: PLAYERS }, (_, i) => ROSTER[(i + rot) % ROSTER.length]);
      const pol = seatArch.map((a) => makeCardCounter(a));
      let state = createInitialState(cfg, 3000 + s);
      const ids = state.turnOrder.slice();
      const acted: Record<string, boolean> = {};
      let key = '';
      let guard = 0;
      while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
        const pid = activePlayerId(state);
        const k = `${pid}-${state.season}-${state.day}`;
        if (k !== key && state.phase === 'PLAYING') { key = k; if (!(k in acted)) acted[k] = false; }
        const a = pol[ids.indexOf(pid)](state, pid, legalActions(state, pid));
        if (state.phase === 'PLAYING') {
          if (EARN.has(a.type)) acted[`${pid}-${state.season}-${state.day}`] = true;
          if (a.type === 'DROP') {
            const g = state.config.map.nodes[state.players[pid].node].ground as Ground;
            if (g) tierDrops[g]++;
          }
        }
        state = reduce(state, a);
      }
      for (const v of Object.values(acted)) { dayCount++; if (!v) dead++; }
      healthSum += avgBagHealth(state);
      const rows = score(state);
      rows.forEach((row) => {
        const arch = seatArch[ids.indexOf(row.playerId)].name;
        (totals[arch] ??= []).push(row.total);
        tracks.m.push(row.moneyVP); tracks.c.push(row.conservationVP); tracks.r.push(row.reputationVP);
      });
      const w = seatArch[ids.indexOf(rows[0].playerId)].name;
      wins[w] = (wins[w] ?? 0) + 1;
    }
  }
  const games = SEEDS * ROSTER.length;
  const rng = (a: number[]) => `${Math.min(...a).toFixed(0)}-${Math.max(...a).toFixed(0)}`;
  const seated = (games * PLAYERS) / ROSTER.length; // each archetype's number of appearances
  const winPct = ROSTER.map((a) => ((wins[a.name] ?? 0) / seated) * 100);
  const allTot = Object.values(totals).flat();
  const farShare = (tierDrops.offshore + tierDrops.deep) / Object.values(tierDrops).reduce((x, y) => x + y, 0);
  console.log(
    `${String(wage).padStart(4)} | ${((dead / dayCount) * 100).toFixed(1).padStart(5)} | ${rng(tracks.m).padEnd(12)} | ${rng(tracks.c).padEnd(6)} | ${rng(tracks.r).padEnd(5)} | ${(allTot.reduce((a, b) => a + b, 0) / allTot.length).toFixed(1).padStart(8)} | ` +
    `${((healthSum / games) * 100).toFixed(0).padStart(5)}% | ${`${Math.min(...winPct).toFixed(0)}-${Math.max(...winPct).toFixed(0)}%`.padEnd(18)} | ${(farShare * 100).toFixed(0)}%`,
  );
}
console.log('\nRead: dead% should FALL only for real players (bots cannot learn to stagger — this column is a floor, not a result).');
console.log('Watch that far drops do not collapse and that the win% spread stays tight.');

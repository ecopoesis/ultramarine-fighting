import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import { ROSTER, makeCardCounter } from '../src/bots';
import type { Ground } from '../src/types';

// Sweep the per-space pot capacity. The question this answers is CONCENTRATION: the
// fleet was putting 45-61% of a season's pots on one node (The Edge), on a 22-node
// map. A cap should spread the gear without killing the far grounds or the balance.
const SEEDS = Number(process.argv[2] ?? 10);
const PLAYERS = Number(process.argv[3] ?? 4);
const CAPS = (process.argv[4] ?? '0,2,3,4,6').split(',').map(Number); // 0 = uncapped

console.log(`space-capacity sweep — ${SEEDS} seeds x ${PLAYERS}p x roster of ${ROSTER.length}`);
console.log('(cap is quoted at referencePlayers and scales with the table)\n');
console.log('cap | effective | topNode% | nodesUsed | far% | health | win% spread | mean VP');
console.log('----+-----------+----------+-----------+------+--------+-------------+--------');

for (const cap of CAPS) {
  const cfg = { ...defaultConfig, players: PLAYERS, maxPotsPerSpace: cap };
  const eff = cap ? Math.max(1, Math.round(cap * (PLAYERS / cfg.referencePlayers))) : Infinity;
  let topShareSum = 0; let nodesSum = 0; let healthSum = 0; let games = 0;
  const wins: Record<string, number> = {}; const totals: number[] = [];
  const tier: Record<string, number> = { inshore: 0, mid: 0, offshore: 0, deep: 0 };

  for (let s = 0; s < SEEDS; s++) {
    for (let rot = 0; rot < ROSTER.length; rot++) {
      const seat = Array.from({ length: PLAYERS }, (_, i) => ROSTER[(i + rot) % ROSTER.length]);
      const pol = seat.map((a) => makeCardCounter(a));
      let state = createInitialState(cfg, 4000 + s);
      const ids = state.turnOrder.slice();
      const drops: Record<string, number> = {};
      let guard = 0;
      while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
        const pid = activePlayerId(state);
        const a = pol[ids.indexOf(pid)](state, pid, legalActions(state, pid));
        if (a.type === 'DROP') {
          const node = state.players[pid].node;
          drops[node] = (drops[node] ?? 0) + 1;
          const g = state.config.map.nodes[node].ground as Ground;
          if (g) tier[g]++;
        }
        state = reduce(state, a);
      }
      const tot = Object.values(drops).reduce((x, y) => x + y, 0);
      if (tot > 0) { topShareSum += Math.max(...Object.values(drops)) / tot; nodesSum += Object.keys(drops).length; }
      healthSum += avgBagHealth(state); games++;
      const rows = score(state);
      rows.forEach((r) => totals.push(r.total));
      const w = seat[ids.indexOf(rows[0].playerId)].name;
      wins[w] = (wins[w] ?? 0) + 1;
    }
  }
  const seated = (games * PLAYERS) / ROSTER.length;
  const winPct = ROSTER.map((a) => ((wins[a.name] ?? 0) / seated) * 100);
  const far = (tier.offshore + tier.deep) / Object.values(tier).reduce((x, y) => x + y, 0);
  console.log(
    `${String(cap || '-').padStart(3)} | ${String(eff === Infinity ? 'none' : eff).padStart(9)} | ${((topShareSum / games) * 100).toFixed(1).padStart(7)}% | ` +
    `${(nodesSum / games).toFixed(1).padStart(9)} | ${(far * 100).toFixed(0).padStart(3)}% | ${((healthSum / games) * 100).toFixed(0).padStart(5)}% | ` +
    `${`${Math.min(...winPct).toFixed(0)}-${Math.max(...winPct).toFixed(0)}%`.padEnd(11)} | ${(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1)}`,
  );
}
console.log('\nWant: topNode% DOWN (the fleet spreads), nodesUsed UP, far% and health steady, win% spread tight.');
console.log('There are 17 fishing spaces on the map.');

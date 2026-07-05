import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { isPort } from '../src/engine/ports';
import { ROSTER, makeCardCounter } from '../src/bots';
import type { GameState } from '../src/types';

// "Does the map make sense?" — run N diverse 6-player games and tally WHERE the
// fleet ports (berths / sells / refuels) and WHERE it fishes (drops / hauls), plus
// how often a day ends stranded at sea. Dead ports or dead grounds => the map isn't
// pulling its weight.
const N = Number(process.argv[2] ?? 40);
const PLAYERS = Number(process.argv[3] ?? 6);
const cfg = { ...defaultConfig, players: PLAYERS };

const add = (m: Record<string, number>, k: string) => (m[k] = (m[k] ?? 0) + 1);
const fishDrop: Record<string, number> = {};
const berthAt: Record<string, number> = {};
const sellAt: Record<string, number> = {};
const refuelAt: Record<string, number> = {};
let endSea = 0, endPort = 0, outOfFuelStrands = 0;

const policies = ROSTER.map((a) => makeCardCounter(a));
const tier = (s: GameState, n: string) => s.config.map.nodes[n]?.ground ?? (s.config.map.nodes[n]?.port?.market ? 'market' : 'shelter');

for (let i = 0; i < N; i++) {
  let s = createInitialState(cfg, 1000 + i);
  const ids = s.turnOrder.slice();
  const seat = ids.map((_, idx) => policies[(idx + i) % policies.length]);
  let guard = 0;
  while (s.phase !== 'GAME_OVER' && guard++ < 300000) {
    const pid = activePlayerId(s);
    const idx = ids.indexOf(pid);
    const node = s.players[pid].node;
    const prevDay = s.day, prevSeason = s.season;
    const a = seat[idx](s, pid, legalActions(s, pid));
    if (a.type === 'DROP') add(fishDrop, node);
    else if (a.type === 'SELL') add(sellAt, node);
    else if (a.type === 'REFUEL') add(refuelAt, node);
    s = reduce(s, a);
    // a within-season day just ended → each boat's node is where it spent the night
    if (s.season === prevSeason && s.day === prevDay + 1) {
      for (const id of ids) {
        const n = s.players[id].node;
        add(berthAt, n);
        if (isPort(s, n)) endPort++;
        else { endSea++; if (s.players[id].fuel < s.config.map.fuelPerStep) outOfFuelStrands++; }
      }
    }
  }
}

function tbl(title: string, m: Record<string, number>, order?: string[]) {
  const keys = order ?? Object.keys(m).sort((a, b) => (m[b] ?? 0) - (m[a] ?? 0));
  const tot = Object.values(m).reduce((x, y) => x + y, 0) || 1;
  console.log(`\n${title}  (total ${tot}, per game ${(tot / N).toFixed(1)})`);
  for (const k of keys) if (m[k]) console.log(`  ${k.padEnd(12)} ${String(m[k]).padStart(5)}  ${((100 * m[k]) / tot).toFixed(0).padStart(3)}%`);
}

console.log(`=== Map usage — ${N} games, ${PLAYERS}p diverse roster ===`);
const s0 = createInitialState(cfg, 1);
const ports = Object.keys(s0.config.map.nodes).filter((n) => isPort(s0, n));
const grounds = Object.keys(s0.config.map.nodes).filter((n) => s0.config.map.nodes[n].type === 'ground');
tbl('BERTH (day-end) by node', berthAt, ports.concat(grounds).filter((n) => berthAt[n]));
tbl('SELL by market port', sellAt, ports);
tbl('REFUEL by port', refuelAt, ports);
tbl('DROP (fish) by ground node', fishDrop, grounds);
// per-tier fishing rollup
const byTier: Record<string, number> = {};
for (const [n, c] of Object.entries(fishDrop)) byTier[tier(s0, n)] = (byTier[tier(s0, n)] ?? 0) + c;
tbl('DROP by tier', byTier, ['inshore', 'mid', 'offshore', 'deep']);
console.log(`\nDay ends:  at port ${endPort}  |  AT SEA ${endSea} (${((100 * endSea) / (endSea + endPort)).toFixed(1)}%)  |  of those, OUT OF FUEL ${outOfFuelStrands}`);
console.log('Read: every port + ground should see real use; a lopsided or dead node means the geometry (or its economics) is off.');

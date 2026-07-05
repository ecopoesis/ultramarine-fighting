import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { ROSTER, makeCardCounter } from '../src/bots';

// Upgrade-engine instrument: how many refits get bought (the cadence target is
// ~2-3 per player per game), which ones, and by which archetypes.
const N = Number(process.argv[2] ?? 40);
const PLAYERS = Number(process.argv[3] ?? 6);
const cfg = { ...defaultConfig, players: PLAYERS };
const catalogIds = cfg.upgrades.catalog.map((u) => u.id);

const byType: Record<string, number> = {};
const byArch: Record<string, { games: number; bought: number }> = {};
for (const a of ROSTER) byArch[a.name] = { games: 0, bought: 0 };
let totalPlayers = 0, totalBought = 0;
const perGameCounts: number[] = [];

const policies = ROSTER.map((a) => makeCardCounter(a));
for (let i = 0; i < N; i++) {
  let s = createInitialState(cfg, 1000 + i);
  const ids = s.turnOrder.slice();
  const seatArch = ids.map((_, idx) => ROSTER[(idx + i) % ROSTER.length].name);
  const seat = ids.map((_, idx) => policies[(idx + i) % policies.length]);
  let guard = 0;
  while (s.phase !== 'GAME_OVER' && guard++ < 300000) {
    const pid = activePlayerId(s);
    s = reduce(s, seat[ids.indexOf(pid)](s, pid, legalActions(s, pid)));
  }
  let gameBought = 0;
  ids.forEach((id, idx) => {
    const ups = Object.values(s.players[id].upgrades);
    totalPlayers++; totalBought += ups.length; gameBought += ups.length;
    byArch[seatArch[idx]].games++; byArch[seatArch[idx]].bought += ups.length;
    for (const u of ups) byType[u!] = (byType[u!] ?? 0) + 1;
  });
  perGameCounts.push(gameBought);
}

console.log(`=== Upgrade engine — ${N} games, ${PLAYERS}p diverse roster ===\n`);
console.log(`Refits bought: ${(totalBought / totalPlayers).toFixed(2)} per player per game (target ~2-3), ${(totalBought / N).toFixed(1)}/game total`);
console.log('\nBy type (share of all refits bought):');
for (const id of catalogIds) {
  const c = byType[id] ?? 0;
  console.log(`  ${id.padEnd(8)} ${String(c).padStart(4)}  ${((100 * c) / Math.max(1, totalBought)).toFixed(0)}%`);
}
console.log('\nBy archetype (refits per game):');
for (const a of ROSTER) {
  const r = byArch[a.name];
  console.log(`  ${a.name.padEnd(10)} ${(r.bought / Math.max(1, r.games)).toFixed(2)}`);
}

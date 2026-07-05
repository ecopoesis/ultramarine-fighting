import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { stageFor } from '../src/engine/soak';
import { ROSTER, makeCardCounter } from '../src/bots';
import type { GameState, Ground, Stage } from '../src/types';

// "How ripe are pots when pulled?" — the designer suspects bots haul immediately
// after dropping (early pull), and that the far grounds prime too slowly. For every
// HAUL/STEAL, record the pot's soak (days + stage) by tier, so we can see the pull
// curve the bots actually play.
const N = Number(process.argv[2] ?? 40);
const PLAYERS = Number(process.argv[3] ?? 6);
const cfg = { ...defaultConfig, players: PLAYERS };
const grounds = Object.keys(cfg.bags) as Ground[];
const STAGES: Stage[] = ['SET', 'SOAKING', 'PRIME', 'OVERRIPE', 'FOULED'];

// per tier: count of pulls at each daysSoaked, and at each stage
const daysHist: Record<Ground, Record<number, number>> = { inshore: {}, mid: {}, offshore: {}, deep: {} };
const stageHist: Record<Ground, Record<string, number>> = { inshore: {}, mid: {}, offshore: {}, deep: {} };
const policies = ROSTER.map((a) => makeCardCounter(a));

for (let i = 0; i < N; i++) {
  let s = createInitialState(cfg, 1000 + i);
  const ids = s.turnOrder.slice();
  const seat = ids.map((_, idx) => policies[(idx + i) % policies.length]);
  let guard = 0;
  while (s.phase !== 'GAME_OVER' && guard++ < 300000) {
    const pid = activePlayerId(s);
    const a = seat[ids.indexOf(pid)](s, pid, legalActions(s, pid));
    if (a.type === 'HAUL' || a.type === 'STEAL') {
      const owner = a.type === 'HAUL' ? s.players[pid] : s.players[a.ownerId];
      const rec = owner.soak[a.buoyId];
      if (rec) {
        const g = rec.ground;
        const st = stageFor(s, g, rec.daysSoaked);
        daysHist[g][rec.daysSoaked] = (daysHist[g][rec.daysSoaked] ?? 0) + 1;
        stageHist[g][st] = (stageHist[g][st] ?? 0) + 1;
      }
    }
    s = reduce(s, a);
  }
}

console.log(`=== Ripeness at pull — ${N} games, ${PLAYERS}p diverse roster ===\n`);
console.log('daysToPrime by ground:', grounds.map((g) => `${g}=${cfg.soakCurves[g].indexOf('PRIME')}`).join('  '));
console.log('\nPull count by days-soaked (col = nights the pot soaked before it was pulled):');
const maxDay = Math.max(...grounds.flatMap((g) => Object.keys(daysHist[g]).map(Number)), 0);
const dayCols = Array.from({ length: maxDay + 1 }, (_, d) => d);
console.table(Object.fromEntries(grounds.map((g) => {
  const tot = Object.values(daysHist[g]).reduce((a, b) => a + b, 0) || 1;
  return [g, Object.fromEntries(dayCols.map((d) => [`${d}d`, `${((100 * (daysHist[g][d] ?? 0)) / tot).toFixed(0)}%`]))];
})));

console.log('Pull count by STAGE (what ripeness the pot was at when pulled):');
console.table(Object.fromEntries(grounds.map((g) => {
  const tot = Object.values(stageHist[g]).reduce((a, b) => a + b, 0) || 1;
  return [g, Object.fromEntries(STAGES.map((st) => [st, `${((100 * (stageHist[g][st] ?? 0)) / tot).toFixed(0)}%`]))];
})));
console.log('Read: lots of SET/SOAKING pulls = early-pull (workers placed & retrieved too fast). PRIME is the intended payoff stage.');

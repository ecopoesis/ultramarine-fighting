import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { runTournament } from '../src/bots/tournament';
import { BOTS, ROSTER, makeCardCounter } from '../src/bots';
import { report, type Named } from './tuneArchetypes';
import type { Config, GameState, Ground } from '../src/types';

// Chunk D instrument. Weather ON. Questions:
//   1. Does the storm escalate as designed (deep always, spreading inward)?
//   2. Do the three effects actually fire (whittle / hazard / fishing bonus)?
//   3. Is a stormed haul really a fatter haul (the reward), and does the fleet
//      lose gear it drops into the blow (the risk)?
//   4. Does weather shift the balance — especially the gambler (the far-bettor)?
const N = Number(process.argv[2] ?? 40);
const PLAYERS = Number(process.argv[3] ?? 6);
const grounds = Object.keys(defaultConfig.bags) as Ground[];
const SEASONS = defaultConfig.seasons;

const wet: Config = { ...defaultConfig, flags: { ...defaultConfig.flags, weather: true } };
const dry: Config = { ...defaultConfig, flags: { ...defaultConfig.flags, weather: false } };

// --- homogeneous card-counter table, weather ON: measure the mechanics ---
const stormCount: Record<Ground, number>[] = Array.from({ length: SEASONS }, () => ({ inshore: 0, mid: 0, offshore: 0, deep: 0 }));
const drops: Record<Ground, number>[] = Array.from({ length: SEASONS }, () => ({ inshore: 0, mid: 0, offshore: 0, deep: 0 }));
const dropsInStorm: number[] = Array(SEASONS).fill(0);
let potsParted = 0, hazardHits = 0, fuelLost = 0;
let stormHauls = 0, stormKept = 0, calmHauls = 0, calmKept = 0;

const tierOf = (s: GameState, node: string) => s.config.map.nodes[node].ground!;

for (let i = 0; i < N; i++) {
  let s = createInitialState(wet, 1000 + i);
  let seen = 0;
  const snapStorms = () => { for (const n of s.stormed) stormCount[s.season - 1][tierOf(s, n)]++; };
  snapStorms(); seen = 1;
  let guard = 0;
  while (s.phase !== 'GAME_OVER' && guard++ < 200000) {
    const pid = activePlayerId(s);
    const p = s.players[pid];
    const from = p.node;
    const action = BOTS.cardcounter(s, pid, legalActions(s, pid));
    let haulNode: string | null = null, haulStormed = false, holdBefore = 0;
    if (action.type === 'DROP') {
      drops[s.season - 1][tierOf(s, from)]++;
      if (s.stormed.includes(from)) dropsInStorm[s.season - 1]++;
    } else if (action.type === 'HAUL') {
      haulNode = from; haulStormed = s.stormed.includes(from); holdBefore = p.hold.length;
    }
    const before = s.log.length;
    s = reduce(s, action);
    // tally storm log events emitted by this step
    for (let k = before; k < s.log.length; k++) {
      const line = s.log[k];
      if (line.includes('parts')) potsParted++;
      else if (line.includes('takes a beating')) { hazardHits++; const m = line.match(/-(\d+) fuel/); if (m) fuelLost += +m[1]; }
    }
    if (haulNode) {
      const kept = s.players[pid].hold.length - holdBefore;
      if (haulStormed) { stormHauls++; stormKept += Math.max(0, kept); }
      else { calmHauls++; calmKept += Math.max(0, kept); }
    }
    if (s.phase === 'PLAYING' && s.season !== seen) { seen = s.season; snapStorms(); }
  }
}

const f1 = (x: number) => (x / N).toFixed(1);
const f2 = (x: number) => (x / N).toFixed(2);
console.log(`=== Weather instrument (${N} seeds, homogeneous 3-boat card-counter table, weather ON) ===\n`);

console.log('Avg STORMED nodes per tier at each season start (escalation — deep always, spreading inward):');
console.table(Object.fromEntries(grounds.map((g) => [g, Object.fromEntries(
  Array.from({ length: SEASONS }, (_, s) => [`S${s + 1}`, f2(stormCount[s][g])]),
)])));

console.log('DROPS per tier per season (migration under weather):');
console.table(Object.fromEntries(grounds.map((g) => [g, Object.fromEntries(
  Array.from({ length: SEASONS }, (_, s) => [`S${s + 1}`, f1(drops[s][g])]),
)])));
console.log('Drops placed INTO a storm per season (weather-blind risk-taking):',
  dropsInStorm.map((x, s) => `S${s + 1}=${f1(x)}`).join('  '));

console.log(`\nStorm effects per game:  pots parted ${f1(potsParted)}   hazard hits ${f1(hazardHits)}   fuel lost ${f1(fuelLost)}`);
console.log(`Stormy hauls: ${f1(stormHauls)}/game, avg kept ${stormHauls ? (stormKept / stormHauls).toFixed(2) : '—'}` +
  `   |   Calm hauls: ${f1(calmHauls)}/game, avg kept ${calmHauls ? (calmKept / calmHauls).toFixed(2) : '—'}`);
console.log('  (stormy avg-kept should exceed calm — the bonus reward — or the gamble never pays)');

// --- balance: roster arena, weather OFF vs ON (does the far-bettor gambler shift?) ---
const fleet: Named[] = ROSTER.map((a) => ({ name: a.name, policy: makeCardCounter(a) }));
console.log(`\n=== Roster arena — ${PLAYERS}-player — WEATHER OFF ===`);
report('dry', dry, N, fleet, PLAYERS);
console.log(`\n=== Roster arena — ${PLAYERS}-player — WEATHER ON ===`);
report('wet', wet, N, fleet, PLAYERS);
void runTournament;

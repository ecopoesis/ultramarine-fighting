import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { isEgger, isKeeper } from '../src/tiles';
import { diceFor } from '../src/engine/breeding';
import type { Action } from '../src/actions';
import type { GameState, Ground, Tile } from '../src/types';

// WHY DOES THE OCEAN DIE? Replays a switchboard LLM game and accounts for every tile
// that leaves the bags and every one the breeding stock puts back, season by season,
// split by the side (light / dark) of the captain responsible at that moment.
//
// The hypothesis under test: dark captains keep eggers instead of notching them, and
// notches are what buy breeding-stock dice — so a dark table starves the ocean's
// recovery, and the light side's dividend (paid on ocean health) dies with it.
// usage: npx tsx scripts/replayOcean.ts <run> [game]
const run = process.argv[2];
const game = process.argv[3] ?? 'r1g1';
const dir = `tournament/runs/${run}/games`;
const res = JSON.parse(readFileSync(`${dir}/${game}.result.json`, 'utf8'));
const names: string[] = res.seats.map((s: { captainName: string }) => s.captainName);
let s: GameState = createInitialState({ ...defaultConfig, players: names.length }, res.seed, names);
const lines = readFileSync(`${dir}/${game}.actions.jsonl`, 'utf8').split('\n').filter((l) => l.trim());
const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];
const darkMin = defaultConfig.alignment.bands.find((b) => b.name === 'shady')!.atLeast;
const sideOf = (st: GameState, id: string) => (st.players[id].tracks.alignment <= darkMin ? 'dark' : 'light');

type Row = { eggNotched: number; eggKept: number; bagKeepers: number; bagIllegal: number; polluted: number };
const blank = (): Row => ({ eggNotched: 0, eggKept: 0, bagKeepers: 0, bagIllegal: 0, polluted: 0 });
const bySeason: Record<number, { light: Row; dark: Row; bagStart: number; spawned: number; dice: string }> = {};
const seasonRow = (n: number) => (bySeason[n] ??= { light: blank(), dark: blank(), bagStart: 0, spawned: 0, dice: '' });
const bagTotal = (st: GameState) => GROUNDS.reduce((a, g) => a + st.bags[g].length, 0);
seasonRow(1).bagStart = bagTotal(s);

// What a counterfactual notch would have bought: dice with every KEPT egger notched too.
const keptByGround: Record<Ground, number> = { inshore: 0, mid: 0, offshore: 0, deep: 0 };

const newTiles = (before: Tile[], after: Tile[]) => { const ids = new Set(before.map((t) => t.id)); return after.filter((t) => !ids.has(t.id)); };
let logSeen = 0;
for (const l of lines) {
  const a = JSON.parse(l) as Action;
  const before = s;
  s = reduce(s, a);
  const season = before.season;
  if (a.type === 'HAUL' || a.type === 'STEAL') {
    const side = sideOf(before, a.playerId);
    const r = seasonRow(season)[side];
    const notchedNow = GROUNDS.reduce((x, g) => x + (s.notches[g] - before.notches[g]), 0);
    const got = newTiles(before.players[a.playerId].hold, s.players[a.playerId].hold).filter((t) => !t.seeded);
    r.eggNotched += notchedNow;
    const eggs = got.filter(isEgger);
    r.eggKept += eggs.length;
    for (const e of eggs) keptByGround[e.ground]++;
    r.bagKeepers += got.filter(isKeeper).length;
    r.bagIllegal += got.filter((t) => !isKeeper(t)).length;
  }
  // pollution and the spawn are read off the log lines this action produced
  for (const line of s.log.slice(logSeen)) {
    const pol = line.match(/^(.+?)'s cheap engine fouls the \w+ water \((\d+) lobster/);
    if (pol) {
      const id = Object.keys(s.players).find((k) => s.players[k].name === pol[1])!;
      seasonRow(season)[sideOf(before, id)].polluted += Number(pol[2]);
    }
    if (line.startsWith('--- Breeding stock spawns.')) {
      const back = [...line.matchAll(/→ (\d+) back/g)].reduce((x, m) => x + Number(m[1]), 0);
      seasonRow(season).spawned += back;
      seasonRow(season).dice = GROUNDS.map((g) => `${g[0]}${diceFor(s, s.notches[g])}d`).join(' ');
    }
  }
  logSeen = s.log.length;
  if (s.season !== season && s.phase !== 'GAME_OVER') seasonRow(s.season).bagStart = bagTotal(s);
}

console.log(`${run}/${game}: where the ocean went (bag tiles; seeded lobsters excluded)\n`);
const table = Object.entries(bySeason).map(([n, r]) => ({
  season: Number(n),
  'bag at start': r.bagStart,
  'light: keepers taken': r.light.bagKeepers,
  'light: illegal kept': r.light.bagIllegal,
  'dark: keepers taken': r.dark.bagKeepers,
  'dark: illegal kept': r.dark.bagIllegal,
  'dark: polluted': r.dark.polluted,
  'eggers notched (L/D)': `${r.light.eggNotched}/${r.dark.eggNotched}`,
  'eggers kept (L/D)': `${r.light.eggKept}/${r.dark.eggKept}`,
  'spawned back': r.spawned,
  'dice after': r.dice || '—',
}));
console.table(table);
const sum = (f: (r: typeof bySeason[number]) => number) => Object.values(bySeason).reduce((a, r) => a + f(r), 0);
const notched = sum((r) => r.light.eggNotched + r.dark.eggNotched);
const kept = sum((r) => r.light.eggKept + r.dark.eggKept);
console.log(`\nWhole game: bag ${bySeason[1].bagStart} -> ${bagTotal(s)} tiles.`);
console.log(`  taken by the light side: ${sum((r) => r.light.bagKeepers + r.light.bagIllegal)} | by the dark side: ${sum((r) => r.dark.bagKeepers + r.dark.bagIllegal + r.dark.polluted)} (of which illegal ${sum((r) => r.dark.bagIllegal)}, polluted ${sum((r) => r.dark.polluted)})`);
console.log(`  eggers: ${notched} notched, ${kept} kept. Spawned back over the game: ${sum((r) => r.spawned)}.`);
const cf = GROUNDS.map((g) => `${g} ${diceFor(s, s.notches[g])}d → ${diceFor(s, s.notches[g] + keptByGround[g])}d`).join(', ');
console.log(`  breeding dice by the end, actual → if every kept egger had been notched: ${cf}`);

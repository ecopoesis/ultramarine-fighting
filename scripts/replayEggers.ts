import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { isEgger } from '../src/tiles';
import { score } from '../src/engine/scoring';
import type { Action } from '../src/actions';
import type { Config, GameState } from '../src/types';

// Replay a recorded game and account for every berried female: how many each captain
// drew, how many they notched and how many they kept, and where their conservation
// score actually came from. The event log cannot answer this — haul lines don't say
// what was drawn — so a low conservation score is ambiguous between "chose to keep
// eggers" (a value problem) and "rarely met one" (a supply problem). This separates them.
// usage: npx tsx scripts/replayEggers.ts <run> [game]
const run = process.argv[2];
const game = process.argv[3] ?? 'r1g1';
const dir = `tournament/runs/${run}/games`;
const res = JSON.parse(readFileSync(`${dir}/${game}.result.json`, 'utf8'));
const names: string[] = res.seats.map((s: { captainName: string }) => s.captainName);
// Every run recorded so far predates the switchboard; replay them under the rules they were played by.
const cfg: Config = { ...defaultConfig, players: res.seats.length, flags: { ...defaultConfig.flags, alignment: false } };
let state: GameState = createInitialState(cfg, res.seed, names);
const lines = readFileSync(`${dir}/${game}.actions.jsonl`, 'utf8').split('\n').filter((l) => l.trim());

const eggersInBags = (s: GameState) => Object.values(s.bags).flat().filter(isEgger).length;
const eggersHeld = (s: GameState, id: string) => s.players[id].hold.filter(isEgger).length;
const notchTotal = (s: GameState) => Object.values(s.notches).reduce((a, b) => a + (b ?? 0), 0);

type Row = { hauls: number; policy: Record<string, number>; notched: number; kept: number };
const rows: Record<string, Row> = {};
for (const id of Object.keys(state.players)) rows[id] = { hauls: 0, policy: {}, notched: 0, kept: 0 };
const supply: string[] = [`S${state.season} start: ${eggersInBags(state)} eggers in the bags`];

for (const l of lines) {
  const a = JSON.parse(l) as Action;
  const before = state;
  state = reduce(state, a);
  if (a.type === 'HAUL') {
    const r = rows[a.playerId];
    r.hauls++;
    const pol = a.policy ?? 'clean';
    r.policy[pol] = (r.policy[pol] ?? 0) + 1;
    r.notched += notchTotal(state) - notchTotal(before);
    r.kept += Math.max(0, eggersHeld(state, a.playerId) - eggersHeld(before, a.playerId));
  }
  if (state.season !== before.season) supply.push(`S${state.season} start: ${eggersInBags(state)} eggers in the bags`);
}
supply.push(`end: ${eggersInBags(state)} eggers left undrawn`);

const scores = score(state);
console.log(`${run}/${game}: ${names.length} captains, vNotch = ${cfg.rep.vNotch} conservation per egger`);
console.log(supply.join(' | '));
console.log('captain            hauls  policy                     eggers met  notched  kept  | cons track  health  consVP  (weakest?)');
for (const [id, r] of Object.entries(rows)) {
  const p = state.players[id];
  const sc = scores.find((x: { playerId: string }) => x.playerId === id)!;
  const pol = Object.entries(r.policy).map(([k, v]) => `${k} ${v}`).join(', ');
  const weakest = Math.min(sc.moneyVP, sc.conservationVP, sc.reputationVP) === sc.conservationVP ? 'yes' : '';
  console.log(`${p.name.padEnd(18)} ${String(r.hauls).padStart(5)}  ${pol.padEnd(26)} ${String(r.notched + r.kept).padStart(10)}  ${String(r.notched).padStart(7)}  ${String(r.kept).padStart(4)}  | ${String(p.tracks.conservation).padStart(10)}  ${String(sc.conservationVP - p.tracks.conservation).padStart(6)}  ${String(sc.conservationVP).padStart(6)}  ${weakest}`);
}

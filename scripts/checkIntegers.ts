import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { score } from '../src/engine/scoring';
import { pricePerLb } from '../src/engine/market';
import { ROSTER, makeCardCounter, BOTS } from '../src/bots';

// TABLETOP GUARD: nothing a player has to track or compute may be fractional. Plays
// real games and flags any money, reputation, conservation, price or score that is
// not a whole number. This is a rule of the project (see CLAUDE.md), not a one-off.
const SEEDS = Number(process.argv[2] ?? 6);
const PLAYERS = Number(process.argv[3] ?? 4);
const bad: Record<string, Set<string>> = {};
const flag = (what: string, v: number, ctx: string) => {
  if (!Number.isInteger(v)) (bad[what] ??= new Set()).add(`${v} (${ctx})`);
};

// Both rule sets: the classic three-track game, and the light/dark switchboard (played
// by the side bots, so the heat check, bribes, the price cut and the dividend all fire).
const SIDES = ['light', 'dark', 'switch', 'dark', 'light', 'switch'];
for (const alignment of [false, true]) for (let s = 0; s < SEEDS; s++) {
  const cfg = { ...defaultConfig, players: PLAYERS, flags: { ...defaultConfig.flags, alignment } };
  let state = createInitialState(cfg, 8000 + s);
  const ids = state.turnOrder.slice();
  const pol = alignment ? SIDES.slice(0, PLAYERS).map((b) => BOTS[b]) : ROSTER.slice(0, PLAYERS).map((a) => makeCardCounter(a));
  let guard = 0;
  while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
    const pid = activePlayerId(state);
    state = reduce(state, pol[ids.indexOf(pid)](state, pid, legalActions(state, pid)));
    for (const p of Object.values(state.players)) {
      flag('money', p.money, p.name);
      flag('reputation', p.tracks.reputation, p.name);
      flag('conservation', p.tracks.conservation, p.name);
      flag('fuel', p.fuel, p.name);
      flag('alignment', p.tracks.alignment, p.name);
      flag('heat', p.tracks.heat, p.name);
    }
    for (const port of Object.keys(state.markets)) {
      flag('market price', pricePerLb(state, port, false), port);
      flag('market price (rare)', pricePerLb(state, port, true), `${port} rare`);
    }
  }
  for (const r of score(state)) {
    flag('final money VP', r.moneyVP, r.name);
    flag('final conservation VP', r.conservationVP, r.name);
    flag('final reputation VP', r.reputationVP, r.name);
    flag('FINAL SCORE', r.total, r.name);
  }
}
const keys = Object.keys(bad);
if (keys.length === 0) {
  console.log(`✓ ${SEEDS} games at ${PLAYERS}p under each rule set (classic and switchboard): every money, reputation, conservation, alignment, heat, fuel, price and score was a whole number.`);
} else {
  console.log('✗ fractional values reached the table:');
  for (const k of keys) console.log(`  ${k}: ${[...bad[k]].slice(0, 6).join(', ')}${bad[k].size > 6 ? ` … (${bad[k].size} distinct)` : ''}`);
  process.exitCode = 1;
}

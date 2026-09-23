import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import { withOverrides } from './alignArena';

// Where does each side's money come from and go? Plays the switchboard with bots and
// sums, per bot type per game, every flow the light/dark levers touch — so a gap in
// the arena's money column can be traced to a lever instead of guessed at.
// usage: npx tsx scripts/alignLedger.ts [seeds] [lineup] [key=value overrides]
const args = process.argv.slice(2);
const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 20);
const lineup = (args.find((a) => a.includes(',') && !a.includes('=')) ?? 'light,light,dark,switch,light').split(',');
const cfg = withOverrides(defaultConfig, args.filter((a) => a.includes('=')));

type Led = Record<string, number>;
const acc: Record<string, Led> = {};
const games: Record<string, number> = {};
const num = (l: string, re: RegExp) => Number(l.match(re)?.[1] ?? 0);

for (let seed = 0; seed < seeds; seed++) {
  for (let rot = 0; rot < lineup.length; rot++) {
    const seats = lineup.map((_, i) => lineup[(i + rot) % lineup.length]);
    const names = seats.map((b, i) => `${b}#${i}`);
    let s = createInitialState({ ...cfg, players: seats.length }, 9000 + seed, names);
    const ids = s.turnOrder.slice();
    for (let g = 0; s.phase !== 'GAME_OVER' && g < 300000; g++) {
      const pid = activePlayerId(s);
      s = reduce(s, BOTS[seats[ids.indexOf(pid)]](s, pid, legalActions(s, pid)));
    }
    names.forEach((n, i) => {
      const b = seats[i];
      const L = (acc[b] ??= {});
      games[b] = (games[b] ?? 0) + 1;
      const add = (k: string, v: number) => { L[k] = (L[k] ?? 0) + v; };
      for (const l of s.log) {
        if (!l.startsWith(n) && !l.includes(n)) continue;
        if (l.startsWith(`${n} hauls (`)) add('hauls', 1);
        if (l.startsWith(`${n} sells `)) { add('sales', 1); add('lbs sold', num(l, /\((\d+)lb\)/)); add('revenue', num(l, / for ([\d.]+)/)); add('price cut', num(l, /under the table: (\d+) less/)); }
        if (l.startsWith(`The warden takes `) && l.includes(`${n}'s`)) add('warden take', num(l, /takes (\d+)/));
        if (l.startsWith(`${n} pays the warden `)) add('bribes', num(l, /warden (\d+)/));
        if (l.startsWith(`${n} drops the catch`)) { add('busts', 1); add('lbs dropped', num(l, /\((\d+)lb\)/)); }
        if (l.startsWith(`${n} takes the season`) || l.startsWith(`${n} is committed to the season`)) add('licence paid', num(l, /licence at (\d+)/));
        if (l.startsWith('The co-op pays a ') && l.includes(n)) add('dividend', num(l, /pays a (\d+)/));
        if (l.startsWith(`${n} refuels `)) add('fuel units', num(l, /refuels (\d+)/));
        if (l.startsWith(`${n} refits`)) add('refit spend', num(l, /\(-(\d+) money\)/));
        if (l.startsWith(`${n} is towed`)) add('tows', 1);
        if (l.startsWith(`${n}'s heat check`)) add('checks', 1);
        if (l.includes(`${n} STEALS`)) add('steals', 1);
      }
      add('final money', s.players[ids[i]].money);
    });
  }
}
const keys = [...new Set(Object.values(acc).flatMap((l) => Object.keys(l)))];
console.log(`ledger per bot per game — lineup ${lineup.join(',')}, ${seeds} seeds × ${lineup.length} rotations`);
console.table(Object.fromEntries(keys.map((k) => [k, Object.fromEntries(Object.entries(acc).map(([b, l]) => [b, ((l[k] ?? 0) / games[b]).toFixed(1)]))])));

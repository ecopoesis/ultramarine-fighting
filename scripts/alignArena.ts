import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score, avgBagHealth } from '../src/engine/scoring';
import { bandOf } from '../src/engine/alignment';
import { BOTS } from '../src/bots';
import type { Config } from '../src/types';
import { applyOverrides } from './lib/overrides';

// THE SWITCHBOARD ARENA (SPEC §14.11). Plays light / dark / switch bots at 3–6 seats
// with flags.alignment on, rotating seats, and reports what the pass marks need:
// dark mean money above light, dark spread much wider, each side winning about its
// share of seats, forced-dark seats still winning, and the ocean holding up.
// usage: npx tsx scripts/alignArena.ts [seeds] [lineup e.g. light,light,dark,switch,light] ...
// Pass `key=value` args to override heat./alignment./closure. numbers for a sweep.

const args = process.argv.slice(2);
const seeds = Number(args.find((a) => /^\d+$/.test(a)) ?? 40);
const lineups = args.filter((a) => a.includes(',') && !a.includes('='));
const overrides = args.filter((a) => a.includes('='));

export function withOverrides(base: Config, kv: string[]): Config {
  return applyOverrides({ ...base, flags: { ...base.flags, alignment: true } }, kv);
}

interface Row { games: number; wins: number; money: number[]; busts: number; checks: number; stops: number; seaBusts: number; unlicensedS2: number; unlicSeasons: number; finalAlign: number; forcedWins: number; forcedGames: number }
const blank = (): Row => ({ games: 0, wins: 0, money: [], busts: 0, checks: 0, stops: 0, seaBusts: 0, unlicensedS2: 0, unlicSeasons: 0, finalAlign: 0, forcedWins: 0, forcedGames: 0 });

function play(cfg: Config, seed: number, seats: string[]) {
  const names = seats.map((b, i) => `${b}#${i}`);
  let s = createInitialState({ ...cfg, players: seats.length }, seed, names);
  const ids = s.turnOrder.slice();
  const unlicS2: Record<string, boolean> = {};
  const unlicSeasons: Record<string, number> = {};
  let lastSeason = 0;
  for (let g = 0; s.phase !== 'GAME_OVER' && g < 300000; g++) {
    if (s.phase === 'PLAYING' && s.season !== lastSeason) {
      lastSeason = s.season;
      for (const id of ids) if (s.players[id].licensed === false) {
        unlicSeasons[id] = (unlicSeasons[id] ?? 0) + 1;
        if (s.season === cfg.alignment.squeezeSeason) unlicS2[id] = true;
      }
    }
    const pid = activePlayerId(s);
    s = reduce(s, BOTS[seats[ids.indexOf(pid)]](s, pid, legalActions(s, pid)));
  }
  const rows = score(s);
  const busts: Record<string, number> = {};
  const checks: Record<string, number> = {};
  const stops: Record<string, number> = {};
  const seaBusts: Record<string, number> = {};
  for (const l of s.log) {
    const m = l.match(/^(\S+)'s heat check: .*?(BUSTED)?$/);
    if (m) { checks[m[1]] = (checks[m[1]] ?? 0) + 1; if (m[2]) busts[m[1]] = (busts[m[1]] ?? 0) + 1; }
    const w = l.match(/^A warden boat stops (\S+) at .*?(BUSTED)?$/);
    if (w) { stops[w[1]] = (stops[w[1]] ?? 0) + 1; if (w[2]) seaBusts[w[1]] = (seaBusts[w[1]] ?? 0) + 1; }
  }
  return { s, rows, ids, names, unlicS2, unlicSeasons, busts, checks, stops, seaBusts, health: avgBagHealth(s) };
}

const sd = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

const DEFAULT_LINEUPS = [
  'light,light,dark',
  'light,dark,switch,light',
  'light,light,dark,switch,light',
  'light,dark,light,switch,light,dark',
];

const cfg = withOverrides(defaultConfig, overrides);
if (overrides.length) console.log(`overrides: ${overrides.join(' ')}`);
for (const lu of lineups.length ? lineups : DEFAULT_LINEUPS) {
  const bots = lu.split(',');
  const byBot: Record<string, Row> = {};
  let health = 0, games = 0;
  for (let seed = 0; seed < seeds; seed++) {
    for (let rot = 0; rot < bots.length; rot++) {
      const seats = bots.map((_, i) => bots[(i + rot) % bots.length]);
      const r = play(cfg, 5000 + seed, seats);
      games++; health += r.health;
      const top = r.rows[0].total;
      const winners = r.rows.filter((x) => x.total === top).map((x) => x.playerId);
      r.ids.forEach((id, i) => {
        const b = seats[i];
        const row = (byBot[b] ??= blank());
        const money = r.rows.find((x) => x.playerId === id)!.total;
        row.games++; row.money.push(money);
        const won = winners.includes(id) ? 1 / winners.length : 0;
        row.wins += won;
        row.busts += r.busts[r.names[i]] ?? 0;
        row.checks += r.checks[r.names[i]] ?? 0;
        row.stops += r.stops[r.names[i]] ?? 0;
        row.seaBusts += r.seaBusts[r.names[i]] ?? 0;
        if (r.unlicS2[id]) row.unlicensedS2++;
        row.unlicSeasons += r.unlicSeasons[id] ?? 0;
        row.finalAlign += r.s.players[id].tracks.alignment;
        if (b === 'switch' && r.unlicS2[id]) { row.forcedGames++; row.forcedWins += won; }
      });
    }
  }
  console.log(`\n=== ${bots.length} seats: ${lu}  (${games} games, seats rotated) — ocean health ${((health / games) * 100).toFixed(0)}% ===`);
  const count: Record<string, number> = {};
  for (const b of bots) count[b] = (count[b] ?? 0) + 1;
  console.table(Object.entries(byBot).map(([b, r]) => {
    const mean = r.money.reduce((a, c) => a + c, 0) / r.money.length;
    const fair = count[b] / bots.length;
    return {
      bot: b,
      seats: count[b],
      'win share': `${((r.wins / games) * 100).toFixed(0)}% (fair ${(fair * 100).toFixed(0)}%)`,
      'money mean': mean.toFixed(0),
      'money sd': sd(r.money).toFixed(0),
      'min–max': `${Math.min(...r.money)}–${Math.max(...r.money)}`,
      'busts/game': (r.busts / r.games).toFixed(2),
      'checks/game': (r.checks / r.games).toFixed(1),
      'patrol stops': (r.stops / r.games).toFixed(2),
      'sea busts': (r.seaBusts / r.games).toFixed(2),
      'unlic S2': `${((r.unlicensedS2 / r.games) * 100).toFixed(0)}%`,
      'end align': (r.finalAlign / r.games).toFixed(1),
      ...(r.forcedGames ? { 'forced-dark win': `${((r.forcedWins / r.forcedGames) * 100).toFixed(0)}% of ${r.forcedGames}` } : {}),
    };
  }));
}

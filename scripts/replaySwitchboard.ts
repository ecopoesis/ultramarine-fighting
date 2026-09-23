import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { bandOf } from '../src/engine/alignment';
import type { Action } from '../src/actions';
import type { Config, GameState } from '../src/types';

// Replay a recorded LLM game under the switchboard and answer what the bot arena
// cannot (SPEC §14.11): did captains pick sides, did about a third go dark, did anyone
// cross — by choice or because the season-2 squeeze left them without a licence — and
// did the dark side push its luck at the counter (sell into 3+ dice) or bribe to safety?
// usage: npx tsx scripts/replaySwitchboard.ts <run> [game] [seasons]
const run = process.argv[2];
const game = process.argv[3] ?? 'r1g1';
const seasons = process.argv[4] ? Number(process.argv[4]) : undefined; // smoke games run short
const dir = `tournament/runs/${run}/games`;
const res = JSON.parse(readFileSync(`${dir}/${game}.result.json`, 'utf8'));
const names: string[] = res.seats.map((s: { captainName: string }) => s.captainName);
const archs: string[] = res.seats.map((s: { agent?: string }) => s.agent ?? '');
const cfg: Config = {
  ...defaultConfig, players: names.length, flags: { ...defaultConfig.flags, alignment: true },
  ...(seasons ? { seasons, daysSchedule: Array.from({ length: seasons }, (_, i) => (i === seasons - 1 ? 3 : 2)) } : {}),
};
let s: GameState = createInitialState(cfg, res.seed, names);
const ids = s.turnOrder.slice();
const lines = readFileSync(`${dir}/${game}.actions.jsonl`, 'utf8').split('\n').filter((l) => l.trim());

// per-captain, per-season snapshot of band + licence, taken when each season opens
const seasonRow: Record<string, string[]> = Object.fromEntries(ids.map((id) => [id, []]));
let seen = 0;
const snap = () => {
  for (const id of ids) {
    const p = s.players[id];
    seasonRow[id].push(`S${s.season} ${bandOf(s, p).name.slice(0, 3).toUpperCase()}${p.tracks.alignment >= 0 ? '+' : ''}${p.tracks.alignment}${p.licensed === false ? ' unlic' : ''}`);
  }
};
for (const l of lines) {
  s = reduce(s, JSON.parse(l) as Action);
  if (s.phase === 'PLAYING' && s.season > seen) { seen = s.season; snap(); }
}
const endSnap = ids.map((id) => `END ${bandOf(s, s.players[id]).name.slice(0, 3).toUpperCase()}${s.players[id].tracks.alignment >= 0 ? '+' : ''}${s.players[id].tracks.alignment}`);

const num = (l: string, re: RegExp) => Number(l.match(re)?.[1] ?? 0);
console.log(`${run}/${game}: ${names.length} captains, switchboard replay (${lines.length} actions)${s.phase === 'GAME_OVER' ? '' : ' — GAME NOT FINISHED'}\n`);
const rows = ids.map((id, i) => {
  const n = s.players[id].name;
  const L = s.log;
  const mine = (pfx: string) => L.filter((l) => l.startsWith(`${n}${pfx}`));
  const checks = mine("'s heat check");
  const dice = checks.map((l) => num(l, /check: (\d+) di/));
  const saleDice = dice.length ? dice.map((d) => `${d}`).join('') : '-';
  return {
    captain: `${n} (${archs[i]})`,
    'money': s.players[id].money,
    'band by season': [...seasonRow[id], endSnap[i]].join(' → '),
    'lic: chose/squeezed/passed': `${mine(' takes the season').length + mine(' is committed to').length}/${L.filter((l) => l.startsWith(`No licence left for ${n} `)).length}/${mine(' passes on the licence').length}`,
    'kept illegal': mine(' steps darker (kept illegal catch)').length,
    'notch steps': mine(' steps lighter (notched').length,
    'dice at each check': saleDice,
    'sold into 3+ dice': dice.filter((d) => d >= 3).length,
    busts: mine(' drops the catch').length,
    'warden bribes': mine(' pays the warden').length,
    'closed-water hauls': L.filter((l) => l.startsWith(`${n}'s heat rises`) && l.includes('hauled closed')).length,
    'black market': mine(' refits').filter((l) => /Illegal net|Cheap engine/.test(l)).length,
    'harbour bribes': mine(' bribes the harbourmaster').length,
    steals: mine(' STEALS').length,
    'price cut': mine(' sells ').reduce((a, l) => a + num(l, /under the table: (\d+) less/), 0),
  };
});
console.table(rows);
const dark = ids.filter((id) => s.players[id].tracks.alignment <= -3).length;
console.log(`\nEnded dark (Shady or Outlaw): ${dark} of ${ids.length}. Ocean health at the end: ${Math.round((Object.values(s.bags).reduce((a, b) => a + b.length, 0) / Object.values(s.bagStart).reduce((a, b) => a + b, 0)) * 100)}% (tiles left overall).`);

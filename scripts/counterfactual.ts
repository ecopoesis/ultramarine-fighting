import { readFileSync } from 'node:fs';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { avgBagHealth } from '../src/engine/scoring';
import type { Action } from '../src/actions';
import type { Config, GameState } from '../src/types';
import { applyOverrides } from './lib/overrides';
import { setChanceHooks } from '../src/rng';
import type { Stream } from '../src/rng';

// THE COUNTERFACTUAL REPLAY. Take a recorded LLM game — real captains' real choices —
// and play it again under different rules, to see what the rules alone change.
//
// Why: the bot arena can't supply realistic PRESSURE. Bots leave the ocean at 65-75%;
// Opus captains strip it to 6-21%. Tuning recovery against bots tunes it for an ocean
// nobody is fishing hard. Here the captains' decisions are held fixed and only the
// rules move, so recovery settings are judged under the fishing that actually happens.
//
// How: the game is first replayed under the rules it was played by, tagging every
// action with its (season, day). Then each captain gets a queue of their own actions,
// and the counterfactual feeds them in on the captain's turns: an action tagged for
// today is applied if it is still legal (skipped if the new rules made it impossible),
// a captain whose next action is tagged for a later day passes, and actions left over
// from a day already gone are dropped. FIDELITY is the share of recorded actions that
// still applied — the further a rule change pushes the game, the lower it goes.
//
// A different rule also changes every random draw after it, so each setting is run
// under several SALTS (perturbed RNG seeds) and averaged. Salt 0 under the original
// rules must reproduce the recorded game exactly (fidelity 100%) — the self-check.
//
// What it cannot show: how captains would REACT to the new rule. That still needs one
// LLM game, to confirm a setting chosen here.
//
// usage: npx tsx scripts/counterfactual.ts [--runs opus16,opus17,opus18] [--salts 5]
//          [--as-played k=v,...] ["name:k=v;k=v" ...]
// With no named settings it runs the built-in restock grid.

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const runs = opt('runs', 'opus16,opus17,opus18').split(',');
const salts = Number(opt('salts', '5'));
// The rules the recorded games were played under, relative to today's config.
const asPlayed = opt('as-played', 'breeding.mode="notches",rngStreams=false,heat.capCheck=false').split(',').filter(Boolean);
// Every compared setting shares these: each kind of chance on its own random stream, and
// otherwise the rules as played.
const common = ['rngStreams=true', 'heat.capCheck=false'];
const named = argv.filter((a) => /^[^-][^:]*:/.test(a) && !argv[argv.indexOf(a) - 1]?.startsWith('--'));

const GRID: Record<string, string[]> = {
  'notches (the old rule)': [...common, 'breeding.mode="notches"'],
  'breeders, bands as now': [...common, 'breeding.mode="breeders"'],
  'breeders, die 0-1-1-1-2-2': [...common, 'breeding.mode="breeders"', 'breeding.dieFaces=[0,1,1,1,2,2]'],
  'breeders, die 1-1-1-2-2-3': [...common, 'breeding.mode="breeders"', 'breeding.dieFaces=[1,1,1,2,2,3]'],
  'breeders, 1 die per 3': [...common, 'breeding.mode="breeders"', 'breeding.diceByStock=[{"atLeast":24,"dice":8},{"atLeast":21,"dice":7},{"atLeast":18,"dice":6},{"atLeast":15,"dice":5},{"atLeast":12,"dice":4},{"atLeast":9,"dice":3},{"atLeast":6,"dice":2},{"atLeast":3,"dice":1},{"atLeast":0,"dice":0}]'],
};
const settings: Record<string, string[]> = named.length
  ? Object.fromEntries(named.map((n) => { const [name, rest] = [n.slice(0, n.indexOf(':')), n.slice(n.indexOf(':') + 1)]; return [name, [...common, ...rest.split(';').filter(Boolean)]]; }))
  : GRID;

interface Tagged { a: Action; season: number; day: number; auction: boolean; potId?: string } // potId: the pot a recorded DROP created

function load(run: string) {
  const dir = `tournament/runs/${run}/games`;
  const res = JSON.parse(readFileSync(`${dir}/r1g1.result.json`, 'utf8'));
  const names: string[] = res.seats.map((s: { captainName: string }) => s.captainName);
  const actions = readFileSync(`${dir}/r1g1.actions.jsonl`, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Action);
  // Tag each action with when it happened, under the rules the game was played by.
  const cfg = applyOverrides({ ...defaultConfig, players: names.length }, asPlayed);
  // ...and record every chance it drew, by kind, in order: the storms, patrols, draws and
  // dice the captains actually saw.
  const chance: Record<string, number[]> = {};
  setChanceHooks((stream, v) => (chance[stream] ??= []).push(v), null);
  let s = createInitialState(cfg, res.seed, names);
  const tagged: Tagged[] = [];
  for (const a of actions) { tagged.push({ a, season: s.season, day: s.day, auction: s.phase === 'AUCTION', ...(a.type === 'DROP' ? { potId: `b${s.buoyCounter}` } : {}) }); s = reduce(s, a); }
  setChanceHooks(null, null);
  return { names, seed: res.seed as number, tagged, chance };
}

const same = (x: Action, y: Action): boolean => {
  if (x.type !== y.type) return false;
  const k = (a: Action) => JSON.stringify([(a as { to?: string }).to, (a as { buoyId?: string }).buoyId, (a as { upgradeId?: string }).upgradeId, (a as { ownerId?: string }).ownerId]);
  return k(x) === k(y);
};
const later = (t: Tagged, s: GameState) => t.season > s.season || (t.season === s.season && t.day > s.day);
const earlier = (t: Tagged, s: GameState) => t.season < s.season || (t.season === s.season && t.day < s.day);

export const dropped: Record<string, number> = {};
interface Outcome { haulFidelity: number; fidelity: number; healthBySeason: number[]; final: number; spawned: number; dry: number; light: number[]; dark: number[]; breedersEnd: number }

function counterfactual(g: ReturnType<typeof load>, overrides: string[], salt: number, replayChance = true): Outcome {
  const cfg: Config = applyOverrides({ ...defaultConfig, players: g.names.length }, overrides);
  // COMMON RANDOM NUMBERS: every kind of chance replays what the recorded game drew, in
  // order — except the breeding dice, the thing under test, which roll fresh (salted).
  // A kind that needs more values than were recorded falls back to its own stream.
  const cursor: Record<string, number> = {};
  setChanceHooks(null, (stream: Stream) => {
    if (!replayChance || stream === 'breeding') return undefined;
    const rec = g.chance[stream];
    const i = cursor[stream] ?? 0;
    if (!rec || i >= rec.length) return undefined;
    cursor[stream] = i + 1;
    return rec[i];
  });
  let s = createInitialState(cfg, g.seed, g.names);
  // A salt varies only the breeding dice (their own stream): storms, patrols and draws stay put.
  if (salt) s = { ...s, rngStreams: { ...s.rngStreams, breeding: ((s.rngStreams?.breeding ?? 0) ^ Math.imul(salt, 0x9e3779b9)) | 0 } };
  const queues: Record<string, Tagged[]> = {};
  for (const t of g.tagged) (queues[t.a.playerId] ??= []).push(t);
  let applied = 0;
  let haulsApplied = 0;
  // Pots are numbered by a global counter, so one skipped DROP renumbers every pot after
  // it. Map each recorded pot to the pot its DROP made here, and translate hauls through it.
  const potMap: Record<string, string> = {};
  const translate = (a: Action): Action => ((a.type === 'HAUL' || a.type === 'STEAL') && potMap[a.buoyId] ? { ...a, buoyId: potMap[a.buoyId] } : a);
  const haulsRecorded = g.tagged.filter((t) => t.a.type === 'HAUL').length;
  const healthBySeason: number[] = [];
  let season = s.season;
  for (let guard = 0; s.phase !== 'GAME_OVER' && guard < 20000; guard++) {
    let pid: string;
    if (s.phase === 'AUCTION') {
      const au = s.auction!;
      pid = au.revealed ? au.optionOrder[au.optionTurn] : au.bidOrder[au.bidTurn];
    } else pid = activePlayerId(s);
    const q = queues[pid] ?? [];
    // drop what belongs to a day (or an auction) already gone
    while (q.length && (earlier(q[0], s) || (q[0].auction && s.phase !== 'AUCTION' && q[0].season <= s.season))) q.shift();
    let next: Action | undefined;
    if (s.phase === 'AUCTION') {
      const i = q.findIndex((t) => t.auction && t.season === s.season && (s.auction!.revealed ? t.a.type === 'LICENSE_BUY' : t.a.type === 'LICENSE_BID'));
      if (i >= 0) { next = q[i].a; q.splice(i, 1); applied++; }
      else next = s.auction!.revealed ? { type: 'LICENSE_BUY', playerId: pid, take: false } : { type: 'LICENSE_BID', playerId: pid, amount: 0 };
    } else {
      const legal = legalActions(s, pid);
      while (q.length && !later(q[0], s) && !q[0].auction) {
        const t = q.shift()!;
        const want = translate(t.a);
        const match = legal.find((l) => same(l, want));
        if (!match && process.env.CF_DEBUG && process.env.CF_WHY === t.a.type) console.log(`drop ${t.a.type} S${t.season}D${t.day} ${t.a.playerId}@${s.players[t.a.playerId].node} hold ${s.players[t.a.playerId].hold.length} berthed ${s.players[t.a.playerId].berthed} ${JSON.stringify(t.a).slice(0, 90)}`);
        if (!match && process.env.CF_DEBUG) dropped[`${t.a.type} S${t.season}`] = (dropped[`${t.a.type} S${t.season}`] ?? 0) + 1;
        if (match) {
          next = want.type === 'REFUEL' ? { ...want, units: Math.min(want.units, (match as { units: number }).units) } : want;
          if (t.a.type === 'DROP' && t.potId) potMap[t.potId] = `b${s.buoyCounter}`;
          applied++;
          if (t.a.type === 'HAUL') haulsApplied++;
          break;
        }
      }
      next ??= { type: 'PASS', playerId: pid };
    }
    try { s = reduce(s, next); } catch { s = reduce(s, { type: 'PASS', playerId: pid } as Action); }
    if (s.season !== season) { healthBySeason.push(avgBagHealth(s)); season = s.season; }
  }
  setChanceHooks(null, null);
  const spawnLines = s.log.filter((l) => l.startsWith('--- Breeding stock spawns.'));
  const spawned = spawnLines.reduce((a, l) => a + [...l.matchAll(/→ (\d+) back/g)].reduce((x, m) => x + Number(m[1]), 0), 0);
  const dry = spawnLines.reduce((a, l) => a + (l.match(/pile ran dry/g)?.length ?? 0), 0);
  const darkMin = cfg.alignment.bands.find((b) => b.name === 'shady')!.atLeast;
  const light: number[] = [], dark: number[] = [];
  for (const p of Object.values(s.players)) (p.tracks.alignment <= darkMin ? dark : light).push(p.money);
  return { haulFidelity: haulsApplied / Math.max(1, haulsRecorded), fidelity: applied / g.tagged.length, healthBySeason, final: avgBagHealth(s), spawned, dry, light, dark, breedersEnd: Object.values(s.breeders ?? {}).reduce((a, b) => a + b, 0) };
}

const games = runs.map(load);
if (process.env.CF_DEBUG) {
  const g = games[0];
  for (const [name, kv] of [['notches', [...common, 'breeding.mode="notches"']], ['breeders', [...common, 'breeding.mode="breeders"']]] as [string, string[]][]) {
    for (const k of Object.keys(dropped)) delete dropped[k];
    const o = counterfactual(g, kv, 0);
    console.log(name, 'fidelity', (o.fidelity * 100).toFixed(1), 'final', (o.final * 100).toFixed(0), JSON.stringify(dropped));
  }
  process.exit(0);
}
// Self-check: the rules as played, unsalted, must reproduce every recorded game exactly.
for (const [i, g] of games.entries()) {
  const o = counterfactual(g, asPlayed, 0, false);
  if (o.fidelity < 0.999) console.log(`WARNING: ${runs[i]} does not replay exactly under --as-played (${(o.fidelity * 100).toFixed(1)}%). Its results are approximate.`);
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
console.log(`Counterfactual replay of ${runs.join(', ')} × ${salts} salts. The captains' choices are fixed; only the rules change.\n`);
const rows = Object.entries(settings).map(([name, kv]) => {
  const outs: Outcome[] = [];
  for (const g of games) for (let salt = 1; salt <= salts; salt++) outs.push(counterfactual(g, kv, salt));
  const bySeason = [0, 1, 2, 3].map((i) => mean(outs.map((o) => o.healthBySeason[i]).filter((x) => x !== undefined)));
  return {
    setting: name,
    'health after S1/S2/S3/S4': bySeason.map(pct).join(' / '),
    'final health': pct(mean(outs.map((o) => o.final))),
    'spawned/game': mean(outs.map((o) => o.spawned)).toFixed(0),
    'trap ran dry': mean(outs.map((o) => o.dry)).toFixed(1),
    'breeders left': mean(outs.map((o) => o.breedersEnd)).toFixed(0),
    'light $': mean(outs.flatMap((o) => o.light)).toFixed(0),
    'dark $': mean(outs.flatMap((o) => o.dark)).toFixed(0),
    fidelity: pct(mean(outs.map((o) => o.fidelity))),
    'hauls kept': pct(mean(outs.map((o) => o.haulFidelity))),
  };
});
console.table(rows);

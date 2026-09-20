import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../types';
import { LlmCaptain, type CaptainSpec, type GameRecord } from './agent';
import { runLlmGame, type GameResult } from './game';
import { LLM_ARCHETYPES } from './archetypes';
import type { AskOptions } from './claude';

// The TOURNAMENT: every archetype × every model is one captain. Rounds of
// concurrent tables (sizes ~N(4,1) clamped 2..6); pairing is Swiss-style after
// round 1 (similar standing meets similar standing, rematches avoided), then a
// FINAL among the top captains. Everything is persisted under runs/<id>/ so a
// stopped run resumes exactly where it left off (games mid-play included).

export interface TournamentOptions {
  runId: string;
  rootDir: string;               // tournament/runs
  rounds: number;
  finalSize: number;
  effort: AskOptions['effort'];
  models: Record<string, string>; // label -> model id, e.g. { fable: 'claude-fable-5-1', opus: 'claude-opus-5' }
  archetypes: string[];
  meanPlayers: number;
  sdPlayers: number;
  seed: number;
  skipFinal?: boolean; // run the rounds only — for a single measurement game
  config: Config;
  log?: (line: string) => void;
}

interface AgentState { name: string; archetypeId: string; modelLabel: string; model: string; journal: string[]; record: GameRecord[] }
interface GameEntry { id: string; round: number; seed: number; agents: string[]; names: string[]; status: 'pending' | 'running' | 'done' | 'error'; error?: string; result?: GameResult }
interface RunState {
  runId: string; createdAt: string; options: Omit<TournamentOptions, 'config' | 'log' | 'rootDir'>;
  agents: Record<string, AgentState>;
  rounds: { round: number; games: GameEntry[] }[];
  final?: GameEntry;
  finished?: boolean;
}

const BOAT_NAMES = ['Bluefin', 'Sea Witch', 'Ellie Mae', 'Northern Light', 'Grey Gull', 'Miss Penobscot', 'Reliance', 'Salty Dog', 'Kestrel', 'Whistler', 'Osprey', 'Fair Wind', 'Black Duck', 'Merganser', 'Tern', 'Halcyon', 'Persistence', 'Wanderer', 'Two Bush', 'Ledge Runner'];

// seeded RNG for the schedule (mulberry32)
function rng(seed: number) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(r: () => number): number {
  const u = 1 - r(); const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
function shuffle<T>(arr: T[], r: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Table sizes for `n` agents: draw from N(mean, sd) clamped to [2,6] until all seated.
export function tableSizes(n: number, mean: number, sd: number, r: () => number): number[] {
  if (n < 2) return n === 1 ? [1] : [];
  const sizes: number[] = [];
  let left = n;
  while (left > 0) {
    if (left <= 6) {
      if (left >= 2) { sizes.push(left); break; }
      // a lone remainder: fold into the smallest table that can take it, else split
      const i = sizes.findIndex((s) => s < 6);
      if (i >= 0) { sizes[i] += 1; break; }
      sizes[sizes.length - 1] -= 1; sizes.push(2); break;
    }
    let s = Math.round(mean + sd * gaussian(r));
    s = Math.max(2, Math.min(6, s));
    if (left - s === 1) s = Math.min(6, s + 1); // never strand one agent
    sizes.push(s);
    left -= s;
  }
  return sizes;
}

// Rank points for a table of n: 1 for first, 0 for last, ties share.
function points(rows: { playerId: string; total: number }[], pid: string): { rank: number; pts: number } {
  const me = rows.find((r) => r.playerId === pid)!;
  const higher = rows.filter((r) => r.total > me.total).length;
  const equal = rows.filter((r) => r.total === me.total).length;
  const n = rows.length;
  if (n === 1) return { rank: 1, pts: 1 };
  const avgRank = higher + (equal + 1) / 2; // 1-based mean rank across the tie
  return { rank: higher + 1, pts: (n - avgRank) / (n - 1) };
}

// Round-robin standings: the final (round > rounds) is excluded so every captain
// is ranked over the same kind of sample.
export function standings(run: RunState): { name: string; games: number; pts: number; avgPts: number; avgTotal: number; wins: number }[] {
  const out = Object.values(run.agents).map((a) => {
    const recs = a.record.filter((g) => (g.round ?? 0) <= run.options.rounds);
    const games = recs.length;
    let pts = 0; let total = 0; let wins = 0;
    for (const g of recs) {
      const gEntry = findGame(run, g.gameId);
      const rows = gEntry?.result?.rows ?? [];
      const pid = gEntry?.result?.seats.find((s) => s.agent === a.name)?.pid;
      const p = pid ? points(rows, pid) : { rank: g.rank, pts: 0 };
      pts += p.pts; total += g.total; if (p.rank === 1) wins++;
    }
    return { name: a.name, games, pts, avgPts: games ? pts / games : 0, avgTotal: games ? total / games : 0, wins };
  });
  return out.sort((x, y) => y.avgPts - x.avgPts || y.avgTotal - x.avgTotal || x.name.localeCompare(y.name));
}

function findGame(run: RunState, id: string): GameEntry | undefined {
  for (const r of run.rounds) for (const g of r.games) if (g.id === id) return g;
  return run.final?.id === id ? run.final : undefined;
}

function meetings(run: RunState): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {};
  const bump = (a: string, b: string) => { (m[a] ??= {})[b] = ((m[a] ??= {})[b] ?? 0) + 1; };
  for (const r of run.rounds) for (const g of r.games) if (g.status === 'done') for (const a of g.agents) for (const b of g.agents) if (a !== b) bump(a, b);
  return m;
}

// Swiss-style seating: pool sorted by standing (jittered), fill each table from the
// top, preferring (within a window) the candidates who have met the seated least.
function seatRound(run: RunState, round: number, r: () => number, opts: TournamentOptions): GameEntry[] {
  const names = Object.keys(run.agents);
  const sizes = tableSizes(names.length, opts.meanPlayers, opts.sdPlayers, r);
  let pool: string[];
  if (round === 1) pool = shuffle(names, r);
  else {
    const st = standings(run);
    pool = st.map((s) => ({ n: s.name, k: s.avgPts + (r() - 0.5) * 0.15 })).sort((a, b) => b.k - a.k).map((x) => x.n);
  }
  const met = meetings(run);
  const games: GameEntry[] = [];
  const boats = shuffle(BOAT_NAMES, r);
  let bi = 0;
  sizes.forEach((size, ti) => {
    const seated: string[] = [pool.shift()!];
    while (seated.length < size && pool.length) {
      const window = pool.slice(0, Math.min(pool.length, 6));
      let best = window[0]; let bestScore = Infinity;
      for (const cand of window) {
        const s = seated.reduce((acc, x) => acc + (met[x]?.[cand] ?? 0), 0) + (run.agents[cand].archetypeId === run.agents[seated[0]].archetypeId ? 0.5 : 0);
        if (s < bestScore) { bestScore = s; best = cand; }
      }
      pool.splice(pool.indexOf(best), 1);
      seated.push(best);
    }
    const agents = shuffle(seated, r); // seat order = initial turn order
    const gameNames = agents.map(() => boats[bi++ % boats.length]);
    games.push({ id: `r${round}g${ti + 1}`, round, seed: Math.floor(r() * 1e9), agents, names: gameNames, status: 'pending' });
  });
  return games;
}

export class Tournament {
  run: RunState;
  dir: string;
  gamesDir: string;
  cwd: string;
  captains: Record<string, LlmCaptain> = {};
  log: (line: string) => void;

  constructor(public opts: TournamentOptions) {
    this.dir = join(opts.rootDir, opts.runId);
    this.gamesDir = join(this.dir, 'games');
    this.cwd = join(this.dir, 'sessions-cwd');
    mkdirSync(this.gamesDir, { recursive: true });
    mkdirSync(this.cwd, { recursive: true });
    mkdirSync(join(this.dir, 'agents'), { recursive: true });
    this.log = opts.log ?? ((l) => { console.log(l); });
    const nAgents = opts.archetypes.length * Math.max(1, Object.keys(opts.models).length);
    if (nAgents > BOAT_NAMES.length) throw new Error(`${nAgents} captains but only ${BOAT_NAMES.length} boat names (names must be unique within a round)`);
    const runFile = join(this.dir, 'run.json');
    if (existsSync(runFile)) {
      this.run = JSON.parse(readFileSync(runFile, 'utf8'));
      this.log(`resuming run ${opts.runId}: ${this.run.rounds.length} round(s) scheduled, ${Object.keys(this.run.agents).length} captains`);
    } else {
      const agents: Record<string, AgentState> = {};
      for (const archId of opts.archetypes) {
        if (!LLM_ARCHETYPES.some((a) => a.id === archId)) throw new Error(`unknown archetype ${archId}`);
        for (const [label, model] of Object.entries(opts.models)) {
          const name = `${archId}-${label}`;
          agents[name] = { name, archetypeId: archId, modelLabel: label, model, journal: [], record: [] };
        }
      }
      const { config: _c, log: _l, rootDir: _r, ...rest } = opts;
      this.run = { runId: opts.runId, createdAt: new Date().toISOString(), options: rest, agents, rounds: [] };
      this.save();
    }
    for (const a of Object.values(this.run.agents)) {
      const spec: CaptainSpec = { name: a.name, archetypeId: a.archetypeId, model: a.model, effort: opts.effort, cwd: this.cwd };
      this.captains[a.name] = new LlmCaptain(spec, a.journal, a.record);
    }
  }

  save(): void {
    writeFileSync(join(this.dir, 'run.json'), JSON.stringify(this.run, null, 2));
  }

  private async playGame(g: GameEntry): Promise<void> {
    g.status = 'running'; this.save();
    const seats = g.agents.map((name, i) => ({ captain: this.captains[name], captainName: g.names[i] }));
    try {
      const res = await runLlmGame({ id: g.id, seed: g.seed, seats }, { config: this.opts.config, dir: this.gamesDir, log: this.log });
      g.result = res; g.status = 'done';
      for (const s of res.seats) {
        const a = this.run.agents[s.agent];
        a.record.push({ gameId: g.id, round: g.round, players: res.seats.length, rank: s.rank, total: s.total, captainName: s.captainName });
        const j = res.journals[s.agent];
        if (j) {
          a.journal.push(`(after ${g.id}, ${res.seats.length}-player table, finished ${s.rank}/${res.seats.length}) ${j}`);
          appendFileSync(join(this.dir, 'agents', `${s.agent}.md`), `\n## ${g.id} — ${res.seats.length} players, rank ${s.rank}, total ${s.total}\n\n${j}\n`);
        }
      }
      this.log(`[${g.id}] DONE: ${res.rows.map((r, i) => `${i + 1}. ${r.name} (${res.seats.find((s) => s.pid === r.playerId)!.agent}) ${r.total}`).join(' | ')} — health ${(res.health * 100).toFixed(0)}%, ${res.actions} actions`);
    } catch (e) {
      g.status = 'error'; g.error = String(e).slice(0, 1000);
      this.log(`[${g.id}] ERROR: ${g.error}`);
    }
    this.save();
  }

  async play(): Promise<void> {
    for (let round = 1; round <= this.opts.rounds; round++) {
      let entry = this.run.rounds.find((x) => x.round === round);
      if (!entry) {
        // burn the RNG deterministically per round so a resume reproduces the schedule
        const rr = rng(this.opts.seed + round * 7919);
        entry = { round, games: seatRound(this.run, round, rr, this.opts) };
        this.run.rounds.push(entry); this.save();
        this.log(`round ${round}: ${entry.games.map((g) => `${g.id}[${g.agents.join(',')}]`).join('  ')}`);
      }
      const todo = entry.games.filter((g) => g.status !== 'done');
      if (todo.length) {
        for (const g of todo) if (g.status === 'error') { g.status = 'pending'; g.error = undefined; }
        await Promise.all(todo.map((g) => this.playGame(g)));
      }
      const errored = entry.games.filter((g) => g.status === 'error');
      if (errored.length) throw new Error(`round ${round}: ${errored.length} game(s) errored — fix and re-run to resume (${errored.map((g) => g.id).join(', ')})`);
      this.printStandings(`after round ${round}`);
    }
    if (this.opts.skipFinal) { this.run.finished = true; this.save(); this.printStandings('STANDINGS (no final)'); return; }
    // FINAL
    if (!this.run.final) {
      const top = standings(this.run).slice(0, this.opts.finalSize).map((s) => s.name);
      const rr = rng(this.opts.seed + 104729);
      const agents = shuffle(top, rr);
      const boats = shuffle(BOAT_NAMES, rr);
      this.run.final = { id: 'final', round: this.opts.rounds + 1, seed: Math.floor(rr() * 1e9), agents, names: agents.map((_, i) => boats[i]), status: 'pending' };
      this.save();
      this.log(`FINAL: ${agents.join(' vs ')}`);
    }
    const fin = this.run.final;
    if (fin.status !== 'done') {
      if (fin.status === 'error') { fin.status = 'pending'; fin.error = undefined; }
      await this.playGame(fin);
      if ((fin.status as string) === 'error') throw new Error(`final errored: ${fin.error}`);
    }
    this.run.finished = true; this.save();
    this.printStandings('FINAL STANDINGS (round robin)');
  }

  printStandings(title: string): void {
    const st = standings(this.run);
    this.log(`\n=== ${title} ===`);
    st.forEach((s, i) => this.log(`${String(i + 1).padStart(2)}. ${s.name.padEnd(22)} games ${s.games}  avgPts ${s.avgPts.toFixed(3)}  avgVP ${s.avgTotal.toFixed(1)}  wins ${s.wins}`));
  }

  // A markdown report of the whole run: standings, model × archetype, every game.
  report(): string {
    const run = this.run;
    const st = standings(run);
    const L: string[] = [];
    L.push(`# Lobsters LLM tournament — run ${run.runId}`);
    L.push(`Created ${run.createdAt}. ${Object.keys(run.agents).length} captains (${run.options.archetypes.length} archetypes × ${Object.keys(run.options.models).join('/')}), ${run.rounds.length} round(s), effort ${run.options.effort}.`);
    L.push('');
    L.push('## Standings (round robin)');
    L.push('| # | captain | games | avg rank-points | avg VP | wins |');
    L.push('|---|---|---|---|---|---|');
    st.forEach((s, i) => L.push(`| ${i + 1} | ${s.name} | ${s.games} | ${s.avgPts.toFixed(3)} | ${s.avgTotal.toFixed(1)} | ${s.wins} |`));
    L.push('');
    // archetype × model
    L.push('## Archetype × model (avg rank-points)');
    const labels = Object.keys(run.options.models);
    L.push(`| archetype | ${labels.join(' | ')} | mean |`);
    L.push(`|---|${labels.map(() => '---').join('|')}|---|`);
    for (const arch of run.options.archetypes) {
      const cells = labels.map((l) => st.find((s) => s.name === `${arch}-${l}`)?.avgPts ?? 0);
      L.push(`| ${arch} | ${cells.map((c) => c.toFixed(3)).join(' | ')} | ${(cells.reduce((a, b) => a + b, 0) / cells.length).toFixed(3)} |`);
    }
    L.push('');
    // track profile per archetype
    L.push('## Track profile per archetype (mean VP across all its games)');
    L.push('| archetype | money | conservation | reputation | total | games |');
    L.push('|---|---|---|---|---|---|');
    for (const arch of run.options.archetypes) {
      let m = 0, c = 0, rp = 0, t = 0, n = 0;
      for (const rd of run.rounds) for (const g of rd.games) if (g.result) for (const s of g.result.seats) if (run.agents[s.agent]?.archetypeId === arch) {
        const row = g.result.rows.find((x) => x.playerId === s.pid)!;
        m += row.moneyVP; c += row.conservationVP; rp += row.reputationVP; t += row.total; n++;
      }
      if (n) L.push(`| ${arch} | ${(m / n).toFixed(1)} | ${(c / n).toFixed(1)} | ${(rp / n).toFixed(1)} | ${(t / n).toFixed(1)} | ${n} |`);
    }
    L.push('');
    if (run.final?.result) {
      const f = run.final.result;
      L.push('## FINAL');
      L.push(`Seed ${f.seed}, commons health ${(f.health * 100).toFixed(0)}%.`);
      f.rows.forEach((r, i) => L.push(`${i + 1}. **${r.name}** (${f.seats.find((s) => s.pid === r.playerId)!.agent}) — ${r.total} (money ${r.moneyVP}, conservation ${r.conservationVP}, reputation ${r.reputationVP})`));
      L.push('');
    }
    L.push('## Games');
    const all = [...run.rounds.flatMap((r) => r.games), ...(run.final ? [run.final] : [])];
    for (const g of all) {
      if (!g.result) { L.push(`- ${g.id}: ${g.status}${g.error ? ` — ${g.error}` : ''}`); continue; }
      const res = g.result;
      const cost = res.seats.reduce((s, x) => s + x.costUsd, 0); // NB unreliable — see claude.ts
      L.push(`- **${g.id}** (${res.seats.length}p, seed ${res.seed}, health ${(res.health * 100).toFixed(0)}%, ${res.actions} actions, ${res.seats.reduce((s, x) => s + x.calls, 0)} model calls, list-cost $${cost.toFixed(0)}): ${res.rows.map((r, i) => `${i + 1}. ${r.name}/${res.seats.find((s) => s.pid === r.playerId)!.agent} ${r.total}`).join('; ')}`);
    }
    return L.join('\n');
  }
}

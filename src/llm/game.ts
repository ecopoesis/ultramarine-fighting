import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { Config, GameState } from '../types';
import type { Action } from '../actions';
import { legalActions } from '../actions';
import { reduce } from '../reducer';
import { createInitialState } from '../state';
import { activePlayerId } from '../selectors';
import { score, avgBagHealth, type ScoreBreakdown } from '../engine/scoring';
import { LlmCaptain, type CaptainRuntime, type DecisionTrace } from './agent';

// One LLM game: an async driver over the pure engine. Everything needed to RESUME a
// crashed game is persisted after every action — the action transcript (replayed
// from the seed to rebuild state deterministically) and each captain's runtime
// (session id, queued plan, log cursor).

export interface GameSeat { captain: LlmCaptain; captainName: string }
export interface GameSpec { id: string; seed: number; seats: GameSeat[] }
export interface GameResult {
  id: string; seed: number; rows: ScoreBreakdown[]; health: number;
  seats: { pid: string; captainName: string; agent: string; rank: number; total: number; calls: number; costUsd: number; invalid: number }[];
  actions: number; journals: Record<string, string>;
}

interface Persisted { seed: number; players: string[]; configHash: string; captains: Record<string, CaptainRuntime>; done?: boolean }
const hashConfig = (c: Config) => createHash('sha1').update(JSON.stringify(c)).digest('hex').slice(0, 12);

export interface RunGameOptions {
  config: Config; dir: string; log?: (line: string) => void; maxActions?: number;
}

export async function runLlmGame(spec: GameSpec, opts: RunGameOptions): Promise<GameResult> {
  const dir = opts.dir;
  mkdirSync(dir, { recursive: true });
  const stateFile = join(dir, `${spec.id}.captains.json`);
  const actionsFile = join(dir, `${spec.id}.actions.jsonl`);
  const traceFile = join(dir, `${spec.id}.trace.jsonl`);
  const logFile = join(dir, `${spec.id}.log`);
  const log = opts.log ?? (() => {});

  const names = spec.seats.map((s) => s.captainName);
  const config: Config = { ...opts.config, players: spec.seats.length };
  let state = createInitialState(config, spec.seed, names);
  const ids = state.turnOrder.slice();
  const byPid: Record<string, LlmCaptain> = {};
  ids.forEach((pid, i) => { byPid[pid] = spec.seats[i].captain; });

  // Resume: replay the transcript and restore captain runtimes. The transcript is
  // the source of truth (the captains file may lag it by one action on a crash).
  let persisted: Persisted = { seed: spec.seed, players: names, configHash: hashConfig(config), captains: {} };
  let replayed = 0;
  if (existsSync(actionsFile)) {
    if (existsSync(stateFile)) persisted = { ...persisted, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
    if (persisted.seed !== spec.seed || persisted.players.join('|') !== names.join('|')) throw new Error(`${spec.id}: transcript is for a different game (seed/seats changed)`);
    if (persisted.configHash !== hashConfig(config)) throw new Error(`${spec.id}: config changed since this game started (${persisted.configHash} → ${hashConfig(config)}); cannot replay. Use a new run id.`);
    for (const line of readFileSync(actionsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const a = JSON.parse(line) as Action;
      state = reduce(state, a);
      replayed++;
    }
    log(`[${spec.id}] resumed: replayed ${replayed} actions → S${state.season} D${state.day} H${state.hour} ${state.phase}`);
  }
  let loggedLines = 0;
  const flushLog = () => {
    if (state.log.length > loggedLines) {
      appendFileSync(logFile, state.log.slice(loggedLines).join('\n') + '\n');
      loggedLines = state.log.length;
    }
  };
  if (replayed) loggedLines = state.log.length; // don't re-append replayed history
  else { writeFileSync(actionsFile, ''); writeFileSync(traceFile, ''); writeFileSync(logFile, ''); } // a fresh game starts clean files

  ids.forEach((pid, i) => {
    const c = byPid[pid];
    c.prepareGame(state, names[i], persisted.captains[pid]);
    writeFileSync(join(dir, `${spec.id}.${c.spec.name}.system.md`), c.systemPrompt); // auditable: rules + archetype + journal this captain played with
    c.onTrace = (t: DecisionTrace) => {
      appendFileSync(traceFile, JSON.stringify({ ...t, agent: c.spec.name }) + '\n');
      if (t.asked && t.reply) {
        appendFileSync(logFile, `  [${names[i]} / ${c.spec.name}] plan: ${t.reply.plan.join(' ; ')} — ${t.reply.note}\n`);
        log(`[${spec.id} S${t.season}D${t.day}H${t.hour}] ${names[i]} (${c.spec.name}): ${t.reply.plan.join(' ; ')} — ${t.reply.note.slice(0, 120)}`);
      }
    };
  });

  const persist = () => {
    for (const pid of ids) persisted.captains[pid] = byPid[pid].rt;
    writeFileSync(stateFile, JSON.stringify(persisted));
  };
  persist();

  const maxActions = opts.maxActions ?? 20000;
  let n = replayed;
  while (state.phase !== 'GAME_OVER' && n < maxActions) {
    const pid = activePlayerId(state);
    const legal = legalActions(state, pid);
    const action = await byPid[pid].decide(state, pid, legal);
    state = reduce(state, action);
    appendFileSync(actionsFile, JSON.stringify(action) + '\n');
    n++;
    persist();
    flushLog();
  }
  if (state.phase !== 'GAME_OVER') throw new Error(`${spec.id}: action cap reached (${n})`);

  const rows = score(state);
  flushLog();
  appendFileSync(logFile, `\nFINAL: ${rows.map((r, i) => `${i + 1}. ${r.name} ${r.total} (m${r.moneyVP}/c${r.conservationVP}/r${r.reputationVP})`).join(' | ')}\n`);

  // Reflection (parallel) — each captain writes its journal entry in its own session.
  const journals: Record<string, string> = {};
  await Promise.all(ids.map(async (pid) => {
    const c = byPid[pid];
    try { journals[c.spec.name] = await c.reflect(state, rows, pid); }
    catch (e) { journals[c.spec.name] = `(reflection failed: ${String(e).slice(0, 200)})`; }
  }));
  persisted.done = true;
  persist();

  const result: GameResult = {
    id: spec.id, seed: spec.seed, rows, health: avgBagHealth(state), actions: n, journals,
    seats: ids.map((pid, i) => {
      const rank = rows.findIndex((r) => r.playerId === pid) + 1;
      const c = byPid[pid];
      return { pid, captainName: names[i], agent: c.spec.name, rank, total: rows.find((r) => r.playerId === pid)!.total, calls: c.rt.calls, costUsd: c.rt.costUsd, invalid: c.rt.invalid };
    }),
  };
  writeFileSync(join(dir, `${spec.id}.result.json`), JSON.stringify(result, null, 2));
  return result;
}

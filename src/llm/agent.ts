import type { GameState } from '../types';
import type { Action } from '../actions';
import { legalActions } from '../actions';
import type { ScoreBreakdown } from '../engine/scoring';
import { ask, type AskOptions } from './claude';
import { renderView, parseCommand } from './view';
import { buildRulesPrompt } from './rules';
import { archetypeById } from './archetypes';

// An LLM CAPTAIN: one model + one archetype + a journal that carries lessons
// between games. Within a game it holds a single CLI session (full context); it
// is asked for a PLAN (a list of commands) and the harness executes the plan
// across turns, re-asking when a step fails, a new day starts, or something
// happens to the captain. Between games it writes a journal entry, which is fed
// into the next game's system prompt.

export interface CaptainSpec {
  name: string;          // tournament identity, e.g. "steward-fable"
  archetypeId: string;
  model: string;
  effort: AskOptions['effort'];
  cwd: string;           // CLI session dir
}

export interface GameRecord { gameId: string; round?: number; players: number; rank: number; total: number; captainName: string }

// Per-game runtime state, persisted after every decision so a crashed game resumes.
export interface CaptainRuntime {
  sessionId?: string;
  plan: string[];
  lastLogIndex: number;
  lastDayKey: string;
  calls: number;
  costUsd: number;
  ms: number;
  invalid: number;       // plans that failed to parse / illegal steps
  badStreak: number;     // consecutive decisions that ended in the fallback (circuit breaker)
  muted?: string;        // day key during which the captain is auto-passing (breaker tripped)
}
const freshRuntime = (): CaptainRuntime => ({ plan: [], lastLogIndex: 0, lastDayKey: '', calls: 0, costUsd: 0, ms: 0, invalid: 0, badStreak: 0 });
const BAD_STREAK_LIMIT = 6;

const PLAN_SCHEMA = {
  type: 'object',
  properties: { plan: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } },
  required: ['plan', 'note'],
};
const JOURNAL_SCHEMA = { type: 'object', properties: { journal: { type: 'string' } }, required: ['journal'] };

export interface DecisionTrace {
  pid: string; season: number; day: number; hour: number; asked: boolean; prompt?: string; reply?: { plan: string[]; note: string }; command?: string; action: Action; error?: string; ms?: number;
}

export class LlmCaptain {
  rt: CaptainRuntime = freshRuntime();
  captainName = '';
  systemPrompt = '';
  onTrace?: (t: DecisionTrace) => void;

  constructor(public spec: CaptainSpec, public journal: string[], public record: GameRecord[]) {}

  // Build this game's system prompt: rules for this table size + archetype + memory.
  prepareGame(state: GameState, captainName: string, rt?: CaptainRuntime): void {
    this.captainName = captainName;
    this.rt = rt ? { ...freshRuntime(), ...rt } : freshRuntime(); // a NEW game starts a new session + clean runtime
    const arch = archetypeById(this.spec.archetypeId);
    const parts = [buildRulesPrompt(state.config, state.config.players), arch.prompt];
    parts.push(`# You\nYou are Captain ${captainName}, ${arch.name}. Rivals know you only by that name. Your tournament identity (private) is ${this.spec.name}.`);
    if (this.record.length) {
      const rec = this.record.map((r) => `- ${r.gameId}: ${r.players}-player table, finished ${r.rank}/${r.players} with ${r.total.toFixed(1)} VP`).join('\n');
      parts.push(`# Your record so far\n${rec}`);
    }
    if (this.journal.length) {
      parts.push(`# Your journal — lessons from your previous games (you wrote these; use them)\n${this.journal.map((j, i) => `## Entry ${i + 1}\n${j}`).join('\n\n')}`);
    }
    parts.push('# This game\nA fresh game: the ocean is full, everyone starts at Rockland with the same boat. Think, then answer in JSON.');
    this.systemPrompt = parts.join('\n\n');
  }

  private async askPlan(prompt: string): Promise<{ plan: string[]; note: string }> {
    const res = await ask(prompt, {
      model: this.spec.model, effort: this.spec.effort, cwd: this.spec.cwd,
      systemPrompt: this.systemPrompt, // used only when (re)creating the session
      sessionId: this.rt.sessionId, schema: PLAN_SCHEMA,
    });
    this.rt.sessionId = res.sessionId;
    this.rt.calls++; this.rt.costUsd += res.costUsd; this.rt.ms += res.ms;
    const s = (res.structured ?? safeJson(res.text)) as { plan?: unknown; note?: unknown } | undefined;
    const plan = Array.isArray(s?.plan) ? s!.plan.filter((x) => typeof x === 'string').map((x) => String(x)) : [];
    const note = typeof s?.note === 'string' ? s!.note : '';
    return { plan, note };
  }

  // Events since the last decision, and whether any of them is about ME in a way
  // that should interrupt a running plan.
  private eventsSince(state: GameState): { events: string[]; interrupt?: string } {
    const me = this.captainName;
    // Redact rivals' PRIVATE haul details (stage, token count). Drops stay visible:
    // at a table everyone sees a pot go in; how ripe it is is what stays hidden.
    const all = state.log.slice(this.rt.lastLogIndex).map((e) => {
      if (e.startsWith(`${me} `)) return e;
      const m = e.match(/^(.+?) hauls \((\w+)\/\w+\): kept (\d+), vTokens \d+$/);
      if (m) return `${m[1]} hauls a pot (${m[2]}): kept ${m[3]}`;
      const ins = e.match(/^(.+?) spends a v-token \(insurance\): rescued (\d+) keeper\(s\)$/);
      if (ins) return `${ins[1]} spends a v-token on a lean haul`;
      return e;
    });
    let interrupt: string | undefined;
    for (const e of all) {
      if (e.includes(`from ${me}`) && e.includes('STEALS')) interrupt = 'a rival stole one of your pots';
      else if (e.startsWith(`Storm parts ${me}`)) interrupt = 'the storm parted one of your pots';
      else if (e.startsWith(`${me} takes a beating`)) interrupt = 'you took a storm beating (lost fuel)';
      else if (e.startsWith(`${me} is towed`)) interrupt = 'you were towed in';
    }
    const events = all.length > 60 ? [`(… ${all.length - 60} earlier events omitted)`, ...all.slice(-60)] : all;
    return { events, interrupt };
  }

  // Decide ONE engine action. May execute a queued plan without calling the model.
  async decide(state: GameState, pid: string, legal: Action[]): Promise<Action> {
    const p = state.players[pid];
    const dayKey = `${state.season}-${state.day}-${state.phase}`;
    const { events, interrupt } = this.eventsSince(state);
    const trace: DecisionTrace = { pid, season: state.season, day: state.day, hour: state.hour, asked: false, action: { type: 'PASS', playerId: pid } };

    let reason: string | undefined;
    // A plan PERSISTS across days — a captain can commit to a multi-day trip (steam
    // out, drop, let it soak overnight, haul, run in and sell) in one decision. Only
    // the restock draft, something happening TO the captain, or an impossible step
    // clears it; otherwise they keep sailing their own orders.
    if (state.phase === 'RESTOCK') this.rt.plan = [];
    else if (this.rt.plan.length && interrupt) { reason = `Plan interrupted: ${interrupt}.`; this.rt.plan = []; }

    // Circuit breaker: a captain that keeps producing unusable plans is muted for
    // the rest of the day (auto-PASS / default draft move) instead of burning calls.
    if (this.rt.muted && this.rt.muted !== dayKey) this.rt.muted = undefined;
    if (this.rt.muted) {
      trace.command = '(muted)'; trace.action = state.phase === 'RESTOCK' ? legal[0] : { type: 'PASS', playerId: pid };
      this.onTrace?.(trace);
      return trace.action;
    }

    // Full-points legality: a queued step that is legal but unaffordable THIS turn
    // just waits for the next turn (PASS now, keep the plan).
    const legalFull = legalActions({ ...state, players: { ...state.players, [pid]: { ...p, actionsLeft: 99 } } }, pid);

    for (let asks = 0; asks < 3; asks++) {
      if (this.rt.plan.length === 0) {
        const prompt = renderView(state, pid, legal, { events: asks === 0 ? events : [], reason });
        trace.asked = true; trace.prompt = prompt;
        const t0 = Date.now();
        const reply = await this.askPlan(prompt);
        trace.reply = reply; trace.ms = Date.now() - t0;
        this.rt.lastLogIndex = state.log.length;
        this.rt.lastDayKey = dayKey;
        this.rt.plan = reply.plan.slice(0, 24); // room for a multi-day trip
        if (this.rt.plan.length === 0) { reason = 'Your reply contained no commands.'; this.rt.invalid++; continue; }
      }

      // Execute the head of the plan.
      const cmd = this.rt.plan[0];
      const parsed = parseCommand(state, pid, cmd, legal);
      if (parsed.ok) {
        // a GOTO stays at the head of the plan until we arrive (re-resolved each decision)
        if (parsed.macro !== 'GOTO') this.rt.plan.shift();
        trace.command = cmd; trace.action = parsed.action;
        this.finish(trace, true);
        return parsed.action;
      }

      // GOTO arrived? (head is GOTO and we're standing on the target) → pop and continue.
      if (/^(GOTO|GO|MOVE)\s/i.test(cmd) && cmd.trim().split(/\s+/)[1]?.toUpperCase() === p.node) {
        this.rt.plan.shift();
        if (this.rt.plan.length) { asks--; continue; }
        reason = `You arrived at ${p.node}; your plan is exhausted.`;
        continue;
      }

      // Legal with a full turn of points but not now → wait for next turn.
      if (state.phase === 'PLAYING' && p.actionsLeft < state.config.actionsPerTurn) {
        const affordableLater = parseCommand({ ...state, players: { ...state.players, [pid]: { ...p, actionsLeft: 99 } } }, pid, cmd, legalFull).ok;
        if (affordableLater) {
          trace.command = `(wait) ${cmd}`; trace.action = { type: 'PASS', playerId: pid };
          this.finish(trace, true);
          return trace.action;
        }
      }

      // Truly illegal → drop the plan and ask again with the reason.
      this.rt.invalid++;
      reason = `Your command "${cmd}" is not possible: ${parsed.error}. The rest of that plan was discarded.`;
      this.rt.plan = [];
      trace.error = reason;
    }

    // Gave up: take a sensible default so the game never stalls.
    const fallback = state.phase === 'RESTOCK' ? legal[0] : { type: 'PASS' as const, playerId: pid };
    trace.command = '(fallback)'; trace.action = fallback;
    this.finish(trace, false);
    if (this.rt.badStreak >= BAD_STREAK_LIMIT) { this.rt.muted = dayKey; trace.error = (trace.error ?? '') + ' [breaker: muted for the day]'; }
    return fallback;
  }

  // Events accumulate until the next ask (lastLogIndex only moves when we ask).
  private finish(trace: DecisionTrace, good: boolean): void {
    this.rt.badStreak = good ? 0 : this.rt.badStreak + 1;
    this.onTrace?.(trace);
  }

  // Post-game reflection in the same session: the captain writes its own journal entry.
  async reflect(state: GameState, rows: ScoreBreakdown[], pid: string): Promise<string> {
    const me = rows.find((r) => r.playerId === pid)!;
    const rank = rows.findIndex((r) => r.playerId === pid) + 1;
    const table = rows.map((r, i) => `${i + 1}. ${r.name}${r.playerId === pid ? ' (YOU)' : ''}: total ${r.total} (money ${r.moneyVP}, conservation ${r.conservationVP}, reputation ${r.reputationVP})`).join('\n');
    const prompt = `GAME OVER. Final standings:\n${table}\n\nYou finished ${rank} of ${rows.length}. Your tracks: money VP ${me.moneyVP}, conservation VP ${me.conservationVP}, reputation VP ${me.reputationVP}; total ${me.total}.\n\nWrite your JOURNAL ENTRY for this game (you will read it before your next game, with the same archetype, possibly at a different table size). Be concrete and honest: what decided this game; which of your plans worked and which did not (name the specific mechanics — grounds, timing, prices, weather, the draft, refits, turn order); the mistakes you will not repeat; the two or three rules of thumb you now believe in; and what you would try next game. 150–350 words. Reply as JSON {"journal": "..."}.`;
    const res = await ask(prompt, { model: this.spec.model, effort: this.spec.effort, cwd: this.spec.cwd, sessionId: this.rt.sessionId, systemPrompt: this.systemPrompt, schema: JOURNAL_SCHEMA });
    this.rt.sessionId = res.sessionId;
    this.rt.calls++; this.rt.costUsd += res.costUsd; this.rt.ms += res.ms;
    const s = (res.structured ?? safeJson(res.text)) as { journal?: unknown } | undefined;
    const text = typeof s?.journal === 'string' ? s!.journal : res.text;
    return text.replace(/\\n/g, '\n').trim(); // models sometimes write literal "\n" inside the JSON string
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* ignore */ } }
  return undefined;
}

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// Thin wrapper over the Claude Code CLI in headless mode (`claude -p`), which runs
// on the user's Claude subscription — no API key needed. One SESSION per captain
// per game: the first call sets the system prompt (recorded by the CLI's prompt
// snapshot), every later call `--resume`s it, so the captain keeps its whole
// in-game context. Structured output via --json-schema.

export interface AskOptions {
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  cwd: string;                 // where the CLI stores sessions (keep it out of the repo)
  systemPrompt?: string;       // required for a NEW session
  sessionId?: string;          // resume this session
  schema?: object;             // JSON schema for the structured reply
  timeoutMs?: number;
  maxRetries?: number;
  bin?: string;                // claude binary
}

export interface AskResult {
  text: string;
  structured?: unknown;
  sessionId: string;
  costUsd: number;
  ms: number;
  attempts: number;
}

const DEFAULT_BIN = process.env.LOBSTERS_CLAUDE_BIN ?? 'claude';
const BACKOFF_MS = [5_000, 15_000, 45_000, 90_000, 180_000, 300_000, 300_000, 300_000];

// A global cap on concurrent CLI processes (each is a full Claude Code process).
let inflight = 0;
const waiters: (() => void)[] = [];
export let MAX_CONCURRENT = Number(process.env.LOBSTERS_LLM_CONCURRENCY ?? 8);
export function setMaxConcurrent(n: number) { MAX_CONCURRENT = n; }
async function acquire(): Promise<void> {
  if (inflight < MAX_CONCURRENT) { inflight++; return; }
  await new Promise<void>((res) => waiters.push(res)); // the slot is handed over, not released
}
function release(): void {
  const w = waiters.shift();
  if (w) w(); else inflight--;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function runCli(bin: string, args: string[], stdin: string, cwd: string, timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd, env: { ...process.env, CLAUDECODE: '', CLAUDE_CODE_ENTRYPOINT: '', OMC_SKIP_HOOKS: 'all' }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ code: -1, stdout, stderr: String(err) }); });
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

export class AskError extends Error {}

// A usage-limit message ("You've hit your session limit · resets 12:10am
// (America/New_York)") names WHEN the window reopens. Return the ms to wait until
// then (+1 min), or undefined if no clock time can be read. Only a time of day is
// parsed: the wait is capped at 24h and the caller polls again after that.
export function parseLimitWaitMs(msg: string, now = new Date()): number | undefined {
  if (!/resets?/i.test(msg)) return undefined;
  const m = msg.match(/resets?\s+(?:[A-Za-z]+\s+\d{1,2},?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?:\s*\(([^)]+)\))?/i);
  if (!m) return undefined;
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'pm') h += 12;
  const target = h * 60 + Number(m[2] ?? 0);
  const tz = m[4];
  let nowMin: number;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
    const hh = Number(parts.find((p) => p.type === 'hour')?.value ?? now.getHours()) % 24;
    const mm = Number(parts.find((p) => p.type === 'minute')?.value ?? now.getMinutes());
    nowMin = hh * 60 + mm;
  } catch { nowMin = now.getHours() * 60 + now.getMinutes(); }
  let delta = target - nowMin;
  if (delta <= 0) delta += 24 * 60;
  return (delta + 1) * 60_000;
}
const MAX_LIMIT_WAIT_MS = 24 * 3600_000;

// Ask the model one message. Retries transient failures with backoff (rate limits,
// overloads, CLI hiccups). For a NEW session, a retry gets a fresh session id so a
// half-created session never poisons the resume.
export async function ask(message: string, opts: AskOptions): Promise<AskResult> {
  const bin = opts.bin ?? DEFAULT_BIN;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const maxRetries = opts.maxRetries ?? BACKOFF_MS.length;
  let lastErr = '';
  let costUsd = 0;
  let limitWaited = 0;
  let resumeId = opts.sessionId;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    const sessionId = resumeId ?? randomUUID();
    // --strict-mcp-config + empty setting sources: no MCP servers, hooks, or CLAUDE.md
    // leak into the captain's context (they added ~75K tokens per call otherwise).
    const args = ['-p', '--model', opts.model, '--effort', opts.effort, '--output-format', 'json', '--tools', '', '--no-chrome', '--strict-mcp-config', '--setting-sources', ''];
    if (resumeId) args.push('--resume', resumeId);
    else {
      if (!opts.systemPrompt) throw new AskError('a new session needs a systemPrompt');
      args.push('--session-id', sessionId, '--system-prompt', opts.systemPrompt);
    }
    if (opts.schema) args.push('--json-schema', JSON.stringify(opts.schema));

    await acquire();
    let out: Awaited<ReturnType<typeof runCli>>;
    try { out = await runCli(bin, args, message, opts.cwd, timeoutMs); } finally { release(); }

    let parsed: Record<string, unknown> | undefined;
    try { parsed = JSON.parse(out.stdout.trim()); } catch { parsed = undefined; }

    costUsd += Number(parsed?.total_cost_usd ?? 0);
    if (parsed && !parsed.is_error && typeof parsed.result === 'string') {
      return {
        text: parsed.result,
        structured: parsed.structured_output,
        sessionId: (parsed.session_id as string) ?? sessionId,
        costUsd,
        ms: Date.now() - t0,
        attempts: attempt + 1,
      };
    }
    lastErr = parsed ? `cli error: ${String(parsed.result ?? JSON.stringify(parsed)).slice(0, 500)}` : `cli exit ${out.code}: ${(out.stderr || out.stdout).slice(0, 500)}`;
    // Usage limit (5-hour window / weekly): not a failure — wait for the window to
    // reopen and try again without spending a retry. Unparseable reset time → poll.
    if (/limit/i.test(lastErr) && /resets?/i.test(lastErr) && limitWaited < MAX_LIMIT_WAIT_MS) {
      const wait = Math.min(parseLimitWaitMs(lastErr) ?? 30 * 60_000, MAX_LIMIT_WAIT_MS - limitWaited);
      console.log(`${new Date().toISOString().slice(11, 19)} usage limit hit — waiting ${Math.round(wait / 60_000)} min (${lastErr.replace(/^cli error: /, '').slice(0, 120)})`);
      await sleep(wait);
      limitWaited += wait;
      attempt--; // does not count against the retry budget
      continue;
    }
    // A session the CLI can no longer resume: fall back to a fresh one (the caller's
    // systemPrompt re-seeds it) rather than failing the same way nine times.
    if (resumeId && opts.systemPrompt && /session|conversation/i.test(lastErr) && !/limit/i.test(lastErr)) resumeId = undefined;
    if (attempt < maxRetries) await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
  }
  throw new AskError(`ask failed after ${maxRetries + 1} attempts: ${lastErr}`);
}

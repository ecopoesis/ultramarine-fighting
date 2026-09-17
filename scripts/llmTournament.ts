import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultConfig } from '../src/config';
import { Tournament } from '../src/llm/tournament';
import { LLM_ARCHETYPES } from '../src/llm/archetypes';
import { setMaxConcurrent } from '../src/llm/claude';
import type { Config } from '../src/types';

// LLM battle-test tournament. Runs on the Claude Code CLI (your subscription).
//
//   npx tsx scripts/llmTournament.ts run    [--run-id ID] [--rounds 5] [--final 5] [--effort medium]
//                                           [--models fable=claude-fable-5-1,opus=claude-opus-5]
//                                           [--archetypes a,b,c] [--mean 4] [--sd 1] [--seed 7] [--concurrency 8]
//   npx tsx scripts/llmTournament.ts smoke  [--model claude-haiku-4-5-20251001] [--players 2] [--seasons 2]   (tiny game: plumbing check; 3+ seasons exercises the restock draft)
//   npx tsx scripts/llmTournament.ts status --run-id ID
//   npx tsx scripts/llmTournament.ts report --run-id ID        (writes runs/ID/report.md)
//
// Re-running `run` with the same --run-id RESUMES (finished games are kept,
// half-played games are replayed from their transcripts, captain sessions resumed).

const args = process.argv.slice(2);
const cmd = args[0] ?? 'run';
const flag = (name: string, def?: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};

const ROOT = join(process.cwd(), 'tournament', 'runs');
const runId = flag('run-id', cmd === 'smoke' ? `smoke-${Date.now()}` : `run-${new Date().toISOString().slice(0, 10)}`)!;

function parseModels(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of s.split(',')) { const [label, id] = part.split('='); out[label.trim()] = (id ?? label).trim(); }
  return out;
}

const ts = () => new Date().toISOString().slice(11, 19);
const logger = (line: string) => { console.log(`${ts()} ${line}`); };

async function main() {
  setMaxConcurrent(Number(flag('concurrency', '8')));
  const effort = (flag('effort', 'medium') as 'low' | 'medium' | 'high' | 'xhigh' | 'max');

  if (cmd === 'smoke') {
    // A tiny game to validate the plumbing end to end (cheap model by default).
    const model = flag('model', 'claude-haiku-4-5-20251001')!;
    const players = Number(flag('players', '2'));
    const seasons = Number(flag('seasons', '3'));
    const config: Config = { ...defaultConfig, seasons, daysSchedule: Array.from({ length: seasons }, (_, i) => (i === seasons - 1 ? 3 : 2)) };
    const archs = LLM_ARCHETYPES.slice(0, players).map((a) => a.id);
    const t = new Tournament({
      runId, rootDir: ROOT, rounds: 1, finalSize: players, effort, models: { smoke: model }, archetypes: archs,
      meanPlayers: players, sdPlayers: 0, seed: 1, config, log: logger,
    });
    // one round, then a "final" of the same captains — exercises journals + resume plumbing
    await t.play();
    writeFileSync(join(t.dir, 'report.md'), t.report());
    console.log(t.report());
    return;
  }

  if (cmd === 'run') {
    const models = parseModels(flag('models', 'fable=claude-fable-5-1,opus=claude-opus-5')!);
    const archetypes = (flag('archetypes') ?? LLM_ARCHETYPES.map((a) => a.id).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
    const t = new Tournament({
      runId, rootDir: ROOT, rounds: Number(flag('rounds', '5')), finalSize: Number(flag('final', '5')), effort, models, archetypes,
      meanPlayers: Number(flag('mean', '4')), sdPlayers: Number(flag('sd', '1')), seed: Number(flag('seed', '7')), config: defaultConfig, log: logger,
    });
    logger(`run ${runId}: ${Object.keys(t.run.agents).length} captains, ${t.opts.rounds} rounds, final of ${t.opts.finalSize}, effort ${effort}`);
    try { await t.play(); }
    finally { writeFileSync(join(t.dir, 'report.md'), t.report()); }
    console.log(`\nreport: ${join(t.dir, 'report.md')}`);
    return;
  }

  if (cmd === 'status' || cmd === 'report') {
    const t = new Tournament({ runId, rootDir: ROOT, rounds: 0, finalSize: 0, effort, models: {}, archetypes: [], meanPlayers: 4, sdPlayers: 1, seed: 0, config: defaultConfig, log: logger });
    if (cmd === 'status') {
      for (const r of t.run.rounds) logger(`round ${r.round}: ${r.games.map((g) => `${g.id}=${g.status}`).join(' ')}`);
      if (t.run.final) logger(`final: ${t.run.final.status}`);
      t.printStandings('standings so far');
    } else {
      const rep = t.report();
      writeFileSync(join(t.dir, 'report.md'), rep);
      console.log(rep);
    }
    return;
  }
  console.error(`unknown command ${cmd}`);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });

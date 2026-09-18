# Lobsters — Prototype Engine (TypeScript)

A decoupled, deterministic engine for the *Lobsters* euro board game prototype.
Hot-seat is the target; **pen-and-paper is the real product.** This exists to find
the balance numbers fast. See `SPEC.md` for the full design rationale.

## Quick start
```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest: depletion invariant, determinism, termination, web smoke
npm run play        # one game, seed 12345, prints score table + bag health
npm run sim         # 200 games, win-by-seat + mean bag health
npm run dev         # hot-seat web UI (Vite) at http://localhost:5173
```

## Hot-seat web UI (`web/`)
A React + Vite front end over the same engine (imports `src/` directly — the engine
is browser-safe). `npm run dev` to play. On the setup screen assign each seat to a
**human**, a **named bot** (the roster archetypes), or a **random bot**; pass the
device between human turns (a hand-off gate hides private info). The map shows the
public state (boats, pots, storms ⛈, seeded piles); the active player's panel shows
their private hold + pot ripeness and legal actions. `npm run build` / `npm run
typecheck:web` for the app; `web/app.smoke.test.tsx` renders it against the engine.

## LLM battle-test tournament (`src/llm/`, `scripts/llmTournament.ts`)
Claude captains play the game against each other through the Claude Code CLI in
headless mode (your subscription; no API key). Each captain = one archetype
(`src/llm/archetypes.ts`) × one model, holds one resumable CLI session per game
(full in-game context), receives a rules prompt generated from the live config
(`src/llm/rules.ts`) plus a per-decision text view (`src/llm/view.ts`), and
replies with a JSON plan of commands the harness executes across turns
(`src/llm/agent.ts`). After every game it writes a journal entry that is fed into
its next game's prompt — the captains learn between games. `src/llm/tournament.ts`
schedules Swiss-style rounds of concurrent tables (sizes ~N(4,1), 2–6 players) and
a final of the top captains; everything under `tournament/runs/<id>/` persists, so
re-running the same `--run-id` resumes (half-played games replay from transcript).

```bash
npx tsx scripts/llmTournament.ts smoke                      # tiny 2-player Haiku game: plumbing check
npx tsx scripts/llmTournament.ts run --run-id rr1 --rounds 5 --final 5 --effort medium
npx tsx scripts/llmTournament.ts status --run-id rr1
npx tsx scripts/llmTournament.ts report --run-id rr1        # writes tournament/runs/rr1/report.md
```
Per game you get `games/<id>.log` (engine log + every plan/note), `.trace.jsonl`
(full prompts and replies), `.actions.jsonl` (replayable transcript) and
`.result.json`; per captain `agents/<name>.md` (its journal).

## Architecture (the decoupling)
- `src/config.ts` — **the only file you touch to rebalance.** Every tunable number.
- `src/types.ts` — all shared types.
- `src/state.ts` — initial-state factory.
- `src/rng.ts` — seeded deterministic RNG (no `Math.random` in engine).
- `src/engine/*` — pure rule modules: movement, soak, buoys (+bags/draw/v-notch),
  market, turnorder, scoring.
- `src/actions.ts` — action union + `legalActions()`.
- `src/reducer.ts` — root reducer `(state, action) => state`, plus turn/day machine.
- `src/selectors.ts` — derived reads (reachability, active player).
- `scripts/playRandomGame.ts` — no-UI runner for experiments.
- `test/` — invariants. **The accounting test proves tiles only leave the world via sales.**

Engine functions are pure at the reducer boundary (clone-once-then-mutate-the-draft).
No number literals in `/engine` — all constants come from config.

## What to tune first (see SPEC §12)
1. **Initiative ≈ marginal haul?** the master dial (`poleRepCost`, what going first buys).
2. **Flood vs depletion** (`buyers.*.elasticity` vs `bags`). Bags must trend down.
3. **Market-close harshness** (`holdDecayLbPerDay`).
4. **v-token strength** — rescue a lean draw without replacing the lobster.
5. **`scoring.combineMode`** — try `sum` vs `weakLinkMultiplier`.

Deferred behind `config.flags`: weather, eras/multi-season, multi-ship, inspections.

## Push to GitHub
```bash
git init
git add .
git commit -m "Lobsters prototype engine: decoupled TS, seeded, tested"
# make an empty repo on github.com first, then:
git remote add origin git@github.com:YOUR_USER/lobsters.git
git branch -M main
git push -u origin main
```

## Component manifest
`npm run components` regenerates `docs/components.html` from `src/config.ts` — every piece in the box and the text printed on it. Regenerate it in the same commit as any rules-number change; see `CLAUDE.md`.

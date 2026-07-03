# Lobsters — Prototype Engine (TypeScript)

A decoupled, deterministic engine for the *Lobsters* euro board game prototype.
Hot-seat is the target; **pen-and-paper is the real product.** This exists to find
the balance numbers fast. See `SPEC.md` for the full design rationale.

## Quick start
```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest: depletion invariant, determinism, termination
npm run play        # one game, seed 12345, prints score table + bag health
npm run sim         # 200 games, win-by-seat + mean bag health
```

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

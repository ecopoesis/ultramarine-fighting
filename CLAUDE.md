# LOBSTERS — working rules for this repo

A digital prototype used to find the balance numbers before the game is cut as a
physical product. `SPEC.md` has the design rationale; `README.md` has the commands.

## The one rule that matters

**`src/config.ts` is the only place a game number may live.** Never hardcode a
constant in `/engine`, `/bots`, `/llm` or the web UI. If you are typing a `5` into a
rule, it belongs in config. Everything downstream is generated or derived from it.

## Keep the derived documents current

Three things are generated from the config and go stale silently if you change a
number and forget them. Regenerate whichever the change touches, in the same commit
as the change:

| document | command | what it is |
|---|---|---|
| **Component manifest** | `npm run components` | Everything in the box and the text printed on each piece — `docs/components.html`. **Any change to bags, board, refits, dice, scoring, tracks, licences or weather must be followed by regenerating this.** Never edit its counts by hand: the manifest and the rules would disagree and only one of them is right. Published at https://claude.ai/artifact/YRfoTwQLni4THyrMmMAi9m — republish that same URL after regenerating. |
| **Rulebook** | `npm run rulebook` | How to play at the table — `docs/rulebook.html`, prose hand-written in `scripts/rulebook.ts` with every number read from config. Regenerate with the manifest; a new mechanic needs its prose added there. Published at https://claude.ai/artifact/C3cCEDEVSmP6aAjNUXUUYQ — republish that same URL. |
| **LLM rules prompt** | (automatic) | `src/llm/rules.ts` builds the rulebook from config at run time. It is generated, but the *prose* around each number is hand-written — if you add a mechanic, add its explanation there too, or the Claude captains will have to reverse-engineer it from the event log (they did exactly that with the co-op). |
| **Captain view** | (automatic) | `src/llm/view.ts` renders the situation report. A new piece of public state needs a line here or players cannot plan against it. |

## How balance work is done here

- **Bots first, players second.** `npm run arena` (and `scripts/tune*.ts`) are fast
  and free. Use them for balance safety-checks, track levels and depletion.
- **The bot arena cannot answer behavioural questions.** The card-counter's policy is
  fixed, so it can never learn to stagger its gear, concentrate on a node, or budget
  for a known cost. Three separate changes measured as inert against bots and moved
  sharply with Claude captains. Anything about planning, adaptation or crowding needs
  an LLM game (`scripts/llmTournament.ts`, about $45 a game).
- **Measure before you fix.** Twice a plausible fix was aimed at the wrong cause
  because the first metric measured the wrong thing (cumulative traffic instead of
  simultaneous crowding; restock turns counted as fishing days). Write the probe.
- **Keep negative results.** Commit messages here carry what did *not* work and why,
  so the next session doesn't retry it. That is deliberate.

## No fractions

Nothing a player tracks or computes may be fractional. `npm run check-integers` plays
real games and fails if any money, reputation, conservation, fuel, market price or
score comes out non-whole. Run it after touching any number.

The devices that keep it that way, so you don't undo them by accident:
- **Reputation runs on a DOUBLED scale** (start 16, not 8) with `repToVP` halved to
  match. Every rep change is a whole number; the VP are identical. Half-points were
  the single biggest source of fractions in the game.
- **Market prices drop in whole steps**: `dropPerLbs` means "one money off for every
  N lb landed here today", not a rate per pound.
- **Weather is a d10**: `hazardInTen` / `whittleInTen` are "this number or less".
- **Scoring SUBTRACTS a penalty** from a printed card rather than multiplying by a
  fraction. Add three numbers, find the smallest, subtract one integer.
- **Money VP floors** — it is a track on the board marked every 5, and you stand on
  the last mark you passed.

## Guardrails for the physical game

Everything must stay hand-computable at a table. No roots, no ratios, no running
arithmetic — lookup cards, stepped tracks and one subtraction at a time. If a rule
cannot be executed with tokens and a printed card, it is not finished.

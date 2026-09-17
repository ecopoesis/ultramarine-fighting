# Lobsters — LLM battle-test, round 1 findings

20 Claude captains (10 archetypes × Fable 5.1 / Opus 5), 5 tables of 3–5 players, full 5-season games
on the shipped config (`c3b280d` + `.nvmrc`). 5,386 engine actions, 1,503 model decisions.
Every captain played once. Raw data: `tournament/runs/rr1/` (logs, prompts, plans, journals).

**Headline: the game is currently decided by a renewable victory-point faucet that has nothing to do
with catching lobsters.** All 20 captains found it independently, most by season 2. Everything else
below is secondary to fixing it.

---

## 1. The egger faucet (fatal)

`engine/buoys.ts` `resolveDraw`: a clean/highgrade haul that draws an EGGER

- returns the egger **to the bag**, and
- grants `+1 vTokens` **and** `+1 tracks.conservation`.

At scoring, `conservationVP = vTokens × 1 + conservation + healthVP`. So **one egger drawn = 2 VP,
and the egger goes back in the pool to be drawn again, forever.** 2 VP = 10 money at `moneyPerVP 5`.

Measured outcome:

| track | min | max | mean |
|---|---|---|---|
| money VP | 39.1 | 99.4 | 62.7 |
| conservation VP | 62.0 | 178.0 | 115.6 |
| reputation VP | 18.0 | 28.0 | 24.1 |

Captains ended holding **48–87 v-tokens**. The winner of the 5-player table scored 243.7 with
conservation 178 and money 41.7 — he was nearly last in money.

Three compounding effects make it worse:

1. **It inverts the depletion arc.** Eggers are thrown back, keepers are not, so as the commons is
   stripped the *egger share* of every bag rises. The reward for fishing a dead ground goes **up**.
   The collapse the whole game is built around becomes a bonus.
2. **It inverts the deep.** The deep bag is 12 eggers of 30 tiles (40%), offshore 7 of 30. So
   DEEP_EDGE became the premium farm — not for its 4 lb keepers. 20.3% of all pot drops landed on
   that single node, and offshore took another 34%.
3. **Storms became the reward, not the risk.** A stormed PRIME haul draws 7 tiles instead of 3. On a
   40%-egger bag that is ~3 eggers = 6 VP per haul, with no sale, no port trip, no market flood and
   no hold decay. Captains deliberately camped stormed nodes from a shelter.

In the captains' own words (unprompted, three different agents):

> "Once keeper density is under ~0.5 lb/tile, fish stormed egger-rich nodes with clean; conservation
> compounds at 2 VP per egger."

> "Count eggers per haul, not pounds."

> "Conservation is the uncapped track, because eggers are 2 VP each and never run out. From S2 on,
> maximize tiles drawn per day on the bag with the highest egger share, and count keepers as a bonus."

### Recommended fix: the v-notch is a *mark*

Thematically the v-notch is a physical notch cut into the tail so every future fisher knows to release
her. Make the game do that: **a v-notched egger is flipped/marked, and scores only the first time.**
Re-drawing an already-notched egger is a free throwback worth nothing.

That single change:

- makes stewardship **finite and front-loaded** (the eggers you notch early are the ones that pay),
- restores the depletion arc (a stripped bag becomes genuinely worthless, not a slot machine),
- makes a v-notched bag genuinely *recovered* rather than a farm,
- is trivially hand-implementable at a table (flip the tile, or a notch sticker), and
- keeps "stewardship pays" intact, which is the design's heart.

Alternatives, weaker: grant the token **or** the conservation point but not both (halves the rate,
still infinite); or cap conservation VP (arbitrary, and punishes honest play late).

---

## 2. The weak-link multiplier is decorative — and simultaneously a cliff

`sumWeakLink` was validated against bots. It does not survive competent play.

- **Reputation was the minimum track in 20 of 20 player-games.**
- **17 of 20 captains scored the full ×1.00 multiplier.**

Reputation is structurally always the weak link because it is the only **one-way** track. You start at
8 (32 VP) and can essentially only lose it; the sole repeatable gain is `+1` for reporting a theft,
which requires being robbed, and there were 3 thefts in 5 games. Money and conservation are unbounded.
So "your lowest track" is not a choice — it is a fixed readout of how much reputation you have spent.

The multiplier is therefore a **binary check on one number** (is reputation ≥ 5.5?), which then
lands as a cliff. `harbormaster-opus` had the second-best raw sum in its game (236) and finished last:

> "Reputation finished at 5, which is 20 VP, just under the 22 line, so everything was multiplied by
> 0.75. Half a reputation point cost me about 59 VP and second place."

Losing 59 points to half a point of a resource you cannot rebuild will feel arbitrary at a table.

**Fixes needed (both):**

1. **Give reputation a repeatable income** so it is a real track rather than a decaying budget — e.g.
   +1 per season for landing a season with zero illegal keeps, or +1 for a clean sale at your home
   port. Then all three tracks are live and the weak-link does the job it was designed for.
2. **Soften the cliff**: more bands, or narrower steps near the top (×1 / ×0.9 / ×0.75 / …), so half a
   point costs a few VP rather than a quarter of the score.

---

## 3. Everything else, ranked by how much it should change the prototype

**The pole is a trap, not a decision.** 27 pole berths across 5 games, and at least four captains
recorded losing reputation to it *by accident* — their plan ended in BERTH while slot 0 was still
open. All of them converged on the same rule: never berth voluntarily, PASS and let the free
auto-berth seat you, which inherits slot 0 anyway when you are the day's first mover. A cost that the
informed player always dodges and the new player always pays is a trap. Either make slot 0 worth its
reputation point, or drop `poleRepCost` and price initiative some other way.

**Storms shred gear far harder than the stated rate feels like.** 82 pots parted and 119 storm
beatings across 5 games. Several captains lost 7–10 pots over a game; one reported 7 of 10 parted. At
12%/night over a 2-night soak that is ~23% per pot, and captains who stacked a full string on one
stormed node routinely lost the season. Meanwhile **radar is dead** — it blocks the entry hazard
(1 fuel) but not the whittle (the thing that actually hurts), and two captains called it "worthless"
at 14 money. Either let radar protect gear, or cut its price.

**The restock draft does nothing.** 2–7 v-token contributions per *game*. Every captain independently
concluded the same thing: a held token is 1 guaranteed VP, contributing spends it on a commons that
rivals fish equally. That is a textbook public-goods failure and thematically perfect, but mechanically
it means the draft is ceremony. If contributions are meant to happen, the contributor needs a private
edge (first claim next season on the bag they rebuilt, say), not a shared one.

**Theft is dead, again.** 3 thefts in 5 games of ~1,100 actions. This matches the earlier bot finding
exactly, so it is now confirmed against competent opponents too: ripe gear is hauled promptly, so
there is nothing to steal. The Pirate archetype finished mid-table on ordinary fishing. Treat theft as
a punish for sloppy play, not a strategy — or give it a reason to exist.

**Idle days are the most common self-reported mistake.** Nearly every journal cites wasted days with
all pots soaking and nothing to do. With 4 pots and 2-night soaks there is simply no move on alternate
days. The players' own fix was staggered drops and 1-night inshore pots. Worth designing for
deliberately, because at a table a dead turn is worse than a bad one.

**What is working well.** Market flooding is the standout: every captain learned to check "lb landed
today" and to sell first, and the island ports beat Rockland on volume (Vinalhaven 100 sales, Rockland
54, Stonington 42) — exactly the spatial spread `bffc69b` was aiming for. Commons health landed at
55–62%, so the depletion arc itself works. Refits ran 1.8 per captain with engine (8) and cargo (6)
leading and fuel line (1) trailing — a reasonable spread, though cargo and crane are power picks
because they scale hauls-per-day, which is the egger faucet again.

**Archetype standings are not usable yet.** Highliner led at 0.88 rank-points and Stormchaser and
Islander trailed at 0.17, but the ranking mostly measures *how close each archetype started to the
egger exploit* — Highliner works the offshore and deep, which are the egger-rich bags. Re-run after
the fix before drawing any conclusion about archetype balance.

**The two models are indistinguishable**, which is good news for the instrument: it means the
tournament measures archetypes rather than model strength.

| model | games | avg rank-points | avg VP |
|---|---|---|---|
| Fable 5.1 | 10 | 0.517 | 188.1 |
| Opus 5 | 10 | 0.483 | 200.5 |

---

## Recommendation

Fix the v-notch mark and the reputation income first, then re-run a **smaller** tournament (3-player
tables, low effort, 3 rounds) to re-measure. Running rounds 2–5 on the current rules would mostly
re-measure the same exploit at roughly $100 per game.

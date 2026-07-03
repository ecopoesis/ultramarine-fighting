# LOBSTERS — Prototype Spec (v0.1)

> Digital hot-seat prototype. Purpose: find the balance numbers before committing to pen-and-paper. **Not** the shipping product. Optimize for *changeability*, not polish: every tunable lives in one config object, all rules are pure functions, the UI is a thin renderer over state.

---

## 1. Scope

### In (the core that must prove out)
- Live shared ocean, **interleaved hourly turns** (everyone co-present on the water).
- **Fuel + clock + one-sale** as the joint reach limiter.
- **Three depletion bags** (inshore / mid / offshore), drained only by player greed, refilled only by thrown-back eggers.
- **Public buoy / private soak** split, with **time+place** soak curves.
- **Bag draw** with keepers / throwbacks, the **v-notch loop**.
- **Live market**: prices drop as people sell, recover overnight (the flood dynamic).
- **Theft** (multi-beat, reputation cost).
- **Dock-to-claim turn order**: berth to claim tomorrow's slot, front slot costs rep, bribe override.
- **Three scored tracks**: money / conservation / reputation.

### Out (deferred until the core is fun)
- Weather.
- Eras / multi-season (prototype = one season, fixed days).
- Multiple ships per player.
- Random inspections (illegal keeps are deterred by the rep hit alone for now).
- Two-harbor turn order (one harbor only; market has multiple *buyers*, not multiple docks).

> Keep these stubbed behind feature flags in config so they can be switched on later without restructuring.

---

## 2. The core loop, in one breath

A **season** is a fixed number of **days**. Each day is a fixed number of **hours**. On each hour, players take a turn **in seated order** (the day's turn order); a turn is up to *A* actions. You steam out, drop and haul buoys, race the clock back to the one harbor, and **sell once** before the day ends. When you're done for the day you **berth** — and the order boats berth in *is* tomorrow's turn order. Bags only deplete (except eggers you throw back). At game end, three tracks combine into one score.

---

## 3. Architecture (the decoupling)

```
/config        ← ALL tunable numbers + content. The only file you touch to rebalance.
/state         ← initial-state factory + documented state shape. No logic.
/engine
   movement.js     reachability, steaming, fuel spend
   buoys.js        drop / haul / steal, public-token <-> private-marker pairing
   soak.js         per-day maturation along ground curves
   bags.js         draw, keeper/throwback classification, v-notch return
   market.js       price tracks, sell, overnight recovery
   turnorder.js    berthing, slot claim, pole rep cost, bribe
   conservation.js egger returns, bag-health scoring
   scoring.js      track -> VP, final combine
   theft.js        steal resolution + report/bounty
/actions       ← action creators + canDo(state, player, action) validators
/reducer       ← root reducer: (state, action) -> state, dispatches to engine modules
/selectors     ← derived reads: legalActions(), reachableNodes(), liveScores(), etc.
/ui            ← React. Renders selectors, dispatches actions. Hot-seat only.
```

**Hard rules for changeability**
- Engine functions are **pure**: `(state, payload) -> newState`. No randomness inside — see §11.
- **No number literals in engine code.** Every constant comes from `config`. If you're typing a `5` in a rule, it belongs in config.
- UI never mutates state; it dispatches actions and reads selectors. You should be able to delete `/ui` and drive the whole game from a test script.
- Each subsystem owns its slice of state and exposes only reducer + selectors. Adding weather later = a new module + a config block, no edits elsewhere.

---

## 4. State shape

```js
GameState = {
  config,                 // frozen copy of the config in use
  rngSeed,                // see §11
  phase,                  // 'PLAYING' | 'DAY_ROLLOVER' | 'GAME_OVER'
  day,                    // 1..config.days
  hour,                   // 1..config.hoursPerDay
  turnOrder,              // [playerId, ...] for the current day
  activePlayerIndex,      // pointer into turnOrder (skips berthed players)
  players: {
    [id]: {
      id, name,
      node,               // current map node id
      fuel,               // units
      money,
      actionsLeft,        // resets to config.actionsPerTurn at start of each of this player's hours
      buoys: {
        available,        // count not yet deployed
        deployed: [ { buoyId, node, ownerId } ],   // PUBLIC info
        soak:    { [buoyId]: { ground, stage } }   // PRIVATE info, never sent to other players' views
      },
      hold: [ Tile ],     // caught-but-unsold tiles (catch in the boat)
      soldToday: false,   // one sale per day
      berthed: false,     // done for the day
      tracks: { money: 0, conservation: 0, reputation: config.startReputation },
      vTokens: 0
    }
  },
  bags: { inshore: [Tile], mid: [Tile], offshore: [Tile] },   // remaining tiles
  bagStart: { inshore: N, mid: N, offshore: N },              // for bag-health %
  buyers: { coop: { price }, tourist: { price } },            // live prices
  nextSlot: 0,            // next berth slot to be claimed today (front=0)
  pendingNextOrder: [],   // playerIds in the order they berthed -> becomes turnOrder tomorrow
  log: [ Event ]          // append-only; UI replays this, also the reactivity feed
}

Tile = {
  id,
  kind,        // 'KEEPER' | 'SHORT' | 'JUMBO' | 'EGGER'
  weightLb,    // 1..3 (keepers/jumbos)
  color        // 'common' | 'rare'  (rare only on some keepers)
}
```

The **public/private split** is enforced here: `deployed[]` is world-visible (position + owner), `soak{}` is keyed by buoyId but only ever serialized into the owning player's own view. The UI's "current player" screen reads its own soak; opponents' soak is never in the DOM.

---

## 5. Config (the single tuning surface)

Starting values below are **deliberate guesses to start play**, not balanced truth. Expect to move most of them.

```js
config = {
  // --- structure ---
  players: 3,              // 3..4 for prototype
  days: 5,
  hoursPerDay: 6,
  actionsPerTurn: 2,
  buoysPerPlayer: 4,
  startMoney: 10,
  startReputation: 5,      // mid of a 0..10 track
  fuelTankMax: 10,
  startFuel: 8,
  fuelCostPerUnit: 1,      // money to refuel 1 unit at harbor

  // --- map: nodes + edges (a small graph) ---
  map: {
    nodes: {
      PORT:     { type: 'harbor' },
      INSHORE:  { type: 'ground', ground: 'inshore' },
      MID:      { type: 'ground', ground: 'mid' },
      OFFSHORE: { type: 'ground', ground: 'offshore' }
    },
    edges: [ ['PORT','INSHORE'], ['INSHORE','MID'], ['MID','OFFSHORE'] ],
    // distances all 1 per edge; OFFSHORE is 3 from PORT (6 fuel round trip)
    fuelPerStep: 1
  },

  // --- bags: composition by tile (drives depletion + value) ---
  // counts are tiles in each bag at season start
  bags: {
    inshore:  { KEEPER_1lb: 14, KEEPER_2lb: 6, SHORT: 14, JUMBO: 2, EGGER: 4 },   // 40, low ceiling
    mid:      { KEEPER_2lb: 12, KEEPER_3lb: 6, RARE_2lb: 2, SHORT: 8, JUMBO: 3, EGGER: 4 }, // 35
    offshore: { KEEPER_3lb: 12, RARE_3lb: 4, SHORT: 4, JUMBO: 5, EGGER: 5 }       // 30, high ceiling + more breeders
  },

  // --- soak curves: time+place. stage by DAYS since drop. ---
  // index = days soaked (0 = dropped this day). Each ground its own curve shape.
  soakCurves: {
    inshore:  ['SET','PRIME','PRIME','PRIME','FOULED'],          // forgiving, wide prime
    mid:      ['SET','SOAKING','PRIME','PRIME','OVERRIPE','FOULED'],
    offshore: ['SET','SOAKING','SOAKING','PRIME','OVERRIPE','FOULED'] // narrow prime (day 3 only)
  },

  // --- draw rules by stage: how many tiles drawn / kept on haul ---
  drawByStage: {
    SET:      { draw: 1, keep: 1 },
    SOAKING:  { draw: 2, keep: 1 },
    PRIME:    { draw: 3, keep: 2 },
    OVERRIPE: { draw: 2, keep: 1 },
    FOULED:   { draw: 1, keep: 1 }
  },

  // --- actions costs (in player actions) ---
  actionCost: { STEAM: 1, DROP: 1, HAUL: 1, STEAL: 2, SELL: 1, REFUEL: 1, REPORT: 1, BERTH: 0 },

  // --- market ---
  buyers: {
    coop:    { base: 4, elasticity: 0.2, floor: 2, rareBonus: 0 },     // bulk, stable
    tourist: { base: 7, elasticity: 1.0, floor: 3, rareBonus: 0.5 }    // small appetite, floods fast, loves rare
  },
  // price = max(floor, base - elasticity * lbsSoldToday); recovers fully overnight

  // --- turn order / berthing ---
  poleRepCost: 1,          // rep lost for claiming the FRONT slot (slot 0)
  bribeMoneyCost: 4,       // money to jump to front slot if you didn't berth early enough
  lastSlotSweetenerFuel: 2,// fuel granted to whoever ends in the worst slot

  // --- reputation deltas ---
  rep: { steal: -2, illegalKeep: -1, report: +1, vNotch: +1, bribe: -1 },

  // --- conservation ---
  vNotchTokenValue: 1,     // VP per v-token at end (also see scoring)
  // theft: stolen tiles confiscated on a successful report; reporter bounty:
  reportBountyShare: 0.5,  // fraction of confiscated value paid to reporter

  // --- scoring (see §10) ---
  scoring: {
    moneyPerVP: 5,         // $5 = 1 money-VP
    conservationBagHealthVP: 10, // VP awarded * (avg bag health % at end)
    repToVP: 1,            // rep point = 1 VP (over a baseline)
    combineMode: 'weakLinkMultiplier' // 'sum' | 'weakLinkMultiplier'
  },

  // --- deferred feature flags ---
  flags: { weather: false, eras: false, multiShip: false, inspections: false }
}
```

---

## 6. Game flow / state machine

```
GAME_START
  -> build initial state, randomize day-1 turn order, fill bags, set prices to base
PLAYING (loop):
  for hour in 1..hoursPerDay:
    for playerId in turnOrder (skip berthed):
      activePlayer = playerId
      actionsLeft = actionsPerTurn
      player takes actions until: actionsLeft == 0, OR player passes, OR player BERTHs
  after hour loop (or once all players berthed): -> DAY_ROLLOVER
DAY_ROLLOVER:
  - any unberthed players auto-berth into remaining slots (worst first); grant lastSlot sweetener
  - turnOrder = pendingNextOrder; reset pendingNextOrder, nextSlot=0
  - advance every deployed buoy's soak stage by 1 along its ground curve
  - unsold hold tiles: carry to tomorrow at decay (see §7.7) — or discard if FOULED rule triggers
  - recover all buyer prices to base
  - reset soldToday=false, berthed=false, actionsLeft, refill fuel? NO (fuel persists; you refuel at harbor)
  - day += 1; if day > config.days -> GAME_OVER else -> PLAYING
GAME_OVER:
  - compute final scores (§10)
```

**Interleaving note:** the thing that makes the ocean live is that state visibly changes between a player's turns. Every action that touches a *contested* resource appends a `log` Event the UI surfaces immediately (a buoy hauled, a price dropped, a buoy stolen, a slot claimed). The reactivity test for any new action: *does resolving it change what the next player should do?*

---

## 7. Subsystem rules

### 7.1 Movement & fuel (`movement.js`)
- `STEAM(toNode)`: requires edge from current node, `fuel >= fuelPerStep`, `actionsLeft >= 1`. Spends 1 fuel, 1 action, moves boat.
- `reachableNodes(player)` selector: nodes within current fuel range **that still leave enough fuel to return to PORT** — surface this in UI as "safe range" vs "one-way range" so the clock/fuel squeeze is legible.
- Out of fuel = can't steam. (No towing in v0; getting stranded is a self-inflicted lesson.)

### 7.2 Buoys & the public/private split (`buoys.js`)
- `DROP(buoyId)`: at a ground node, `available > 0`, 1 action. Creates a public `deployed` entry (node, owner) **and** a private `soak{buoyId} = {ground, stage:'SET'}`. They're paired by `buoyId`; opponents see the token, never the stage.
- `HAUL(buoyId)`: own buoy, same node, 1 action. Reads private stage → resolves draw (§7.4) → returns buoy to `available`, removes public token + private marker.
- Buoys are scarce (4). You **cannot** drop-and-forget; the limit forces the cycle.

### 7.3 Soak / time+place (`soak.js`)
- Stage is **not** stored as a number on the public token. It's derived at rollover by indexing the ground's curve with `daysSoaked`. Store `daysSoaked` privately and recompute stage, or store stage and advance it — either works; keep it in the private slice.
- Same buoyId on `offshore` rides a different curve than on `inshore`: position (public) determines which hidden schedule applies. This is the whole point — opponents reading your buoy's *location* can infer your *risk profile* but never your *timing*.

### 7.4 Bags, draw, throwbacks, v-notch (`bags.js`, `conservation.js`)
On `HAUL`:
1. `{draw, keep} = drawByStage[stage]`.
2. Draw `draw` tiles from that ground's bag (RNG, §11). **If the bag is near-empty, draws skew to whatever's left** — a stripped offshore bag returns mostly SHORT/JUMBO/EGGER. This is the commons biting; no special rule needed.
3. Player classifies each drawn tile:
   - `KEEPER` → may keep (counts toward `keep` limit), goes to `hold`.
   - `SHORT` / `JUMBO` → **illegal**. Throw back (returns to bag) for free, OR keep illegally: rep `illegalKeep`, tile to `hold` (sells like its weight).
   - `EGGER` → throw back to **v-notch**: tile returns to bag, `vTokens += 1`, conservation track `+= rep.vNotch`-equivalent. OR keep illegally (rep hit), sells.
4. Kept tiles beyond `keep` limit must be thrown back.
- **v-token spend:** during a haul, spend 1 token to upgrade one drawn tile (e.g., redraw, or bump a SHORT to the smallest KEEPER). Narrow on purpose — tokens do **one** job (draw insurance) and contribute VP at end. Do **not** let them buy fuel/bribes.
- **Accounting invariant:** the only way a tile leaves a bag permanently is a *sale* (clean or illegal). Eggers/throwbacks return. So bag level trends down iff players profit — depletion is purely endogenous. Assert this in tests.

### 7.5 Market (`market.js`)
- `SELL(buyerId)`: at PORT, `!soldToday`, has `hold`, 1 action. Sells **entire hold** to one buyer.
- Price per lb = `max(floor, base - elasticity * lbsSoldToday_thisBuyer)`. Rare color adds `rareBonus` per lb (tourist loves rare).
- Selling **drops that buyer's price immediately and visibly** (flood). Recovers to base overnight.
- One sale per day → choosing buyer + timing is a one-shot bet. Get to harbor and sell before rivals flood your buyer.
- Miss it (hour H ends, hold non-empty, never sold) → catch carries at decay.

### 7.6 Turn order / berthing (`turnorder.js`)
- `BERTH`: only at PORT, on your turn. Ends your day. Claims the next open slot (`nextSlot++`) into `pendingNextOrder`. **The order players berth = tomorrow's turn order.**
- Claiming **slot 0** (first to berth) costs `poleRepCost` rep — muscling to the front is a social cost, charged the same however you got there.
- `BRIBE`: if you didn't berth early enough, pay `bribeMoneyCost` money + `rep.bribe` to swap into the front slot. (Unifies with poleRepCost: front slot always costs rep; bribe adds the money.)
- Auto-berth at day end fills worst slots; the player in the **last** slot gets `lastSlotSweetenerFuel` so a hard-fishing late return isn't a death spiral.
- The trade: **berth early = better slot, fewer fishing hours; fish late = fat day, worse slot.** Same tension, expressed purely through *when you choose to berth*.

### 7.7 Carry-over / decay
- Unsold hold tiles at rollover lose value (e.g., one weight tier, or a flat % via a `holdDecay` config you can add). Keeps "missed the market" a *wound*, not a wipeout. Start lenient; tighten if players ignore the clock.

### 7.8 Theft & reporting (`theft.js`)
- `STEAL(buoyId)`: rival's buoy at your node, costs **2 actions** (the multi-beat — so even a first-mover can't reach-pull-flee unopposed in one lap; the victim, acting later the same hour, gets a window to defend/haul). Resolves the draw using the *owner's* hidden stage (the thief is gambling blind on ripeness). Rep `steal`. The owner's public token vanishing is the tell.
- `REPORT(thiefId)`: a victim whose buoy was stolen *this day* may report at PORT, 1 action. Warden confiscates the stolen tiles from the thief; reporter gets `reportBountyShare` of their value + `rep.report`. Theft is thus self-targeting (you only steal from someone with ripe pots worth the gamble) and policed by the victim spending their own tempo.

---

## 8. Action list (dispatchable)

| Action | Where | Cost (actions) | Pre-conditions | Effect |
|---|---|---|---|---|
| STEAM | any edge | 1 | fuel≥1, edge exists | move, −1 fuel |
| DROP | ground | 1 | available>0 | place buoy, soak=SET |
| HAUL | own buoy here | 1 | — | draw + resolve, recover buoy |
| STEAL | rival buoy here | 2 | — | draw on owner's stage, rep− |
| SELL | PORT | 1 | !soldToday, hold>0 | sell hold to chosen buyer, price drops |
| REFUEL | PORT | 1 | money≥cost | buy fuel up to tank max |
| REPORT | PORT | 1 | was robbed today | confiscate + bounty |
| BERTH | PORT | 0 | — | end day, claim slot |
| BRIBE | PORT | 0 | money≥cost | swap to front slot |
| PASS | — | — | — | end turn early |

`canDo(state, playerId, action)` validates all preconditions; `legalActions(state, playerId)` powers the UI's available-buttons. Keep validation in `/actions`, separate from effects in `/engine`.

---

## 9. Hot-seat UI notes
- One device, pass-and-play. Big **"Current captain: X"** banner; a **"Pass device"** confirm screen between turns so nobody sees a rival's private soak.
- Current player's screen shows: their hold, their buoys' **stages** (private), fuel/money/tracks, legal actions as buttons, the **safe-range vs one-way-range** map highlight.
- Shared/public panel (always visible): the ocean with all buoy tokens (owner-colored, no stage), live buyer prices, the day/hour clock, the berth slots filling up, the three tracks for **all** players (public leaderboard = target map), and the live event log.
- No animations needed. Render from `state` + `selectors`; every action re-renders. Undo = keep an action history and replay from seed (you already have pure reducers + a seed).

---

## 10. Scoring (`scoring.js`)
Per player, convert tracks to VP:
- **money** → `money / moneyPerVP`.
- **conservation** → `vTokens * vNotchTokenValue` **+** `conservationBagHealthVP * avgBagHealth` where `avgBagHealth = mean(remaining/start across bags)`. So a stripped commons devalues *everyone's* banked conservation — greed attacks the steward.
- **reputation** → `repToVP * rep`.

Combine via `config.scoring.combineMode`:
- `sum`: just add. (Baseline; expect it to collapse to money-grinding — useful as a control.)
- `weakLinkMultiplier` (recommended): `total = (mVP+cVP+rVP) * (minTrackVP / maxTrackVP)`. Dumping any track toward zero craters the multiplier, forcing each archetype to keep its weak track off the floor without playing identically. **Make this swappable** — comparing the two in play is itself a key experiment.

---

## 11. Randomness (keep it controllable)
- All RNG (bag draws) goes through **one seeded generator** stored as `rngSeed` in state; the reducer threads and advances it. This makes games **reproducible** (essential for debugging a balance bug) and lets you replay an action log deterministically.
- No `Math.random()` inside engine code, ever.
- For tuning, expose a **"fixed seed"** dev toggle so you can replay the same bag sequence across rule changes and isolate what the *rules* did vs what the *draws* did.

---

## 12. What to watch on the first plays (the dials, in priority order)

1. **Initiative ≈ marginal haul?** The master balance. To berth early (good slot) you fish less. Is the value of sailing first ~one good haul? If everyone races home for pole → grounds under-fished, greed engine stalls → cut pole's value or raise `poleRepCost`. If nobody bothers → raise what going-first buys (first crack at the fullest bag). *Watch:* do players agonize over when to berth, or is there an obvious default?
2. **Flood rate vs depletion rate.** `buyers.*.elasticity` vs `bags` size. Does dumping a big catch *visibly hurt* and make rivals pivot ports? Does the offshore bag actually thin across 5 days, or is it inexhaustible? The commons must trend down.
3. **Market-close harshness** (`holdDecay`). Is missing the sale a tense wound or a random wipeout? Tune toward "wound."
4. **v-token strength.** Does conservation rescue a lean-year draw *without* fully replacing the lobster given up? You want a little regret on every v-notch. Too weak → everyone defects, conservation is flavor. Too strong → eggers hoarded, bag never depletes.
5. **Steward dominance check.** Is clean play strictly safer-and-better? If conservation+rep+weathering-lean-years all favor one passive line, the knife-fight drains. The brake is *tempo*: thief scores now, steward banks for the end. Keep steward payoff back-loaded, thief front-loaded.
6. **Theft as chase, not snipe.** Does the 2-action steal cost actually give victims a window to react, or does a first-mover pull ripe pots unopposed? If unopposed → raise steal cost or let defense interrupt.
7. **Last-slot death spiral.** Does the trailing player climb out (bribe valve + sweetener), or get locked into always-last? Adjust sweetener.
8. **`combineMode` comparison.** Play once with `sum`, once with `weakLinkMultiplier`. Does the multiplier actually produce three distinct viable archetypes?

---

## 13. Suggested build order
1. State + config + reducer skeleton + seeded RNG. Drive via a script, no UI.
2. Movement + buoys + soak + bags + draw. Verify the accounting invariant (bags only drop on sales) in a test.
3. Market + sell. 
4. Turn order / berthing. 
5. Theft + report. 
6. Scoring. 
7. Thin hot-seat UI last — by now a test script already "plays" full games, so the UI is just a renderer + button dispatcher.

> Everything deferred (weather, eras, multi-ship, inspections) should slot in as a new `/engine` module + a `config.flags` toggle + a config block, with zero edits to existing modules. If adding one of them later forces edits elsewhere, the decoupling failed and that's worth fixing then.

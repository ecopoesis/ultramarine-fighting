import type { Config, Ground } from '../types';
import { tileTemplate } from '../tiles';

// The RULES PROMPT for an LLM captain — generated from the live config so every
// number the agent reads is the number the engine uses. Written as a rulebook a
// human could play from; the command syntax section at the end is the contract
// the harness parses (see view.ts / agent.ts).

const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];

function bfsDistances(cfg: Config, from: string): Record<string, number> {
  const adj: Record<string, string[]> = {};
  for (const n of Object.keys(cfg.map.nodes)) adj[n] = [];
  for (const [a, b] of cfg.map.edges) { adj[a].push(b); adj[b].push(a); }
  const dist: Record<string, number> = { [from]: 0 };
  const q = [from];
  while (q.length) {
    const n = q.shift()!;
    for (const m of adj[n]) if (!(m in dist)) { dist[m] = dist[n] + 1; q.push(m); }
  }
  return dist;
}

function adjacency(cfg: Config): Record<string, string[]> {
  const adj: Record<string, string[]> = {};
  for (const n of Object.keys(cfg.map.nodes)) adj[n] = [];
  for (const [a, b] of cfg.map.edges) { adj[a].push(b); adj[b].push(a); }
  return adj;
}

function bagLine(cfg: Config, g: Ground, scale: number): string {
  const parts: string[] = [];
  let total = 0;
  for (const [name, count] of Object.entries(cfg.bags[g])) {
    const n = Math.round(count * scale);
    total += n;
    const t = tileTemplate(name);
    const desc = t.kind === 'KEEPER' ? `${n}× ${t.weightLb}lb keeper${t.color === 'rare' ? ' (RARE)' : ''}`
      : t.kind === 'SHORT' ? `${n}× SHORT (undersized, worth 0)`
      : t.kind === 'JUMBO' ? `${n}× JUMBO (oversized, ${t.weightLb}lb if kept illegally)`
      : `${n}× EGGER (berried female, worth 0)`;
    parts.push(desc);
  }
  return `- ${g}: ${total} tiles — ${parts.join(', ')}`;
}

export function buildRulesPrompt(cfg: Config, players: number): string {
  const scale = players / cfg.referencePlayers;
  const adj = adjacency(cfg);
  const dist = bfsDistances(cfg, cfg.map.startPort);
  const days = cfg.daysSchedule ?? Array(cfg.seasons).fill(cfg.daysPerSeason);
  const totalDays = days.reduce((a, b) => a + b, 0);

  const nodeLines: string[] = [];
  for (const [id, n] of Object.entries(cfg.map.nodes)) {
    let kind: string;
    if (n.type === 'port') {
      const p = n.port!;
      kind = p.market
        ? `MARKET PORT — sells lobster (base ${p.market.base}/lb, price drops ${p.market.elasticity}/lb per lb landed here today, floor ${p.market.floor}/lb, rare bonus +${p.market.rareBonus}/lb); fuel ${p.fuelCostPerUnit}/unit${p.market.coopRep ? ` — THE CO-OP: landing ${p.market.coopMinLb ?? 0} lb or more here earns +${p.market.coopRep} reputation` : ''}`
        : `SHELTER — refuge and emergency fuel only (${p.fuelCostPerUnit}/unit, dear), NO market; never storms`;
    } else {
      kind = `${n.ground!.toUpperCase()} fishing ground`;
    }
    nodeLines.push(`- ${id} (${n.label ?? id}) [${dist[id]} steps from ${cfg.map.startPort}]: ${kind}. Adjacent: ${adj[id].join(', ')}`);
  }

  const curveLines = GROUNDS.map((g) => {
    const c = cfg.soakCurves[g];
    const primeIdx = c.indexOf('PRIME');
    return `- ${g}: ${c.map((s, i) => `${i}n=${s}`).join(', ')} (first haulable after ${primeIdx} night${primeIdx === 1 ? '' : 's'}; stays at the last stage after that)`;
  });

  const drawLines = Object.entries(cfg.drawByStage).map(([s, r]) => `- ${s}: draw ${r.draw}, keep up to ${r.keep} keepers`);

  const stormTrack = cfg.weather.track.map((row, i) => `S${i + 1}: inshore ${row.inshore}, mid ${row.mid}, offshore ${row.offshore}, deep ${row.deep}`).join(' | ');

  const upgradeLines = cfg.upgrades.catalog.map((u) => {
    const fx: string[] = [];
    if (u.stepsPerSteam) fx.push(`STEAM moves up to ${u.stepsPerSteam} nodes per action`);
    if (u.stormImmune) fx.push('immune to the storm entry hazard');
    if (u.freeAction) fx.push(`${u.freeAction} costs 0 actions`);
    if (u.fuelBonus) fx.push(`+${u.fuelBonus} fuel capacity`);
    if (u.buoyBonus) fx.push(`+${u.buoyBonus} pot`);
    return `- ${u.id} "${u.label}" — slot ${u.slot}, cost ${u.cost}: ${fx.join('; ')}`;
  });

  const weakLink = (cfg.scoring.weakLink ?? []).map((r) => `lowest track ≥ ${r.atLeast === -Infinity ? 'anything' : r.atLeast} → ×${r.mult}`).join('; ');
  const health = (cfg.scoring.healthBuckets ?? []).map((b) => `≥${Math.round(b.atLeast * 100)}% → ${b.vp} VP`).join('; ');

  const actionCosts = Object.entries(cfg.actionCost).map(([k, v]) => `${k} ${v}`).join(', ');
  const draftSeasons = Array.from({ length: Math.max(0, cfg.seasons - 2) }, (_, i) => i + 1);

  return `# LOBSTERS — the rules (${players}-player game)

You are the captain of a lobster boat in Penobscot Bay, Maine. Over ${cfg.seasons} seasons you fish a shared ocean against ${players - 1} rival captains. The ocean is a commons: what anyone takes is gone for everyone until the inter-season restock. The winner is the captain with the highest final SCORE, which combines three tracks — MONEY, CONSERVATION and REPUTATION — with a weak-link multiplier that punishes neglecting any one of them.

## 1. Structure and time
- ${cfg.seasons} seasons. Days per season: ${days.map((d, i) => `S${i + 1}=${d}`).join(', ')} (${totalDays} days total). Later seasons are longer.
- Each day has ${cfg.hoursPerDay} hours. Each hour, every captain who has not yet berthed takes one TURN in the day's turn order. A turn is up to ${cfg.actionsPerTurn} action points. Action costs: ${actionCosts}. Unspent points are lost at the end of the turn.
- Between your turns the other captains act, so the ocean changes under you.
- At the start of each season every boat is back at ${cfg.map.startPort} with all pots in hand and turn order reset to seat order. Fuel, money, v-tokens, refits and anything still in your hold carry over (the hold keeps decaying). Every pot still in the water is pulled at the season change — whatever it would have caught is lost.

## 2. The map
A graph of nodes. STEAM moves you one edge per action (${cfg.map.fuelPerStep} fuel per step). You start at ${cfg.map.startPort}.
${nodeLines.join('\n')}

Tiers: inshore (4 nodes, up-bay, never storms) → mid (6, the island belt) → offshore (6, outer water) → deep (1, "The Edge"). Round trip to the deep is long: plan fuel and days.

## 3. Pots (buoys), soaking, hauling
- You own ${cfg.buoysPerPlayer} pots. DROP places one on the fishing ground you are standing on (1 action). Its position is PUBLIC, and rivals who pay attention see when you drop it; its soak stage is never displayed to them (they must infer it).
- A pot ripens overnight along its ground's soak curve (index = nights soaked):
${curveLines.join('\n')}
- A pot can only be hauled (or stolen) once it has reached PRIME. Draw rules by stage (tiles drawn from that ground's bag; keep limit applies to keepers):
${drawLines.join('\n')}
- Tile kinds: KEEPER (legal, weight 1–4 lb, some RARE — sell for a bonus at island ports). SHORT (undersized, illegal, worth 0). JUMBO (oversized, illegal, but weighs ${tileTemplate('JUMBO').weightLb} lb if you keep it). EGGER (berried female, illegal, worth 0). V-NOTCHED (a breeder somebody already notched and released — see below).
- When you haul you choose a policy for the drawn tiles:
  - clean: keep legal keepers (up to the keep limit, heaviest first), throw shorts and jumbos back, V-NOTCH every egger.
- V-NOTCHING, and why eggers are FINITE: when you notch an egger you TAKE her out of the bag (she is your proof: +1 conservation and +1 v-token) and drop a V-NOTCHED lobster in her place. The bag is the same size, but that lobster is now a protected breeder: whoever draws her later must release her and scores NOTHING. So each egger in the ocean pays exactly once, to whoever notches her first, and every notch leaves behind a tile that dilutes all future hauls — including your own. Protecting the breeding stock genuinely costs you catch.
  - highgrade: like clean, but KEEP jumbos (${cfg.rep.illegalKeep} reputation each). Shorts still go back, eggers still v-notched.
  - greedy: keep every illegal tile drawn, eggers included (${cfg.rep.illegalKeep} reputation per illegal tile; eggers kept this way earn nothing and are not v-notched).
  - Keepers over the keep limit go back in the bag.
- V-TOKEN INSURANCE: if a haul draws no keeper at all, you may spend one v-token to draw ${cfg.vToken.insuranceDraws} extra tile(s) and keep the best keeper among them (the token is spent either way). Say "token" on the HAUL command to enable this.
- Hauling returns the pot to your hand. A hauled catch goes to your HOLD.
- SEEDED LOBSTERS: at the start of every season one generic ${cfg.seeded.weightLb} lb keeper is placed on EVERY fishing node, and they accumulate on nodes nobody fishes. Whoever hauls (or steals) a pot on a node first collects that node's whole seeded pile, before the bag draw. Neglected corners become jackpots.

## 4. The bags (the commons)
Each ground TYPE has one shared bag (all ${cfg.map.nodes ? Object.values(cfg.map.nodes).filter((n) => n.ground === 'mid').length : 6} mid nodes draw from the same mid bag, etc). Starting contents for ${players} players:
${GROUNDS.map((g) => bagLine(cfg, g, scale)).join('\n')}
Throwbacks return to the bag. Sold bag lobsters do not vanish: they land on that ground's extraction PILE, from which the restock draft can return them (seeded lobsters are the exception: sold, they leave the world). Keeper DENSITY (keeper lb per tile in the bag) is what makes a ground worth fishing; as keepers are stripped, hauls turn up junk. The bag contents are public knowledge (you may track what has been taken).

## 5. Selling, markets, fuel
- SELL (${cfg.actionCost.SELL} action) sells your ENTIRE hold at the market port you are docked in, once per day. THE CO-OP: the home port pays the least per pound, but landing a real day's catch there (see the port list for the poundage) earns reputation — the only repeatable way to raise it. A token landing does not count. Price per lb = max(floor, base − elasticity × lb already landed at that port today) (+ rare bonus for RARE keepers). Landing catch floods that port for the rest of the day — for everyone. Prices recover overnight.
- Unsold keepers/jumbos lose ${cfg.holdDecayLbPerDay} lb per night in the hold (to a minimum of 1 lb).
- CREW WAGES: at the end of EVERY day you pay your sternman ${cfg.wagePerDay} money, whether you landed anything or not (you cannot be taken below zero). A day is the unit you pay for, so a day your gear isn't ready is a day you paid for nothing. Note that four pots set as two waves of two yield the same hauls per day as all four at once, but with no waiting days — what that costs you is the freedom to be somewhere else on the off day.
- REFUEL (${cfg.actionCost.REFUEL} action) at any port buys fuel at that port's price, up to your tank (base ${cfg.fuelTankMax}, more with the tank refit). You start with ${cfg.startFuel} fuel and ${cfg.startMoney} money.
- TOW: if the day ends and you are not at a port, you are towed to the nearest port: −${cfg.tow.fee} money (never below zero), fuel topped up to at least ${cfg.tow.emergencyFuel} (you keep more if you had more), and you LOSE your next ${cfg.tow.lostTurns} turns. Make harbor before the day ends.

## 6. Berthing and turn order
- BERTH (free) at any port ends your day there; you start tomorrow at that port. The ORDER captains berth is tomorrow's turn order. Anyone not berthed by the end of hour ${cfg.hoursPerDay} is auto-berthed into the remaining slots in today's turn order. The order is a GRADIENT paid at day's end, and you cannot dodge either end of it by refusing to decide: whoever holds slot 0 (tomorrow's first mover) pays ${cfg.poleRepCost} reputation for pushing to the front, however they got there; whoever holds the LAST slot gains +${cfg.lastSlotRep} reputation ("after you") plus ${cfg.lastSlotSweetenerFuel} fuel, provided they made harbour under their own power — a boat that was towed in gets the fuel but no standing. The captain in the LAST slot gets +${cfg.lastSlotSweetenerFuel} fuel.
- BRIBE (free, at a port): pay ${cfg.bribeMoneyCost} money and ${cfg.rep.bribe} reputation to jump to the FRONT of tomorrow's order (and berth now if not yet berthed).
- Turn order matters: first mover gets first pick of ripe grounds, seeded piles, chandlery refits and unflooded markets — and first claim in the restock draft.

## 7. Theft and reporting
- STEAL (${cfg.actionCost.STEAL} actions): haul a RIVAL's pot sitting on your node, if it is ripe (you only know it is ripe when the game lists it as stealable). You get the catch (and the node's seeded pile), the owner gets their empty pot back, you lose ${-cfg.rep.steal} reputation. The theft is public.
- REPORT (${cfg.actionCost.REPORT} action, at any port, if you were robbed): you gain +${cfg.rep.report} reputation and a bounty of ${cfg.reportBountyShare * 100}% of the stolen catch's book value; the thief loses a further ${-cfg.rep.reported} reputation. One report per theft.

## 8. Weather
Season 1 is calm. From season 2 storms are placed at random on some nodes per tier and re-rolled each season, intensifying: (nodes stormed per tier) ${stormTrack}. Shelters and inshore never storm.
- ENTERING a stormed node: ${cfg.weather.hazardChance * 100}% chance to lose ${cfg.weather.hazardFuel} fuel.
- Each night, every pot left in a stormed node has a ${cfg.weather.whittleChance * 100}% chance to be PARTED — lost for the rest of the season (you get it back at the season change).
- HAULING a pot in a stormed node draws +${cfg.weather.bonusDraws} extra tiles and raises the keep limit by ${cfg.weather.bonusKeep}: a fat, risky haul.
- The radar refit makes you immune to the entry hazard (not the whittle).

## 9. Restock draft (between seasons, except into the final season)
${draftSeasons.length ? `After season${draftSeasons.length > 1 ? 's' : ''} ${draftSeasons.join(', ')} there is a RESTOCK DRAFT (none before the final season: the ocean gets no relief for the last year).` : 'There is NO restock draft in this game (it only happens between seasons that are not the last).'} In berth order (the order you berthed on the last day), each captain in turn CLAIMS one bag that has not yet been claimed, rolls the lobster die (faces ${cfg.restock.dieFaces.join('/')}) and returns that many lobsters of their choice from that bag's PILE into the bag (a roll of 0 wastes the claim but still locks the bag). After each claim, going around from the claimer's left, every other captain may CONTRIBUTE v-tokens: each token spent returns one more lobster of their choice from the pile to that bag (the token is gone — you trade end-game VP for a healthier commons). With ${GROUNDS.length} bags and ${players} captains, ${players > GROUNDS.length ? 'the tail of the berth order never gets to claim' : 'every captain claims once'}.

## 10. Ship refits (upgrades)
Market ports have a chandlery with ${cfg.upgrades.display} refits face-up (of ${cfg.upgrades.perPortStock} in stock, random; the next slides up when one is bought). BUY costs ${cfg.actionCost.BUY_UPGRADE} action + the price, at that port only, one refit per slot (3 slots: stern, midPrimary, midSecondary), never replaced. Catalog:
${upgradeLines.join('\n')}

## 11. Scoring (end of season ${cfg.seasons})
Three tracks, each in victory points (VP):
- MONEY VP = money ÷ ${cfg.scoring.moneyPerVP}.
- CONSERVATION VP = your v-tokens still held (×${cfg.scoring.vNotchTokenValue}) + your conservation track (+1 per egger v-notched over the game) + a shared commons-health bonus read from the average bag fullness at the end (${health}) — everyone gets the same bonus, so a stripped ocean hurts every steward.
- REPUTATION VP = reputation × ${cfg.scoring.repToVP}. You start at ${cfg.startReputation} reputation.
- TOTAL = (money VP + conservation VP + reputation VP) × a multiplier from your LOWEST track: ${weakLink}. A dumped track zeroes you; a balanced captain scores in full. Highest total wins; ties share.
- Rough scale: a 20 VP track is 100 money, or 20 conservation, or 5 reputation points. Reputation is expensive to rebuild (only +1 per report, +0 otherwise), so treat it as a budget you spend, not a free resource.

## 12. How you play (command contract)
Each time it is your decision, you receive the current situation (public state, your private pot ripeness, events since your last decision, and the list of legal actions right now) and you reply with JSON: {"plan": ["<command>", ...], "note": "<brief reasoning, ≤60 words>"}.
Commands (one per string, uppercase keyword first):
- STEAM <NODE> — move to an adjacent node (with a bigger engine, up to 2 nodes away).
- GOTO <NODE> — macro: steam step by step toward NODE across as many turns as needed (spends 1 action per hop). Stops if fuel runs out or the day ends.
- DROP — place a pot on this fishing ground.
- HAUL <potId> [clean|highgrade|greedy] [token] — haul your ripe pot here (default clean, no token).
- STEAL <potId> [clean|highgrade|greedy] [token] — steal a rival's ripe pot here.
- SELL — sell your whole hold at this market port.
- REFUEL [units] — buy fuel here (default: fill the tank or spend what you can).
- BUY <refitId> — install a face-up refit here.
- REPORT — report a theft against you (at a port).
- BERTH — end your day here (claims the next berth slot).
- BRIBE — pay to take the front slot (and berth).
- PASS — end this turn (unspent actions are lost).
- REPLAN — abandon the rest of your plan and be asked again with a fresh situation report.
- During a restock draft: CLAIM <ground> [heavy|light] — claim that bag and return up to your roll of the heaviest (default) or lightest lobsters from its pile; CONTRIBUTE <n> [heavy|light] — spend n v-tokens on the open bag (0 to pass).
Your plan is executed in order and CARRIES ACROSS TURNS AND DAYS — it runs until it is exhausted, a step becomes impossible (you are asked again, with the reason), something happens to you (theft, storm damage, tow), or you REPLAN. So you can commit to a whole multi-day trip in one decision: steam out, drop, BERTH for the night, haul the next morning once it has ripened, run in and SELL. That is the intended way to play the far grounds, where a round trip cannot fit in a day.

A step that is legal but simply unaffordable this turn (you are out of action points) is NOT an error — it waits for your next turn automatically. Actions cost points as listed; a turn ends when your points are spent, on PASS/BERTH/BRIBE, or when nothing else in the plan is affordable.

The trade-off is judgement: a long plan saves you decisions and buys tempo, but the ocean moves between your turns — rivals haul the ground you were steaming to, a port floods before you reach it, a storm re-rolls at the season change. Plan long where you are committed (a far trip) and short where the situation is contested, and REPLAN when you want to look again. Always reply with valid JSON and at least one command.`;
}

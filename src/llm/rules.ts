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
      : `${n}× EGGER (berried female, ${cfg.eggerWeightLb} lb)`;
    parts.push(desc);
  }
  return `- ${g}: ${total} tiles — ${parts.join(', ')}`;
}

// Chance a heat check with `dice` dice totals at least `failAt`, by exact enumeration
// of the configured faces — printed for the captains as a lookup, never computed at the table.
function bustOdds(faces: number[], dice: number, failAt: number): { fail: number; zeros: number } {
  let dist: Record<number, number> = { 0: 1 };
  for (let i = 0; i < dice; i++) {
    const next: Record<number, number> = {};
    for (const [t, pr] of Object.entries(dist)) for (const f of faces) next[Number(t) + f] = (next[Number(t) + f] ?? 0) + pr / faces.length;
    dist = next;
  }
  const fail = Object.entries(dist).filter(([t]) => Number(t) >= failAt).reduce((a, [, pr]) => a + pr, 0);
  const zeroFace = faces.filter((f) => f === 0).length / faces.length;
  return { fail, zeros: Math.pow(zeroFace, dice) };
}

// THE SWITCHBOARD section (flags.alignment): alignment, heat, the warden, closures,
// the dividend, the licence squeeze and the black market. Prose around every number
// is hand-written; the numbers come from config.
function switchboardSection(cfg: Config, players: number): string {
  const a = cfg.alignment, h = cfg.heat, st = a.step;
  const bandRows = a.bands.map((b, i) => {
    const hi = i === 0 ? a.max : a.bands[i - 1].atLeast - 1;
    const lo = b.atLeast === -Infinity ? a.min : b.atLeast;
    const perks = [
      b.priceCut ? `markets pay ${b.priceCut} less per lb (under the table)` : 'full market price',
      `${b.starsPerCrime}★ per crime`,
      b.mustLicense ? 'MUST buy the licence' : 'may skip the licence',
      b.coop ? 'co-op open' : 'co-op closed',
      b.dividend ? 'shares the dividend (if licensed)' : 'no dividend',
      b.refuge ? '' : 'the outer shelters turn you away',
      b.harbourBribe ? 'may bribe the harbourmaster' : '',
      b.blackMarket ? 'black market open' : '',
    ].filter(Boolean).join('; ');
    return `| ${b.name.toUpperCase()} | ${lo} … ${hi} | ${perks} |`;
  });
  const odds = Array.from({ length: h.max }, (_, i) => i + 1).map((n) => {
    const o = bustOdds(h.dieFaces, n, h.failAt);
    return `| ${n} | ${o.fail < 0.005 ? 'never' : `${Math.round(o.fail * 100)}%`} | ${Math.round(o.zeros * 1000) / 10}% |`;
  });
  const slots = a.darkSlotsByPlayers[Math.min(players, a.darkSlotsByPlayers.length - 1)] ?? 0;
  const closures = cfg.closure.levels.map((l) => `below ${l.belowPct}% of its starting size → closed to ${l.closedTo.join(', ')}`).join('; ');
  const dividend = cfg.dividend.byHealth.map((r) => `≥${r.atLeast}% → ${r.money}`).join(', ');
  const dark = cfg.upgrades.catalog.filter((u) => u.dark).map((u) => `${u.id} "${u.label}" (${u.slot}, ${u.cost})`).join(', ');
  return `## THE SWITCHBOARD — alignment and heat
**Money is the only score.** Alignment and heat are not points. They decide HOW you can earn money.

### Alignment: a track from ${a.min} (dark) to +${a.max} (light). Everyone starts at 0, NEUTRAL.
Your band decides what is open to you (the band card):
| band | alignment | what it switches |
|---|---|---|
${bandRows.join('\n')}

What moves you (whole steps, public):
- LIGHTER: notch an egger +${st.notch} each; buy the season's licence +${st.licence}; land ${'a real catch'} at the co-op +${st.coopLanding}; report a theft against you +${st.report}.
- DARKER: keep an illegal tile (egger, jumbo or short) ${st.illegalKeep} each; haul while unlicensed (poaching) ${st.poachHaul} per haul; steal a pot ${st.steal}; bribe the warden or the harbourmaster ${st.bribe}; buy a black-market refit ${st.darkRefit}; get busted by the warden ${st.caught}.
You can cross in either direction, any time. Neutral is a real place to live, but it has neither side's perks. A PARAGON who gets busted falls straight to alignment ${a.paragonFallTo}.

### Heat: 0–${h.max} stars. The warden's check happens every time you SELL.
- A CRIME adds stars according to your band: ${a.bands.map((b) => `${b.name} ${b.starsPerCrime}★`).join(', ')}. Everyone expects an outlaw to cheat; a paragon who cheats is a scandal. Crimes: each illegal tile you keep; each theft; each haul with the illegal net${h.poachHaulIsCrime ? '; each unlicensed haul' : ''}. Hauling a pot from water CLOSED to your band adds +${cfg.closure.starsPerHaul}★ per pot. Being reported for theft adds +${h.reportedStars}★.
- **No stars, no check.** With stars, when you SELL you roll one HEAT DIE per star (faces ${h.dieFaces.join(', ')}) and add them up:
  - total below ${h.failAt}: you are paid, minus the warden's take of ${h.takePerPoint} money per point rolled.
  - **total ${h.failAt} or more: BUSTED. You drop your catch and run.** You are paid nothing, the catch still floods that market, you step ${-st.caught} darker, and THAT PORT IS CLOSED TO YOU for the rest of the day. You cannot berth there, so steam to another port before nightfall or be towed (−${cfg.tow.fee} money and ${cfg.tow.lostTurns} lost turns).
  - every die showing 0: NERVES OF STEEL. You lose a star.
- The odds (a fail line of ${h.failAt}):
| stars (dice) | chance to bust | chance of nerves of steel |
|---|---|---|
${odds.join('\n')}
- **Bribing the warden:** when you SELL you may buy dice off THIS roll only: \`SELL BRIBE <n>\`. The 1st die costs ${h.bribePerDie[0]}, then ${h.bribePerDie.slice(1).join(', ')} (added up). You can never go below one die, and bribing steps you ${-st.bribe} darker. Your stars stay.
- **Cooling off:** every day you do NOT sell, you lose ${h.coolPerDayUnsold}★ at nightfall. Lying low costs you a day's sales and lets the hold lose weight.

### Closed water
Each ground's bag health is public. When a ground falls ${closures}. Closed water is still fishable, but every pot you haul there adds +${cfg.closure.starsPerHaul}★ to you. Light captains fish it freely.

### The co-op dividend
At the end of every season the co-op pays each LICENSED member in a dividend band (Neutral or lighter) money read off the whole ocean's health: ${dividend}. It is the light side's steady income, and it depends on live water.

### The season ${a.squeezeSeason} licence squeeze
In season ${a.squeezeSeason} only ${players - slots} licences are sold at this ${players}-player table, going down the bid order. Whoever is left over fishes unlicensed that season whether they meant to or not. From season ${a.squeezeSeason + 1} there is a licence for everyone again. HONEST and PARAGON captains MUST buy one when they can.

### The black market
A small stack that is never at a chandlery: ${dark}. There is one of each per dark slot (${slots} at this table), and it is open at any market port to SHADY and OUTLAW captains only (\`BUY <id>\`). Buying one steps you ${-st.darkRefit} darker. The illegal net draws and keeps ${cfg.upgrades.catalog.find((u) => u.id === 'net')?.bonusDraws ?? 0} more per haul, and every haul with it is a crime. The cheap engine steams ${cfg.upgrades.catalog.find((u) => u.id === 'smoker')?.stepsPerSteam ?? 1} nodes per action like the big engine, for half the price, and strips an extra lobster off the ground each time you haul.

### The berth
Arrival order is tomorrow's turn order, free: come in early for a good slot. Only SHADY and OUTLAW captains may BRIBE the harbourmaster (${cfg.bribeMoneyCost} money, one step darker, no heat) to jump to the front.

### Reading it
The dark side keeps what the light side throws back, skips the licence and buys the black market, so it lands far more lobster. It pays for that in price, closed doors, the warden's take and the risk of a bust. The light side lands less but sells clean, shares the dividend and never rolls. Either side can win. Which one, and when to cross, is your judgement.`;
}

export function buildRulesPrompt(cfg: Config, players: number): string {
  const al = cfg.flags.alignment;
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
        ? `MARKET PORT — sells lobster (base ${p.market.base}/lb, dropping 1/lb for every ${p.market.dropPerLbs} lb landed here today, floor ${p.market.floor}/lb, rare bonus +${p.market.rareBonus}/lb); fuel ${p.fuelCostPerUnit}/unit${p.market.coopRep ? (cfg.flags.alignment ? ` — THE CO-OP: landing ${p.market.coopMinLb ?? 0} lb or more here steps a licensed co-op-band captain +${cfg.alignment.step.coopLanding} lighter` : ` — THE CO-OP: landing ${p.market.coopMinLb ?? 0} lb or more here earns +${p.market.coopRep} reputation`) : ''}`
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

  const upgradeLines = cfg.upgrades.catalog.filter((u) => !u.dark).map((u) => {
    const fx: string[] = [];
    if (u.stepsPerSteam) fx.push(`STEAM moves up to ${u.stepsPerSteam} nodes per action`);
    if (u.stormImmune) fx.push('immune to the storm entry hazard');
    if (u.whittleMult !== undefined) fx.push(`your pots are ${Math.round((1 - u.whittleMult) * 100)}% less likely to be parted by a storm overnight`);
    if (u.freeAction) fx.push(`${u.freeAction} costs 0 actions`);
    if (u.fuelBonus) fx.push(`+${u.fuelBonus} fuel capacity`);
    if (u.buoyBonus) fx.push(`+${u.buoyBonus} pot`);
    return `- ${u.id} "${u.label}" — slot ${u.slot}, cost ${u.cost}: ${fx.join('; ')}`;
  });

  const weakLink = (cfg.scoring.weakLinkPenalty ?? []).map((r) => `lowest track ≥ ${r.atLeast === -Infinity ? 'anything' : r.atLeast} → −${r.penalty}`).join('; ');
  const health = (cfg.scoring.healthBuckets ?? []).map((b) => `≥${b.atLeast}% → ${b.vp} VP`).join('; ');

  const actionCosts = Object.entries(cfg.actionCost).map(([k, v]) => `${k} ${v}`).join(', ');
  const draftSeasons = Array.from({ length: Math.max(0, cfg.seasons - 2) }, (_, i) => i + 1);
  const deepId = Object.keys(cfg.map.nodes).find((n) => cfg.map.nodes[n].ground === 'deep');
  const deepLabel = deepId ? (cfg.map.nodes[deepId].label ?? deepId) : 'the deep';
  const deepRound = deepId ? dist[deepId] * 2 : 0;

  // Sections the switchboard replaces are wrapped in <!-- --> above and cut here, so a
  // captain never reads a rule that no longer applies.
  return stripHidden(`# LOBSTERS — the rules (${players}-player game)

You are the captain of a lobster boat in Penobscot Bay, Maine. Over ${cfg.seasons} seasons you fish a shared ocean against ${players - 1} rival captains. The ocean is a commons: what anyone takes is gone for everyone until the breeding stock brings it back. ${al ? 'The winner is the captain with the most MONEY at the end. Nothing else scores. How you may earn it is set by your ALIGNMENT and your HEAT (see THE SWITCHBOARD below): you can fish clean or dirty, and both can win.' : 'The winner is the captain with the highest final SCORE, which combines three tracks — MONEY, CONSERVATION and REPUTATION — with a weak-link PENALTY, read off a printed card, that punishes neglecting any one of them.'}

## 1. Structure and time
- ${cfg.seasons} seasons. Days per season: ${days.map((d, i) => `S${i + 1}=${d}`).join(', ')} (${totalDays} days total). Later seasons are longer.
- Each day has ${cfg.hoursPerDay} hours. Each hour, every captain who has not yet berthed takes one TURN in the day's turn order. A turn is up to ${cfg.actionsPerTurn} action points. Action costs: ${actionCosts}. Unspent points are lost at the end of the turn.
- Between your turns the other captains act, so the ocean changes under you.
- At the start of each season every boat is back at ${cfg.map.startPort} with all pots in hand and turn order reset to seat order. Fuel, money, refits and anything still in your hold carry over (the hold keeps decaying). Every pot still in the water is pulled at the season change — whatever it would have caught is lost.

## 2. The map
A graph of nodes. STEAM moves you one edge per action (${cfg.map.fuelPerStep} fuel per step). You start at ${cfg.map.startPort}.
${nodeLines.join('\n')}

Tiers: ${GROUNDS.map((g) => `${g} (${Object.values(cfg.map.nodes).filter((n) => n.ground === g).length})`).join(" → ")}. Inshore is up-bay and never storms; the deep is ${deepLabel}, the farthest water on the board — a round trip there is ${deepRound} lanes, so plan fuel and days before you commit to it. NOTE that depth and distance are not the same thing on this chart: some shallower grounds sit further from ${cfg.map.startPort} than others that are deeper.

## 3. Pots (buoys), soaking, hauling
- You own ${cfg.buoysPerPlayer} pots. DROP places one on the fishing ground you are standing on (1 action). GEAR CONGESTION: a ground only has so much bottom — at this table size each fishing space holds **${Math.max(1, Math.round(cfg.maxPotsPerSpace * (players / cfg.referencePlayers)))} pots in total, counting every captain's**. Once a space is full nobody can set there until gear comes up, so a rich ground is a race for berths as well as for lobster, and a fleet cannot all pile onto the same ledge. Its position is PUBLIC, and rivals who pay attention see when you drop it; its soak stage is never displayed to them (they must infer it).
- A pot ripens overnight along its ground's soak curve (index = nights soaked):
${curveLines.join('\n')}
- A pot can only be hauled (or stolen) once it has reached PRIME. Draw rules by stage (tiles drawn from that ground's bag; keep limit applies to keepers):
${drawLines.join('\n')}
- Tile kinds: KEEPER (legal, weight 1–4 lb, some RARE — sell for a bonus at island ports). SHORT (undersized, illegal, worth 0). JUMBO (oversized, illegal, but weighs ${tileTemplate('JUMBO').weightLb} lb if you keep it). EGGER (berried female, illegal, but ${cfg.eggerWeightLb} lb of meat if you keep her — see below). V-NOTCHED (a breeder somebody already notched and released — see below).
- When you haul you choose a policy for the drawn tiles:
  - clean: keep legal keepers (up to the keep limit, heaviest first), throw shorts and jumbos back, V-NOTCH every egger — which means giving up ${cfg.eggerWeightLb} lb of landable meat each time.
- V-NOTCHING, and why eggers are FINITE: when you notch an egger you TAKE her out of the bag (${al ? `+${cfg.alignment.step.notch} alignment` : `+${cfg.rep.vNotch} conservation`}) and drop a V-NOTCHED lobster in her place, and her ground's BREEDING STOCK track goes up one (see section 9). The bag is the same size, but that lobster is now a protected breeder: whoever draws her later must release her and scores NOTHING. So each egger in the ocean pays exactly once, to whoever notches her first, and every notch leaves behind a tile that dilutes all future hauls — including your own. Notching is a choice about WHERE as well as whether: the water you protect is the water that comes back.
  - highgrade: like clean, but KEEP jumbos (${al ? `each one ${cfg.alignment.step.illegalKeep} alignment and a crime` : `${cfg.rep.illegalKeep} reputation each`}). Shorts still go back, eggers still v-notched.
  - greedy: keep every illegal tile drawn, shorts, jumbos and eggers alike (${al ? `each one ${cfg.alignment.step.illegalKeep} alignment and a crime; shorts weigh nothing` : `${cfg.rep.illegalKeep} reputation per illegal tile`}).
- EGGERS ARE YOUR CALL, separately from the policy: add keep-eggers or notch-eggers to a HAUL or STEAL. Without it, greedy keeps eggers and clean/highgrade notch them. ${al ? `A kept egger goes in your hold and SELLS like any lobster (${cfg.eggerWeightLb} lb at the market price); she costs ${cfg.alignment.step.illegalKeep} alignment and is a crime (heat), is not notched (no breeding stock) and is gone from the ocean for good. A notched egger steps you +${cfg.alignment.step.notch} lighter and grows her ground's breeding stock, and you land nothing. Nobody can see what you drew; alignment and heat are public.` : `A kept egger goes in your hold and SELLS like any lobster (${cfg.eggerWeightLb} lb at the market price), costs ${cfg.rep.illegalKeep} reputation, is not notched (no conservation, no breeding stock) and is gone from the ocean for good. A notched egger earns +${cfg.rep.vNotch} conservation and grows her ground's breeding stock, and you land nothing. Nobody can see what you drew; the reputation track is public.`}
  - Keepers over the keep limit go back in the bag.
- Hauling returns the pot to your hand. A hauled catch goes to your HOLD.
- SEEDED LOBSTERS: at the start of every season one generic ${cfg.seeded.weightLb} lb keeper is placed on EVERY fishing node, and they accumulate on nodes nobody fishes. Whoever hauls (or steals) a pot on a node first collects that node's whole seeded pile, before the bag draw. Neglected corners become jackpots.

## 4. The bags (the commons)
Each ground TYPE has one shared bag (all ${cfg.map.nodes ? Object.values(cfg.map.nodes).filter((n) => n.ground === 'mid').length : 6} mid nodes draw from the same mid bag, etc). Starting contents for ${players} players:
${GROUNDS.map((g) => bagLine(cfg, g, scale)).join('\n')}
Throwbacks return to the bag. Sold bag lobsters do not vanish: they land on that ground's extraction TRAP, from which the breeding stock can return them (seeded lobsters are the exception: sold, they leave the world). Keeper DENSITY (keeper lb per tile in the bag) is what makes a ground worth fishing; as keepers are stripped, hauls turn up junk. The bag contents are public knowledge (you may track what has been taken).

## 5. Selling, markets, fuel
- SELL (${cfg.actionCost.SELL} action) sells your ENTIRE hold at the market port you are docked in, once per day. ${al ? `THE CO-OP: the home port pays the least per pound, but landing a real day's catch there (see the port list for the poundage) steps a licensed captain in a co-op band +${cfg.alignment.step.coopLanding} lighter. A token landing does not count. If you have heat stars, every SELL is also the warden's check (see THE SWITCHBOARD).` : `THE CO-OP: the home port pays the least per pound, but landing a real day's catch there (see the port list for the poundage) earns reputation — the only repeatable way to raise it. A token landing does not count.`} Price per lb = max(floor, base − (lb already landed at that port today ÷ that port's step, rounded down)) (+ rare bonus for RARE keepers). Every price is a whole number. Landing catch floods that port for the rest of the day — for everyone. Prices recover overnight.
- Unsold keepers/jumbos lose ${cfg.holdDecayLbPerDay} lb per night in the hold (to a minimum of 1 lb).
- FISHING LICENCE — SOLD AT AUCTION. Season 1's comes with the boat. At the start of every season after that, the licences go to a SEALED-BID, SECOND-PRICE auction: everyone bids in secret, all bids are revealed at once, and the price everyone pays is the SECOND-highest bid. The top two bidders are COMMITTED and must buy at that price; everyone else may take it or leave it. The reserve (minimum bid) is ${cfg.licensePerSeason.slice(1).join(', ')} for seasons 2 to ${cfg.seasons}.
  **The bid order is that season's TURN ORDER.** You are bidding for the harbour's pecking order — first pick of the water on opening day, first crack at the seeded piles, and first choice of berths on the grounds — as much as for the licence itself. Because it is second-price, bidding what the position is genuinely worth to you is safe: you pay what your closest rival thought, not what you did. ${al ? `**If you do not hold one, you are UNLICENSED for that whole season and everything you pull is POACHED: every haul steps you ${-cfg.alignment.step.poachHaul} darker${cfg.heat.poachHaulIsCrime ? ' and is a crime' : ''}, you get no co-op step and no dividend. You save the fee and can still fish and steal — you are just doing it outside the law.** Buying the licence steps you +${cfg.alignment.step.licence} lighter. See the season ${cfg.alignment.squeezeSeason} squeeze and the licence duty in THE SWITCHBOARD.` : `**If you cannot, you are UNLICENSED for that whole season and everything you pull is POACHED: every haul costs ${cfg.unlicensed.repPerHaul} reputation, and the co-op will not take your catch (no standing from landing at the home port). You can still fish and still steal — you are just doing it outside the law.** Budget for the fee: it rises as the fishery is squeezed, and a season spent poaching will gut the reputation track, and the weak-link card will charge you for it.`}
- REFUEL (${cfg.actionCost.REFUEL} action) at any port buys fuel at that port's price, up to your tank (base ${cfg.fuelTankMax}, more with the tank refit). You start with ${cfg.startFuel} fuel and ${cfg.startMoney} money.
- TOW: if the day ends and you are not at a port${al ? ' that will have you' : ''}, you are towed to the nearest port: −${cfg.tow.fee} money (never below zero), fuel topped up to at least ${cfg.tow.emergencyFuel} (you keep more if you had more), and you LOSE your next ${cfg.tow.lostTurns} turns. Make harbor before the day ends.

## 6. Berthing and turn order
${al ? `- BERTH (free) at any port that will have you ends your day there; you start tomorrow at that port. The ORDER captains berth is tomorrow's turn order, and it costs nothing: come in early for a good slot. Anyone not berthed by the end of hour ${cfg.hoursPerDay} is auto-berthed behind everyone who did, in reverse of today's order.
- BRIBE (free, at a port, SHADY or OUTLAW only): pay ${cfg.bribeMoneyCost} money, step ${-cfg.alignment.step.bribe} darker, and jump to the FRONT of tomorrow's order.
- Turn order matters: first mover gets first pick of ripe grounds, seeded piles, chandlery refits and unflooded markets.
` : ''}${al ? '<!--' : ''}- BERTH (free) at any port ends your day there; you start tomorrow at that port. The ORDER captains berth is tomorrow's turn order. Anyone not berthed by the end of hour ${cfg.hoursPerDay} is auto-berthed into the remaining slots in today's turn order. The order is a GRADIENT paid at day's end, and you cannot dodge either end of it by refusing to decide: whoever holds slot 0 (tomorrow's first mover) pays ${cfg.poleRepCost} reputation for pushing to the front, however they got there; whoever holds the LAST slot gains +${cfg.lastSlotRep} reputation ("after you") plus ${cfg.lastSlotSweetenerFuel} fuel, provided they made harbour under their own power — a boat that was towed in gets the fuel but no standing. The captain in the LAST slot gets +${cfg.lastSlotSweetenerFuel} fuel.
- BRIBE (free, at a port): pay ${cfg.bribeMoneyCost} money and ${cfg.rep.bribe} reputation to jump to the FRONT of tomorrow's order (and berth now if not yet berthed).
- Turn order matters: first mover gets first pick of ripe grounds, seeded piles, chandlery refits and unflooded markets.${al ? '-->' : ''}

## 7. Theft and reporting
- STEAL (${cfg.actionCost.STEAL} actions): haul a RIVAL's pot sitting on your node, if it is ripe (you only know it is ripe when the game lists it as stealable). You get the catch (and the node's seeded pile), the owner gets their empty pot back, ${al ? `you step ${cfg.alignment.step.steal} darker and it is a crime (heat)` : `you lose ${-cfg.rep.steal} reputation`}. The theft is public.
- REPORT (${cfg.actionCost.REPORT} action, at any port, if you were robbed): ${al ? `you step +${cfg.alignment.step.report} lighter and take a bounty of the stolen catch's book value divided by ${cfg.reportBountyDivisor}; the thief gains +${cfg.heat.reportedStars}★.` : `you gain +${cfg.rep.report} reputation and a bounty of the stolen catch's book value divided by ${cfg.reportBountyDivisor}; the thief loses a further ${-cfg.rep.reported} reputation.`} One report per theft.

## 8. Weather
Season 1 is calm. From season 2 storms are placed at random on some nodes per tier and re-rolled each season, intensifying: (nodes stormed per tier) ${stormTrack}. Shelters and inshore never storm.
- ENTERING a stormed node: ${cfg.weather.hazardChance * 100}% chance to lose ${cfg.weather.hazardFuel} fuel.
- Each night, every pot left in a stormed node has a ${cfg.weather.whittleChance * 100}% chance to be PARTED — lost for the rest of the season (you get it back at the season change).
- HAULING a pot in a stormed node draws +${cfg.weather.bonusDraws} extra tiles and raises the keep limit by ${cfg.weather.bonusKeep}: a fat, risky haul.
- The GPS plotter refit makes you immune to the entry hazard AND halves the chance your gear is parted overnight.

## 9. Breeding stock (between seasons, except into the final season)
Every berried female you v-notch and release advances her ground's BREEDING STOCK track, which is public and printed on the board. After season${draftSeasons.length > 1 ? 's' : ''} ${draftSeasons.join(', ')} — not before the final season, the ocean gets no relief for the last year — each ground's protected stock SPAWNS: it rolls one lobster die per band of notches on its track and returns that many lobsters from its trap to its bag, drawn AT RANDOM — you do not choose which ones come back, so a ground you stripped of jumbos does not get its jumbos back on demand.
Dice by notches: ${cfg.breeding.diceByNotches.slice().reverse().filter((r) => r.dice > 0).map((r) => `${r.atLeast}+ → ${r.dice}d`).join(', ')}. The die faces are ${cfg.breeding.dieFaces.join('/')}, so a die averages under one lobster and a thin track can spawn nothing at all.
Lobsters come back AT RANDOM, drawn blind from that ground's trap — you can see how full a trap is, never what is in it. Nobody is asked to donate anything: you already paid, by throwing back a ${cfg.eggerWeightLb} lb lobster you could have landed. The track is the public record of who protected which water, and the water you protected is the water that comes back.

## 10. Ship refits (upgrades)
Market ports have a chandlery with ${cfg.upgrades.display} refits face-up (of ${cfg.upgrades.perPortStock} in stock, random; the next slides up when one is bought). BUY costs ${cfg.actionCost.BUY_UPGRADE} action + the price, at that port only, one refit per slot (3 slots: stern, midPrimary, midSecondary), never replaced. Catalog:
${upgradeLines.join('\n')}

${al ? switchboardSection(cfg, players) + `

## 11. Scoring (end of season ${cfg.seasons})
**Most money wins.** Nothing else scores: not alignment, not heat, not reputation, not conservation. Ties share.
<!--` : ''}## 11. Scoring (end of season ${cfg.seasons})
Three tracks, each in victory points (VP):
- MONEY VP = money ÷ ${cfg.scoring.moneyPerVP}.
- CONSERVATION VP = your conservation track (+${cfg.rep.vNotch} per berried female v-notched and released) + a shared commons-health bonus read from the average bag fullness at the end (${health}) — everyone gets the same bonus, so a stripped ocean hurts every steward.
- REPUTATION VP = reputation × ${cfg.scoring.repToVP}. You start at ${cfg.startReputation} reputation.
- TOTAL = (money VP + conservation VP + reputation VP) MINUS a penalty read off a printed card using your LOWEST track: ${weakLink}. A balanced captain pays nothing; a dumped track is close to fatal. Highest total wins; ties share. Every number is a whole one.
- Rough scale: a 20 VP track is 100 money, or 20 conservation, or 5 reputation points. Reputation is expensive to rebuild (only +1 per report, +0 otherwise), so treat it as a budget you spend, not a free resource.${al ? '-->' : ''}

## 12. How you play (command contract)
Each time it is your decision, you receive the current situation (public state, your private pot ripeness, events since your last decision, and the list of legal actions right now) and you reply with JSON: {"plan": ["<command>", ...], "note": "<brief reasoning, ≤60 words>"}.
Commands (one per string, uppercase keyword first):
- STEAM <NODE> — move to an adjacent node (with a bigger engine, up to 2 nodes away).
- GOTO <NODE> — macro: steam step by step toward NODE across as many turns as needed (spends 1 action per hop). Stops if fuel runs out or the day ends.
- DROP — place a pot on this fishing ground.
- HAUL <potId> [clean|highgrade|greedy] [keep-eggers|notch-eggers] — haul your ripe pot here (default clean; eggers follow the policy unless you say).
- STEAL <potId> [clean|highgrade|greedy] [keep-eggers|notch-eggers] — steal a rival's ripe pot here.
- SELL — sell your whole hold at this market port.${al ? ' `SELL BRIBE <n>` buys n dice off the warden’s check first.' : ''}
- REFUEL [units] — buy fuel here (default: fill the tank or spend what you can).
- BUY <refitId> — install a face-up refit here.
- REPORT — report a theft against you (at a port).
- BERTH — end your day here (claims the next berth slot).
- BRIBE — pay to take the front slot (and berth).${al ? ' Shady or outlaw only.' : ''}
- PASS — end this turn (unspent actions are lost).
- REPLAN — abandon the rest of your plan and be asked again with a fresh situation report.
Your plan is executed in order and CARRIES ACROSS TURNS AND DAYS — it runs until it is exhausted, a step becomes impossible (you are asked again, with the reason), something happens to you (theft, storm damage, tow), or you REPLAN. So you can commit to a whole multi-day trip in one decision: steam out, drop, BERTH for the night, haul the next morning once it has ripened, run in and SELL. That is the intended way to play the far grounds, where a round trip cannot fit in a day.

A step that is legal but simply unaffordable this turn (you are out of action points) is NOT an error — it waits for your next turn automatically. Actions cost points as listed; a turn ends when your points are spent, on PASS/BERTH/BRIBE, or when nothing else in the plan is affordable.

The trade-off is judgement: a long plan saves you decisions and buys tempo, but the ocean moves between your turns — rivals haul the ground you were steaming to, a port floods before you reach it, a storm re-rolls at the season change. Plan long where you are committed (a far trip) and short where the situation is contested, and REPLAN when you want to look again. Always reply with valid JSON and at least one command.`);
}

const stripHidden = (text: string): string => text.replace(/<!--[\s\S]*?-->/g, '').replace(/\n{3,}/g, '\n\n');

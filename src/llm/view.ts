import type { GameState, Ground, Tile } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy, EggerChoice } from '../engine/buoys';
import { stageFor, isRipe } from '../engine/soak';
import { pricePerLb } from '../engine/market';
import { fuelPriceAt, isPort } from '../engine/ports';
import { upgradeDisplay, upgradeDef, fuelCap, buoyCap, stepsPerSteam } from '../engine/upgrades';
import { potCapacity, potsOnNode } from '../engine/buoys';
import { diceFor } from '../engine/breeding';
import { hopToward } from '../bots/helpers';
import { daysThisSeason, activePlayerId } from '../selectors';
import { alignmentOn, bandOf, groundClosedTo, groundHealthPct, portClosedTo, bribeCost, bribeableDice, licencesOnSale } from '../engine/alignment';
import { darkOffer } from '../engine/upgrades';

// The captain's VIEW: a compact text rendering of everything a player is allowed
// to know (public state + their own private soak), plus the command parser that
// turns the model's plan strings back into engine actions. Never leaks a rival's
// SoakRecord.

const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore', 'deep'];

function tileWord(t: Tile): string {
  if (t.kind === 'KEEPER') return `${t.weightLb}lb${t.color === 'rare' ? 'R' : ''}${t.seeded ? 's' : ''}`;
  if (t.kind === 'JUMBO') return `JUMBO${t.weightLb}`;
  return t.kind;
}

function holdSummary(hold: Tile[]): string {
  if (hold.length === 0) return 'empty';
  const lbs = hold.reduce((s, t) => s + t.weightLb, 0);
  return `${hold.map(tileWord).join(' ')} (${lbs} lb, ${hold.length} tiles)`;
}

function bagSummary(state: GameState, g: Ground): string {
  const bag = state.bags[g];
  const counts: Record<string, number> = {};
  let keeperLb = 0; let keepers = 0;
  for (const t of bag) {
    const k = tileWord(t);
    counts[k] = (counts[k] ?? 0) + 1;
    if (t.kind === 'KEEPER') { keeperLb += t.weightLb; keepers++; }
  }
  const density = bag.length ? (keeperLb / bag.length).toFixed(2) : '0';
  const detail = Object.entries(counts).sort().map(([k, n]) => `${n}×${k}`).join(' ');
  return `${g}: ${bag.length} tiles, ${keepers} keepers (${keeperLb} lb), density ${density} lb/tile — ${detail || 'EMPTY'}`;
}

// The pile is a trap on the board. You can see how full it is; you cannot see what is
// in it, and at the season change you reach in blind.
function pileSummary(state: GameState, g: Ground): string {
  return `${g}: ${state.piles[g].length}`;
}

function describeAction(state: GameState, a: Action): string {
  switch (a.type) {
    case 'STEAM': {
      const me = state.players[a.playerId];
      const warden = state.wardens?.includes(a.to) && me.tracks.heat > 0;
      const offers = warden ? Array.from({ length: bribeableDice(state, me) }, (_, i) => `BRIBE ${i + 1} = ${bribeCost(state, me, i + 1)}`).join(', ') : '';
      return `STEAM ${a.to}${state.stormed.includes(a.to) ? ' (STORM)' : ''}${warden ? ` (WARDEN: ${me.tracks.heat} ${me.tracks.heat === 1 ? 'die' : 'dice'}${offers ? `; ${offers}` : ''})` : ''}`;
    }
    case 'DROP': return `DROP (${potCapacity(state) - potsOnNode(state, state.players[a.playerId].node)} of ${potCapacity(state)} berths left on this ground)`;
    case 'HAUL': { const me = state.players[a.playerId]; return `HAUL ${a.buoyId}${alignmentOn(state) && state.config.heat.capCheck && me.tracks.heat >= state.config.heat.max ? ` (you are at ${me.tracks.heat}★: any crime here is a check on the spot)` : ''}`; }
    case 'STEAL': return `STEAL ${a.buoyId} (${state.players[a.ownerId].name}'s)`;
    case 'SELL': {
      const me = state.players[a.playerId];
      if (!alignmentOn(state) || me.tracks.heat <= 0) return 'SELL';
      const n = me.tracks.heat;
      const offers = Array.from({ length: bribeableDice(state, me) }, (_, i) => `BRIBE ${i + 1} = ${bribeCost(state, me, i + 1)}`).join(', ');
      return `SELL (heat check: ${n} ${n === 1 ? 'die' : 'dice'}${offers ? `; ${offers}` : `; your band cannot buy any off`})`;
    }
    case 'REFUEL': return `REFUEL (up to ${a.units})`;
    case 'REPORT': return 'REPORT';
    case 'BERTH': return `BERTH (slot ${state.nextSlot}${state.nextSlot === 0 && !alignmentOn(state) ? ', pole: -rep' : ''})`;
    case 'BRIBE': return alignmentOn(state) ? `BRIBE the harbourmaster (${state.config.bribeMoneyCost} money, one step darker)` : 'BRIBE';
    case 'BUY_UPGRADE': return `BUY ${a.upgradeId}`;
    case 'PASS': return 'PASS';
    case 'LICENSE_BID': return `BID <amount> (reserve ${a.amount})`;
    case 'LICENSE_BUY': return a.take ? 'TAKE the licence' : 'LEAVE it';
  }
}

export interface ViewOptions {
  events: string[];        // log lines since the captain's last decision
  reason?: string;         // why we are asking again (a failed plan step)
}

// Render the situation for `pid`. Everything here is either public or pid's own.
export function renderView(state: GameState, pid: string, legal: Action[], opts: ViewOptions): string {
  const cfg = state.config;
  const p = state.players[pid];
  const lines: string[] = [];

  if (state.phase === 'AUCTION') return renderAuctionView(state, pid, opts);

  const dis = daysThisSeason(state);
  lines.push(`=== Season ${state.season}/${cfg.seasons}, Day ${state.day}/${dis}, Hour ${state.hour}/${cfg.hoursPerDay} — YOUR TURN (${p.actionsLeft} action points)`);
  lines.push(`Turn order today: ${state.turnOrder.map((id) => (id === pid ? `${state.players[id].name}(YOU)` : state.players[id].name)).join(' → ')}`);
  const berthed = state.pendingNextOrder.map((id, i) => `${state.players[id].name}@${state.players[id].berthNode} slot${i}`);
  lines.push(`Berthed so far today: ${berthed.length ? berthed.join(', ') : 'nobody'} (next slot ${state.nextSlot})`);
  lines.push(`Storms this season: ${state.stormed.length ? state.stormed.join(', ') : 'none'}`);
  if (state.wardens?.length) lines.push(`WARDEN BOATS today: ${state.wardens.join(', ')}${state.players[pid].tracks.heat > 0 ? ` — you have ${state.players[pid].tracks.heat}★: entering one of these spaces is a heat check at sea${state.players[pid].tracks.heat >= 3 ? ' that CAN BUST you' : ' (it cannot bust you at 1–2★)'}` : ' (they ignore you: no stars)'}`);
  lines.push('');

  // me
  const node = cfg.map.nodes[p.node];
  const where = node.type === 'port' ? `${p.node} (${node.port!.market ? 'market port' : 'shelter'})` : `${p.node} (${node.ground} ground${state.stormed.includes(p.node) ? ', STORMED' : ''})`;
  const al = alignmentOn(state);
  const bandWord = (x: typeof p) => `${bandOf(state, x).name.toUpperCase()} ${x.tracks.alignment >= 0 ? '+' : ''}${x.tracks.alignment}`;
  const stars = (x: typeof p) => (x.tracks.heat > 0 ? '★'.repeat(x.tracks.heat) : 'no stars');
  if (p.licensed === false) lines.push(al
    ? `*** YOU ARE UNLICENSED THIS SEASON — every haul is poached (${-cfg.alignment.step.poachHaul} step darker each), no co-op step, no dividend. ***`
    : `*** YOU ARE UNLICENSED THIS SEASON — everything you haul is poached: ${cfg.unlicensed.repPerHaul} reputation per haul, and the co-op will not take your catch. ***`);
  lines.push(al
    ? `YOU — ${p.name}: at ${where} | fuel ${p.fuel}/${fuelCap(state, p)} | money ${p.money.toFixed(1)} | alignment ${bandWord(p)} | heat ${stars(p)} | pots in hand ${p.buoysAvailable}/${buoyCap(state, p)} | sold today: ${p.soldToday ? 'yes' : 'no'}`
    : `YOU — ${p.name}: at ${where} | fuel ${p.fuel}/${fuelCap(state, p)} | money ${p.money.toFixed(1)} | reputation ${p.tracks.reputation} | conservation ${p.tracks.conservation} | pots in hand ${p.buoysAvailable}/${buoyCap(state, p)} | sold today: ${p.soldToday ? 'yes' : 'no'}`);
  if (al) {
    const b = bandOf(state, p);
    lines.push(`Your band switches: ${b.priceCut ? `markets pay you ${b.priceCut} less per lb` : 'full price'}; a crime costs you ${b.starsPerCrime}★; warden bribes ${b.bribeCosts.join('/')} a die, down to ${b.bribeFloor} ${b.bribeFloor === 1 ? 'die' : 'dice'}; ${b.coop ? 'co-op open' : 'co-op CLOSED'}; ${b.dividend ? 'dividend if licensed' : 'no dividend'}; ${b.mustLicense ? 'you MUST buy the licence' : 'licence optional'}${b.refuge ? '' : '; the outer shelters turn you away'}${b.blackMarket ? '; black market open' : ''}${b.harbourBribe ? '; may bribe the harbourmaster' : ''}`);
    if (p.barredPorts?.length) lines.push(`*** CLOSED TO YOU TODAY (you ran): ${p.barredPorts.join(', ')} — you cannot sell, refuel or berth there. ***`);
  }
  lines.push(`Your hold: ${holdSummary(p.hold)}`);
  const ups = Object.values(p.upgrades).filter(Boolean) as string[];
  lines.push(`Your refits: ${ups.length ? ups.map((u) => upgradeDef(state, u)?.label ?? u).join(', ') : 'none'}${stepsPerSteam(state, p) > 1 ? ` (STEAM reaches ${stepsPerSteam(state, p)} nodes)` : ''}`);
  if ((p.towCooldown ?? 0) > 0) lines.push(`Tow recovery: ${p.towCooldown} turn(s) still to lose`);
  const pots = p.deployed.map((b) => {
    const rec = p.soak[b.buoyId];
    const stage = stageFor(state, rec.ground, rec.daysSoaked);
    const ripe = isRipe(state, rec.ground, rec.daysSoaked);
    const primeIdx = cfg.soakCurves[rec.ground].indexOf('PRIME');
    const eta = ripe ? 'RIPE — haulable' : `ripe in ${primeIdx - rec.daysSoaked} night(s)`;
    return `${b.buoyId} @${b.node} (${rec.ground}${state.stormed.includes(b.node) ? ', STORMED' : ''}) soaked ${rec.daysSoaked}n = ${stage}, ${eta}`;
  });
  lines.push(`Your pots in the water: ${pots.length ? pots.join(' | ') : 'none'}`);
  lines.push('');

  // rivals
  for (const id of Object.keys(state.players)) {
    if (id === pid) continue;
    const r = state.players[id];
    const rp = r.deployed.map((b) => b.node);
    const rups = Object.values(r.upgrades).filter(Boolean) as string[];
    lines.push(`RIVAL ${r.name}: at ${r.node}${r.berthed ? ' (berthed)' : ''} | fuel ${r.fuel} | money ${r.money.toFixed(1)} | ${al ? `${bandWord(r)} | heat ${stars(r)}${r.licensed === false ? ' | UNLICENSED' : ''}` : `rep ${r.tracks.reputation} | cons ${r.tracks.conservation}`} | hold ${r.hold.length} tiles (${r.hold.reduce((s, t) => s + t.weightLb, 0)} lb) | pots at: ${rp.length ? rp.join(', ') : 'none'} | refits: ${rups.length ? rups.join(', ') : 'none'}`);
  }
  lines.push('');

  // commons
  lines.push('BAGS (public):');
  for (const g of GROUNDS) lines.push(`  ${bagSummary(state, g)}`);
  lines.push(`TRAPS (how many landed lobsters sit in each ground's trap — what its breeding stock can bring back; you cannot see WHICH): ${GROUNDS.map((g) => pileSummary(state, g)).join(' | ')}`);
  lines.push('BREEDING STOCK (public; berried females notched and released on each ground — at each season change except the last, a ground rolls this many dice and draws that many lobsters blind from its trap):');
  lines.push(`  ${GROUNDS.map((g) => `${g} ${state.notches[g] ?? 0} notched = ${diceFor(state, state.notches[g] ?? 0)}d`).join(' | ')}`);
  const occupied = Object.keys(cfg.map.nodes)
    .filter((n) => cfg.map.nodes[n].type === 'ground' && potsOnNode(state, n) > 0)
    .map((n) => `${n} ${potsOnNode(state, n)}/${potCapacity(state)}`);
  if (al) {
    const shut = GROUNDS.filter((g) => groundClosedTo(state, g, p));
    lines.push(`GROUND HEALTH (bag vs start; closures): ${GROUNDS.map((g) => `${g} ${groundHealthPct(state, g)}%`).join(' | ')} — closed to YOU: ${shut.length ? `${shut.join(', ')} (+${cfg.closure.starsPerHaul}★ per pot hauled there)` : 'none'}`);
    const refuges = Object.keys(cfg.map.nodes).filter((n) => cfg.map.nodes[n].port?.shelter && portClosedTo(state, p, n));
    if (refuges.length) lines.push(`Refuges that turn you away: ${refuges.join(', ')}`);
  }
  lines.push(`GEAR ON THE GROUND (every captain's pots; a ground takes ${potCapacity(state)} pots and no more): ${occupied.length ? occupied.join(', ') : 'the bay is clear'}`);
  const seeded = Object.entries(state.seeded).filter(([, n]) => n > 0).map(([n, c]) => `${n}:${c}`);
  lines.push(`SEEDED piles (generic ${cfg.seeded.weightLb} lb keepers on nodes): ${seeded.length ? seeded.join(' ') : 'none'}`);
  lines.push('');

  // markets
  const mk = Object.keys(state.markets).map((port) => `${port} ${pricePerLb(state, port, false).toFixed(2)}/lb (${state.markets[port].lbsSoldToday} lb landed today; rare +${cfg.map.nodes[port].port!.market!.rareBonus})`);
  lines.push(`MARKETS now: ${mk.join(' | ')}`);
  lines.push(`FUEL prices: ${Object.keys(cfg.map.nodes).filter((n) => isPort(state, n)).map((n) => `${n} ${fuelPriceAt(state, n)}`).join(', ')}`);
  if (cfg.flags.upgrades) {
    const ch = Object.keys(state.markets).map((port) => `${port} [${upgradeDisplay(state, port).map((id) => `${id} ${upgradeDef(state, id)?.cost}`).join(', ') || 'sold out'}]`);
    lines.push(`CHANDLERY face-up: ${ch.join(' | ')}`);
    if (al) {
      const bm = [...new Set(state.darkStock ?? [])];
      const open = darkOffer(state, p).length > 0 || (bandOf(state, p).blackMarket && bm.length > 0);
      lines.push(`BLACK MARKET (Shady/Outlaw, any market port): ${bm.length ? bm.map((id) => `${id} ${upgradeDef(state, id)?.cost} (${(state.darkStock ?? []).filter((x) => x === id).length} left)`).join(', ') : 'sold out'}${open ? '' : ' — not open to your band'}`);
    }
  }
  if (state.thefts.some((t) => t.victimId === pid)) lines.push(`You have an unreported theft against you (REPORT at a port for the bounty).`);
  lines.push('');

  if (opts.events.length) {
    lines.push('SINCE YOUR LAST DECISION:');
    for (const e of opts.events) lines.push(`  - ${e}`);
    lines.push('');
  }
  if (opts.reason) lines.push(`NOTE: ${opts.reason}\n`);

  lines.push(`LEGAL NOW: ${legal.map((a) => describeAction(state, a)).join(' | ')}`);
  lines.push('(GOTO <NODE> is always allowed as a macro while you have fuel.)');
  lines.push('Reply with JSON: {"plan": ["..."], "note": "..."}');
  return lines.join('\n');
}

// The licence auction. Rival bids are SECRET until every captain has bid — this view
// must never show them, only who has and has not bid yet.
function renderAuctionView(state: GameState, pid: string, opts: ViewOptions): string {
  const a = state.auction!;
  const p = state.players[pid];
  const L: string[] = [];
  L.push(`=== SEASON ${state.season} LICENCE AUCTION — YOUR DECISION (${p.name})`);
  L.push('Sealed bids. The price everyone pays is the SECOND-highest bid. The top two bidders are committed and must buy at that price; everyone else may take it or leave it.');
  L.push('The bid order is THIS SEASON\'S TURN ORDER — you are bidding for first pick of the water on opening day as much as for the licence.');
  L.push(`Reserve (minimum bid): ${a.minBid}. You have ${p.money.toFixed(1)} money.`);
  if (alignmentOn(state)) {
    const cfg = state.config;
    const onSale = licencesOnSale(state);
    L.push(`Without a licence you may still fish, but every haul is poaching (${-cfg.alignment.step.poachHaul} step darker each), with no co-op step and no dividend. Buying one steps you +${cfg.alignment.step.licence} lighter.`);
    if (onSale !== Infinity) L.push(`*** THE SQUEEZE: only ${onSale} licences are for sale this season, going down the bid order. Whoever is left over fishes unlicensed. ***`);
    if (bandOf(state, p).mustLicense) L.push(`You are ${bandOf(state, p).name.toUpperCase()}: you MUST buy the licence if you can afford it.`);
  } else L.push(`Without a licence you may still fish, but every haul is poaching: ${state.config.unlicensed.repPerHaul} reputation each, and the co-op will not take your catch.`);
  L.push('');
  for (const id of Object.keys(state.players)) {
    const r = state.players[id];
    L.push(`${id === pid ? 'YOU  ' : 'RIVAL'} ${r.name}: money ${r.money.toFixed(1)} | ${alignmentOn(state) ? `${bandOf(state, r).name.toUpperCase()} ${r.tracks.alignment} | heat ${r.tracks.heat}★` : `reputation ${r.tracks.reputation}`} | ${a.bids[id] !== undefined ? 'has bid (amount sealed)' : 'has not bid yet'}`);
  }
  L.push('');
  if (!a.revealed) {
    L.push(`Command: BID <amount>  — at least ${a.minBid}, at most what you hold. A bid below the reserve or beyond your money counts as no bid at all.`);
  } else {
    L.push(`Bids are open. The price is ${a.price}. You were not among the committed two.`);
    L.push('Command: TAKE (buy the licence at that price) or LEAVE (fish unlicensed this season).');
  }
  if (opts.events.length) { L.push('SINCE YOUR LAST DECISION:'); for (const e of opts.events) L.push(`  - ${e}`); }
  if (opts.reason) L.push(`NOTE: ${opts.reason}`);
  L.push('Reply with JSON: {"plan": ["..."], "note": "..."}');
  return L.join('\n');
}

// ---- command parsing ----

export type Parsed =
  | { ok: true; action: Action; macro?: undefined }
  | { ok: true; macro: 'GOTO'; target: string; action: Action } // the first hop, resolved now
  | { ok: false; error: string };

const POLICIES: HaulPolicy[] = ['clean', 'highgrade', 'greedy'];
const EGGER_WORDS: Record<string, EggerChoice> = { 'keep-eggers': 'keep', keepeggers: 'keep', 'notch-eggers': 'notch', notcheggers: 'notch' };
const isModifier = (tok?: string) => !!tok && (POLICIES.includes(tok.toLowerCase() as HaulPolicy) || tok.toLowerCase() in EGGER_WORDS || tok.toUpperCase() === 'BRIBE');

// Resolve one command string against the legal action set. GOTO resolves to its
// first STEAM hop (the caller keeps the macro alive across turns).
export function parseCommand(state: GameState, pid: string, cmd: string, legal: Action[]): Parsed {
  const raw = cmd.trim();
  const parts = raw.split(/\s+/);
  const kw = (parts[0] ?? '').toUpperCase();
  const args = parts.slice(1);
  const find = <T extends Action['type']>(type: T, pred?: (a: Extract<Action, { type: T }>) => boolean) =>
    legal.find((a) => a.type === type && (!pred || pred(a as Extract<Action, { type: T }>))) as Extract<Action, { type: T }> | undefined;
  const policyOf = (toks: string[]): HaulPolicy => (toks.map((t) => t.toLowerCase()).find((t) => POLICIES.includes(t as HaulPolicy)) as HaulPolicy) ?? 'clean';
  const eggersOf = (toks: string[]): EggerChoice | undefined => toks.map((t) => EGGER_WORDS[t.toLowerCase()]).find(Boolean);
  // `BRIBE <n>` on a HAUL/STEAL: dice to buy off a check on the spot, if a crime there runs past 5★.
  const bribeOf = (toks: string[]): { bribeDice?: number } => {
    const i = toks.findIndex((t) => t.toUpperCase() === 'BRIBE');
    const n = i >= 0 ? Number(toks[i + 1] ?? 1) : 0;
    return Number.isFinite(n) && n > 0 ? { bribeDice: Math.floor(n) } : {};
  };
  const tokenOf = (toks: string[]) => toks.some((t) => t.toLowerCase() === 'token');

  if (state.phase === 'AUCTION') {
    const a = state.auction!;
    if (!a.revealed) {
      if (kw !== 'BID') return { ok: false, error: `the licence auction is open — reply with BID <amount> (reserve ${a.minBid}), not "${raw}"` };
      const n = Number(args[0]);
      if (!Number.isFinite(n)) return { ok: false, error: 'BID needs a number' };
      return { ok: true, action: { type: 'LICENSE_BID', playerId: pid, amount: Math.floor(n) } };
    }
    if (kw === 'TAKE' || kw === 'BUY') return { ok: true, action: { type: 'LICENSE_BUY', playerId: pid, take: true } };
    if (kw === 'LEAVE' || kw === 'PASS' || kw === 'DECLINE') return { ok: true, action: { type: 'LICENSE_BUY', playerId: pid, take: false } };
    return { ok: false, error: `the licence price is ${a.price} — reply TAKE or LEAVE, not "${raw}"` };
  }
  switch (kw) {
    case 'STEAM': {
      const to = (args[0] ?? '').toUpperCase();
      const a = find('STEAM', (s) => s.to === to);
      if (!a) return { ok: false, error: `cannot STEAM to ${to || '?'} from ${state.players[pid].node} right now (not adjacent, no fuel, or no action points)` };
      // STEAM <NODE> BRIBE <n>: if a warden boat stops you there, buy n dice off its check.
      const bi = args.findIndex((t) => t.toUpperCase() === 'BRIBE');
      const n = bi >= 0 ? Number(args[bi + 1] ?? 1) : 0;
      if (bi >= 0 && !Number.isFinite(n)) return { ok: false, error: 'STEAM <NODE> BRIBE needs a number of dice, e.g. STEAM SEAL_BAY BRIBE 2' };
      return { ok: true, action: n > 0 ? { ...a, bribeDice: Math.floor(n) } : a };
    }
    case 'GOTO': case 'GO': case 'MOVE': {
      const target = (args[0] ?? '').toUpperCase();
      if (!state.config.map.nodes[target]) return { ok: false, error: `unknown node ${target || '?'}` };
      const p = state.players[pid];
      if (p.node === target) return { ok: false, error: `already at ${target}` };
      // longest legal hop first (a bigger engine may not have fuel for its full reach)
      let hop: string | null = null;
      let a: Extract<Action, { type: 'STEAM' }> | undefined;
      for (let reach = stepsPerSteam(state, p); reach >= 1 && !a; reach--) {
        hop = hopToward(state, p.node, target, reach);
        a = hop ? find('STEAM', (s) => s.to === hop) : undefined;
      }
      if (!a) return { ok: false, error: `cannot make the next hop toward ${target} (${hop ?? 'no path'}): out of fuel or action points` };
      return { ok: true, macro: 'GOTO', target, action: a };
    }
    case 'DROP': {
      const a = find('DROP');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot DROP here (not a fishing ground, no pots in hand, or no action points)' };
    }
    case 'HAUL': {
      const id = isModifier(args[0]) ? undefined : args[0];
      const a = id ? find('HAUL', (h) => h.buoyId === id) : find('HAUL');
      if (!a) return { ok: false, error: `cannot HAUL ${id ?? ''} (not your ripe pot here, or no action points)` };
      return { ok: true, action: { ...a, policy: policyOf(args), eggers: eggersOf(args), ...bribeOf(args) } };
    }
    case 'STEAL': {
      const id = isModifier(args[0]) ? undefined : args[0];
      const a = id ? find('STEAL', (s) => s.buoyId === id) : find('STEAL');
      if (!a) return { ok: false, error: `cannot STEAL ${id ?? ''} (no ripe rival pot of that id here, or fewer than 2 action points)` };
      return { ok: true, action: { ...a, policy: policyOf(args), eggers: eggersOf(args), ...bribeOf(args) } };
    }
    case 'SELL': {
      const a = find('SELL');
      if (!a) return { ok: false, error: 'cannot SELL (not a market port, already sold today, empty hold, a port closed to you, or no action points)' };
      // SELL BRIBE <n>: buy n heat dice off the warden's check first (never below one die).
      const bi = args.findIndex((t) => t.toUpperCase() === 'BRIBE');
      const n = bi >= 0 ? Number(args[bi + 1] ?? 1) : 0;
      if (bi >= 0 && !Number.isFinite(n)) return { ok: false, error: 'SELL BRIBE needs a number of dice, e.g. SELL BRIBE 2' };
      return { ok: true, action: n > 0 ? { ...a, bribeDice: Math.floor(n) } : a };
    }
    case 'REFUEL': {
      const a = find('REFUEL');
      if (!a) return { ok: false, error: 'cannot REFUEL (not at a port, a port closed to you, tank full, no money, or no action points)' };
      const want = args[0] === undefined ? NaN : Number(args[0]);
      const units = Number.isFinite(want) ? Math.max(0, Math.min(Math.floor(want), a.units)) : a.units;
      if (units === 0) return { ok: false, error: 'REFUEL 0 buys nothing (omit the number to fill up, or give a positive amount)' };
      return { ok: true, action: { ...a, units } };
    }
    case 'BUY': case 'BUY_UPGRADE': case 'REFIT': {
      const id = (args[0] ?? '').toLowerCase();
      const a = find('BUY_UPGRADE', (b) => b.upgradeId === id);
      return a ? { ok: true, action: a } : { ok: false, error: `cannot BUY ${id || '?'} here (not face-up at this port or not open to your band, slot taken, a port closed to you, or cannot afford it)` };
    }
    case 'REPORT': {
      const a = find('REPORT');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot REPORT (no theft against you, or not at a port)' };
    }
    case 'BERTH': {
      const a = find('BERTH');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot BERTH (must be at a port that will have you)' };
    }
    case 'BRIBE': {
      const a = find('BRIBE');
      return a ? { ok: true, action: a } : { ok: false, error: alignmentOn(state) ? 'cannot BRIBE the harbourmaster (Shady or Outlaw only, at a port, with the money)' : 'cannot BRIBE (must be at a port with enough money)' };
    }
    case 'PASS': case 'WAIT': case 'END':
      return { ok: true, action: { type: 'PASS', playerId: pid } };
    case 'REPLAN': case 'STOP':
      // Not an engine action: the captain is asking to be consulted again.
      return { ok: false, error: 'REPLAN — you asked to reconsider; here is the current situation.' };
    default:
      return { ok: false, error: `unknown command "${raw}"` };
  }
}

export { activePlayerId };

import type { GameState, Ground, Tile } from '../types';
import type { Action } from '../actions';
import type { HaulPolicy } from '../engine/buoys';
import { stageFor, isRipe } from '../engine/soak';
import { pricePerLb } from '../engine/market';
import { fuelPriceAt, isPort } from '../engine/ports';
import { upgradeDisplay, upgradeDef, fuelCap, buoyCap, stepsPerSteam } from '../engine/upgrades';
import { potCapacity, potsOnNode } from '../engine/buoys';
import { hopToward } from '../bots/helpers';
import { daysThisSeason, activePlayerId } from '../selectors';

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

function pileSummary(state: GameState, g: Ground): string {
  const pile = state.piles[g];
  const lbs = pile.reduce((s, t) => s + t.weightLb, 0);
  const counts: Record<string, number> = {};
  for (const t of pile) counts[tileWord(t)] = (counts[tileWord(t)] ?? 0) + 1;
  return `${g}: ${pile.length} (${lbs} lb) ${Object.entries(counts).sort().map(([k, n]) => `${n}×${k}`).join(' ')}`;
}

function describeAction(state: GameState, a: Action): string {
  switch (a.type) {
    case 'STEAM': return `STEAM ${a.to}${state.stormed.includes(a.to) ? ' (STORM)' : ''}`;
    case 'DROP': return `DROP (${potCapacity(state) - potsOnNode(state, state.players[a.playerId].node)} of ${potCapacity(state)} berths left on this ground)`;
    case 'HAUL': return `HAUL ${a.buoyId}`;
    case 'STEAL': return `STEAL ${a.buoyId} (${state.players[a.ownerId].name}'s)`;
    case 'SELL': return 'SELL';
    case 'REFUEL': return `REFUEL (up to ${a.units})`;
    case 'REPORT': return 'REPORT';
    case 'BERTH': return `BERTH (slot ${state.nextSlot}${state.nextSlot === 0 ? ', pole: -rep' : ''})`;
    case 'BRIBE': return 'BRIBE';
    case 'BUY_UPGRADE': return `BUY ${a.upgradeId}`;
    case 'PASS': return 'PASS';
    case 'RESTOCK_CLAIM': return `CLAIM ${a.ground}`;
    case 'RESTOCK_CONTRIBUTE': return 'CONTRIBUTE <n>';
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

  if (state.phase === 'RESTOCK') return renderRestockView(state, pid, legal, opts);

  const dis = daysThisSeason(state);
  lines.push(`=== Season ${state.season}/${cfg.seasons}, Day ${state.day}/${dis}, Hour ${state.hour}/${cfg.hoursPerDay} — YOUR TURN (${p.actionsLeft} action points)`);
  lines.push(`Turn order today: ${state.turnOrder.map((id) => (id === pid ? `${state.players[id].name}(YOU)` : state.players[id].name)).join(' → ')}`);
  const berthed = state.pendingNextOrder.map((id, i) => `${state.players[id].name}@${state.players[id].berthNode} slot${i}`);
  lines.push(`Berthed so far today: ${berthed.length ? berthed.join(', ') : 'nobody'} (next slot ${state.nextSlot})`);
  lines.push(`Storms this season: ${state.stormed.length ? state.stormed.join(', ') : 'none'}`);
  lines.push('');

  // me
  const node = cfg.map.nodes[p.node];
  const where = node.type === 'port' ? `${p.node} (${node.port!.market ? 'market port' : 'shelter'})` : `${p.node} (${node.ground} ground${state.stormed.includes(p.node) ? ', STORMED' : ''})`;
  lines.push(`YOU — ${p.name}: at ${where} | fuel ${p.fuel}/${fuelCap(state, p)} | money ${p.money.toFixed(1)} | reputation ${p.tracks.reputation} | conservation ${p.tracks.conservation} | v-tokens ${p.vTokens} | pots in hand ${p.buoysAvailable}/${buoyCap(state, p)} | sold today: ${p.soldToday ? 'yes' : 'no'}`);
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
    lines.push(`RIVAL ${r.name}: at ${r.node}${r.berthed ? ' (berthed)' : ''} | fuel ${r.fuel} | money ${r.money.toFixed(1)} | rep ${r.tracks.reputation} | cons ${r.tracks.conservation} | v-tokens ${r.vTokens} | hold ${r.hold.length} tiles (${r.hold.reduce((s, t) => s + t.weightLb, 0)} lb) | pots at: ${rp.length ? rp.join(', ') : 'none'} | refits: ${rups.length ? rups.join(', ') : 'none'}`);
  }
  lines.push('');

  // commons
  lines.push('BAGS (public):');
  for (const g of GROUNDS) lines.push(`  ${bagSummary(state, g)}`);
  lines.push(`PILES (sold lobsters awaiting restock): ${GROUNDS.map((g) => pileSummary(state, g)).join(' | ')}`);
  const occupied = Object.keys(cfg.map.nodes)
    .filter((n) => cfg.map.nodes[n].type === 'ground' && potsOnNode(state, n) > 0)
    .map((n) => `${n} ${potsOnNode(state, n)}/${potCapacity(state)}`);
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

function renderRestockView(state: GameState, pid: string, legal: Action[], opts: ViewOptions): string {
  const r = state.restock!;
  const p = state.players[pid];
  const lines: string[] = [];
  lines.push(`=== RESTOCK DRAFT after Season ${state.season} — YOUR DECISION (${p.name})`);
  lines.push(`Claim order: ${r.claimOrder.map((id) => state.players[id].name).join(' → ')}. Bags already claimed: ${r.claimed.length ? r.claimed.join(', ') : 'none'}.`);
  lines.push('BAGS now:');
  for (const g of GROUNDS) lines.push(`  ${bagSummary(state, g)}`);
  lines.push('PILES (what can be returned):');
  for (const g of GROUNDS) lines.push(`  ${pileSummary(state, g)}`);
  lines.push(`You hold ${p.vTokens} v-token(s); money ${p.money.toFixed(1)}, reputation ${p.tracks.reputation}, conservation ${p.tracks.conservation}.`);
  if (r.step === 'claim') {
    lines.push(`It is your CLAIM. You rolled ${r.roll}: claim one unclaimed bag and return up to ${r.roll} lobsters from its pile.`);
    lines.push(`Commands: CLAIM <ground> [heavy|light]  (grounds available: ${GROUNDS.filter((g) => !r.claimed.includes(g)).join(', ')})`);
  } else {
    lines.push(`${state.players[r.claimOrder[r.claimTurn]].name} just claimed the ${r.contribGround} bag. You may CONTRIBUTE v-tokens (each returns one more lobster from the ${r.contribGround} pile, which has ${state.piles[r.contribGround!].length} lobsters).`);
    lines.push(`Commands: CONTRIBUTE <n> [heavy|light]  (n from 0 to ${Math.min(p.vTokens, state.piles[r.contribGround!].length)})`);
  }
  if (opts.events.length) {
    lines.push('SINCE YOUR LAST DECISION:');
    for (const e of opts.events) lines.push(`  - ${e}`);
  }
  if (opts.reason) lines.push(`NOTE: ${opts.reason}`);
  lines.push('Reply with JSON: {"plan": ["..."], "note": "..."}');
  return lines.join('\n');
}

// ---- command parsing ----

export type Parsed =
  | { ok: true; action: Action; macro?: undefined }
  | { ok: true; macro: 'GOTO'; target: string; action: Action } // the first hop, resolved now
  | { ok: false; error: string };

const POLICIES: HaulPolicy[] = ['clean', 'highgrade', 'greedy'];
const isModifier = (tok?: string) => !!tok && (POLICIES.includes(tok.toLowerCase() as HaulPolicy) || tok.toLowerCase() === 'token');

function pickTiles(state: GameState, g: Ground, n: number, order: 'heavy' | 'light'): string[] {
  const pile = [...state.piles[g]].sort((a, b) => (order === 'light' ? a.weightLb - b.weightLb : b.weightLb - a.weightLb));
  return pile.slice(0, Math.max(0, Math.min(n, pile.length))).map((t) => t.id);
}

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
  const tokenOf = (toks: string[]) => toks.some((t) => t.toLowerCase() === 'token');

  if (state.phase === 'RESTOCK') {
    const r = state.restock!;
    if (kw === 'CLAIM') {
      if (r.step !== 'claim') return { ok: false, error: 'not your claim turn (it is a CONTRIBUTE decision)' };
      const g = (args[0] ?? '').toLowerCase() as Ground;
      if (!GROUNDS.includes(g)) return { ok: false, error: `CLAIM needs a ground: ${GROUNDS.join('|')}` };
      if (r.claimed.includes(g)) return { ok: false, error: `${g} bag already claimed` };
      const order = (args[1] ?? 'heavy').toLowerCase() === 'light' ? 'light' : 'heavy';
      return { ok: true, action: { type: 'RESTOCK_CLAIM', playerId: pid, ground: g, tileIds: pickTiles(state, g, r.roll, order) } };
    }
    if (kw === 'CONTRIBUTE') {
      if (r.step !== 'contribute') return { ok: false, error: 'not a contribute step (it is your CLAIM)' };
      const n = Math.max(0, Math.floor(Number(args[0] ?? 0)) || 0);
      const p = state.players[pid];
      const spend = Math.min(n, p.vTokens, state.piles[r.contribGround!].length);
      const order = (args[1] ?? 'heavy').toLowerCase() === 'light' ? 'light' : 'heavy';
      return { ok: true, action: { type: 'RESTOCK_CONTRIBUTE', playerId: pid, tileIds: pickTiles(state, r.contribGround!, spend, order) } };
    }
    // Anything else during the draft → a sensible default so the draft can't stall.
    if (r.step === 'claim') return { ok: false, error: `during the restock draft use CLAIM <ground> (got "${raw}")` };
    return { ok: false, error: `during the restock draft use CONTRIBUTE <n> (got "${raw}")` };
  }

  switch (kw) {
    case 'STEAM': {
      const to = (args[0] ?? '').toUpperCase();
      const a = find('STEAM', (s) => s.to === to);
      if (!a) return { ok: false, error: `cannot STEAM to ${to || '?'} from ${state.players[pid].node} right now (not adjacent, no fuel, or no action points)` };
      return { ok: true, action: a };
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
      return { ok: true, action: { ...a, policy: policyOf(args), useToken: tokenOf(args) } };
    }
    case 'STEAL': {
      const id = isModifier(args[0]) ? undefined : args[0];
      const a = id ? find('STEAL', (s) => s.buoyId === id) : find('STEAL');
      if (!a) return { ok: false, error: `cannot STEAL ${id ?? ''} (no ripe rival pot of that id here, or fewer than 2 action points)` };
      return { ok: true, action: { ...a, policy: policyOf(args), useToken: tokenOf(args) } };
    }
    case 'SELL': {
      const a = find('SELL');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot SELL (not a market port, already sold today, empty hold, or no action points)' };
    }
    case 'REFUEL': {
      const a = find('REFUEL');
      if (!a) return { ok: false, error: 'cannot REFUEL (not at a port, tank full, no money, or no action points)' };
      const want = args[0] === undefined ? NaN : Number(args[0]);
      const units = Number.isFinite(want) ? Math.max(0, Math.min(Math.floor(want), a.units)) : a.units;
      if (units === 0) return { ok: false, error: 'REFUEL 0 buys nothing (omit the number to fill up, or give a positive amount)' };
      return { ok: true, action: { ...a, units } };
    }
    case 'BUY': case 'BUY_UPGRADE': case 'REFIT': {
      const id = (args[0] ?? '').toLowerCase();
      const a = find('BUY_UPGRADE', (b) => b.upgradeId === id);
      return a ? { ok: true, action: a } : { ok: false, error: `cannot BUY ${id || '?'} here (not face-up at this port, slot taken, or cannot afford it)` };
    }
    case 'REPORT': {
      const a = find('REPORT');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot REPORT (no theft against you, or not at a port)' };
    }
    case 'BERTH': {
      const a = find('BERTH');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot BERTH (must be at a port)' };
    }
    case 'BRIBE': {
      const a = find('BRIBE');
      return a ? { ok: true, action: a } : { ok: false, error: 'cannot BRIBE (must be at a port with enough money)' };
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

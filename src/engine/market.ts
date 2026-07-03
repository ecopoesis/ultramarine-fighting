import type { GameState } from '../types';
import { portOf, isMarketPort, isPort } from './ports';

// Price per lb at a given market port right now — the more that's been landed
// here today, the lower it drops (flood). Appetite is the port's `elasticity`.
export function pricePerLb(d: GameState, portNode: string, rare: boolean): number {
  const cfg = portOf(d, portNode)?.market;
  if (!cfg) return 0; // not a market
  const sold = d.markets[portNode]?.lbsSoldToday ?? 0;
  const base = Math.max(cfg.floor, cfg.base - cfg.elasticity * sold);
  return base + (rare ? cfg.rareBonus : 0);
}

// SELL: land the whole hold at the port you're tied up in. Which port you sailed
// to IS the choice — Rockland absorbs bulk (low elasticity), island ports pay
// high but flood fast.
export function sell(d: GameState, playerId: string): void {
  const p = d.players[playerId];
  if (!isMarketPort(d, p.node)) throw new Error('No market at this dock');
  if (p.soldToday) throw new Error('Already sold today');
  if (p.hold.length === 0) throw new Error('Empty hold');

  // snapshot price on the lbs sold so far today at this port; then add this volume
  let revenue = 0;
  let lbs = 0;
  for (const t of p.hold) {
    revenue += t.weightLb * pricePerLb(d, p.node, t.color === 'rare');
    lbs += t.weightLb;
  }
  d.markets[p.node].lbsSoldToday += lbs; // flood: depresses THIS port for the rest of the day
  p.money += revenue;
  p.soldToday = true;
  d.log.push(`${p.name} sells ${p.hold.length} tiles (${lbs}lb) at ${p.node} for ${revenue.toFixed(1)}`);
  p.hold = [];
}

export function reportTheft(d: GameState, reporterId: string): void {
  const p = d.players[reporterId];
  if (!isPort(d, p.node)) throw new Error('Report at a port');
  const recIdx = d.thefts.findIndex((t) => t.victimId === reporterId);
  if (recIdx < 0) throw new Error('Nothing to report');
  const rec = d.thefts[recIdx];
  const thief = d.players[rec.thiefId];
  const bounty = rec.value * d.config.reportBountyShare;
  p.money += bounty;
  p.tracks.reputation += d.config.rep.report;
  thief.tracks.reputation += d.config.rep.reported; // extra heat on confiscation
  d.thefts.splice(recIdx, 1);
  d.log.push(`${p.name} reports ${thief.name}; bounty ${bounty.toFixed(1)}`);
}

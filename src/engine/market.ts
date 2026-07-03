import type { GameState, BuyerId } from '../types';

export function pricePerLb(d: GameState, buyerId: BuyerId, rare: boolean): number {
  const cfg = d.config.buyers[buyerId];
  const sold = d.buyers[buyerId].lbsSoldToday;
  const base = Math.max(cfg.floor, cfg.base - cfg.elasticity * sold);
  return base + (rare ? cfg.rareBonus : 0);
}

export function sell(d: GameState, playerId: string, buyerId: BuyerId): void {
  const p = d.players[playerId];
  if (p.node !== d.config.map.harbor) throw new Error('Must be at harbor to sell');
  if (p.soldToday) throw new Error('Already sold today');
  if (p.hold.length === 0) throw new Error('Empty hold');

  // snapshot price on the lbs sold so far today; then add this sale's volume
  let revenue = 0;
  let lbs = 0;
  for (const t of p.hold) {
    const per = pricePerLb(d, buyerId, t.color === 'rare');
    revenue += t.weightLb * per;
    lbs += t.weightLb;
  }
  d.buyers[buyerId].lbsSoldToday += lbs; // flood: depresses the buyer for the rest of the day
  p.money += revenue;
  p.soldToday = true;
  d.log.push(`${p.name} sells ${p.hold.length} tiles (${lbs}lb) to ${buyerId} for ${revenue.toFixed(1)}`);
  p.hold = [];
}

export function reportTheft(d: GameState, reporterId: string): void {
  const p = d.players[reporterId];
  if (p.node !== d.config.map.harbor) throw new Error('Report at harbor');
  const recIdx = d.thefts.findIndex((t) => t.victimId === reporterId);
  if (recIdx < 0) throw new Error('Nothing to report');
  const rec = d.thefts[recIdx];
  const thief = d.players[rec.thiefId];
  const bounty = rec.value * d.config.reportBountyShare;
  p.money += bounty;
  p.tracks.reputation += d.config.rep.report;
  thief.tracks.reputation += d.config.rep.reported; // extra heat on confiscation (own dial, not a 2nd steal penalty)
  d.thefts.splice(recIdx, 1);
  d.log.push(`${p.name} reports ${thief.name}; bounty ${bounty.toFixed(1)}`);
}

import type { GameState } from '../types';
import { portOf, isMarketPort, isPort } from './ports';
import { alignmentOn, bandOf, heatCheck, stepAlignment, coolStars, addStars } from './alignment';

// Price per lb at a given market port right now — the more that's been landed
// here today, the lower it drops (flood). Appetite is the port's `elasticity`.
export function pricePerLb(d: GameState, portNode: string, rare: boolean): number {
  const cfg = portOf(d, portNode)?.market;
  if (!cfg) return 0; // not a market
  const sold = d.markets[portNode]?.lbsSoldToday ?? 0;
  // one whole money off for every dropPerLbs already landed here today
  const base = Math.max(cfg.floor, cfg.base - Math.floor(sold / cfg.dropPerLbs));
  return base + (rare ? cfg.rareBonus : 0);
}

// SELL: land the whole hold at the port you're tied up in. Which port you sailed
// to IS the choice — Rockland absorbs bulk (low elasticity), island ports pay
// high but flood fast.
export function sell(d: GameState, playerId: string, bribeDice = 0): void {
  const p = d.players[playerId];
  if (!isMarketPort(d, p.node)) throw new Error('No market at this dock');
  if (p.soldToday) throw new Error('Already sold today');
  if (p.hold.length === 0) throw new Error('Empty hold');

  // Under the table: a dark captain's buyer knocks whole money off every pound.
  const cut = alignmentOn(d) ? bandOf(d, p).priceCut : 0;
  // A sale floods its OWN price. Lay the hold out one lobster at a time, best first
  // (rare, then heaviest — what any captain would do): each is paid at the price the
  // track stands at when it lands, then the marker moves down by its weight. Pricing
  // the whole hold at the pre-sale price let a hoarded 159 lb hold sell for 805 in one
  // go without denting its own market (opus13) — only the captains after you paid for
  // the flood. It stays hand-computable: step down the price track as you lay tiles.
  let revenue = 0;
  let lbs = 0;
  let cutLoss = 0;
  const order = [...p.hold].sort((a, b) => (Number(b.color === 'rare') - Number(a.color === 'rare')) || (b.weightLb - a.weightLb));
  for (const t of order) {
    const price = pricePerLb(d, p.node, t.color === 'rare');
    revenue += t.weightLb * Math.max(0, price - cut);
    cutLoss += t.weightLb * Math.min(cut, price);
    lbs += t.weightLb;
    d.markets[p.node].lbsSoldToday += t.weightLb; // the flood lands as you sell, and stays for the day
  }
  p.soldToday = true;

  // THE WARDEN'S CHECK (flags.alignment): one heat die per star. Bust, and you drop the
  // catch and run — it rolls into the market all the same (the flood above stands, so
  // the next captain in pays for your run too), you get nothing, and this port is shut
  // to you for the rest of the day.
  const check = heatCheck(d, p, bribeDice);
  if (check.failed) {
    const band = bandOf(d, p).name;
    stepAlignment(d, p, d.config.alignment.step.caught, 'caught by the warden');
    if (band === 'paragon' && p.tracks.alignment > d.config.alignment.paragonFallTo) {
      p.tracks.alignment = d.config.alignment.paragonFallTo;
      d.log.push(`${p.name} — the harbour's pride, caught cheating — falls to ${bandOf(d, p).name.toUpperCase()} (alignment ${p.tracks.alignment})`);
    }
    (p.barredPorts ??= []).push(p.node);
    d.log.push(`${p.name} drops the catch (${lbs}lb) and runs — ${p.node} is closed to them for the rest of the day`);
    for (const t of p.hold) if (!t.seeded) d.piles[t.ground].push(t);
    p.hold = [];
    return;
  }
  const take = Math.min(revenue, check.take);
  if (take > 0) d.log.push(`The warden takes ${take} of ${p.name}'s ${revenue}`);
  if (check.nerves) coolStars(d, p, 1, 'nerves of steel');
  revenue -= take;
  p.money += revenue;
  // Landing at the co-op: less money per pound, but standing in the harbour.
  const mkt = portOf(d, p.node)?.market;
  const coop = mkt?.coopRep ?? 0;
  const coopOpen = alignmentOn(d) ? bandOf(d, p).coop && p.licensed !== false : (p.licensed !== false || d.config.unlicensed.mayUseCoop);
  if (coop > 0 && lbs >= (mkt?.coopMinLb ?? 0) && coopOpen) {
    p.tracks.reputation += coop;
    if (alignmentOn(d)) stepAlignment(d, p, d.config.alignment.step.coopLanding, 'landed at the co-op');
    else d.log.push(`${p.name} lands at the co-op (+${coop} reputation, now ${p.tracks.reputation})`);
  }
  d.log.push(`${p.name} sells ${p.hold.length} tiles (${lbs}lb) at ${p.node} for ${revenue.toFixed(1)}${cutLoss > 0 ? ` (under the table: ${cutLoss} less)` : ''}`);
  // Sold BAG lobsters aren't destroyed — they land on their home bag's extraction
  // pile, where the inter-season restock draft can return some to the commons.
  // Seeded (generic) lobsters are an OPEN injection: they leave the world on sale.
  for (const t of p.hold) if (!t.seeded) d.piles[t.ground].push(t);
  p.hold = [];
}

export function reportTheft(d: GameState, reporterId: string): void {
  const p = d.players[reporterId];
  if (!isPort(d, p.node)) throw new Error('Report at a port');
  const recIdx = d.thefts.findIndex((t) => t.victimId === reporterId);
  if (recIdx < 0) throw new Error('Nothing to report');
  const rec = d.thefts[recIdx];
  const thief = d.players[rec.thiefId];
  const bounty = Math.floor(rec.value / d.config.reportBountyDivisor);
  p.money += bounty;
  p.tracks.reputation += d.config.rep.report;
  thief.tracks.reputation += d.config.rep.reported; // extra heat on confiscation
  stepAlignment(d, p, d.config.alignment.step.report, 'reported a theft');
  addStars(d, thief, d.config.heat.reportedStars, 'reported for theft');
  d.thefts.splice(recIdx, 1);
  d.log.push(`${p.name} reports ${thief.name}; bounty ${bounty.toFixed(1)}`);
}

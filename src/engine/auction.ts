import type { GameState } from '../types';
import type { Action } from '../actions';
import { openSeason } from './season';

// THE LICENCE AUCTION — a sealed-bid, second-price auction for the season's fishing
// licence, run at the start of every season after the first.
//
// Everyone bids in secret. Bids are revealed together. The price everyone pays is the
// SECOND-highest bid. The top two bidders are COMMITTED and must buy at that price;
// everyone else may take it or leave it.
//
// The licence itself is not scarce, so price discovery alone would collapse: if you
// can always buy at the clearing price anyway, bidding the minimum strictly dominates
// and the auction degenerates into the flat fee it replaced. What makes a bid worth
// making is that THE BID ORDER IS THE SEASON'S TURN ORDER. You are bidding for the
// harbour's pecking order as much as for the licence — first pick of the water on
// opening day, and first crack at the seeded piles — which is worth real money now
// that gear congestion makes berths contested.
//
// Second-price keeps the bidding honest: you can bid what the position is truly worth
// to you without fear of paying it, because you pay what your closest rival thought.

export interface AuctionState {
  minBid: number;
  bidOrder: string[];            // who has still to bid, in seat order
  bidTurn: number;
  bids: Record<string, number>;  // SECRET until every captain has bid
  revealed: boolean;
  price: number;                 // the second-highest bid
  optionOrder: string[];         // everyone not committed, in bid order
  optionTurn: number;
}

export const auctionMinBid = (d: GameState): number =>
  d.config.licensePerSeason?.[Math.min(d.season - 1, d.config.licensePerSeason.length - 1)] ?? 0;

// Open the bidding. Captains who cannot even meet the minimum simply cannot bid.
export function enterAuction(d: GameState): void {
  d.phase = 'AUCTION';
  d.auction = {
    minBid: auctionMinBid(d),
    bidOrder: Object.keys(d.players),
    bidTurn: 0,
    bids: {},
    revealed: false,
    price: 0,
    optionOrder: [],
    optionTurn: 0,
  };
  d.log.push(`--- Season ${d.season} licence auction. Sealed bids, minimum ${d.auction.minBid}; the price is the second-highest bid, and the bid order is this season's turn order. ---`);
}

// Rank bidders high to low; non-bidders keep seat order behind them.
function ranked(d: GameState): string[] {
  const a = d.auction!;
  const seats = Object.keys(d.players);
  const bidders = seats.filter((id) => (a.bids[id] ?? 0) > 0);
  const rest = seats.filter((id) => !((a.bids[id] ?? 0) > 0));
  bidders.sort((x, y) => (a.bids[y] - a.bids[x]) || (seats.indexOf(x) - seats.indexOf(y)));
  return [...bidders, ...rest];
}

function grant(d: GameState, id: string, price: number, forced: boolean): void {
  const p = d.players[id];
  if (p.money < price) {
    p.licensed = false;
    d.log.push(`${p.name} cannot cover the ${price} licence — fishing unlicensed this season`);
    return;
  }
  p.money -= price;
  p.licensed = true;
  d.log.push(`${p.name} ${forced ? 'is committed to' : 'takes'} the season ${d.season} licence at ${price} (money ${p.money.toFixed(1)})`);
}

// All bids are in: reveal, set the price, and commit the top two.
function reveal(d: GameState): void {
  const a = d.auction!;
  a.revealed = true;
  const order = ranked(d);
  const values = order.map((id) => a.bids[id] ?? 0).filter((v) => v > 0).sort((x, y) => y - x);
  // With fewer than two bidders there is no second bid to price against, so the
  // minimum stands — the reserve the harbour will not go below.
  a.price = values.length >= 2 ? values[1] : a.minBid;
  d.log.push(`Bids: ${order.map((id) => `${d.players[id].name} ${a.bids[id] ? a.bids[id] : '—'}`).join(', ')}. Price is ${a.price}.`);

  const committed = order.filter((id) => (a.bids[id] ?? 0) > 0).slice(0, 2);
  for (const id of committed) grant(d, id, a.price, true);
  a.optionOrder = order.filter((id) => !committed.includes(id));
  a.optionTurn = 0;
  if (a.optionOrder.length === 0) finishAuction(d);
}

export function applyAuctionAction(d: GameState, action: Action): void {
  const a = d.auction!;
  if (!a.revealed) {
    if (action.type !== 'LICENSE_BID') throw new Error('auction: expected a sealed bid');
    const p = d.players[action.playerId];
    // A bid you cannot honour is not a bid. Clamp to the money actually in hand.
    const want = Math.max(0, Math.floor(action.amount));
    a.bids[action.playerId] = want >= a.minBid && p.money >= want ? want : 0;
    a.bidTurn++;
    if (a.bidTurn >= a.bidOrder.length) reveal(d);
    return;
  }
  if (action.type !== 'LICENSE_BUY') throw new Error('auction: expected a take-it-or-leave-it');
  const id = a.optionOrder[a.optionTurn];
  if (action.take) grant(d, id, a.price, false);
  else {
    d.players[id].licensed = false;
    d.log.push(`${d.players[id].name} passes on the licence — fishing unlicensed this season`);
  }
  a.optionTurn++;
  if (a.optionTurn >= a.optionOrder.length) finishAuction(d);
}

// The bid order becomes the season's turn order: what the auction really sold.
export function finishAuction(d: GameState): void {
  const order = ranked(d);
  d.auction = undefined;
  d.phase = 'PLAYING';
  openSeason(d, order);
}

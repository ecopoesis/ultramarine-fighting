import type { GameState, Ground } from '../types';
import type { Action } from '../actions';
import { randInt } from '../rng';
import { placeStorms } from './weather';
import { seedSpaces } from './seeded';
import { buoyCap } from './upgrades';

// The inter-season RESTOCK DRAFT as a real, action-driven phase (what a human UI
// will drive too). Going around in berth order, each captain CLAIMS one remaining
// bag, rolls the lobster die for how many, and returns that many lobsters from the
// bag's extraction pile (their secret choice). After each claim, players to the
// claimer's LEFT may CONTRIBUTE v-notch tokens — one token = one extra lobster of
// their choice back into that bag. With ~4 bags, the tail of the berth order may
// never get to claim, so the pole is worth fighting for.

// Roll the custom lobster d6: pick one of its six faces uniformly. A blank (0)
// face is a legal outcome — the claim is wasted but the bag is still locked.
const rollDie = (d: GameState) => {
  const faces = d.config.restock.dieFaces;
  return faces[randInt(d, faces.length)];
};

// Enter the draft: capture the berth order as the claim order and roll for the
// first claimer. The season reset (pull gear, send everyone home, advance the
// season) is deferred to finishSeasonRollover, once the draft completes.
export function enterRestock(d: GameState): void {
  d.phase = 'RESTOCK';
  d.restock = {
    claimOrder: d.turnOrder.slice(),
    claimTurn: 0,
    claimed: [],
    roll: rollDie(d),
    step: 'claim',
  };
  d.log.push(`--- Restock draft. Claim order: ${d.restock.claimOrder.join(', ')} ---`);
}

// Move specific pile tiles (by id) back into their bag. Throws on an unknown id so
// an illegal selection can't silently mint or misplace lobsters.
function returnTiles(d: GameState, ground: Ground, tileIds: string[]): void {
  const pile = d.piles[ground];
  for (const id of tileIds) {
    const idx = pile.findIndex((t) => t.id === id);
    if (idx < 0) throw new Error(`restock: tile ${id} not in ${ground} pile`);
    d.bags[ground].push(pile.splice(idx, 1)[0]);
  }
}

export function applyRestockAction(d: GameState, a: Action): void {
  const r = d.restock!;
  if (r.step === 'claim') {
    if (a.type !== 'RESTOCK_CLAIM') throw new Error('restock: expected a claim');
    if (r.claimed.includes(a.ground)) throw new Error('restock: bag already claimed');
    if (a.tileIds.length > r.roll) throw new Error('restock: returned more than the roll allows');
    returnTiles(d, a.ground, a.tileIds);
    r.claimed.push(a.ground);
    d.log.push(`${d.players[a.playerId].name} restocks ${a.ground} +${a.tileIds.length} (rolled ${r.roll}; pile ${d.piles[a.ground].length} left)`);

    // Open the contribution round: everyone to the claimer's left, in seat order.
    const seating = Object.keys(d.players);
    const ci = seating.indexOf(a.playerId);
    const contribOrder: string[] = [];
    for (let k = 1; k < seating.length; k++) contribOrder.push(seating[(ci + k) % seating.length]);
    r.step = 'contribute';
    r.contribGround = a.ground;
    r.contribOrder = contribOrder;
    r.contribTurn = 0;
    advanceContribute(d); // handles the solo-player case (no one to contribute)
    return;
  }

  if (a.type !== 'RESTOCK_CONTRIBUTE') throw new Error('restock: expected a contribution');
  if (a.tileIds.length > 0) {
    const p = d.players[a.playerId];
    if (a.tileIds.length > p.vTokens) throw new Error('restock: not enough v-notch tokens');
    returnTiles(d, r.contribGround!, a.tileIds);
    p.vTokens -= a.tileIds.length; // spending a token trades conservation VP for a healthier commons
    d.log.push(`${p.name} spends ${a.tileIds.length} v-notch → +${a.tileIds.length} to ${r.contribGround}`);
  }
  r.contribTurn!++;
  advanceContribute(d);
}

// Move past finished contributors; when the round is done, advance to the next
// claimer — or finish the draft if every captain has claimed or every bag is done.
function advanceContribute(d: GameState): void {
  const r = d.restock!;
  if (r.contribTurn! < r.contribOrder!.length) return;
  r.step = 'claim';
  r.contribGround = undefined;
  r.contribOrder = undefined;
  r.contribTurn = undefined;
  r.claimTurn++;
  const grounds = Object.keys(d.bags) as Ground[];
  if (r.claimTurn >= r.claimOrder.length || r.claimed.length >= grounds.length) {
    finishSeasonRollover(d);
  } else {
    r.roll = rollDie(d);
  }
}

// Close out the season: pull all gear, send every captain home to the start port,
// advance to the next season in base seat order. Also the direct path for the
// no-restock transition into the final season.
export function finishSeasonRollover(d: GameState): void {
  const ids = Object.keys(d.players);
  for (const id of ids) {
    const p = d.players[id];
    p.deployed = [];
    p.soak = {};
    p.buoysAvailable = buoyCap(d, p); // cargo-hold refit carries over
    p.node = d.config.map.startPort;
    p.berthNode = undefined;
    p.berthed = false;
    p.soldToday = false;
    p.actionsLeft = 0;
  }
  d.restock = undefined;
  d.phase = 'PLAYING';
  d.season++;
  // Re-roll the weather for the new season: old tokens clear, the storm intensifies
  // inward. Happens on EVERY rollover, including the no-restock 4→5 (the ocean stops
  // recovering, but the weather keeps worsening).
  placeStorms(d);
  // Drop this season's generic lobsters onto every space (accumulating on the unfished).
  seedSpaces(d);
  d.turnOrder = ids;
  d.pendingNextOrder = [];
  d.nextSlot = 0;
  d.day = 1;
  d.hour = 1;
  d.activePlayerIndex = 0;
  d.players[d.turnOrder[0]].actionsLeft = d.config.actionsPerTurn;
  d.log.push(`=== Season ${d.season} begins at ${d.config.map.startPort}. Order: ${ids.join(', ')} ===`);
}

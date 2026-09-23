import type { GameState } from '../types';
import { placeStorms } from './weather';
import { seedSpaces } from './seeded';
import { buoyCap } from './upgrades';
import { enterAuction, auctionMinBid } from './auction';
import { breedingRollover } from './breeding';
import { placeWardens } from './patrol';

// The season boundary: pull every pot, send the fleet home, let the protected stock
// spawn, re-roll the weather, then open the new season — via the licence auction,
// whose bid order becomes the turn order.
//
// This file used to be restock.ts and held the RESTOCK DRAFT: in berth order each
// captain claimed a bag, rolled a die and returned that many lobsters, after which
// everyone else could spend v-tokens to add more. It is gone, and the measurements
// are why. The contribute round asked about 48 questions a game across the table and
// got roughly one answer, because giving up a token worth guaranteed points to
// restock water everybody fishes is a textbook public-goods failure — two of the last
// four games with it produced zero contributions from anybody. Breeding stock does
// the same job without asking anyone to donate: you paid during the season by
// throwing a lobster back, and the ground's track is the public record of it.

export function finishSeasonRollover(d: GameState): void {
  const ids = Object.keys(d.players);
  // The protected stock spawns — except into the final season, which gets no relief.
  if (d.season < d.config.seasons - 1) breedingRollover(d);

  for (const id of ids) {
    const p = d.players[id];
    p.deployed = [];
    p.soak = {};
    p.buoysAvailable = buoyCap(d, p); // cargo-hold refit carries over
    p.node = d.config.map.startPort;
    p.berthNode = undefined;
    p.berthed = false;
    p.madeHarbour = false;
    p.soldToday = false;
    p.actionsLeft = 0;
  }
  d.phase = 'PLAYING';
  d.season++;
  // Re-roll the weather: old tokens clear, the storm intensifies inward. Happens on
  // EVERY rollover including the last (the ocean stops recovering, the weather does
  // not stop worsening). Then this season's generic lobsters go onto every space.
  placeStorms(d);
  seedSpaces(d);
  // The season's licences go under the hammer, and the bid order opens the season.
  if (auctionMinBid(d) > 0) { enterAuction(d); return; }
  for (const id of ids) d.players[id].licensed = true;
  openSeason(d, ids);
}

// Set the season running: turn order, day one, first captain on the clock.
export function openSeason(d: GameState, order: string[]): void {
  d.turnOrder = order;
  d.pendingNextOrder = [];
  d.nextSlot = 0;
  d.day = 1;
  d.hour = 1;
  d.activePlayerIndex = 0;
  placeWardens(d); // day one's patrol
  d.players[d.turnOrder[0]].actionsLeft = d.config.actionsPerTurn;
  d.log.push(`=== Season ${d.season} begins at ${d.config.map.startPort}. Order: ${order.map((id) => d.players[id].name).join(', ')} ===`);
}

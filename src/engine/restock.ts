import type { GameState, Ground, Tile } from '../types';
import { randInt } from '../rng';

// Inter-season RESTOCK DRAFT. Going around in berth order, each captain claims one
// remaining bag, rolls the lobster die for how many (1..dieFaces), and returns
// that many lobsters from that bag's extraction pile back into the bag. There are
// only ~4 bags, so with more players than bags the tail of the berth order does
// NOT get to restock — which is exactly what makes the pole worth fighting for;
// with fewer players than bags, some bags go un-restocked and stay depleted.
//
// Which bag, and which lobsters to return, is the strategic layer (a rich bag
// helps everyone who fishes it; you can also stock it thin to deny). For now the
// resolver uses one neutral heuristic — claim the most-depleted bag with stock,
// return the heaviest keepers — pending archetype-specific restock strategies and
// the v-notch spend layer.
export function restock(d: GameState): void {
  const grounds = Object.keys(d.bags) as Ground[];
  const claimed = new Set<Ground>();

  for (const pid of d.turnOrder) {           // berth order
    if (claimed.size >= grounds.length) break; // every bag already restocked
    // Claim the unclaimed bag with the most in its pile (the most to restore).
    const pick = grounds
      .filter((g) => !claimed.has(g) && d.piles[g].length > 0)
      .sort((a, b) => d.piles[b].length - d.piles[a].length)[0];
    if (!pick) continue; // nothing left worth restocking for this captain

    claimed.add(pick);
    const n = randInt(d, d.config.restock.dieFaces) + 1; // roll the lobster die: 1..dieFaces
    const returned = drawFromPile(d.piles[pick], n);
    d.bags[pick].push(...returned);
    d.log.push(`${d.players[pid].name} restocks ${pick} +${returned.length} (rolled ${n}; pile ${d.piles[pick].length} left)`);
  }
}

// Take up to `n` lobsters out of a pile, heaviest first (rebuild fishing value),
// removing them from the pile. Mutates the pile; returns the taken tiles.
function drawFromPile(pile: Tile[], n: number): Tile[] {
  pile.sort((a, b) => b.weightLb - a.weightLb);
  return pile.splice(0, Math.min(n, pile.length));
}

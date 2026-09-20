import type { GameState, Ground, Tile } from '../types';
import { randInt, takeRandom } from '../rng';

// BREEDING STOCK — what replaces the restock draft.
//
// Every berried female you v-notch and release advances her ground's BREEDING STOCK
// track, which is public and sits on the board. At each season change the protected
// stock spawns: a ground rolls one lobster die per band of notches on its track, and
// returns that many lobsters from its extraction pile to its bag.
//
// Why this rather than the draft. The draft asked ~48 questions a game across the
// table and got about one answer: contributing a v-token was a textbook public-goods
// failure, since a held token is guaranteed points and a contribution is a gift to
// everyone who fishes that water. Here nobody is asked to donate anything. You paid
// during the season, by throwing back a 4 lb lobster you could have landed, and the
// track is the public record of it. The water you protected is the water that comes
// back, which also makes the notch a question of WHERE and not merely whether.
//
// The dice are the flavour: stewardship should feel like tending something alive, not
// like arithmetic. A thin track can roll nothing at all; a well-tended one rarely does.

// Dice for a track, from the config's bands (widening, so the first notches on a
// ground are worth the most and no single ground can run away with the recovery).
export function diceFor(d: GameState, notches: number): number {
  const row = d.config.breeding.diceByNotches.find((r) => notches >= r.atLeast);
  return row?.dice ?? 0;
}

const rollOne = (d: GameState): number => {
  const faces = d.config.breeding.dieFaces;
  return faces[randInt(d, faces.length)];
};

// Return `n` lobsters from a ground's pile to its bag, drawn AT RANDOM.
//
// The pile is a lobster trap on the board — a 3D one you can reach into — so the
// physical object does the work: shake it and take what comes out. An earlier version
// returned the lightest first, to model the size truncation that selective harvest
// causes in a real fishery. It was a nice story and a bad rule: sorting a heap of
// tiles by weight at every season change is exactly the table-side misery this game
// has been stripping out, and it bought a subtle effect at a real cost in tedium.
//
// Drawing blind also quietly fixes a hole in the sorted version. A greedy captain who
// lands undersized shorts puts 0 lb tiles in the trap, and lightest-first handed those
// back BEFORE any real lobster — one dirty player could poison a ground's recovery for
// everyone at no cost to themselves. Drawn at random they are just part of the mix.
function returnFromPile(d: GameState, g: Ground, n: number): number {
  const pile = d.piles[g];
  let back = 0;
  for (let i = 0; i < n; i++) {
    const t: Tile | undefined = takeRandom(d, pile);
    if (!t) break;                       // the trap is empty: nothing left to come back
    d.bags[g].push(t);
    back++;
  }
  return back;
}

// The season's breeding. Called at each season change except the one into the final
// season — the ocean gets no relief for the last year.
export function breedingRollover(d: GameState): void {
  const parts: string[] = [];
  for (const g of Object.keys(d.bags) as Ground[]) {
    const notches = d.notches[g] ?? 0;
    const dice = diceFor(d, notches);
    if (dice === 0) { parts.push(`${g}: ${notches} notched, no stock to speak of`); continue; }
    const rolls: number[] = [];
    for (let i = 0; i < dice; i++) rolls.push(rollOne(d));
    const spawn = rolls.reduce((a, b) => a + b, 0);
    const back = returnFromPile(d, g, spawn);
    parts.push(`${g}: ${notches} notched → ${dice}d [${rolls.join(',')}] → ${back} back${back < spawn ? ` (pile ran dry, ${spawn} wanted)` : ''}`);
  }
  d.log.push(`--- Breeding stock spawns. ${parts.join(' | ')} ---`);
}

import type { GameState, PlayerState } from '../types';
import { randInt } from '../rng';
import { alignmentOn, bandOf, stepAlignment, coolStars, heatCheck } from './alignment';

// WARDEN PATROLS — random area denial for the dark side (flags.patrols).
//
// Every morning n cards come off the patrol deck — one card per ocean space — and each
// drawn space gets a warden boat. n is one, plus one for every captain on the dark
// side (Shady or Outlaw) that morning, to a maximum of three: the more crooked the
// harbour, the more boats are out.
//
// Wardens ignore captains with no stars. A captain with heat who ENTERS a warden's
// space takes a heat check at sea, every time, even against the same boat twice in a
// day: one heat die per star, and the warden can be bribed on the same band scale as
// at the market (floor and escalating price from the band card).
//   - all blanks: nerves of steel, one star off, as at the counter.
//   - a bust: the day is over. The warden SEIZES THE CATCH in their hold, they are
//     escorted home to the start port, and they launch LAST tomorrow (anyone stopped
//     after them launches behind them). Their pots stay in the water.
// A smart captain steers around the boats, so this may rarely fire. That is the point:
// it bends routes, it doesn't have to catch anyone.

export const patrolsOn = (d: GameState): boolean => alignmentOn(d) && !!d.config.flags.patrols;

const oceanSpaces = (d: GameState): string[] =>
  Object.keys(d.config.map.nodes).filter((n) => d.config.map.nodes[n].type === 'ground');

export function wardenCount(d: GameState): number {
  const dark = Object.values(d.players).filter((p) => bandOf(d, p).blackMarket).length; // Shady or Outlaw
  const { base, perDarkCaptain, max } = d.config.patrol;
  return Math.min(max, base + perDarkCaptain * dark);
}

// Draw this morning's patrol. Consumes RNG only when patrols are on.
export function placeWardens(d: GameState): void {
  d.patrolBusts = 0;
  if (!patrolsOn(d)) { d.wardens = []; return; }
  const deck = oceanSpaces(d);
  const out: string[] = [];
  for (let i = 0, n = wardenCount(d); i < n && deck.length; i++) out.push(deck.splice(randInt(d, deck.length), 1)[0]);
  d.wardens = out;
  d.log.push(`Warden boats out today: ${out.join(', ')}`);
}

export const isWarden = (d: GameState, node: string): boolean => !!d.wardens?.includes(node);

// A captain with stars has just entered `node`. Returns true if they were stopped.
export function patrolCheck(d: GameState, p: PlayerState, node: string, bribeDice = 0): boolean {
  if (!patrolsOn(d) || p.tracks.heat <= 0 || !isWarden(d, node)) return false;
  const check = heatCheck(d, p, bribeDice, `A warden boat stops ${p.name} at ${node}`);
  if (!check.failed) {
    if (check.nerves) coolStars(d, p, 1, 'nerves of steel at sea');
    return false;
  }
  const wasParagon = bandOf(d, p).name === 'paragon';
  stepAlignment(d, p, d.config.alignment.step.caught, 'busted by a warden patrol');
  if (wasParagon && p.tracks.alignment > d.config.alignment.paragonFallTo) p.tracks.alignment = d.config.alignment.paragonFallTo;
  // The warden seizes the catch. Seized lobsters go to their grounds' traps, as landed
  // catch does (seeded ones leave the world), so the census stays closed.
  const lbs = p.hold.reduce((a, t) => a + t.weightLb, 0);
  for (const t of p.hold) if (!t.seeded) d.piles[t.ground].push(t);
  if (p.hold.length) d.log.push(`The warden seizes ${p.name}'s catch (${lbs} lb)`);
  p.hold = [];
  // Escorted home; the day is over, and tomorrow they launch last.
  p.node = d.config.map.startPort;
  p.berthNode = d.config.map.startPort;
  p.berthed = true;
  p.madeHarbour = false;
  p.actionsLeft = 0;
  p.patrolBustSeq = d.patrolBusts ?? 0;
  d.patrolBusts = (d.patrolBusts ?? 0) + 1;
  d.log.push(`${p.name} is escorted home to ${d.config.map.startPort} — their day is over, and they launch last tomorrow`);
  return true;
}

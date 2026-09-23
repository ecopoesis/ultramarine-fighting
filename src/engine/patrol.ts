import type { GameState, PlayerState } from '../types';
import { randInt } from '../rng';
import { alignmentOn, bandOf, stepAlignment, coolStars } from './alignment';

// WARDEN PATROLS — random area denial for the dark side (flags.patrols).
//
// Every morning n cards come off the patrol deck — one card per ocean space — and each
// drawn space gets a warden boat. n is one, plus one for every captain on the dark
// side (Shady or Outlaw) that morning, to a maximum of three: the more crooked the
// harbour, the more boats are out.
//
// Wardens ignore captains with no stars. A captain with heat who ENTERS a warden's
// space takes a heat check at sea, every time, even against the same boat twice in a
// day: one heat die per star, no bribe (there's no counter to slide money across).
//   - all blanks: nerves of steel, one star off, as at the counter.
//   - a bust: the day is over. They are sent home to the start port and launch LAST
//     tomorrow (anyone stopped after them launches behind them). Their catch and gear
//     stay theirs; the price is the day and the turn order.
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
export function patrolCheck(d: GameState, p: PlayerState, node: string): boolean {
  if (!patrolsOn(d) || p.tracks.heat <= 0 || !isWarden(d, node)) return false;
  const h = d.config.heat;
  const rolls: number[] = [];
  for (let i = 0; i < p.tracks.heat; i++) rolls.push(h.dieFaces[randInt(d, h.dieFaces.length)]);
  const total = rolls.reduce((a, b) => a + b, 0);
  const busted = total >= h.failAt;
  d.log.push(`A warden boat stops ${p.name} at ${node}: ${rolls.length} ${rolls.length === 1 ? 'die' : 'dice'} [${rolls.join(',')}] = ${total}${busted ? ' — BUSTED at sea' : ''}`);
  if (!busted) {
    if (rolls.every((r) => r === 0)) coolStars(d, p, 1, 'nerves of steel at sea');
    return false;
  }
  const wasParagon = bandOf(d, p).name === 'paragon';
  stepAlignment(d, p, d.config.alignment.step.caught, 'busted by a warden patrol');
  if (wasParagon && p.tracks.alignment > d.config.alignment.paragonFallTo) p.tracks.alignment = d.config.alignment.paragonFallTo;
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

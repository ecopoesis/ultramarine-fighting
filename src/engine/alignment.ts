import type { AlignmentBand, GameState, Ground, PlayerState } from '../types';
import { randInt } from '../rng';
import { avgBagHealth } from './scoring';

// THE LIGHT/DARK SWITCHBOARD (SPEC §14). Money is the only score. ALIGNMENT is a
// track from dark (−) to light (+) that scores nothing and switches things on and
// off — prices, the co-op, the licence duty, refuges, closed water, the dividend.
// HEAT is a wanted level of 0–5 stars that the warden reads every time you sell.
//
// Why this replaced conservation + reputation as VP: under the weak-link card every
// dark act subtracted from a scored track, so the dark side was a tax, never a
// strategy — offered a clean keep-or-notch choice, Opus captains notched 139 times
// and kept nothing (opus12). Here the dark side is meant to pay MORE on average, and
// only lose to the dice.
//
// Everything is gated on the flag. With it off, nothing here runs and no RNG is
// consumed, so every existing seed and transcript replays byte-identical.

export const alignmentOn = (d: GameState): boolean => !!d.config.flags.alignment;

export function bandOf(d: GameState, p: PlayerState): AlignmentBand {
  const bands = d.config.alignment.bands;
  return bands.find((b) => p.tracks.alignment >= b.atLeast) ?? bands[bands.length - 1];
}

// Move along the track by whole steps, clamped to its printed ends.
//
// `crimes` marks a step as crimes (illegal keeps, poaching, theft, black-market gear).
// THE BOTTOM OF THE VILLAIN ARC: once an Outlaw is pinned at the dark end, a crime can
// no longer cost them alignment — measured, opus15's outlaws said so out loud ("I'm
// already at −10, so poaching can't push me lower"). So each crime that would have
// pushed them past the end costs a star instead.
export function stepAlignment(d: GameState, p: PlayerState, delta: number, why: string, crimes = 0): void {
  if (!alignmentOn(d) || delta === 0) return;
  const { min, max } = d.config.alignment;
  const before = bandOf(d, p).name;
  if (crimes > 0 && delta < 0) {
    const perCrime = -delta / crimes;
    const room = p.tracks.alignment - min;             // steps left before the end of the track
    const overflowCrimes = Math.max(0, crimes - Math.floor(room / perCrime));
    if (overflowCrimes > 0) addStars(d, p, overflowCrimes * d.config.alignment.floorStarsPerCrime, 'nowhere darker to go');
  }
  p.tracks.alignment = Math.max(min, Math.min(max, p.tracks.alignment + delta));
  const after = bandOf(d, p).name;
  d.log.push(`${p.name} ${delta > 0 ? 'steps lighter' : 'steps darker'} (${why}): alignment ${p.tracks.alignment}${after !== before ? ` — now ${after.toUpperCase()}` : ''}`);
}

// Add heat stars, capped at five. Public: the star track is on the board.
export function addStars(d: GameState, p: PlayerState, stars: number, why: string): void {
  if (!alignmentOn(d) || stars <= 0) return;
  const was = p.tracks.heat;
  p.tracks.heat = Math.min(d.config.heat.max, p.tracks.heat + stars);
  if (p.tracks.heat !== was) d.log.push(`${p.name}'s heat rises to ${p.tracks.heat}★ (${why})`);
}

// A crime lands by your band: an outlaw is expected to cheat, a paragon is not.
export function commitCrimes(d: GameState, p: PlayerState, crimes: number, why: string): void {
  if (!alignmentOn(d) || crimes <= 0) return;
  addStars(d, p, crimes * bandOf(d, p).starsPerCrime, why);
}

export function coolStars(d: GameState, p: PlayerState, stars: number, why: string): void {
  if (!alignmentOn(d) || stars <= 0 || p.tracks.heat <= 0) return;
  p.tracks.heat = Math.max(0, p.tracks.heat - stars);
  d.log.push(`${p.name}'s heat cools to ${p.tracks.heat}★ (${why})`);
}

// ---- where you may go ----

// A ground's health as whole percent of its starting bag (a stepped board read).
export const groundHealthPct = (d: GameState, g: Ground): number =>
  Math.floor((d.bags[g].length * 100) / Math.max(1, d.bagStart[g]));

// Is this ground closed to this captain's band? Closed water is still fishable —
// it just costs stars per pot hauled there.
export function groundClosedTo(d: GameState, g: Ground, p: PlayerState): boolean {
  if (!alignmentOn(d)) return false;
  const pct = groundHealthPct(d, g);
  const band = bandOf(d, p).name;
  // rows run high → low by severity; any row whose line the ground is under that names you
  return d.config.closure.levels.some((l) => pct < l.belowPct && l.closedTo.includes(band));
}

// Is this dock shut to this captain today? Either they ran from it after a failed
// heat check, or it is an outer shelter and their band has lost refuge.
export function portClosedTo(d: GameState, p: PlayerState, node: string): boolean {
  if (!alignmentOn(d)) return false;
  if (p.barredPorts?.includes(node)) return true;
  const port = d.config.map.nodes[node]?.port;
  return !!port?.shelter && !bandOf(d, p).refuge;
}

// ---- the licence squeeze ----

// How many licences are on sale this season (Infinity = one for everyone).
export function licencesOnSale(d: GameState): number {
  if (!alignmentOn(d) || d.season !== d.config.alignment.squeezeSeason) return Infinity;
  const n = Object.keys(d.players).length;
  const slots = d.config.alignment.darkSlotsByPlayers;
  return n - (slots[Math.min(n, slots.length - 1)] ?? 0);
}

// ---- the warden's check at the counter ----

// How many dice this captain may buy off a check at their heat: down to their band's
// floor and no further (and never below one die).
export function bribeableDice(d: GameState, p: PlayerState): number {
  return Math.max(0, p.tracks.heat - Math.max(1, bandOf(d, p).bribeFloor));
}

// What this captain would pay to buy `dice` dice off a check, read off their band's row.
export function bribeCost(d: GameState, p: PlayerState, dice: number): number {
  const buy = Math.max(0, Math.min(dice, bribeableDice(d, p)));
  const row = bandOf(d, p).bribeCosts;
  let cost = 0;
  for (let i = 0; i < buy; i++) cost += row[Math.min(i, row.length - 1)];
  return cost;
}

export interface HeatCheck { rolled: boolean; dice: number; total: number; failed: boolean; take: number; nerves: boolean }

// Roll the check. Mutates only heat (nerves of steel), the bribe payment and the
// alignment step for bribing; the caller settles the sale. No stars, no roll.
export function heatCheck(d: GameState, p: PlayerState, bribeDice = 0, logPrefix = `${p.name}'s heat check`): HeatCheck {
  const none: HeatCheck = { rolled: false, dice: 0, total: 0, failed: false, take: 0, nerves: false };
  if (!alignmentOn(d) || p.tracks.heat <= 0) return none;
  const h = d.config.heat;
  // Buy dice off, down to the band's floor, as far as the money goes.
  let buy = Math.max(0, Math.min(bribeDice, bribeableDice(d, p)));
  while (buy > 0 && bribeCost(d, p, buy) > p.money) buy--;
  if (buy > 0) {
    const cost = bribeCost(d, p, buy);
    p.money -= cost;
    d.log.push(`${p.name} pays the warden ${cost} to look away (${buy} fewer heat ${buy === 1 ? 'die' : 'dice'})`);
    stepAlignment(d, p, d.config.alignment.step.bribe, 'bribed the warden');
  }
  const dice = p.tracks.heat - buy;
  const rolls: number[] = [];
  for (let i = 0; i < dice; i++) rolls.push(h.dieFaces[randInt(d, h.dieFaces.length)]);
  const total = rolls.reduce((a, b) => a + b, 0);
  const failed = total >= h.failAt;
  const nerves = !failed && rolls.every((r) => r === 0);
  d.log.push(`${logPrefix}: ${dice} ${dice === 1 ? 'die' : 'dice'} [${rolls.join(',')}] = ${total}${failed ? ' — BUSTED' : ''}`);
  return { rolled: true, dice, total, failed, take: failed ? 0 : total * h.takePerPoint, nerves };
}

// ---- the co-op dividend ----

// At each season end, licensed members Neutral or lighter share a dividend read off
// the ocean's health. The light side's steady income depends on keeping it alive.
export function payDividend(d: GameState): void {
  if (!alignmentOn(d)) return;
  const pct = Math.floor(avgBagHealth(d) * 100);
  const row = d.config.dividend.byHealth.find((r) => pct >= r.atLeast);
  if (!row || (row.money <= 0 && row.paragon <= 0)) { d.log.push(`The co-op pays no dividend — the ocean is at ${pct}%`); return; }
  // Two columns on the printed table: members, and PARAGONS, who are paid more.
  const paid: string[] = [];
  for (const p of Object.values(d.players)) {
    if (p.licensed === false || !bandOf(d, p).dividend) continue;
    const money = bandOf(d, p).name === 'paragon' ? row.paragon : row.money;
    if (money <= 0) continue;
    p.money += money;
    paid.push(`${p.name} ${money}`);
  }
  d.log.push(`The co-op pays its dividend (ocean ${pct}%: ${row.money}, paragons ${row.paragon}) to ${paid.length ? paid.join(', ') : 'nobody'}`);
}

import type { GameState, Ground } from '../types';
import { randInt } from '../rng';
import { tileTemplate, isEgger } from '../tiles';

// Weighted pick of a tile-template name from a ground's ORIGINAL mix (proportions
// only — the config counts are unscaled, but recruits arrive in the natural ratio).
function sampleTemplate(d: GameState, g: Ground): string {
  const entries = Object.entries(d.config.bags[g]);
  const total = entries.reduce((s, [, c]) => s + c, 0);
  let r = randInt(d, total);
  for (const [name, count] of entries) {
    r -= count;
    if (r < 0) return name;
  }
  return entries[entries.length - 1][0];
}

// Inter-season recruitment: fresh tiles breed back into each ground. The dice
// pool is `round(baseDice*playerScale)` PLUS one die per `eggerPerDie` v-notched
// eggers sitting in the bag — so the breeding stock you left literally IS the
// recovery. No cap: the bag grows; keeper DENSITY (not tile count) is the signal.
export function restock(d: GameState): void {
  const cfg = d.config;
  const scale = cfg.players / cfg.referencePlayers;
  const grounds = Object.keys(d.bags) as Ground[];
  for (const g of grounds) {
    const eggers = d.bags[g].filter(isEgger).length;
    const dice = Math.round(cfg.restock.baseDice[g] * scale) + Math.floor(eggers / cfg.restock.eggerPerDie);
    let recruits = 0;
    for (let i = 0; i < dice; i++) recruits += randInt(d, cfg.restock.diceSides) + 1;
    for (let i = 0; i < recruits; i++) {
      d.bags[g].push({ id: `${g}-r${d.recruitedTotal + i}`, ...tileTemplate(sampleTemplate(d, g)) });
    }
    d.recruitedTotal += recruits;
    d.log.push(`Recruitment: ${g} +${recruits} (${dice} dice, ${eggers} eggers bred)`);
  }
}

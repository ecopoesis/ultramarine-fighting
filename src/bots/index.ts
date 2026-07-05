import type { Policy } from './helpers';
import { makeCardCounter, CARD_COUNTER, ROSTER } from './cardcounter';

export type { Policy } from './helpers';
// Legacy lane-based archetypes (superseded by the card-counter-core roster) —
// still exported for the old tuning scripts (tuneInitiative, tuneRep).
export { makePolicy, STEWARD, GREEDY, THIEF, HIGHLINER } from './archetypes';
export {
  makeCardCounter, CARD_COUNTER, ROSTER,
  CC_STEWARD, CC_GREEDY, CC_HIGHLINER, CC_GRINDER, CC_GAMBLER, CC_HUSTLER, CC_MONK, CC_NOMAD, CC_GUZZLER,
} from './cardcounter';
export type { Archetype } from './archetypes';
export type { CardCounter } from './cardcounter';

// Named captains for the arena. Deterministic — no Math.random — so any
// (seed, seating, config) reproduces exactly one game. Every archetype is the
// card-counter optimizer plus a personality twist (all migrate, all can steal a
// target of opportunity); `cardcounter` is the neutral clean baseline.
export const BOTS: Record<string, Policy> = { cardcounter: makeCardCounter(CARD_COUNTER) };
for (const a of ROSTER) BOTS[a.name] = makeCardCounter(a);

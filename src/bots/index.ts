import type { Policy } from './helpers';
import { makeCardCounter, CARD_COUNTER, CC_STEWARD, CC_GREEDY, CC_THIEF, CC_HIGHLINER } from './cardcounter';

export type { Policy } from './helpers';
// Legacy lane-based archetypes (superseded by the card-counter-core versions
// below) — still exported for the old tuning scripts (tuneInitiative, tuneRep).
export { makePolicy, STEWARD, GREEDY, THIEF, HIGHLINER } from './archetypes';
export { makeCardCounter, CARD_COUNTER, CC_STEWARD, CC_GREEDY, CC_THIEF, CC_HIGHLINER } from './cardcounter';
export type { Archetype } from './archetypes';
export type { CardCounter } from './cardcounter';

// Named captains for the arena. Deterministic — no Math.random — so any
// (seed, seating, config) reproduces exactly one game. Every archetype is the
// card-counter optimizer plus a personality twist, so they all migrate and
// contest the whole map; `cardcounter` is the neutral strong baseline.
export const BOTS: Record<string, Policy> = {
  steward: makeCardCounter(CC_STEWARD),
  greedy: makeCardCounter(CC_GREEDY),
  thief: makeCardCounter(CC_THIEF),
  highliner: makeCardCounter(CC_HIGHLINER),
  cardcounter: makeCardCounter(CARD_COUNTER),
};

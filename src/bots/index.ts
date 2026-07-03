import type { Policy } from './helpers';
import { makePolicy, STEWARD, GREEDY, THIEF, HIGHLINER } from './archetypes';
import { makeCardCounter, CARD_COUNTER } from './cardcounter';

export type { Policy } from './helpers';
export { makePolicy, STEWARD, GREEDY, THIEF, HIGHLINER } from './archetypes';
export { makeCardCounter, CARD_COUNTER } from './cardcounter';
export type { Archetype } from './archetypes';
export type { CardCounter } from './cardcounter';

// Named captains for the arena. Deterministic — no Math.random — so any
// (seed, seating, config) reproduces exactly one game. `cardcounter` is the
// public-info optimizer: the strong baseline the archetypes are measured against.
export const BOTS: Record<string, Policy> = {
  steward: makePolicy(STEWARD),
  greedy: makePolicy(GREEDY),
  thief: makePolicy(THIEF),
  highliner: makePolicy(HIGHLINER),
  cardcounter: makeCardCounter(CARD_COUNTER),
};

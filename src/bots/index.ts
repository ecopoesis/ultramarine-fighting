import type { Policy } from './helpers';
import { makePolicy, STEWARD, GREEDY, THIEF } from './archetypes';

export type { Policy } from './helpers';
export { makePolicy, STEWARD, GREEDY, THIEF } from './archetypes';
export type { Archetype } from './archetypes';

// Named archetype captains for the arena. Deterministic — no Math.random —
// so any (seed, seating, config) reproduces exactly one game.
export const BOTS: Record<string, Policy> = {
  steward: makePolicy(STEWARD),
  greedy: makePolicy(GREEDY),
  thief: makePolicy(THIEF),
};

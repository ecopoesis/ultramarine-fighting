import { defaultConfig } from '../src/config';
import { makeCardCounter, CARD_COUNTER } from '../src/bots';
import type { CardCounter } from '../src/bots';
import { report, type Named } from './tuneArchetypes';
import type { Config } from '../src/types';

const SEEDS = Number(process.argv[2] ?? 40);
const cc = (o: Partial<CardCounter> & { name: string }): Named => ({ name: o.name, policy: makeCardCounter({ ...CARD_COUNTER, ...o }) });

// Greedy is now a SELECTIVE high-grader (keeps jumbos, not worthless shorts/eggers).
const FLEET = (greedyPol: 'greedy' | 'highgrade', gFloor: number, tFloor: number): Named[] => [
  cc({ name: 'steward' }),
  cc({ name: 'greedy', haulPolicy: greedyPol, repFloor: gFloor, minKeep: 1 }),
  cc({ name: 'thief', steals: true, stealPolicy: 'highgrade', repFloor: tFloor, minKeep: 1 }),
  cc({ name: 'highliner', farBias: 1.3 }),
];

report('greedy=dumb (keep-all), floors 5/6', defaultConfig, SEEDS, FLEET('greedy', 5, 6));
report('greedy=highgrade (jumbos only), floors 5/6', defaultConfig, SEEDS, FLEET('highgrade', 5, 6));
report('greedy=highgrade, floors 3/4', defaultConfig, SEEDS, FLEET('highgrade', 3, 4));
report('greedy=highgrade, floors 1/2', defaultConfig, SEEDS, FLEET('highgrade', 1, 2));

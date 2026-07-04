// Thin adapter over the pure engine so the UI has one import surface.
export { defaultConfig } from '../src/config';
export { createInitialState } from '../src/state';
export { reduce } from '../src/reducer';
export { legalActions } from '../src/actions';
export { activePlayerId, daysThisSeason } from '../src/selectors';
export { score, avgBagHealth } from '../src/engine/scoring';
export { BOTS, ROSTER } from '../src/bots';
export { neighbors } from '../src/engine/movement';
export { isPort, isMarketPort } from '../src/engine/ports';
export { stageFor } from '../src/engine/soak';
export type { GameState, PlayerState, Tile, Ground, Config } from '../src/types';
export type { Action } from '../src/actions';

import { ROSTER } from '../src/bots';
// Bot identities a seat can be assigned (the archetype roster + the neutral baseline).
export const BOT_NAMES: string[] = ['cardcounter', ...ROSTER.map((a) => a.name)];

// A distinct color per seat (p1..p6).
export const SEAT_COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#008080'];

import type { Tile, TileKind, Color, Ground } from './types';

// Maps a config tile-template name to a tile blueprint (everything but id + ground).
// Add new templates here; config references them by name.
export function tileTemplate(name: string): Omit<Tile, 'id' | 'ground'> {
  switch (name) {
    case 'KEEPER_1lb': return { kind: 'KEEPER', weightLb: 1, color: 'common' };
    case 'KEEPER_2lb': return { kind: 'KEEPER', weightLb: 2, color: 'common' };
    case 'KEEPER_3lb': return { kind: 'KEEPER', weightLb: 3, color: 'common' };
    case 'RARE_2lb': return { kind: 'KEEPER', weightLb: 2, color: 'rare' };
    case 'RARE_3lb': return { kind: 'KEEPER', weightLb: 3, color: 'rare' };
    case 'KEEPER_4lb': return { kind: 'KEEPER', weightLb: 4, color: 'common' }; // the deep edge
    case 'RARE_4lb': return { kind: 'KEEPER', weightLb: 4, color: 'rare' };
    case 'SHORT': return { kind: 'SHORT', weightLb: 0, color: 'common' };   // undersized: illegal
    case 'JUMBO': return { kind: 'JUMBO', weightLb: 5, color: 'common' };   // oversized: illegal but heavy
    case 'EGGER': return { kind: 'EGGER', weightLb: 0, color: 'common' };   // berried female: v-notch
    default: throw new Error(`Unknown tile template: ${name}`);
  }
}

// IDs are derived from the ground so they're deterministic per game (no persistent
// module state leaking across createInitialState calls). Every tile carries its
// home `ground` (the bag marker) so a sold tile routes back to the right pile.
export function buildBag(spec: Record<string, number>, ground: Ground): Tile[] {
  const bag: Tile[] = [];
  let i = 0;
  for (const [name, count] of Object.entries(spec)) {
    const blueprint = tileTemplate(name);
    for (let c = 0; c < count; c++) {
      bag.push({ id: `${ground}-${i++}`, ground, ...blueprint });
    }
  }
  return bag;
}

export const isKeeper = (t: Tile) => t.kind === 'KEEPER';
export const isIllegal = (t: Tile) => t.kind === 'SHORT' || t.kind === 'JUMBO';
export const isEgger = (t: Tile) => t.kind === 'EGGER';

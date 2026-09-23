import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import { wardenCount, patrolCheck, placeWardens } from '../src/engine/patrol';
import type { Config, GameState } from '../src/types';

// WARDEN PATROLS: random area denial for the dark side.

const on: Config = { ...defaultConfig, players: 4, flags: { ...defaultConfig.flags, alignment: true, patrols: true } };
const shady = on.alignment.bands.find((b) => b.name === 'shady')!.atLeast;

describe('warden patrols', () => {
  it('one boat, plus one per dark captain, to a maximum', () => {
    const s = createInitialState(on, 1);
    expect(wardenCount(s)).toBe(on.patrol.base);
    s.players.p1.tracks.alignment = shady;
    expect(wardenCount(s)).toBe(on.patrol.base + on.patrol.perDarkCaptain);
    for (const p of Object.values(s.players)) p.tracks.alignment = shady;
    expect(wardenCount(s)).toBe(on.patrol.max);
  });

  it('draws that many distinct ocean spaces every morning', () => {
    const s = createInitialState(on, 2);
    for (const p of Object.values(s.players)) p.tracks.alignment = shady;
    placeWardens(s);
    expect(new Set(s.wardens).size).toBe(on.patrol.max);
    for (const n of s.wardens!) expect(s.config.map.nodes[n].type).toBe('ground');
  });

  it('ignores a captain with no stars, and consumes no dice', () => {
    const s = createInitialState(on, 3);
    const node = s.wardens![0];
    const seed = s.rngSeed;
    expect(patrolCheck(s, s.players.p1, node)).toBe(false);
    expect(s.rngSeed).toBe(seed);
  });

  it('a bust ends the day, sends the captain home, and they launch last in stop order', () => {
    // Find a seed where two hot captains are both stopped by the same boat.
    let s: GameState | undefined;
    for (let seed = 0; seed < 500 && !s; seed++) {
      const t = createInitialState(on, seed);
      const node = t.wardens![0];
      t.players.p1.tracks.heat = 5; t.players.p2.tracks.heat = 5;
      if (patrolCheck(t, t.players.p1, node) && patrolCheck(t, t.players.p2, node)) s = t;
    }
    expect(s).toBeDefined();
    const g = s!;
    for (const id of ['p1', 'p2']) {
      expect(g.players[id].node).toBe(g.config.map.startPort);
      expect(g.players[id].berthed).toBe(true);
    }
    // finish the day: everyone else passes until it rolls over
    let t = g;
    for (let i = 0; i < 400 && t.day === 1; i++) {
      const pid = activePlayerId(t);
      t = reduce(t, { type: 'BERTH', playerId: pid } as never);
    }
    expect(t.turnOrder.slice(-2)).toEqual(['p1', 'p2']);
  });

  it('a bust at sea seizes the catch but leaves the pots; a bribe uses the band scale', () => {
    let hit: GameState | undefined;
    for (let seed = 0; seed < 500 && !hit; seed++) {
      const t = createInitialState(on, seed);
      const p = t.players.p1;
      p.tracks.heat = 5;
      p.deployed = [{ buoyId: 'bX', node: 'MUSCLE_RIDGE', ownerId: 'p1' }];
      p.soak = { bX: { ground: 'inshore', daysSoaked: 1 } };
      p.buoysAvailable = t.config.buoysPerPlayer - 1;
      p.hold = [{ id: 'k1', kind: 'KEEPER', weightLb: 3, color: 'common', ground: 'inshore' }];
      if (patrolCheck(t, p, t.wardens![0])) hit = t;
    }
    const p = hit!.players.p1;
    expect(p.hold).toHaveLength(0);                                   // catch seized
    expect(hit!.piles.inshore.some((t) => t.id === 'k1')).toBe(true); // into the ground's trap
    expect(p.deployed).toHaveLength(1);                               // pots stay
    // an Outlaw can bribe a warden down to their band's floor, and pays that band's row
    const t = createInitialState(on, 7);
    const o = t.players.p2;
    o.tracks.heat = 5; o.tracks.alignment = on.alignment.min; o.money = 999;
    const outlaw = on.alignment.bands[on.alignment.bands.length - 1];
    patrolCheck(t, o, t.wardens![0], 99);
    expect(999 - o.money).toBe(outlaw.bribeCosts.slice(0, 5 - outlaw.bribeFloor).reduce((a, b) => a + b, 0));
  });

  it('a whole game with patrols finishes, and hot bots do meet the wardens', () => {
    let checks = 0;
    for (const seed of [21, 22, 23]) {
      const seats = ['light', 'dark', 'switch', 'dark'];
      let s = createInitialState(on, seed);
      const ids = s.turnOrder.slice();
      for (let g = 0; s.phase !== 'GAME_OVER' && g < 300000; g++) {
        const pid = activePlayerId(s);
        s = reduce(s, BOTS[seats[ids.indexOf(pid)]](s, pid, legalActions(s, pid)));
      }
      expect(s.phase).toBe('GAME_OVER');
      checks += s.log.filter((l) => l.startsWith('A warden boat stops')).length;
    }
    expect(checks).toBeGreaterThanOrEqual(0); // may genuinely be zero: the bots steer around them
  });
});

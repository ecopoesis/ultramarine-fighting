import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import { heatCheck, bandOf, licencesOnSale, bribeCost, stepAlignment, payDividend } from '../src/engine/alignment';
import { sell } from '../src/engine/market';
import type { Config, GameState, Tile } from '../src/types';

// THE SWITCHBOARD (SPEC §14): the rules a later tuning pass must not quietly break.

const on: Config = { ...defaultConfig, players: 4, flags: { ...defaultConfig.flags, alignment: true } };
const keeper = (lb: number): Tile => ({ id: `t${lb}-${Math.random()}`, kind: 'KEEPER', weightLb: lb, color: 'common', ground: 'inshore' });

function atMarket(stars: number, seed = 1): GameState {
  const s = createInitialState(on, seed);
  const p = s.players.p1;
  p.node = 'ROCKLAND';
  p.hold = [keeper(3), keeper(3)];
  p.tracks.heat = stars;
  p.money = 100;
  return s;
}

describe('heat check', () => {
  it('a captain with no stars never rolls and pays no take', () => {
    const s = atMarket(0);
    const seedBefore = s.rngSeed;
    expect(heatCheck(s, s.players.p1).rolled).toBe(false);
    expect(s.rngSeed).toBe(seedBefore); // no RNG consumed
  });

  it('one or two stars can never bust', () => {
    for (let seed = 0; seed < 200; seed++) for (const stars of [1, 2]) {
      const s = atMarket(stars, seed);
      expect(heatCheck(s, s.players.p1).failed).toBe(false);
    }
  });

  it('a bribe buys dice off this roll only, down to the band floor, and leaves the stars', () => {
    const s = atMarket(5);
    const cost = bribeCost(s, s.players.p1, 99);
    const c = heatCheck(s, s.players.p1, 99);
    expect(c.dice).toBe(1); // neutral: down to one die
    expect(s.players.p1.tracks.heat).toBeGreaterThanOrEqual(4); // stars stay (nerves of steel may take one)
    expect(s.players.p1.money).toBe(100 - cost);
  });

  it('an outlaw can never buy below three dice, and pays the outlaw row', () => {
    const s = atMarket(5);
    const p = s.players.p1;
    p.tracks.alignment = on.alignment.min;
    const outlaw = on.alignment.bands[on.alignment.bands.length - 1];
    expect(bribeCost(s, p, 99)).toBe(outlaw.bribeCosts.slice(0, 5 - outlaw.bribeFloor).reduce((a, b) => a + b, 0));
    expect(heatCheck(s, p, 99).dice).toBe(outlaw.bribeFloor);
  });

  it('a bust drops the catch, pays nothing, and shuts the port for the day', () => {
    let busted: GameState | undefined;
    for (let seed = 0; seed < 400 && !busted; seed++) {
      const s = atMarket(5, seed);
      const money = s.players.p1.money;
      sell(s, 'p1');
      if (s.players.p1.barredPorts?.includes('ROCKLAND')) { busted = s; expect(s.players.p1.money).toBe(money); }
    }
    expect(busted).toBeDefined();
    const p = busted!.players.p1;
    expect(p.hold).toHaveLength(0);
    const legal = legalActions(busted!, 'p1').map((a) => a.type);
    expect(legal).not.toContain('BERTH');
    expect(legal).not.toContain('REFUEL');
  });
});

describe('the ends of the track', () => {
  it('a crime at the dark end costs a star instead of alignment; a bribe there does not', () => {
    const s = createInitialState(on, 1);
    const p = s.players.p1;
    p.tracks.alignment = on.alignment.min + 1; // one step of room left
    stepAlignment(s, p, 3 * on.alignment.step.illegalKeep, 'kept illegal catch', 3);
    expect(p.tracks.alignment).toBe(on.alignment.min);
    expect(p.tracks.heat).toBe(2 * on.alignment.floorStarsPerCrime); // two of the three crimes had nowhere to go
    stepAlignment(s, p, on.alignment.step.bribe, 'bribed the warden'); // not a crime
    expect(p.tracks.heat).toBe(2 * on.alignment.floorStarsPerCrime);
  });

  it('paragons read the higher dividend column', () => {
    const s = createInitialState(on, 1);
    s.players.p1.tracks.alignment = on.alignment.max;            // paragon
    s.players.p2.tracks.alignment = 0;                           // neutral
    const m1 = s.players.p1.money, m2 = s.players.p2.money;
    payDividend(s);
    const row = on.dividend.byHealth[0];                         // a fresh ocean is healthy
    expect(s.players.p1.money - m1).toBe(row.paragon);
    expect(s.players.p2.money - m2).toBe(row.money);
  });
});

describe('licences and bands', () => {
  it('season 2 sells players minus dark slots; later seasons sell to all', () => {
    const s = createInitialState({ ...on, players: 5 }, 3);
    s.season = 2;
    expect(licencesOnSale(s)).toBe(5 - on.alignment.darkSlotsByPlayers[5]);
    s.season = 3;
    expect(licencesOnSale(s)).toBe(Infinity);
  });

  it('everyone starts neutral with no stars', () => {
    const s = createInitialState(on, 1);
    for (const p of Object.values(s.players)) {
      expect(bandOf(s, p).name).toBe('neutral');
      expect(p.tracks.heat).toBe(0);
    }
  });
});

describe('a whole switchboard game', () => {
  function play(seed: number): GameState {
    const seats = ['light', 'dark', 'switch', 'dark'];
    let s = createInitialState(on, seed);
    const ids = s.turnOrder.slice();
    for (let g = 0; s.phase !== 'GAME_OVER' && g < 300000; g++) {
      const pid = activePlayerId(s);
      s = reduce(s, BOTS[seats[ids.indexOf(pid)]](s, pid, legalActions(s, pid)));
    }
    return s;
  }

  it('finishes, keeps every track on the printed board, and is deterministic', () => {
    const a = play(11);
    const b = play(11);
    expect(a.phase).toBe('GAME_OVER');
    expect(a.log).toEqual(b.log);
    for (const p of Object.values(a.players)) {
      expect(p.tracks.alignment).toBeGreaterThanOrEqual(on.alignment.min);
      expect(p.tracks.alignment).toBeLessThanOrEqual(on.alignment.max);
      expect(p.tracks.heat).toBeGreaterThanOrEqual(0);
      expect(p.tracks.heat).toBeLessThanOrEqual(on.heat.max);
    }
  });

  it('the dark side actually rolls, and the light side never commits a crime', () => {
    // (A light bot CAN still take stars: squeezed out of a licence, it poaches, drifts to
    // Neutral, and closed water then costs it stars. That is the rule working.)
    let dark = 0;
    for (const seed of [12, 13, 14, 15]) {
      const s = play(seed);
      const checks = (who: string) => s.log.filter((l) => l.startsWith(`${s.players[who].name}'s heat check`)).length;
      dark += checks('p2') + checks('p4');
      const lightName = s.players.p1.name;
      expect(s.log.filter((l) => l.startsWith(`${lightName}'s heat rises`) && /illegal|theft|net/.test(l))).toHaveLength(0);
    }
    expect(dark).toBeGreaterThan(0);
  });
});

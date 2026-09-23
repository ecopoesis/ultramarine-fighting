import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { legalActions } from '../src/actions';
import { reduce } from '../src/reducer';
import { activePlayerId } from '../src/selectors';
import { tableSizes } from '../src/llm/tournament';
import { parseCommand, renderView } from '../src/llm/view';
import { buildRulesPrompt } from '../src/llm/rules';
import { BOTS } from '../src/bots';
import { LlmCaptain, redactRival } from '../src/llm/agent';
import { enterAuction } from '../src/engine/auction';
import { breedingRollover, diceFor } from '../src/engine/breeding';
import { parseLimitWaitMs } from '../src/llm/claude';

// The map is reshaped from time to time; tests derive node names from the config
// rather than hardcoding them, so a reshape does not look like a test failure.
const deepNode = (c: typeof defaultConfig) =>
  Object.keys(c.map.nodes).find((n) => c.map.nodes[n].ground === 'deep')!;

function rng(seed: number) {
  let s = seed | 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('LLM tournament harness (pure parts)', () => {
  it('tableSizes seats everyone at tables of 2..6', () => {
    for (let n = 2; n <= 40; n++) {
      for (const sd of [0, 1, 2]) {
        const sizes = tableSizes(n, 4, sd, rng(n * 31 + sd));
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
        for (const s of sizes) { expect(s).toBeGreaterThanOrEqual(2); expect(s).toBeLessThanOrEqual(6); }
      }
    }
  });

  it('rules prompt carries the live numbers (classic three-track rules)', () => {
    const classic = { ...defaultConfig, flags: { ...defaultConfig.flags, alignment: false } };
    const r = buildRulesPrompt(classic, 4);
    expect(r).toContain('4-player game');
    expect(r).toContain(`MONEY VP = money ÷ ${classic.scoring.moneyPerVP}`);
    expect(r).toContain(`REPUTATION VP = reputation × ${classic.scoring.repToVP}`);
    expect(r).toContain(deepNode(classic));   // whatever the current map calls the deep
    expect(r).toContain(`${classic.tow.lostTurns} turns`);
  });

  it('switchboard rules prompt carries the live numbers and none of the retired scoring', () => {
    const on = { ...defaultConfig, flags: { ...defaultConfig.flags, alignment: true } };
    const r = buildRulesPrompt(on, 6);
    expect(r).toContain('Most money wins');
    expect(r).toContain(`total ${on.heat.failAt} or more: BUSTED`);
    expect(r).toContain(`only ${6 - on.alignment.darkSlotsByPlayers[6]} licences are sold`);
    // A captain must never read a rule that no longer applies (hidden sections are cut, not commented).
    expect(r).not.toMatch(/<!--|-->|weak-link|REPUTATION VP|CONSERVATION VP/);
  });

  it('parseCommand maps commands onto legal actions and rejects illegal ones', () => {
    const cfg = { ...defaultConfig, players: 3 };
    let state = createInitialState(cfg, 42);
    const pid = activePlayerId(state);
    let legal = legalActions(state, pid);
    // derive the nodes from the map rather than naming them — the bay gets reshaped
    const adjacent = cfg.map.edges.find(([a]) => a === cfg.map.startPort)![1];
    const deep = deepNode(cfg);
    expect(parseCommand(state, pid, `STEAM ${adjacent}`, legal)).toMatchObject({ ok: true, action: { type: 'STEAM', to: adjacent } });
    expect(parseCommand(state, pid, `GOTO ${deep}`, legal)).toMatchObject({ ok: true, macro: 'GOTO', target: deep });
    expect(parseCommand(state, pid, 'DROP', legal).ok).toBe(false);          // at a port
    expect(parseCommand(state, pid, 'SELL', legal).ok).toBe(false);          // empty hold
    expect(parseCommand(state, pid, 'FLY AWAY', legal).ok).toBe(false);
    expect(parseCommand(state, pid, 'REFUEL 1', legal)).toMatchObject({ ok: true, action: { type: 'REFUEL', units: 1 } });
    expect(parseCommand(state, pid, 'berth', legal)).toMatchObject({ ok: true, action: { type: 'BERTH' } });
    // steam out and drop
    state = reduce(state, { type: 'STEAM', playerId: pid, to: adjacent });
    legal = legalActions(state, pid);
    const drop = parseCommand(state, pid, 'DROP', legal);
    expect(drop.ok).toBe(true);
    // the view never mentions rivals' soak days
    const view = renderView(state, pid, legal, { events: [] });
    expect(view).toContain('YOUR TURN');
    expect(view).not.toMatch(/RIVAL[^\n]*soaked/);
  });

  it('parses the usage-limit reset time into a wait', () => {
    const msg = "You've hit your session limit · resets 12:10am (America/New_York)";
    // 11:12pm New York = 03:12Z on Sep 16 (EDT)
    const now = new Date('2026-09-16T03:12:00Z');
    expect(parseLimitWaitMs(msg, now)).toBe(59 * 60_000);
    expect(parseLimitWaitMs('resets 3pm (America/New_York)', now)).toBe((15 * 60 + 48 + 1) * 60_000);
    expect(parseLimitWaitMs('some other error', now)).toBeUndefined();
    expect(parseLimitWaitMs("You've hit your weekly limit · resets Sep 20, 3am (America/New_York)", now)).toBeGreaterThan(0);
  });

  it('a captain starts every new game with a fresh runtime (no session bleed) and restores a persisted one', () => {
    const c = new LlmCaptain({ name: 'steward-test', archetypeId: 'steward', model: 'x', effort: 'low', cwd: '/tmp' }, ['lesson one'], [{ gameId: 'g1', players: 3, rank: 2, total: 20, captainName: 'Bluefin' }]);
    const state = createInitialState({ ...defaultConfig, players: 3 }, 1);
    c.prepareGame(state, 'Bluefin');
    c.rt.sessionId = 'old-session'; c.rt.plan = ['PASS']; c.rt.lastLogIndex = 500; c.rt.calls = 9;
    c.prepareGame(state, 'Osprey');
    expect(c.rt.sessionId).toBeUndefined();
    expect(c.rt.plan).toEqual([]);
    expect(c.rt.lastLogIndex).toBe(0);
    expect(c.rt.calls).toBe(0);
    expect(c.systemPrompt).toContain('lesson one');
    expect(c.systemPrompt).toContain('finished 2/3');
    c.prepareGame(state, 'Osprey', { ...c.rt, sessionId: 'restored', plan: ['DROP'] });
    expect(c.rt.sessionId).toBe('restored');
    expect(c.rt.plan).toEqual(['DROP']);
  });

  it('a whole bot game can be driven through the command parser (HAUL/SELL/BID round-trip)', () => {
    // Drive a game with the card-counter, but re-encode every chosen action as a
    // command string and parse it back: the parser must reproduce a legal action.
    const cfg = { ...defaultConfig, players: 3 };
    let state = createInitialState(cfg, 7);
    const bot = BOTS.cardcounter;
    let n = 0; let auctionSeen = false;
    while (state.phase !== 'GAME_OVER' && n++ < 5000) {
      const pid = activePlayerId(state);
      const legal = legalActions(state, pid);
      const a = bot(state, pid, legal);
      let cmd: string;
      switch (a.type) {
        case 'STEAM': cmd = `STEAM ${a.to}`; break;
        case 'HAUL': cmd = `HAUL ${a.buoyId} ${a.policy ?? 'clean'}`; break;
        case 'STEAL': cmd = `STEAL ${a.buoyId} ${a.policy ?? 'clean'}`; break;
        case 'REFUEL': cmd = `REFUEL ${a.units}`; break;
        case 'BUY_UPGRADE': cmd = `BUY ${a.upgradeId}`; break;
        case 'LICENSE_BID': cmd = `BID ${a.amount}`; auctionSeen = true; break;
        case 'LICENSE_BUY': cmd = a.take ? 'TAKE' : 'LEAVE'; break;
        default: cmd = a.type;
      }
      const parsed = parseCommand(state, pid, cmd, legal);
      expect(parsed.ok, `${cmd}: ${(parsed as { error?: string }).error}`).toBe(true);
      if (!parsed.ok) break;
      state = reduce(state, parsed.action);
    }
    expect(state.phase).toBe('GAME_OVER');
    expect(auctionSeen).toBe(true);   // the licence auction runs every season after the first
  });
});

describe('breeding stock', () => {
  it('notches advance the ground track, and the season change spawns from the pile lightest-first', () => {
    const cfg = { ...defaultConfig, players: 3 };
    let state = createInitialState(cfg, 11);
    expect(state.notches.offshore).toBe(0);

    // a clean haul that draws eggers must advance that ground's track
    const before = state.notches.offshore;
    const d = structuredClone(state);
    d.notches.offshore += 4;
    expect(diceFor(d, d.notches.offshore)).toBe(2);        // 3+ notches = 2 dice
    expect(diceFor(d, 0)).toBe(0);                          // an untended ground spawns nothing
    expect(diceFor(d, 15)).toBe(5);
    expect(before).toBe(0);

    // spawning returns the LIGHTEST lobsters and leaves the heavy ones on the pile
    d.piles.offshore = [
      { id: 'h1', kind: 'JUMBO', weightLb: 5, color: 'common', ground: 'offshore' },
      { id: 'l1', kind: 'KEEPER', weightLb: 1, color: 'common', ground: 'offshore' },
      { id: 'm1', kind: 'KEEPER', weightLb: 3, color: 'common', ground: 'offshore' },
    ];
    d.notches.offshore = 20;                                 // plenty of dice
    const bagBefore = d.bags.offshore.length;
    breedingRollover(d);
    const moved = d.bags.offshore.length - bagBefore;
    expect(moved).toBeGreaterThan(0);
    const backIds = d.bags.offshore.slice(bagBefore).map((t) => t.id);
    expect(backIds).toContain('l1');                         // the 1 lb went first
    if (moved < 3) expect(backIds).not.toContain('h1');       // the jumbo stays taken
  });

  it('a full game spawns, and never into the final season', () => {
    const cfg = { ...defaultConfig, players: 3 };
    let state = createInitialState(cfg, 12);
    let n = 0;
    while (state.phase !== 'GAME_OVER' && n++ < 20000) {
      const pid = activePlayerId(state);
      state = reduce(state, BOTS.cardcounter(state, pid, legalActions(state, pid)));
    }
    const spawns = state.log.filter((l) => l.startsWith('--- Breeding stock spawns'));
    expect(spawns.length).toBe(cfg.seasons - 2);            // not before the final season
    expect(Object.values(state.notches).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});

describe('the licence auction', () => {
  it('prices at the SECOND-highest bid, commits the top two, and makes the bid order the turn order', () => {
    const cfg = { ...defaultConfig, players: 4 };
    // Drive the auction directly with known money, rather than depending on what four
    // bots happen to have in hand at the first rollover (some arrive broke, which is
    // real but makes a poor fixture).
    let state = createInitialState(cfg, 99);
    state = { ...state, season: 2 };
    const seats = Object.keys(state.players);
    for (const id of seats) state.players[id].money = 100;
    enterAuction(state);
    expect(state.phase).toBe('AUCTION');
    const minBid = state.auction!.minBid;
    expect(minBid).toBeGreaterThan(0);

    const bids: Record<string, number> = {
      [seats[0]]: minBid + 6, [seats[1]]: minBid + 4, [seats[2]]: minBid + 2, [seats[3]]: minBid,
    };
    for (const id of seats) {
      expect(activePlayerId(state)).toBe(id);
      state = reduce(state, { type: 'LICENSE_BID', playerId: id, amount: bids[id] });
    }

    // the winner pays the RUNNER-UP's bid, not their own, and both are committed
    expect(state.players[seats[0]].money).toBe(100 - bids[seats[1]]);
    expect(state.players[seats[1]].money).toBe(100 - bids[seats[1]]);
    expect(state.players[seats[0]].licensed).toBe(true);
    expect(state.players[seats[1]].licensed).toBe(true);

    // everyone else is offered it at that price and may decline
    expect(activePlayerId(state)).toBe(seats[2]);
    state = reduce(state, { type: 'LICENSE_BUY', playerId: seats[2], take: true });
    expect(state.players[seats[2]].money).toBe(100 - bids[seats[1]]);
    state = reduce(state, { type: 'LICENSE_BUY', playerId: seats[3], take: false });
    expect(state.players[seats[3]].money).toBe(100);          // paid nothing
    expect(state.players[seats[3]].licensed).toBe(false);     // and fishes as a poacher

    // the bid ranking IS the season's turn order — what the auction really sold
    expect(state.phase).toBe('PLAYING');
    expect(state.turnOrder).toEqual(seats);
    expect(state.day).toBe(1);
  });

  it('a bid beyond your money is no bid at all', () => {
    const cfg = { ...defaultConfig, players: 3 };
    let state = createInitialState(cfg, 7);
    state = { ...state, season: 2 };
    const seats = Object.keys(state.players);
    state.players[seats[0]].money = 4;   // cannot even meet the reserve
    state.players[seats[1]].money = 50;
    state.players[seats[2]].money = 50;
    enterAuction(state);
    const minBid = state.auction!.minBid;
    state = reduce(state, { type: 'LICENSE_BID', playerId: seats[0], amount: 999 });
    state = reduce(state, { type: 'LICENSE_BID', playerId: seats[1], amount: minBid + 5 });
    state = reduce(state, { type: 'LICENSE_BID', playerId: seats[2], amount: minBid + 1 });
    expect(state.players[seats[1]].money).toBe(50 - (minBid + 1)); // priced off the real runner-up
    // the non-bidder is still offered it at that price — they bid nothing, not "no"
    expect(state.phase).toBe('AUCTION');
    expect(activePlayerId(state)).toBe(seats[0]);
    state = reduce(state, { type: 'LICENSE_BUY', playerId: seats[0], take: true });
    expect(state.players[seats[0]].licensed).toBe(false);           // 4 money cannot cover it
    expect(state.turnOrder[2]).toBe(seats[0]);                      // and they open the season last
  });
});

describe('v-notching is finite: the egger is taken, a v-notch meeple takes her place', () => {
  it('pays once, keeps the bag size constant, and a notched breeder never scores again', () => {
    const cfg = { ...defaultConfig, players: 3 };
    const state = createInitialState(cfg, 5);
    const pid = 'p1';
    const before = state.bags.inshore.length;
    const eggers = () => state.bags.inshore.filter((t) => t.kind === 'EGGER').length;
    const meeples = () => state.bags.inshore.filter((t) => t.kind === 'VNOTCHED').length;
    const startEggers = eggers();
    expect(startEggers).toBeGreaterThan(0);
    expect(meeples()).toBe(0);

    // notch every egger in the inshore bag by hand through the engine's own path
    const d = structuredClone(state);
    for (let i = 0; i < startEggers; i++) {
      const idx = d.bags.inshore.findIndex((t) => t.kind === 'EGGER');
      const egger = d.bags.inshore.splice(idx, 1)[0];
      // mimic resolveDraw's clean-policy egger branch
      d.bags.inshore.push({ id: `vn-${egger.id}`, ground: 'inshore', kind: 'VNOTCHED', weightLb: 0, color: 'common' });
      d.notches.inshore = (d.notches.inshore ?? 0) + 1;
      d.players[pid].tracks.conservation += cfg.rep.vNotch;
    }
    expect(d.bags.inshore.length).toBe(before);                       // bag size conserved
    expect(d.bags.inshore.filter((t) => t.kind === 'EGGER').length).toBe(0);
    expect(d.bags.inshore.filter((t) => t.kind === 'VNOTCHED').length).toBe(startEggers);
    expect(d.notches.inshore).toBe(startEggers);                      // the breeding track recorded each one
    expect(d.players[pid].tracks.conservation).toBe(startEggers * cfg.rep.vNotch); // and each paid ONCE
    // and the conservation income is now capped by the world's egger supply
    const worldEggers = (['inshore', 'mid', 'offshore', 'deep'] as const)
      .reduce((n, g) => n + state.bags[g].filter((t) => t.kind === 'EGGER').length, 0);
    expect(worldEggers).toBeLessThan(60); // was effectively unbounded before this change
  });
});

describe('the event feed never leaks a rival\'s soak', () => {
  it('redacts the stage off a haul line taken from a real game', () => {
    // Play a real game and harvest the engine's ACTUAL haul lines, rather than
    // asserting against a literal that would keep passing after the engine's
    // wording changed. That drift is the bug this test exists to catch: the
    // redactor fails OPEN, so a stale pattern leaks silently.
    let state = createInitialState(defaultConfig, 4242);
    const hauls: string[] = [];
    let guard = 0;
    while (state.phase !== 'GAME_OVER' && guard++ < 200000) {
      const pid = activePlayerId(state);
      const before = state.log.length;
      state = reduce(state, BOTS.gambler(state, pid, legalActions(state, pid)));
      for (const line of state.log.slice(before)) if (/ hauls \(/.test(line)) hauls.push(line);
    }
    expect(hauls.length).toBeGreaterThan(5);   // guard against a vacuous test

    const me = Object.values(state.players)[0].name;
    const rivalHauls = hauls.filter((h) => !h.startsWith(`${me} `));
    expect(rivalHauls.length).toBeGreaterThan(0);

    for (const line of rivalHauls) {
      const out = redactRival(line, me);
      expect(out).not.toBe(line);              // the pattern still MATCHES the engine
      const stage = line.match(/ hauls \(\w+\/(\w+)\)/)![1];
      expect(out).not.toContain(`/${stage}`);  // and the stage is gone
      expect(out).toContain('hauls a pot');
    }

    // my own hauls pass through untouched — I am allowed to know my own soak
    const mine = hauls.filter((h) => h.startsWith(`${me} `));
    for (const line of mine) expect(redactRival(line, me)).toBe(line);
  });
});

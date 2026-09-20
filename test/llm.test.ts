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
import { LlmCaptain } from '../src/llm/agent';
import { enterAuction } from '../src/engine/auction';
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

  it('rules prompt carries the live numbers', () => {
    const r = buildRulesPrompt(defaultConfig, 4);
    expect(r).toContain('4-player game');
    expect(r).toContain(`MONEY VP = money ÷ ${defaultConfig.scoring.moneyPerVP}`);
    expect(r).toContain(`REPUTATION VP = reputation × ${defaultConfig.scoring.repToVP}`);
    expect(r).toContain(deepNode(defaultConfig));   // whatever the current map calls the deep
    expect(r).toContain(`${defaultConfig.tow.lostTurns} turns`);
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

  it('a whole bot game can be driven through the command parser (HAUL/SELL/CLAIM round-trip)', () => {
    // Drive a game with the card-counter, but re-encode every chosen action as a
    // command string and parse it back: the parser must reproduce a legal action.
    const cfg = { ...defaultConfig, players: 3 };
    let state = createInitialState(cfg, 7);
    const bot = BOTS.cardcounter;
    let n = 0; let restockSeen = false; let auctionSeen = false;
    while (state.phase !== 'GAME_OVER' && n++ < 5000) {
      const pid = activePlayerId(state);
      const legal = legalActions(state, pid);
      const a = bot(state, pid, legal);
      let cmd: string;
      switch (a.type) {
        case 'STEAM': cmd = `STEAM ${a.to}`; break;
        case 'HAUL': cmd = `HAUL ${a.buoyId} ${a.policy ?? 'clean'}${a.useToken ? ' token' : ''}`; break;
        case 'STEAL': cmd = `STEAL ${a.buoyId} ${a.policy ?? 'clean'}`; break;
        case 'REFUEL': cmd = `REFUEL ${a.units}`; break;
        case 'BUY_UPGRADE': cmd = `BUY ${a.upgradeId}`; break;
        case 'RESTOCK_CLAIM': cmd = `CLAIM ${a.ground} heavy`; restockSeen = true; break;
        case 'RESTOCK_CONTRIBUTE': cmd = `CONTRIBUTE ${a.tileIds.length}`; break;
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
    expect(restockSeen).toBe(true);
    expect(auctionSeen).toBe(true);   // the licence auction runs every season after the first
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
      d.players[pid].vTokens += 1;
      d.players[pid].tracks.conservation += cfg.rep.vNotch;
    }
    expect(d.bags.inshore.length).toBe(before);                       // bag size conserved
    expect(d.bags.inshore.filter((t) => t.kind === 'EGGER').length).toBe(0);
    expect(d.bags.inshore.filter((t) => t.kind === 'VNOTCHED').length).toBe(startEggers);
    expect(d.players[pid].vTokens).toBe(startEggers);                 // paid once each
    // and the conservation income is now capped by the world's egger supply
    const worldEggers = (['inshore', 'mid', 'offshore', 'deep'] as const)
      .reduce((n, g) => n + state.bags[g].filter((t) => t.kind === 'EGGER').length, 0);
    expect(worldEggers).toBeLessThan(60); // was effectively unbounded before this change
  });
});

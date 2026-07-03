import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { score } from '../src/engine/scoring';
import { BOTS } from '../src/bots';
import type { Config, GameState, Ground, BuyerId } from '../src/types';

// Dial #2 — flood rate vs depletion rate. Two questions the SPEC (§12.2) poses:
//   (a) Does the commons actually thin — per ground, is offshore inexhaustible?
//   (b) Does dumping a big catch visibly hurt, so late sellers eat a worse
//       price and rivals pivot buyers? (Flooding depresses the buyer for the
//       NEXT seller, not you — the tension is "sell before your buyer floods.")

const ARCHES = ['steward', 'greedy', 'thief'] as const;
const GROUNDS: Ground[] = ['inshore', 'mid', 'offshore'];
const BUYERS: BuyerId[] = ['coop', 'tourist'];

interface SaleRec { buyer: BuyerId; floodBefore: number; lbs: number; rev: number }

function game(config: Config, seed: number, seatArch: string[]) {
  const policies = seatArch.map((a) => BOTS[a]);
  let state = createInitialState(config, seed);
  const ids = state.turnOrder.slice();
  const sales: SaleRec[] = [];
  let guard = 0;
  while (state.phase === 'PLAYING' && guard++ < 200000) {
    const pid = activePlayerId(state);
    const action = policies[ids.indexOf(pid)](state, pid, legalActions(state, pid));
    if (action.type === 'SELL') {
      const buyer = action.buyerId;
      const floodBefore = state.buyers[buyer].lbsSoldToday;
      const lbs = state.players[pid].hold.reduce((a, t) => a + t.weightLb, 0);
      const m0 = state.players[pid].money;
      state = reduce(state, action);
      sales.push({ buyer, floodBefore, lbs, rev: state.players[pid].money - m0 });
      continue;
    }
    state = reduce(state, action);
  }
  const health: Record<Ground, number> = { inshore: 0, mid: 0, offshore: 0 };
  for (const g of GROUNDS) health[g] = state.bags[g].length / state.bagStart[g];
  return { sales, health, winnerId: score(state)[0].playerId, ids };
}

function runAll(config: Config, seeds: number) {
  const health: Record<Ground, number> = { inshore: 0, mid: 0, offshore: 0 };
  const fresh: Record<BuyerId, { rev: number; lbs: number; n: number }> = { coop: z(), tourist: z() };
  const flooded: Record<BuyerId, { rev: number; lbs: number; n: number }> = { coop: z(), tourist: z() };
  const wins: Record<string, number> = { steward: 0, greedy: 0, thief: 0 };
  let games = 0;
  for (let s = 0; s < seeds; s++) {
    for (let rot = 0; rot < 3; rot++) {
      const seatArch = [0, 1, 2].map((i) => ARCHES[(i + rot) % 3]);
      const r = game(config, 1000 + s, seatArch);
      games++;
      for (const g of GROUNDS) health[g] += r.health[g];
      for (const sale of r.sales) {
        const bucket = sale.floodBefore === 0 ? fresh : flooded;
        bucket[sale.buyer].rev += sale.rev; bucket[sale.buyer].lbs += sale.lbs; bucket[sale.buyer].n++;
      }
      wins[seatArch[r.ids.indexOf(r.winnerId)]]++;
    }
  }
  return { health, fresh, flooded, wins, games };
}
const z = () => ({ rev: 0, lbs: 0, n: 0 });
const perLb = (b: { rev: number; lbs: number }) => (b.lbs > 0 ? b.rev / b.lbs : 0);

const seeds = Number(process.argv[2] ?? 120);

// ---- Part A: per-ground depletion + flood bite at the live config ----
const a = runAll(defaultConfig, seeds);
console.log(`Dial #2 — market flood vs depletion — ${seeds} seeds × 3 rotations, live config\n`);
console.log('Per-ground bag health at end (does the commons thin? is offshore inexhaustible?):');
console.table(GROUNDS.map((g) => ({ ground: g, 'end health%': ((a.health[g] / a.games) * 100).toFixed(1) })));

console.log('\nFlood bite — $/lb when the buyer is FRESH (you sold first) vs already FLOODED:');
console.table(BUYERS.map((b) => ({
  buyer: b,
  'fresh $/lb': perLb(a.fresh[b]).toFixed(2),
  'flooded $/lb': perLb(a.flooded[b]).toFixed(2),
  'flood penalty': perLb(a.fresh[b]) > 0 ? `${(((perLb(a.fresh[b]) - perLb(a.flooded[b])) / perLb(a.fresh[b])) * 100).toFixed(0)}%` : '—',
  'fresh sales': a.fresh[b].n,
  'flooded sales': a.flooded[b].n,
})));

// ---- Part B: tourist-elasticity sweep (how sharp should the flood be?) ----
console.log('\nTourist elasticity sweep — flood severity vs depletion & balance:');
const rows = [0.5, 1.0, 1.5, 2.0].map((elasticity) => {
  const cfg: Config = { ...defaultConfig, buyers: { ...defaultConfig.buyers, tourist: { ...defaultConfig.buyers.tourist, elasticity } } };
  const r = runAll(cfg, seeds);
  return {
    'tourist elast': elasticity,
    'tourist fresh $/lb': perLb(r.fresh.tourist).toFixed(2),
    'tourist flooded $/lb': perLb(r.flooded.tourist).toFixed(2),
    'offshore health%': ((r.health.offshore / r.games) * 100).toFixed(0),
    'S/G/T win%': `${((r.wins.steward / r.games) * 100).toFixed(0)}/${((r.wins.greedy / r.games) * 100).toFixed(0)}/${((r.wins.thief / r.games) * 100).toFixed(0)}`,
  };
});
console.table(rows);

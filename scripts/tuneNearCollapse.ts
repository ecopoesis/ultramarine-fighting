import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import type { Config, Ground } from '../src/types';

// Chunk C step 2: make the near commons COLLAPSE. Design target (user): even a
// NICE table (clean play, v-notching — exactly what the card-counter does) that
// fishes the near grounds in season 1 must find them collapsed at the start of
// season 2. Recovery is stewardship-gated: low base recruitment, so v-notched
// eggers (the extra dice) are what bring near back in the mid-game — and a greedy
// table that keeps eggers gets none of it. Here we tune near bags + near baseDice
// so the nice fleet strips near faster than one restock refills it.

const grounds = Object.keys(defaultConfig.bags) as Ground[];
const SEEDS = Number(process.argv[2] ?? 40);

function measure(config: Config, seeds: number) {
  const S = config.seasons;
  const dens = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  const keepers = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  const drops = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  let money = 0;
  for (let i = 0; i < seeds; i++) {
    let s = createInitialState(config, 1000 + i);
    let seen = 1;
    const snap = (season: number) => {
      for (const g of grounds) {
        const bag = s.bags[g];
        const kl = bag.filter((t) => t.kind === 'KEEPER').reduce((a, t) => a + t.weightLb, 0);
        dens[season - 1][g] += bag.length ? kl / bag.length : 0;
        keepers[season - 1][g] += bag.filter((t) => t.kind === 'KEEPER').length;
      }
    };
    snap(1);
    let g = 0;
    while (s.phase === 'PLAYING' && g++ < 300000) {
      const pid = activePlayerId(s);
      const from = s.players[pid].node;
      const a = BOTS.cardcounter(s, pid, legalActions(s, pid));
      if (a.type === 'DROP') drops[s.season - 1][config.map.nodes[from].ground!]++;
      s = reduce(s, a);
      if (s.phase === 'PLAYING' && s.season !== seen) { seen = s.season; snap(seen); }
    }
    money += Object.values(s.players).reduce((m, p) => m + p.money, 0);
  }
  return { dens, keepers, drops, S, money, boatGames: seeds * config.players };
}

const nearBags = (base: Config, inshore: Record<string, number>, mid: Record<string, number>): Config => ({
  ...base, bags: { ...base.bags, inshore, mid },
});
const die = (base: Config, dieFaces: number): Config => ({
  ...base, restock: { ...base.restock, dieFaces },
});

// Candidates: near bag size × restock die (how many lobsters come back per claim).
const cand: [string, Config][] = [
  ['current (20/20, dieFaces 6)', defaultConfig],
  ['near die 3 (slower recovery)', die(defaultConfig, 3)],
  ['thinner near (die 6)', nearBags(defaultConfig,
    { KEEPER_1lb: 6, KEEPER_2lb: 3, SHORT: 3, JUMBO: 1, EGGER: 2 },
    { KEEPER_2lb: 5, KEEPER_3lb: 2, RARE_2lb: 1, SHORT: 3, JUMBO: 1, EGGER: 2 })],
  ['thinner near + die 3', die(nearBags(defaultConfig,
    { KEEPER_1lb: 6, KEEPER_2lb: 3, SHORT: 3, JUMBO: 1, EGGER: 2 },
    { KEEPER_2lb: 5, KEEPER_3lb: 2, RARE_2lb: 1, SHORT: 3, JUMBO: 1, EGGER: 2 }), 3)],
];

console.log(`=== Near-collapse tuner (${SEEDS} seeds, nice card-counter fleet) ===`);
console.log('TARGET: inshore & mid keeper DENSITY at S2 start should be well below S1 (near collapsed after one season of nice fishing).\n');

for (const [name, cfg] of cand) {
  const r = measure(cfg, SEEDS);
  const dRow = (g: Ground) => r.dens.map((d) => (d[g] / SEEDS).toFixed(2));
  const kRow = (g: Ground) => r.keepers.map((d) => (d[g] / SEEDS).toFixed(0));
  const farShare = r.drops.map((d) => {
    const far = d.offshore + d.deep, tot = grounds.reduce((a, g) => a + d[g], 0);
    return tot ? `${((far / tot) * 100).toFixed(0)}%` : '—';
  });
  const collapse2 = ((r.dens[1].inshore / Math.max(1e-9, r.dens[0].inshore)) * 100).toFixed(0);
  console.log(`--- ${name} ---  money/bg ${(r.money / r.boatGames).toFixed(0)}  |  inshore S2/S1 density = ${collapse2}% (lower = harder collapse)`);
  console.log(`  inshore density S1..S5: [${dRow('inshore').join(', ')}]   keepers: [${kRow('inshore').join(', ')}]`);
  console.log(`  mid     density S1..S5: [${dRow('mid').join(', ')}]   keepers: [${kRow('mid').join(', ')}]`);
  console.log(`  far-drop% S1..S5: [${farShare.join(', ')}]\n`);
}

console.log('Read: want inshore S2/S1 density ~50% or less, far-drop% climbing across seasons, money not starved.');

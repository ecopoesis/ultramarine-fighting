import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { BOTS } from '../src/bots';
import type { Config, Ground, Stage } from '../src/types';

// Chunk C, step 1: open a MIGRATION WINDOW. The card-counter instrument shows the
// fleet never fishes far water at baseline (offshore/deep prime in 3 days = the
// whole 4-day season). Compare two window-openers — speed far prime vs lengthen
// seasons — and a blend, and read which yields a clean inshore→mid→offshore→deep
// ratchet across the five seasons. Uses the strong card-counter as the probe.

const grounds = Object.keys(defaultConfig.bags) as Ground[];
const SEEDS = Number(process.argv[2] ?? 40);

function runMigration(config: Config, seeds: number) {
  const S = config.seasons;
  const drops = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  const density = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  let money = 0, hauls = 0, dropTot = 0;

  for (let i = 0; i < seeds; i++) {
    let s = createInitialState(config, 1000 + i);
    let seen = 1;
    const snap = (season: number) => {
      for (const g of grounds) {
        const bag = s.bags[g];
        density[season - 1][g] += bag.length
          ? bag.filter((t) => t.kind === 'KEEPER').reduce((a, t) => a + t.weightLb, 0) / bag.length
          : 0;
      }
    };
    snap(1);
    let g = 0;
    while (s.phase !== 'GAME_OVER' && g++ < 300000) {
      const pid = activePlayerId(s);
      const from = s.players[pid].node;
      const a = BOTS.cardcounter(s, pid, legalActions(s, pid));
      if (a.type === 'DROP') { drops[s.season - 1][config.map.nodes[from].ground!]++; dropTot++; }
      if (a.type === 'HAUL') hauls++;
      s = reduce(s, a);
      if (s.phase === 'PLAYING' && s.season !== seen) { seen = s.season; snap(seen); }
    }
    money += Object.values(s.players).reduce((m, p) => m + p.money, 0);
  }
  return { drops, density, S, money, hauls, dropTot, boatGames: seeds * config.players };
}

// far-drop share of all drops, per season — the migration signal
function farShareBySeason(r: ReturnType<typeof runMigration>): string[] {
  return r.drops.map((d) => {
    const far = d.offshore + d.deep;
    const tot = grounds.reduce((a, g) => a + d[g], 0);
    return tot ? `${((far / tot) * 100).toFixed(0)}%` : '—';
  });
}

const withCurves = (base: Config, offshore: Stage[], deep: Stage[]): Config => ({
  ...base, soakCurves: { ...base.soakCurves, offshore, deep },
});

// Variants ------------------------------------------------------------------
const baseline = defaultConfig;
// A) speed far prime by one day (offshore prime idx 3→2, deep prime idx 3→2)
const fastFar = withCurves(baseline,
  ['SET', 'SOAKING', 'PRIME', 'PRIME', 'FOULED'],   // offshore: prime day 2, 2-day window
  ['SET', 'SOAKING', 'PRIME', 'FOULED']);           // deep: prime day 2 only, fouls fast
// B) lengthen seasons
const season5: Config = { ...baseline, daysPerSeason: 5 };
const season6: Config = { ...baseline, daysPerSeason: 6 };
// C) blend: modest far speedup + a slightly longer season
const blend: Config = { ...fastFar, daysPerSeason: 5 };

const variants: [string, Config][] = [
  ['baseline (4d, far prime@3)', baseline],
  ['A: fastFar (far prime@2)', fastFar],
  ['B1: season5 (5d)', season5],
  ['B2: season6 (6d)', season6],
  ['C: blend (fastFar + 5d)', blend],
];

console.log(`=== Migration-window comparison (${SEEDS} seeds × card-counter fleet) ===`);
console.log('far-drop% by season = share of drops on offshore+deep; should RISE S1→S5 for a clean ratchet.\n');

const summary: Record<string, unknown>[] = [];
const dropTables: [string, ReturnType<typeof runMigration>][] = [];
for (const [name, cfg] of variants) {
  const r = runMigration(cfg, SEEDS);
  dropTables.push([name, r]);
  const far = farShareBySeason(r);
  summary.push({
    variant: name,
    ...Object.fromEntries(far.map((v, i) => [`S${i + 1}`, v])),
    'money/bg': (r.money / r.boatGames).toFixed(0),
    'haul/drop': (r.hauls / Math.max(1, r.dropTot)).toFixed(2),
  });
}
console.table(summary);

// Detailed drop-by-ground table for each variant (mean per game across seeds)
for (const [name, r] of dropTables) {
  console.log(`\n${name} — drops per ground TYPE by season (mean/season across ${SEEDS} seeds):`);
  console.table(Object.fromEntries(grounds.map((g) => [g, Object.fromEntries(
    r.drops.map((d, i) => [`S${i + 1}`, (d[g] / SEEDS).toFixed(1)]),
  )])));
}

console.log(
  '\nReads:\n' +
  '  • Want far-drop% climbing toward the late seasons AND money staying healthy (not a starved fleet).\n' +
  '  • If far-drop% is still ~0 even with a window, near grounds recover too well — pair with near-bag thinning next.\n' +
  '  • Deep should stay a late-game gamble (small but non-zero share by S4–S5), not an every-season staple.',
);

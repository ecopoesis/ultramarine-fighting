import { defaultConfig } from '../src/config';
import { createInitialState } from '../src/state';
import { reduce } from '../src/reducer';
import { legalActions } from '../src/actions';
import { activePlayerId } from '../src/selectors';
import { makeCardCounter, CARD_COUNTER } from '../src/bots';
import type { Config, Ground } from '../src/types';

// Chunk C step 2 check: does STEWARDSHIP actually decide near recovery? Two fleets
// of the same optimizer, differing only in haul policy: NICE (v-notches eggers →
// they stay in the bag → they are the recruitment dice) vs GREEDY (keeps eggers →
// removes them from the breeding pool → less recovery). If the design holds, the
// nice table's near grounds recover in the mid-game while the greedy table's stay
// collapsed — the same map plays differently by how you treat the commons.

const grounds = Object.keys(defaultConfig.bags) as Ground[];
const SEEDS = Number(process.argv[2] ?? 40);
const nice = makeCardCounter({ ...CARD_COUNTER, name: 'nice' });
const greedy = makeCardCounter({ ...CARD_COUNTER, name: 'greedy', haulPolicy: 'greedy' });

function run(config: Config, bot: ReturnType<typeof makeCardCounter>, seeds: number) {
  const S = config.seasons;
  const dens = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  const eggers = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  const keepers = Array.from({ length: S }, () => Object.fromEntries(grounds.map((g) => [g, 0])) as Record<Ground, number>);
  let money = 0, rep = 0;
  for (let i = 0; i < seeds; i++) {
    let s = createInitialState(config, 1000 + i);
    let seen = 1;
    const snap = (season: number) => {
      for (const g of grounds) {
        const bag = s.bags[g];
        const kl = bag.filter((t) => t.kind === 'KEEPER').reduce((a, t) => a + t.weightLb, 0);
        dens[season - 1][g] += bag.length ? kl / bag.length : 0;
        eggers[season - 1][g] += bag.filter((t) => t.kind === 'EGGER').length;
        keepers[season - 1][g] += bag.filter((t) => t.kind === 'KEEPER').length;
      }
    };
    snap(1);
    let g = 0;
    while (s.phase === 'PLAYING' && g++ < 300000) {
      const pid = activePlayerId(s);
      s = reduce(s, bot(s, pid, legalActions(s, pid)));
      if (s.phase === 'PLAYING' && s.season !== seen) { seen = s.season; snap(seen); }
    }
    money += Object.values(s.players).reduce((m, p) => m + p.money, 0);
    rep += Object.values(s.players).reduce((m, p) => m + p.tracks.reputation, 0);
  }
  const bg = seeds * config.players;
  return { dens, eggers, keepers, money: money / bg, rep: rep / bg };
}

console.log(`=== Stewardship-decides check (${SEEDS} seeds) — nice (v-notch) vs greedy (keep eggers) card-counter fleets ===\n`);
const rN = run(defaultConfig, nice, SEEDS);
const rG = run(defaultConfig, greedy, SEEDS);

const fmt = (arr: Record<Ground, number>[], g: Ground, div: number, dp = 2) => arr.map((d) => (d[g] / div).toFixed(dp));
for (const g of ['inshore', 'mid'] as Ground[]) {
  console.log(`${g} KEEPERS (count) S1..S5   nice [${fmt(rN.keepers, g, SEEDS, 0).join(', ')}]   greedy [${fmt(rG.keepers, g, SEEDS, 0).join(', ')}]`);
  console.log(`${g} keeper DENSITY  S1..S5   nice [${fmt(rN.dens, g, SEEDS).join(', ')}]   greedy [${fmt(rG.dens, g, SEEDS).join(', ')}]`);
  console.log(`${g} EGGERS in bag   S1..S5   nice [${fmt(rN.eggers, g, SEEDS, 0).join(', ')}]   greedy [${fmt(rG.eggers, g, SEEDS, 0).join(', ')}]\n`);
}
console.log(`\nmoney/boat-game   nice ${rN.money.toFixed(0)}   greedy ${rG.money.toFixed(0)}`);
console.log(`reputation/boat   nice ${rN.rep.toFixed(1)}   greedy ${rG.rep.toFixed(1)}  (greedy eats illegalKeep rep)`);
console.log(
  '\nRead: nice should keep MORE eggers in the near bags → higher near density in the mid-game (S3-S4).\n' +
  'If the two are identical, eggers aren’t swinging recruitment enough — raise eggerPerDie leverage or cut base dice further.',
);
